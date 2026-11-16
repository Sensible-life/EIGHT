"""Local development-only reference videos."""
from hashlib import sha256
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix='/mock/explore')
VIDEO_DIR = Path(__file__).resolve().parent.parent / 'mock' / 'mission_videos'

def videos():
    if not VIDEO_DIR.exists():
        return []
    return sorted((p for p in VIDEO_DIR.iterdir() if p.is_file() and not p.is_symlink() and p.suffix.lower() == '.mp4'), key=lambda p: p.name.casefold())

def video_id(path: Path):
    return sha256(path.name.encode('utf-8')).hexdigest()[:24]

@router.get('')
def list_videos():
    return [{'id': video_id(p), 'title': p.stem.replace('_', ' ').replace('-', ' ')} for p in videos()]

@router.get('/{item_id}')
def get_video(item_id: str):
    for path in videos():
        if video_id(path) == item_id:
            return FileResponse(path, media_type='video/mp4')
    raise HTTPException(404, 'Video not found')
