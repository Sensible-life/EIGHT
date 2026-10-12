"""분석 서버.

POST /jobs            음원 업로드 → 분리 + 분석 작업 시작
GET  /jobs            작업 목록
GET  /jobs/{id}       상태/진행률 (앱에서 polling)
GET  /jobs/{id}/analysis   분석 JSON
GET  /files/{id}/{stem}.mp3  stem 오디오
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .analysis import analyze
from .audio_io import load_audio, write_mp3
from .separation import SeparationConfig, make_separator, pick_device

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("server")
logging.getLogger("httpx").setLevel(logging.WARNING)

DATA = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Choreo Music Analysis")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/files", StaticFiles(directory=DATA), name="files")

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=1)  # 모델이 무거우므로 한 번에 한 곡


def _save(job: dict) -> None:
    (DATA / job["id"] / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=1))


def _update(jid: str, **kw) -> None:
    with LOCK:
        JOBS[jid].update(kw, updatedAt=time.time())
        _save(JOBS[jid])


def _load_existing() -> None:
    for p in DATA.glob("*/job.json"):
        try:
            j = json.loads(p.read_text())
            if j.get("status") not in ("done", "error"):
                j.update(status="error", error="server restarted during processing")
            JOBS[j["id"]] = j
        except Exception:
            pass


_load_existing()


def _run(jid: str, src: Path, cfg: SeparationConfig) -> None:
    d = DATA / jid
    try:
        _update(jid, status="loading", stage="음원 디코딩", progress=0.02)
        sep = make_separator(cfg)
        mix = load_audio(src, sr=sep.samplerate)
        _update(jid, duration=mix.shape[1] / sep.samplerate)

        # 분리: 전체 진행률의 0.05 ~ 0.75
        label = "LALAL.AI" if cfg.provider == "lalal" else cfg.model
        _update(jid, status="separating", stage=f"stem 분리 ({label})", progress=0.05)
        t0 = time.time()
        stems = sep.separate(mix, sep.samplerate, progress=lambda f: _update(jid, progress=round(0.05 + 0.7 * f, 3)))
        sep_sec = time.time() - t0

        _update(jid, status="analyzing", stage="beat / 8 count / 구조 분석", progress=0.78)
        t0 = time.time()
        result = analyze(mix, stems, sep.samplerate, device=pick_device(cfg.device))
        result["separation"] = {**cfg.to_dict(), "device": sep.device, "seconds": round(sep_sec, 1)}
        result["analysisSeconds"] = round(time.time() - t0, 1)
        (d / "analysis.json").write_text(json.dumps(result, ensure_ascii=False))

        _update(jid, status="encoding", stage="stem 인코딩", progress=0.9)
        gain = 1.0 / max(1.0, max(float(np.abs(a).max()) for a in [mix, *stems.values()]))
        write_mp3(mix, sep.samplerate, d / "mix.mp3", gain)
        for name, a in stems.items():
            write_mp3(a, sep.samplerate, d / f"{name}.mp3", gain)

        _update(
            jid,
            status="done",
            stage="완료",
            progress=1.0,
            stems=list(stems),
            tempo=result.get("tempo"),
        )
    except Exception as e:
        log.error("job %s failed\n%s", jid, traceback.format_exc())
        _update(jid, status="error", error=f"{type(e).__name__}: {e}")


def _public(job: dict, request: Request) -> dict:
    base = str(request.base_url).rstrip("/")
    out = dict(job)
    if job.get("status") == "done":
        out["files"] = {s: f"{base}/files/{job['id']}/{s}.mp3" for s in ["mix", *job.get("stems", [])]}
        out["analysisUrl"] = f"{base}/jobs/{job['id']}/analysis"
    return out


@app.get("/health")
def health():
    return {"ok": True, "device": pick_device(), "models": ["htdemucs", "htdemucs_ft", "htdemucs_6s"],
            "providers": {"demucs": {"ready": True}, "lalal": {"ready": bool(os.environ.get("LALAL_API_KEY", "").strip())}}}


@app.post("/jobs")
async def create_job(
    request: Request,
    file: UploadFile = File(...),
    original_name: Optional[str] = Form(None),
    model: str = Form("htdemucs"),
    shifts: int = Form(1),
    overlap: float = Form(0.25),
    segment: Optional[float] = Form(None),
    provider: str = Form("demucs"),
    lalal_mode: str = Form("vocals"),
    extraction_level: str = Form("clear_cut"),
    lalal_stems: Optional[str] = Form(None),
    split_vocals: bool = Form(False),
):
    chosen_stems = None
    if provider not in ("demucs", "lalal"):
        raise HTTPException(400, "unknown provider")
    if provider == "lalal":
        if not os.environ.get("LALAL_API_KEY", "").strip():
            raise HTTPException(503, "서버에 LALAL_API_KEY를 설정하고 재시작해 주세요.")
        if lalal_mode not in ("vocals", "four_stem", "multistem") or extraction_level not in ("clear_cut", "deep_extraction"):
            raise HTTPException(400, "invalid LALAL.AI options")
        from .lalal import ALL_STEMS, selected_stems
        if lalal_stems is not None:
            try:
                chosen_stems = json.loads(lalal_stems)
            except (ValueError, TypeError):
                raise HTTPException(400, "lalal_stems must be a JSON array")
            if lalal_mode != "multistem" or not isinstance(chosen_stems, list) or not 1 <= len(chosen_stems) <= len(ALL_STEMS) or any(not isinstance(s, str) or s not in ALL_STEMS for s in chosen_stems) or len(set(chosen_stems)) != len(chosen_stems):
                raise HTTPException(400, "invalid stem selection")
        if split_vocals and "vocals" not in selected_stems(SeparationConfig(lalal_mode=lalal_mode, lalal_stems=chosen_stems)):
            raise HTTPException(400, "split_vocals requires vocals")
        model = "auto"
    elif model not in ("htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx_extra"):
        raise HTTPException(400, f"unknown model {model}")
    jid = uuid.uuid4().hex[:12]
    d = DATA / jid
    d.mkdir(parents=True)
    src = d / ("source" + Path(file.filename or "x.mp3").suffix.lower())
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    cfg = SeparationConfig(provider=provider, lalal_mode=lalal_mode, extraction_level=extraction_level,
                           lalal_stems=chosen_stems, split_vocals=split_vocals,
                           model=model, shifts=max(1, min(shifts, 10)), overlap=min(max(overlap, 0.0), 0.9), segment=segment)
    job = {
        "id": jid,
        "name": Path(original_name).name if original_name else file.filename,
        "status": "queued",
        "stage": "대기 중",
        "progress": 0.0,
        "config": cfg.to_dict(),
        "createdAt": time.time(),
        "updatedAt": time.time(),
    }
    with LOCK:
        JOBS[jid] = job
        _save(job)
    POOL.submit(_run, jid, src, cfg)
    return _public(job, request)


@app.get("/jobs")
def list_jobs(request: Request):
    return sorted((_public(j, request) for j in JOBS.values()), key=lambda j: -j["createdAt"])


@app.get("/jobs/{jid}")
def get_job(jid: str, request: Request):
    if jid not in JOBS:
        raise HTTPException(404)
    return _public(JOBS[jid], request)


@app.get("/jobs/{jid}/analysis")
def get_analysis(jid: str):
    p = DATA / jid / "analysis.json"
    if not p.exists():
        raise HTTPException(404, "analysis not ready")
    return json.loads(p.read_text())


@app.delete("/jobs/{jid}")
def delete_job(jid: str):
    with LOCK:
        if jid not in JOBS:
            raise HTTPException(404)
        if JOBS[jid]["status"] not in ("done", "error"):
            raise HTTPException(409, "처리 중인 작업은 완료 후 삭제해 주세요.")
        JOBS.pop(jid, None)
    shutil.rmtree(DATA / jid, ignore_errors=True)
    return {"ok": True}
