"""LAN relay for aggregated movement data and the optional creative display."""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from .display_agent import MovementGuide, Observation, TARGETS

router = APIRouter()
rooms: dict[str, dict] = {}
ROOM = re.compile(r'^[a-f0-9]{16}$')
DEMO_ROOM = 'd8d8d8d8d8d8d8d8'
LIMBS = ('arm_l', 'arm_r', 'leg_l', 'leg_r')


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


MOVEMENT = {
    'speed': ('still', 'slow', 'medium', 'fast'), 'size': ('small', 'medium', 'large'),
    'direction': ('in place', 'left', 'right', 'up', 'down', 'side to side', 'up-down'),
    'texture': ('smooth', 'sharp', None), 'lead': ('head', 'torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'whole body', None),
    'timing': ('on beat', 'off beat', 'mixed', None),
}


def _movement(value):
    """Movement labels from app/src/tracking/labels.ts: exactly these keys, each one of its known words."""
    if not isinstance(value, dict) or set(value) != set(MOVEMENT):
        return None
    if any(not (value[k] is None or isinstance(value[k], str)) or value[k] not in words for k, words in MOVEMENT.items()):
        return None
    return {k: value[k] for k in MOVEMENT}


PART = {  # None in kind / speed / size: the part was not seen enough to say (labels.ts), never "still"
    'kind': ('hold', 'reach', 'circle', 'swing', 'shake', 'step', 'shift', 'travel', 'jump', 'drop', None), 'speed': (*MOVEMENT['speed'], None), 'size': (*MOVEMENT['size'], None),
    'texture': MOVEMENT['texture'], 'toward': ('up', 'side', 'down', None), 'timing': MOVEMENT['timing'],
}
PART_NAMES = ('arm_l', 'arm_r', 'leg_l', 'leg_r', 'torso')
SPACE = {'zone': ('left', 'center', 'right'), 'level': ('low', 'mid', 'high'), 'depth': ('near', 'home', 'far'), 'weight': ('left', 'center', 'right')}


def _words(value, allowed):
    return all((value[k] is None or isinstance(value[k], str)) and value[k] in words for k, words in allowed.items())


def _parts(value):
    """What each body part did (app/src/tracking/labels.ts): the five parts, each with exactly the known keys and words."""
    if not isinstance(value, dict) or set(value) != set(PART_NAMES):
        return None
    if any(not isinstance(p, dict) or set(p) != set(PART) or not _words(p, PART) for p in value.values()):
        return None
    return {name: {k: value[name][k] for k in PART} for name in PART_NAMES}


def _space(value):
    """Where the dancer is against the calibrated spot (app/src/tracking/labels.ts): known words, offsets in torso lengths."""
    numbers = ('x', 'y', 'width')
    if not isinstance(value, dict) or set(value) != set(SPACE) | set(numbers) or not _words(value, SPACE):
        return None
    if any(type(value[k]) not in (int, float) or not math.isfinite(value[k]) or abs(value[k]) > 50 for k in numbers):
        return None
    return {k: value[k] for k in (*SPACE, *numbers)}


def _body(value):
    if not isinstance(value, dict):
        return None
    upper, lower, targets = value.get('upper'), value.get('lower'), value.get('underused')
    if not _number(upper) or not _number(lower) or abs(upper + lower - 1) > 0.02 or not isinstance(targets, list):
        return None
    if len(targets) > len(TARGETS) or any(not isinstance(x, str) or x not in TARGETS for x in targets):
        return None
    body = {'upper': upper, 'lower': lower, 'underused': list(dict.fromkeys(targets))}
    # each limb's share of the movement, for the display's 8 (targets.ts limbShares): the recent window and the last
    # 8-count; optional, and dropped alone when malformed
    for key in ('limbs', 'limbsNow'):
        limbs = value.get(key)
        if isinstance(limbs, dict) and set(limbs) == set(LIMBS) and all(_number(limbs[k]) for k in LIMBS) and abs(sum(limbs.values()) - 1) <= 0.02:
            body[key] = {k: limbs[k] for k in LIMBS}
    return body


def _usage_history(value):
    if not isinstance(value, dict) or not value or any(k not in TARGETS or not _number(v) for k, v in value.items()):
        return None
    return dict(value)


def _targets(value):
    """A list of the guide's targets (what the dancer just tried); anything else is dropped."""
    if not isinstance(value, list) or len(value) > len(TARGETS) or any(not isinstance(x, str) or x not in TARGETS for x in value):
        return None
    return list(dict.fromkeys(value))


@router.get('/projection/{room}', response_class=HTMLResponse)
def display(room: str):
    if not ROOM.fullmatch(room):
        return HTMLResponse('Invalid room', status_code=404)
    return HTMLResponse((Path(__file__).parent / 'projection.html').read_text(encoding='utf-8'))


@router.get('/display/moves', response_class=HTMLResponse)
def moves_page():
    """What each movement word means: scripted figures, read by the same labeler as the dancer (app/src/tracking/figures.ts)."""
    return HTMLResponse((Path(__file__).parent / 'moves.html').read_text(encoding='utf-8'))


@router.get('/display/{room}', response_class=HTMLResponse)
def creative_display(room: str):
    if room != 'demo' and not ROOM.fullmatch(room):
        return HTMLResponse('Invalid room', status_code=404)
    return HTMLResponse((Path(__file__).parent / 'display.html').read_text(encoding='utf-8'))


@router.get('/display', response_class=HTMLResponse)
def webcam_display():
    """The display reading the dancer with this computer's webcam; ?room=<phone room> joins a phone session as its camera."""
    return HTMLResponse((Path(__file__).parent / 'display.html').read_text(encoding='utf-8'))


@router.get('/movement')
def movement_camera(room: str | None = None):
    """The old webcam page is now the display itself."""
    return RedirectResponse(f'/display?room={room}' if room and ROOM.fullmatch(room) else '/display', status_code=307)


@router.get('/movement/rooms')
def movement_rooms():
    """Phone sessions a webcam page can join: rooms with a publisher and no camera yet."""
    return {'rooms': [room for room, s in rooms.items() if s['publisher'] is not None and s['camera'] is None and not s.get('demo')]}


@router.get('/static/tracking.js')
def tracking_module():
    """The tracking code bundled for the display page (app/scripts/build-display.cjs)."""
    return Response((Path(__file__).parent / 'static' / 'tracking.js').read_text(encoding='utf-8'), media_type='text/javascript')


async def broadcast(state: dict, packet: str):
    await asyncio.gather(*(v.send_text(packet) for v in list(state['viewers'])), return_exceptions=True)


@router.websocket('/projection/ws/{room}/{role}')
async def relay(ws: WebSocket, room: str, role: str):
    if not ROOM.fullmatch(room) or role not in ('publish', 'view', 'camera'):
        await ws.close(code=1008)
        return
    await ws.accept()
    state = rooms.setdefault(room, {'publisher': None, 'viewers': set(), 'last': None, 'last_at': None, 'guide': None, 'camera': None, 'cam': None})
    if (role == 'publish' and state['publisher'] is not None) or (role == 'camera' and state['camera'] is not None):
        await ws.close(code=1008)
        return
    if role == 'publish':
        state['publisher'] = ws
        # A demo page (?demo=1: its scripted dancer, read like a webcam) asks sooner, so its whole loop shows within a minute.
        state['demo'] = ws.query_params.get('demo') == '1' or room == DEMO_ROOM
        state['guide'] = MovementGuide(warmup=5, persistence=2, cooldown=20, no_save_after=7, webcam_warmup=8, webcam_persistence=4,
                                       webcam_cooldown=20, webcam_target_cooldown=40) if state['demo'] else MovementGuide()
    elif role == 'camera':  # a webcam display page (/display?room=) reading the dancer for the phone's session
        state['camera'] = ws
    else:
        state['viewers'].add(ws)
        if state['last'] is not None and state['last_at'] is not None and time.monotonic() - state['last_at'] < 3:
            await ws.send_text(state['last'])
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 4096:
                continue
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    continue
                if role == 'camera':  # kept until the phone's next packet carries it to the viewers
                    cam = {'at': time.monotonic(), 'answering': data.get('answering') is True}
                    for key, check in (('movement', _movement), ('parts', _parts), ('space', _space), ('body', _body), ('explored', _targets)):
                        checked = check(data.get(key))
                        if checked is not None:
                            cam[key] = checked
                    state['cam'] = cam if 'movement' in cam or 'body' in cam else None
                    continue
                if role == 'view' or data.get('type') in ('agent_response', 'agent_enabled'):
                    if state['publisher'] is None or state['last'] is None or state['guide'] is None or state['last_at'] is None or time.monotonic() - state['last_at'] >= 3:
                        continue
                    guide = state['guide']
                    now = time.monotonic()
                    if data.get('type') == 'agent_response':
                        if not isinstance(data.get('proposalId'), str) or not guide.respond(data['proposalId'], data.get('choice'), now):
                            continue
                    elif data.get('type') == 'agent_enabled' and type(data.get('enabled')) is bool:
                        guide.set_enabled(data['enabled'])
                    else:
                        continue
                    previous = json.loads(state['last'])
                    previous['agent'] = guide.public(now, tracking=previous.get('active') is True and bool(previous.get('body')))
                    state['last'] = json.dumps(previous)
                    await broadcast(state, state['last'])
                    if state['publisher'] is not None:
                        await state['publisher'].send_text(state['last'])
                    continue
                cells = data['cells']
                if not isinstance(cells, list) or len(cells) != 64 or any(not _number(x) for x in cells):
                    continue
                now = time.monotonic()
                guide = state['guide']
                if state['last_at'] is not None and now - state['last_at'] >= 3:
                    guide.observe(Observation(active=False), now)
                state['last_at'] = now
                active = data.get('active') is True
                recording = data.get('recording') is True
                body = _body(data.get('body')) if active else None
                explored = (_targets(data.get('explored')) or []) if active else []
                answering = active and data.get('answering') is True
                cam = state['cam'] if state['cam'] and now - state['cam']['at'] < 3 else None
                if cam:  # the room's webcam sees the dancer: its reading stands in for the phone camera's
                    active, body = True, cam.get('body') or body
                    data = {**data, **{k: cam[k] for k in ('movement', 'parts', 'space') if k in cam}}
                    explored, answering = cam.get('explored', []), cam['answering']
                webcam = cam is not None or data.get('source') == 'webcam'  # the guide's rules follow who reads the dancer
                context = data.get('context') if isinstance(data.get('context'), dict) else {}
                pos = context.get('position')
                pos = float(pos) if type(pos) in (int, float) and math.isfinite(pos) and 0 <= pos <= 86400 else None
                rev = context.get('saveRevision')
                rev = rev if type(rev) is int and 0 <= rev <= 1000000 else None
                loop = context.get('loop')
                if isinstance(loop, dict):
                    start, end = loop.get('start'), loop.get('end')
                    if not (type(start) in (int, float) and type(end) in (int, float) and math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= 86400):
                        loop = None
                else:
                    loop = None
                packet = {'cells': cells, 'active': active, 'calibrated': data.get('calibrated') is True}
                if isinstance(data.get('missionTitle'), str) and 0 < len(data['missionTitle']) <= 100:
                    packet['missionTitle'] = data['missionTitle']
                if body is not None:
                    packet['body'] = body
                movement = _movement(data.get('movement')) if active else None
                if movement is not None:
                    packet['movement'] = movement
                for key, check in (('parts', _parts), ('space', _space)):
                    checked = check(data.get(key)) if active else None
                    if checked is not None:
                        packet[key] = checked
                if recording:
                    packet['recording'] = True
                if state['camera'] is not None:  # the phone's music clock, for the webcam page's beat timing
                    note = json.dumps({'phone': {'position': pos, 'playing': context.get('playing') is True, 'recording': recording}})
                    await asyncio.gather(state['camera'].send_text(note), return_exceptions=True)
                agent = guide.observe(Observation(active=active and body is not None,
                                                   upper=body['upper'] if body else None,
                                                   lower=body['lower'] if body else None,
                                                   underused=tuple(body['underused']) if body else (), position=pos, loop_start=loop['start'] if loop else None, loop_end=loop['end'] if loop else None, save_revision=rev, playing=context.get('playing') if type(context.get('playing')) is bool else None,
                                                   project_usage=_usage_history(context.get('projectUsage')),
                                                   overall_usage=_usage_history(context.get('overallUsage')),
                                                   webcam=webcam, explored=tuple(explored), answering=answering,
                                                   movement=movement, parts=packet.get('parts'), space=packet.get('space')), now)
                if body is not None:
                    packet['agent'] = agent
                previous_agent = json.loads(state['last']).get('agent') if state['last'] else None
                state['last'] = json.dumps(packet, allow_nan=False)
                if packet.get('agent') != previous_agent:
                    await ws.send_text(state['last'])
            except (ValueError, TypeError, KeyError):
                continue
            await broadcast(state, state['last'])
    except WebSocketDisconnect:
        pass
    finally:
        if role == 'publish':
            state['publisher'] = None
            state['last'] = None
            state['last_at'] = None
            state['guide'] = None
            await broadcast(state, '{"active":false,"cells":[]}')
        elif role == 'camera':
            state['camera'] = None
            state['cam'] = None
        else:
            state['viewers'].discard(ws)
        if state['publisher'] is None and state['camera'] is None and not state['viewers']:
            rooms.pop(room, None)
