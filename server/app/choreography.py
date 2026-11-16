"""Render a project's single-track choreography into a downloadable MP4."""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

router = APIRouter()
MAX_BYTES = 500 * 1024 * 1024


def render(audios: list[Path], videos: list[Path], clips: list[dict], output: Path) -> None:
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(audios[0])], capture_output=True, text=True, timeout=30, check=True)
    duration = float(probe.stdout.strip())
    if not math.isfinite(duration) or not 0 < duration <= 1800:
        raise ValueError('Music must be no longer than 30 minutes.')
    args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    for path in audios:
        args += ['-i', str(path)]
    for path in videos:
        args += ['-i', str(path)]
    # Black background fills gaps; each clip keeps its aspect ratio and original orientation.
    filters = [f'color=c=black:s=720x1280:r=30:d={duration:.3f}[base0]']
    for i, clip in enumerate(clips):
        start, source, length = clip['start'], clip['sourceStart'], clip['duration']
        rate = clip.get('sourceRate', 1)
        if start + length > duration + .15:
            raise ValueError('A clip extends beyond the music.')
        filters.append(f'[{i + len(audios)}:v]trim=start={source:.3f}:duration={length / rate:.3f},setpts=(PTS-STARTPTS)*{rate:.6f}+{start:.3f}/TB,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1[v{i}]')
        filters.append(f"[base{i}][v{i}]overlay=eof_action=pass:enable='between(t,{start:.3f},{start + length:.3f})'[base{i + 1}]")
    filters.append(''.join(f'[{i}:a]' for i in range(len(audios))) + f'amix=inputs={len(audios)}:normalize=0:duration=shortest[audio]')
    args += ['-filter_complex', ';'.join(filters), '-map', f'[base{len(clips)}]', '-map', '[audio]', '-t', f'{duration:.3f}', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', str(output)]
    subprocess.run(args, capture_output=True, timeout=1800, check=True)


@router.post('/choreography/render')
async def render_choreography(audios: list[UploadFile] = File(...), videos: list[UploadFile] = File(...), timeline: str = Form(...)):
    try:
        clips = json.loads(timeline)
        if not isinstance(clips, list) or not 1 <= len(clips) <= 100 or len(clips) != len(videos) or not 1 <= len(audios) <= 20:
            raise ValueError('Add at least one video clip.')
        end = 0.0
        for clip in clips:
            if not isinstance(clip, dict):
                raise ValueError('Invalid timeline.')
            for key in ('start', 'sourceStart', 'duration'):
                value = clip.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1800:
                    raise ValueError('Invalid timeline time.')
            rate = clip.get('sourceRate', 1)
            if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0.5 <= rate <= 1.5:
                raise ValueError('Invalid video recording speed.')
            if clip['duration'] < .1 or clip['start'] < end - .02:
                raise ValueError('Timeline clips cannot overlap.')
            end = clip['start'] + clip['duration']
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(400, detail=str(error)) from error
    directory = Path(tempfile.mkdtemp(prefix='choreography-'))
    try:
        paths = []
        total = 0
        for i, upload in enumerate([*audios, *videos]):
            path = directory / f'input-{i}'
            with path.open('wb') as output:
                while chunk := await upload.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES:
                        raise HTTPException(413, detail='Files exceed the 500 MB render limit.')
                    output.write(chunk)
            paths.append(path)
        result = directory / 'choreography.mp4'
        await run_in_threadpool(render, paths[:len(audios)], paths[len(audios):], clips, result)
        return FileResponse(result, media_type='video/mp4', filename='choreography.mp4', background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True))
    except HTTPException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(400, detail=f'Could not render video: {error}') from error
