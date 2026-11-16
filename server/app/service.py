"""Development service for accounts, record snapshots, community and weekly missions.

Uses a separate SQLite database; the audio analysis API remains independent.
A production deployment needs HTTPS, backups, moderation and managed credentials.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Header, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix='/service')
DB = Path(os.environ.get('SERVICE_DB', Path(__file__).resolve().parent.parent / 'private_data' / 'service.sqlite3'))

@contextmanager
def db():
    audio_root = Path(os.environ.get('DATA_DIR', Path(__file__).resolve().parent.parent / 'data')).resolve()
    if DB.resolve().is_relative_to(audio_root):
        raise RuntimeError('SERVICE_DB must be outside the public audio DATA_DIR')
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def initialize():
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt BLOB NOT NULL, password BLOB NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), sha TEXT NOT NULL, size INTEGER NOT NULL, UNIQUE(user_id,sha));
        CREATE TABLE IF NOT EXISTS snapshots(user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL, data TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS likes(post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), PRIMARY KEY(post_id,user_id));
        CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), text TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS blocks(user_id TEXT REFERENCES users(id), blocked_id TEXT REFERENCES users(id), PRIMARY KEY(user_id,blocked_id));
        CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id), reason TEXT NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS missions(week TEXT PRIMARY KEY, title TEXT NOT NULL, goal INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS mission_joins(user_id TEXT REFERENCES users(id), week TEXT NOT NULL, PRIMARY KEY(user_id,week));
        CREATE TABLE IF NOT EXISTS mission_completions(user_id TEXT REFERENCES users(id), week TEXT NOT NULL, session_id TEXT NOT NULL, seconds REAL NOT NULL, PRIMARY KEY(user_id,week,session_id));
        ''')
        cols = {row['name'] for row in c.execute('PRAGMA table_info(mission_joins)')}
        if 'joined_at' not in cols: c.execute('ALTER TABLE mission_joins ADD COLUMN joined_at REAL NOT NULL DEFAULT 0')

initialize()

def digest(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=2**14, r=8, p=1, dklen=32)

def user_id(authorization: str = Header(default='')) -> str:
    if not authorization.startswith('Bearer '): raise HTTPException(401, '로그인이 필요해요.')
    token = authorization[7:]
    if len(token) > 100: raise HTTPException(401, '로그인이 필요해요.')
    with db() as c:
        row = c.execute('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row: raise HTTPException(401, '로그인이 만료됐어요.')
    return str(row['user_id'])

class Credentials(BaseModel):
    name: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=128)

class Message(BaseModel):
    text: str = Field(min_length=1, max_length=1000)

class Snapshot(BaseModel):
    revision: int = Field(ge=0)
    data: dict

class Complete(BaseModel):
    session_id: str = Field(min_length=1, max_length=120)
    seconds: float = Field(ge=30, le=86400)
    started_at: float = Field(gt=0)

class MissionInput(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    goal: int = Field(ge=1, le=100)

# A bounded per-process limiter avoids unlimited password checks on the development server.
_attempts: dict[str, list[float]] = {}
def throttle(request: Request):
    key = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    recent = [t for t in _attempts.get(key, []) if now - t < 60]
    if len(recent) >= 15: raise HTTPException(429, '잠시 후 다시 시도해 주세요.')
    recent.append(now); _attempts[key] = recent
    if len(_attempts) > 10000: _attempts.clear()

def new_session(c, uid):
    token = secrets.token_urlsafe(32)
    c.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), uid, time.time()+30*86400))
    return token

def credentials(input: Credentials):
    name = input.name.strip().lower()
    if not re.fullmatch(r'[a-z0-9_]{3,30}', name): raise HTTPException(400, '아이디는 영문 소문자, 숫자, 밑줄 3~30자예요.')
    return name

@router.post('/register')
def register(input: Credentials, request: Request):
    throttle(request); name = credentials(input); salt = secrets.token_bytes(16); hashed = digest(input.password, salt); uid = uuid.uuid4().hex
    with db() as c:
        try: c.execute('INSERT INTO users VALUES (?,?,?,?,?)', (uid, name, salt, hashed, time.time()))
        except sqlite3.IntegrityError: raise HTTPException(409, '이미 사용 중인 아이디예요.')
        token = new_session(c, uid)
    return {'token': token, 'name': name, 'userId': uid}

@router.post('/login')
def login(input: Credentials, request: Request):
    throttle(request); name = credentials(input)
    with db() as c:
        row = c.execute('SELECT * FROM users WHERE name=?', (name,)).fetchone()
        salt = row['salt'] if row else bytes(16)
        calculated = digest(input.password, salt)
        if not row or not hmac.compare_digest(calculated, row['password']): raise HTTPException(401, '아이디 또는 비밀번호를 확인해 주세요.')
        token = new_session(c, row['id'])
    return {'token': token, 'name': name, 'userId': row['id']}

@router.post('/logout')
def logout(authorization: str = Header(default=''), uid: str = Depends(user_id)):
    with db() as c: c.execute('DELETE FROM sessions WHERE token_hash=? AND user_id=?', (hashlib.sha256(authorization[7:].encode()).hexdigest(), uid))
    return {'ok': True}

@router.get('/snapshot')
def get_snapshot(uid: str = Depends(user_id)):
    with db() as c: row = c.execute('SELECT revision,data FROM snapshots WHERE user_id=?', (uid,)).fetchone()
    return {'revision': row['revision'], 'data': json.loads(row['data'])} if row else {'revision': 0, 'data': None}

@router.put('/snapshot')
def put_snapshot(input: Snapshot, uid: str = Depends(user_id)):
    raw = json.dumps(input.data, ensure_ascii=False, separators=(',', ':'))
    if len(raw.encode()) > 30_000_000 or input.data.get('version') != 1: raise HTTPException(400, '기록 형식 또는 크기를 확인해 주세요.')
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT revision FROM snapshots WHERE user_id=?', (uid,)).fetchone()
        current = row['revision'] if row else 0
        if input.revision != current: raise HTTPException(409, '다른 기기에서 기록이 바뀌었어요. 먼저 내려받아 주세요.')
        revision = current + 1
        c.execute('INSERT INTO snapshots VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated=excluded.updated', (uid, revision, raw, time.time()))
    return {'revision': revision}

@router.post('/media')
async def upload_media(file: UploadFile = File(...), uid: str = Depends(user_id)):
    directory = DB.parent / 'service-media'
    directory.mkdir(parents=True, exist_ok=True)
    handle, temp_path = tempfile.mkstemp(prefix='upload-', dir=directory)
    total = 0
    digest = hashlib.sha256()
    try:
        with os.fdopen(handle, 'wb') as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > 150_000_000: raise HTTPException(413, '영상은 150MB 이하만 저장할 수 있어요.')
                digest.update(chunk); out.write(chunk)
        if total == 0: raise HTTPException(400, '빈 영상은 저장할 수 없어요.')
        sha = digest.hexdigest()
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            existing = c.execute('SELECT id FROM media WHERE user_id=? AND sha=?',(uid,sha)).fetchone()
            if existing: return {'id': existing['id'], 'size': total}
            used = c.execute('SELECT COALESCE(SUM(size),0) FROM media WHERE user_id=?',(uid,)).fetchone()[0]
            if used + total > 2_000_000_000: raise HTTPException(413, '서버 저장 공간이 부족해요.')
            media_id = uuid.uuid4().hex
            os.replace(temp_path, directory / media_id)
            try: c.execute('INSERT INTO media VALUES (?,?,?,?)',(media_id,uid,sha,total))
            except Exception:
                (directory / media_id).unlink(missing_ok=True)
                raise
        return {'id': media_id, 'size': total}
    finally:
        Path(temp_path).unlink(missing_ok=True)
        await file.close()

@router.get('/media/{media_id}')
def download_media(media_id: str, uid: str = Depends(user_id)):
    with db() as c: row = c.execute('SELECT id FROM media WHERE id=? AND user_id=?',(media_id,uid)).fetchone()
    path = DB.parent / 'service-media' / media_id
    if not row or not path.is_file(): raise HTTPException(404, '영상을 찾을 수 없어요.')
    return FileResponse(path, media_type='video/mp4')

@router.get('/posts')
def posts(uid: str = Depends(user_id)):
    with db() as c:
        rows = c.execute('''SELECT p.id,p.text,p.created,p.user_id,u.name,
          (SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS likes,
          EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked
          FROM posts p JOIN users u ON u.id=p.user_id
          WHERE NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.blocked_id=p.user_id)
          ORDER BY p.created DESC LIMIT 100''', (uid, uid)).fetchall()
        out = []
        for row in rows:
            comments = c.execute('''SELECT c.id,c.text,c.created,u.name FROM comments c JOIN users u ON u.id=c.user_id
              WHERE c.post_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.user_id=? AND b.blocked_id=c.user_id) ORDER BY c.created LIMIT 100''', (row['id'], uid)).fetchall()
            out.append({'id': row['id'], 'authorId': row['user_id'], 'author': row['name'], 'text': row['text'], 'createdAt': row['created'], 'likes': row['likes'], 'liked': bool(row['liked']), 'mine': row['user_id'] == uid, 'comments': [dict(x) for x in comments]})
    return out

@router.post('/posts')
def create_post(input: Message, uid: str = Depends(user_id)):
    text = input.text.strip()
    if not text: raise HTTPException(400, '내용을 입력해 주세요.')
    pid = uuid.uuid4().hex
    with db() as c: c.execute('INSERT INTO posts VALUES (?,?,?,?)', (pid, uid, text, time.time()))
    return {'id': pid}

def visible_post(c, pid, uid):
    row = c.execute('SELECT * FROM posts WHERE id=? AND NOT EXISTS(SELECT 1 FROM blocks WHERE user_id=? AND blocked_id=posts.user_id)', (pid, uid)).fetchone()
    if not row: raise HTTPException(404, '게시글을 찾을 수 없어요.')
    return row

@router.delete('/posts/{pid}')
def delete_post(pid: str, uid: str = Depends(user_id)):
    with db() as c:
        row = visible_post(c,pid,uid)
        if row['user_id'] != uid: raise HTTPException(403, '내 글만 삭제할 수 있어요.')
        c.execute('DELETE FROM posts WHERE id=?', (pid,))
    return {'ok': True}

@router.put('/posts/{pid}/like')
def like(pid: str, uid: str = Depends(user_id)):
    with db() as c: visible_post(c,pid,uid); c.execute('INSERT OR IGNORE INTO likes VALUES (?,?)', (pid,uid))
    return {'ok': True}

@router.delete('/posts/{pid}/like')
def unlike(pid: str, uid: str = Depends(user_id)):
    with db() as c: c.execute('DELETE FROM likes WHERE post_id=? AND user_id=?', (pid,uid))
    return {'ok': True}

@router.post('/posts/{pid}/comments')
def comment(pid: str, input: Message, uid: str = Depends(user_id)):
    text = input.text.strip()
    if not text or len(text) > 300: raise HTTPException(400, '댓글은 1~300자예요.')
    with db() as c: visible_post(c,pid,uid); c.execute('INSERT INTO comments VALUES (?,?,?,?,?)', (uuid.uuid4().hex,pid,uid,text,time.time()))
    return {'ok': True}

@router.post('/posts/{pid}/report')
def report(pid: str, input: Message, uid: str = Depends(user_id)):
    with db() as c: visible_post(c,pid,uid); c.execute('INSERT INTO reports VALUES (?,?,?,?,?)', (uuid.uuid4().hex,pid,uid,input.text.strip(),time.time()))
    return {'ok': True}

@router.put('/blocks/{target}')
def block(target: str, uid: str = Depends(user_id)):
    if target == uid: raise HTTPException(400, '자신을 차단할 수 없어요.')
    with db() as c:
        if not c.execute('SELECT 1 FROM users WHERE id=?',(target,)).fetchone(): raise HTTPException(404, '사용자를 찾을 수 없어요.')
        c.execute('INSERT OR IGNORE INTO blocks VALUES (?,?)',(uid,target))
    return {'ok': True}

@router.delete('/blocks/{target}')
def unblock(target: str, uid: str = Depends(user_id)):
    with db() as c: c.execute('DELETE FROM blocks WHERE user_id=? AND blocked_id=?',(uid,target))
    return {'ok': True}

@router.get('/blocks')
def blocks(uid: str = Depends(user_id)):
    with db() as c: return [dict(r) for r in c.execute('SELECT u.id,u.name FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=?',(uid,)).fetchall()]

def current_week():
    day = datetime.now(ZoneInfo('Asia/Seoul')).date()
    return (day - timedelta(days=day.weekday())).isoformat()

@router.get('/mission')
def mission(uid: str = Depends(user_id)):
    week = current_week()
    with db() as c:
        row = c.execute('SELECT title,goal FROM missions WHERE week=?',(week,)).fetchone()
        enrollment = c.execute('SELECT joined_at FROM mission_joins WHERE user_id=? AND week=?',(uid,week)).fetchone()
        joined = bool(enrollment)
        progress = c.execute('SELECT count(*) FROM mission_completions WHERE user_id=? AND week=?',(uid,week)).fetchone()[0]
    return {'week':week,'title':row['title'] if row else 'Rhythm practice','goal':row['goal'] if row else 3,'joined':joined,'joinedAt':enrollment['joined_at'] if enrollment else None,'progress':progress}

@router.post('/mission/join')
def join_mission(uid: str = Depends(user_id)):
    with db() as c: c.execute('INSERT OR IGNORE INTO mission_joins(user_id,week,joined_at) VALUES (?,?,?)',(uid,current_week(),time.time()))
    return {'ok':True}

@router.post('/mission/complete')
def complete(input: Complete, uid: str = Depends(user_id)):
    week = current_week()
    with db() as c:
        enrollment = c.execute('SELECT joined_at FROM mission_joins WHERE user_id=? AND week=?',(uid,week)).fetchone()
        if not enrollment: raise HTTPException(400,'먼저 미션에 참여해 주세요.')
        if input.started_at < enrollment['joined_at'] or input.started_at > time.time(): raise HTTPException(400,'참여 후 시작한 세션만 기록할 수 있어요.')
        c.execute('INSERT OR IGNORE INTO mission_completions VALUES (?,?,?,?)',(uid,week,input.session_id,input.seconds))
    return {'ok':True}

@router.get('/admin/reports')
def list_reports(x_admin_key: str = Header(default='')):
    key = os.environ.get('SERVICE_ADMIN_KEY', '')
    if not key or not hmac.compare_digest(key, x_admin_key): raise HTTPException(403, '권한이 없어요.')
    with db() as c:
        return [dict(row) for row in c.execute('SELECT id,post_id,user_id,reason,created FROM reports ORDER BY created DESC LIMIT 500').fetchall()]

@router.put('/admin/mission/{week}')
def set_mission(week: str, input: MissionInput, x_admin_key: str = Header(default='')):
    key = os.environ.get('SERVICE_ADMIN_KEY', '')
    if not key or not hmac.compare_digest(key, x_admin_key): raise HTTPException(403,'권한이 없어요.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',week): raise HTTPException(400,'날짜를 확인해 주세요.')
    with db() as c: c.execute('INSERT INTO missions VALUES (?,?,?) ON CONFLICT(week) DO UPDATE SET title=excluded.title,goal=excluded.goal',(week,input.title,input.goal))
    return {'ok':True}
