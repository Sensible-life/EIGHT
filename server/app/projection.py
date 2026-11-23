"""LAN relay for aggregated movement data and the optional creative display."""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from .display_agent import MovementGuide, Observation, TARGETS

router = APIRouter()
rooms: dict[str, dict] = {}
ROOM = re.compile(r'^[a-f0-9]{16}$')
DEMO_ROOM = 'd8d8d8d8d8d8d8d8'


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


MOVEMENT = {
    'speed': ('still', 'slow', 'medium', 'fast'), 'size': ('small', 'medium', 'large'),
    'direction': ('in place', 'left', 'right', 'up', 'down', 'side to side', 'up-down'),
    'texture': ('smooth', 'sharp', None), 'lead': ('head', 'torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r', 'whole body', None),
    'timing': ('on beat', 'off beat', 'mixed', None),
}


def _movement(value):
    """Movement labels from app/src/movement/classify.ts: exactly these keys, each one of its known words."""
    if not isinstance(value, dict) or set(value) != set(MOVEMENT):
        return None
    if any(not (value[k] is None or isinstance(value[k], str)) or value[k] not in words for k, words in MOVEMENT.items()):
        return None
    return {k: value[k] for k in MOVEMENT}


PART = {
    'kind': ('hold', 'reach', 'circle', 'swing', 'shake', 'shift', 'travel', 'jump', 'drop'), 'speed': MOVEMENT['speed'], 'size': MOVEMENT['size'],
    'texture': MOVEMENT['texture'], 'toward': ('up', 'side', 'down', None), 'timing': MOVEMENT['timing'],
}
PART_NAMES = ('arm_l', 'arm_r', 'leg_l', 'leg_r', 'torso')
SPACE = {'zone': ('left', 'center', 'right'), 'level': ('low', 'mid', 'high'), 'depth': ('near', 'home', 'far'), 'weight': ('left', 'center', 'right')}


def _words(value, allowed):
    return all((value[k] is None or isinstance(value[k], str)) and value[k] in words for k, words in allowed.items())


def _parts(value):
    """What each body part did (movement.js): the five parts, each with exactly the known keys and words."""
    if not isinstance(value, dict) or set(value) != set(PART_NAMES):
        return None
    if any(not isinstance(p, dict) or set(p) != set(PART) or not _words(p, PART) for p in value.values()):
        return None
    return {name: {k: value[name][k] for k in PART} for name in PART_NAMES}


def _space(value):
    """Where the dancer is against the calibrated spot (movement.js): known words, offsets in torso lengths."""
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
    return {'upper': upper, 'lower': lower, 'underused': list(dict.fromkeys(targets))}


@router.get('/projection/{room}', response_class=HTMLResponse)
def display(room: str):
    if not ROOM.fullmatch(room):
        return HTMLResponse('Invalid room', status_code=404)
    return HTMLResponse((Path(__file__).parent / 'projection.html').read_text(encoding='utf-8'))


@router.get('/display/{room}', response_class=HTMLResponse)
def creative_display(room: str):
    if room != 'demo' and not ROOM.fullmatch(room):
        return HTMLResponse('Invalid room', status_code=404)
    return HTMLResponse((Path(__file__).parent / 'display.html').read_text(encoding='utf-8'))


@router.get('/movement', response_class=HTMLResponse)
def movement_camera():
    """Webcam page: reads the dancer's movement in the browser and publishes the labels to a room."""
    return HTMLResponse((Path(__file__).parent / 'movement.html').read_text(encoding='utf-8'))


@router.get('/movement.js')
def movement_module():
    return Response((Path(__file__).parent / 'movement.js').read_text(encoding='utf-8'), media_type='text/javascript')


async def broadcast(state: dict, packet: str):
    await asyncio.gather(*(v.send_text(packet) for v in list(state['viewers'])), return_exceptions=True)


@router.websocket('/projection/ws/{room}/{role}')
async def relay(ws: WebSocket, room: str, role: str):
    if not ROOM.fullmatch(room) or role not in ('publish', 'view'):
        await ws.close(code=1008)
        return
    await ws.accept()
    state = rooms.setdefault(room, {'publisher': None, 'viewers': set(), 'last': None, 'last_at': None, 'guide': None})
    if role == 'publish' and state['publisher'] is not None:
        await ws.close(code=1008)
        return
    if role == 'publish':
        state['publisher'] = ws
        state['guide'] = MovementGuide(warmup=5, persistence=2, cooldown=20, no_save_after=7) if room == DEMO_ROOM else MovementGuide()
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
                agent = guide.observe(Observation(active=active and body is not None,
                                                   upper=body['upper'] if body else None,
                                                   lower=body['lower'] if body else None,
                                                   underused=tuple(body['underused']) if body else (), position=pos, loop_start=loop['start'] if loop else None, loop_end=loop['end'] if loop else None, save_revision=rev, playing=context.get('playing') if type(context.get('playing')) is bool else None), now)
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
        else:
            state['viewers'].discard(ws)
        if state['publisher'] is None and not state['viewers']:
            rooms.pop(room, None)
