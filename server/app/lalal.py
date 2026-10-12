"""LALAL.AI v1 adapter. License stays on the server; no Demucs weights needed.

Six instruments use native multistem; synth, strings and wind are extracted
sequentially from its remainder. Optional lead/back vocals are split first.
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, urlparse

import numpy as np
import requests
import soundfile as sf

from .audio_io import load_audio

API_BASE = "https://www.lalal.ai/api/v1/"
MULTISTEM_STEMS = ("vocals", "drum", "bass", "piano", "electric_guitar", "acoustic_guitar")
EXTRA_STEMS = ("synthesizer", "strings", "wind")
ALL_STEMS = (*MULTISTEM_STEMS, *EXTRA_STEMS)


def selected_stems(cfg) -> list[str]:
    if cfg.lalal_mode == "vocals":
        return ["vocals"]
    if cfg.lalal_mode == "four_stem":
        return ["vocals", "drum", "bass"]
    return list(cfg.lalal_stems if cfg.lalal_stems is not None else ALL_STEMS)


class LalalError(RuntimeError):
    pass


class LalalClient:
    def __init__(self, license_key: str, poll_interval: float = 5, timeout: float = 1800):
        if not license_key.strip():
            raise LalalError("서버에 LALAL_API_KEY를 설정하고 재시작해 주세요.")
        self.headers = {"X-License-Key": license_key.strip()}
        self.poll_interval = poll_interval
        self.timeout = timeout

    def _post(self, endpoint: str, **kwargs) -> dict:
        try:
            with requests.post(API_BASE + endpoint, headers={**self.headers, **kwargs.pop("headers", {})},
                               timeout=(15, 120), **kwargs) as response:
                if not response.ok:
                    # Don't expose third-party response bodies or request headers to app/logs.
                    hint = {403: "API 키 또는 이용 권한을 확인해 주세요.",
                            402: "처리 잔여량을 확인해 주세요.",
                            429: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."}.get(response.status_code, "요청에 실패했습니다.")
                    raise LalalError(f"LALAL.AI {endpoint} HTTP {response.status_code}: {hint}")
                return response.json()
        except (requests.RequestException, ValueError):
            raise LalalError(f"LALAL.AI {endpoint} 연결 또는 응답 오류") from None

    def upload(self, path: Path) -> str:
        with path.open("rb") as stream:
            result = self._post("upload/", data=stream, headers={
                "Content-Type": "application/octet-stream",
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(path.name)}",
            })
        if not result.get("id"):
            raise LalalError("LALAL.AI 업로드 응답에 source id가 없습니다.")
        return result["id"]

    def split(self, source_id: str, stem: str, extraction_level: str, split_vocals: bool = False) -> str:
        presets = {"stem": stem, "splitter": "phoenix" if stem in EXTRA_STEMS else "auto", "extraction_level": extraction_level}
        if split_vocals:
            presets["multivocal"] = "lead_back"
        result = self._post("split/stem_separator/", json={
            "source_id": source_id,
            "presets": presets,
        })
        if not result.get("task_id"):
            raise LalalError("LALAL.AI 분리 응답에 task id가 없습니다.")
        return result["task_id"]

    def split_multiple(self, source_id: str, extraction_level: str, stems=None) -> str:
        result = self._post("split/multistem/", json={
            "source_id": source_id,
            "presets": {"stem_list": list(stems if stems is not None else ("vocals", "drum", "bass")), "splitter": "auto",
                        "extraction_level": extraction_level},
        })
        if not result.get("task_id"):
            raise LalalError("LALAL.AI 분리 응답에 task id가 없습니다.")
        return result["task_id"]

    def wait(self, task_id: str, progress=None) -> list[dict]:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            result = self._post("check/", json={"task_ids": [task_id]})
            task = result.get("result", {}).get(task_id)
            if not isinstance(task, dict):
                raise LalalError("LALAL.AI 작업 상태가 응답에 없습니다.")
            status = task.get("status")
            if status == "success":
                tracks = task.get("result", {}).get("tracks")
                if not isinstance(tracks, list) or not tracks:
                    raise LalalError("LALAL.AI 결과에 오디오 트랙이 없습니다.")
                if progress:
                    progress(1.0)
                return tracks
            if status != "progress":
                raise LalalError(f"LALAL.AI 작업 실패 ({status})")
            if progress:
                progress(min(0.99, max(0, float(task.get("progress", 0)) / 100)))
            time.sleep(self.poll_interval)
        raise LalalError("LALAL.AI 처리 대기 시간이 초과되었습니다. 원격 작업은 계속될 수 있습니다.")

    def download(self, url: str, path: Path) -> None:
        parsed = urlparse(url)
        # API examples use http://d.lalal.ai; download over TLS, without license headers.
        if parsed.scheme not in ("http", "https") or not parsed.hostname or not (
            parsed.hostname == "lalal.ai" or parsed.hostname.endswith(".lalal.ai")
        ) or parsed.username or parsed.password:
            raise LalalError("LALAL.AI 결과 다운로드 주소가 올바르지 않습니다.")
        url = parsed._replace(scheme="https").geturl()
        try:
            with requests.get(url, stream=True, timeout=(15, 120), allow_redirects=False) as response:
                if response.status_code != 200:
                    raise LalalError(f"LALAL.AI 다운로드 HTTP {response.status_code}")
                with path.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        output.write(chunk)
        except requests.RequestException:
            raise LalalError("LALAL.AI 결과 다운로드 연결 오류") from None


class LalalSeparator:
    samplerate = 44100
    device = "cloud"

    def __init__(self, cfg):
        self.cfg = cfg
        self.selected = selected_stems(cfg)
        self.sources = ["drums" if stem == "drum" else stem for stem in self.selected] + ["other"]
        self.client = LalalClient(os.environ.get("LALAL_API_KEY", ""))

    def separate(self, audio: np.ndarray, sr: int, progress=None) -> dict[str, np.ndarray]:
        if sr != self.samplerate:
            raise ValueError(f"expected {self.samplerate} Hz, got {sr}")
        if not self.selected or len(set(self.selected)) != len(self.selected) or any(s not in ALL_STEMS for s in self.selected):
            raise LalalError("분리할 악기 목록이 올바르지 않습니다.")
        if self.cfg.split_vocals and "vocals" not in self.selected:
            raise LalalError("리드·백킹 분리에는 보컬 선택이 필요합니다.")
        # Native multistem supports only six instruments. Split extra instruments from
        # its remainder, avoiding overlaps from independently extracting the original.
        groups = []
        if self.cfg.split_vocals:
            groups.append((["vocals"], True))
        core = [s for s in MULTISTEM_STEMS if s in self.selected and not (s == "vocals" and self.cfg.split_vocals)]
        if core:
            groups.append((core, False))
        groups.extend(([s], False) for s in EXTRA_STEMS if s in self.selected)
        stems = {}
        with tempfile.TemporaryDirectory(prefix="choreo-lalal-") as tmp:
            source = Path(tmp) / "source.wav"
            sf.write(source, audio.T, sr, subtype="FLOAT")
            for stage, (group, vocal_split) in enumerate(groups):
                source_id = self.client.upload(source)
                task_id = (self.client.split(source_id, group[0], self.cfg.extraction_level, vocal_split)
                           if len(group) == 1 else self.client.split_multiple(source_id, self.cfg.extraction_level, group))
                tracks = self.client.wait(task_id, progress=(
                    lambda fraction, i=stage: progress((i + fraction * 0.9) / len(groups))
                ) if progress else None)
                mapping = [(s, "drums" if s == "drum" else s) for s in group]
                if vocal_split:
                    mapping = [("vocals@0", "lead_vocals"), ("vocals@1", "backing_vocals")]
                for api_stem, name in mapping:
                    track = next((t for t in tracks if t.get("label") == api_stem and t.get("type") == "stem"), None)
                    if not track:
                        if name == "backing_vocals":
                            continue  # documented optional result; don't invent a silent track
                        raise LalalError(f"LALAL.AI {api_stem} 결과에 분리 트랙이 없습니다.")
                    extracted = Path(tmp) / f"{name}.audio"
                    self.client.download(track["url"], extracted)
                    stems[name] = self._decode(extracted, audio.shape[1])
                back_label = f"no_{group[0]}" if len(group) == 1 else "no_multistem"
                track = next((t for t in tracks if t.get("label") == back_label and t.get("type") == "back"), None)
                if not track:
                    raise LalalError("LALAL.AI 결과에 나머지 트랙이 없습니다.")
                remainder = Path(tmp) / "remainder.audio"
                self.client.download(track["url"], remainder)
                remaining_audio = self._decode(remainder, audio.shape[1])
                if stage < len(groups) - 1:
                    source = Path(tmp) / f"remainder_{stage}.wav"
                    sf.write(source, remaining_audio.T, sr, subtype="FLOAT")
                if progress:
                    progress((stage + 1) / len(groups))
            stems["instrumental" if self.selected == ["vocals"] else "other"] = remaining_audio
            self.sources = list(stems)
            if progress:
                progress(1.0)
        return stems

    def _decode(self, path: Path, samples: int) -> np.ndarray:
        audio = load_audio(path, sr=self.samplerate)
        if not np.isfinite(audio).all() or abs(audio.shape[1] - samples) > self.samplerate // 10:
            raise LalalError("분리 오디오 길이가 원곡과 다릅니다. 미리보기/잘린 결과는 사용할 수 없습니다.")
        if audio.shape[1] < samples:
            audio = np.pad(audio, ((0, 0), (0, samples - audio.shape[1])))
        return audio[:, :samples]
