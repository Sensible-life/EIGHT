"""음악 분석: beat / downbeat / 8 count / phrase / 구조 / accent / 음압 변화 / 악기 등장·퇴장.

모든 시간 값은 초 단위. 댄서 관점의 '8 count'는 4/4 기준 2마디(8박).
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np

log = logging.getLogger(__name__)

SR = 22050
HOP = 512
ENV_RATE = 10  # envelope 초당 프레임 수


# ---------------------------------------------------------------- beats

_A2B: dict = {}


def _beats_beat_this(y: np.ndarray, sr: int, device: str) -> Tuple[np.ndarray, np.ndarray]:
    """beat_this (CPJKU, ISMIR 2024): beat + downbeat 동시 추정. 첫 실행 시 가중치 자동 다운로드."""
    from beat_this.inference import Audio2Beats

    if device not in _A2B:
        _A2B[device] = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
    beats, downbeats = _A2B[device](y, sr)
    return np.asarray(beats, float), np.asarray(downbeats, float)


def _beats_grid(y: np.ndarray, sr: int, stems: Dict[str, np.ndarray]):
    """beat_this를 못 쓸 때의 fallback.

    스튜디오 음원(댄스/팝)은 템포가 거의 고정이므로, 템포·위상을 정밀 탐색해
    onset에 가장 잘 맞는 '고정 템포 그리드'를 만든다. (librosa beat_track은
    하이햇 8분음표 구간에서 엇박으로 튀는 문제가 있어 쓰지 않음)
    라이브 연주처럼 템포가 흔들리는 곡은 beat_this를 써야 한다.
    """
    hop = 256
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if "drums" in stems:
        env = env + librosa.onset.onset_strength(y=stems["drums"], sr=sr, hop_length=hop)
    env = env / (env.max() + 1e-9)
    fps = sr / hop
    est = float(librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=hop, start_bpm=110)[0])
    x = np.arange(len(env))
    best = (-1.0, est, 0.0)
    for bpm in np.arange(est * 0.97, est * 1.03, 0.02):
        period = fps * 60.0 / bpm
        k = np.arange(int((len(env) - 1) / period))
        for ph in np.arange(0, period, 0.5):
            s = np.interp(ph + k * period, x, env).mean()
            if s > best[0]:
                best = (s, bpm, ph)
    _, bpm, ph = best
    period = fps * 60.0 / bpm
    beats = (ph + np.arange(int((len(env) - 1 - ph) / period) + 1) * period) / fps
    # 음악이 시작되기 전 무음 구간의 beat는 제거
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    on = np.flatnonzero(rms > 0.05 * rms.max())
    if len(on):
        t_on, t_off = on[0] / fps - 0.1, on[-1] / fps + 0.1
        beats = beats[(beats >= t_on) & (beats <= t_off)]
    return beats, _downbeat_phase(beats, y, sr, stems)


def _downbeat_phase(beats: np.ndarray, y: np.ndarray, sr: int, stems: Dict[str, np.ndarray], bpb: int = 4) -> np.ndarray:
    """마디 첫 박 = 화성(코드) 변화 + 킥(드럼 저역)이 가장 강한 위상."""
    if len(beats) < 2 * bpb:
        return beats[::bpb]
    frames = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)
    score = np.zeros(len(beats))
    harm = sum(stems[k] for k in ("bass", "other", "vocals") if k in stems) if stems else y
    if np.ndim(harm) == 0:
        harm = y
    chroma = librosa.feature.chroma_stft(y=harm, sr=sr, hop_length=HOP)
    cs = librosa.util.sync(chroma, frames, aggregate=np.median)[:, 1 : len(beats) + 1]  # 열 i ↔ beat i
    change = np.r_[0, np.linalg.norm(np.diff(cs, axis=1), axis=0)]
    score[: len(change)] += 2 * _norm(change[: len(score)])
    if "drums" in stems:
        S = np.abs(librosa.stft(stems["drums"], hop_length=HOP))
        low = S[librosa.fft_frequencies(sr=sr) < 120].sum(0)
        score += _norm(np.array([low[max(0, f - 1) : f + 3].max() if f < len(low) else 0 for f in frames]))
    phase = int(np.argmax([score[p::bpb].mean() for p in range(bpb)]))
    return beats[phase::bpb]


def _norm(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, float)
    rng = x.max() - x.min()
    return (x - x.min()) / rng if rng > 0 else np.zeros_like(x)


# ---------------------------------------------------------------- features

def _beat_features(y: np.ndarray, stems: Dict[str, np.ndarray], sr: int, beats: np.ndarray) -> np.ndarray:
    """beat 단위 특징: 음색(MFCC) + 화성(chroma) + stem별 에너지."""
    frames = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=13)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOP)
    feats = [librosa.util.sync(mfcc, frames), librosa.util.sync(chroma, frames, aggregate=np.median)]
    for s in stems.values():
        rms = librosa.feature.rms(y=s, hop_length=HOP)
        feats.append(librosa.amplitude_to_db(librosa.util.sync(rms, frames), ref=np.max) / 20.0)
    n = min(f.shape[1] for f in feats)
    F = np.vstack([f[:, :n] for f in feats])
    F = (F - F.mean(1, keepdims=True)) / (F.std(1, keepdims=True) + 1e-6)
    # sync()는 첫 beat 이전 구간을 0번 열로 넣으므로 한 칸 밀어서 beat i ↔ 열 i+1
    return F[:, 1 : len(beats) + 1] if F.shape[1] > len(beats) else F


def _novelty(F: np.ndarray, w: int = 8) -> np.ndarray:
    """self-similarity matrix 위 checkerboard kernel → 구조 경계 후보 곡선."""
    n = F.shape[1]
    if n < 2 * w + 1:
        return np.zeros(n)
    X = F / (np.linalg.norm(F, axis=0, keepdims=True) + 1e-9)
    S = X.T @ X
    g = np.exp(-0.5 * (np.linspace(-2, 2, 2 * w)) ** 2)
    K = np.outer(g, g) * np.sign(np.outer(np.r_[-np.ones(w), np.ones(w)], np.r_[-np.ones(w), np.ones(w)]))
    P = np.pad(S, w, mode="edge")
    nov = np.array([np.sum(P[i : i + 2 * w, i : i + 2 * w] * K) for i in range(n)])
    nov[: w // 2 + 1] = 0  # 곡 시작/끝의 무음↔음악 전환은 구조 경계가 아님
    nov[-(w // 2 + 1) :] = 0
    return _norm(np.maximum(nov, 0))


# ---------------------------------------------------------------- main

def analyze(
    mix: np.ndarray,
    stems: Dict[str, np.ndarray],
    sr_in: int,
    device: str = "cpu",
    beat_method: str = "auto",
) -> dict:
    """mix: (ch, n) / stems: {name: (ch, n)} → 분석 JSON(dict)."""
    to_mono = lambda a: librosa.resample(np.asarray(a, np.float32).mean(0), orig_sr=sr_in, target_sr=SR)
    y = to_mono(mix)
    st = {k: to_mono(v) for k, v in stems.items()}
    duration = len(y) / SR

    # 1) beat / downbeat
    method = "grid"
    beats = downbeats = None
    if beat_method in ("auto", "beat_this"):
        try:
            beats, downbeats = _beats_beat_this(y, SR, device if device != "mps" else "cpu")
            method = "beat_this"
        except Exception as e:  # 가중치 다운로드 실패 등
            log.warning("beat_this unavailable (%s) → grid fallback", e)
    if beats is None or len(beats) < 8:
        beats, downbeats = _beats_grid(y, SR, st)
        method = "grid"

    nb = len(beats)
    if nb < 2:
        return {"version": 1, "duration": duration, "error": "not enough beats detected", "stems": list(stems)}
    d = np.diff(beats)
    ibi = float(d[(d > 0.5 * np.median(d)) & (d < 1.5 * np.median(d))].mean())
    tempo = 60.0 / ibi
    db_idx = np.unique([int(np.argmin(np.abs(beats - d))) for d in downbeats]) if len(downbeats) else np.array([0])
    bpb = int(np.clip(np.round(np.median(np.diff(db_idx))) if len(db_idx) > 1 else 4, 2, 7))

    # 2) 8 count anchor: 첫 downbeat 또는 한 마디 뒤 중 구조 경계와 더 잘 맞는 쪽
    F = _beat_features(y, st, SR, beats)
    nov = _novelty(F, w=16)  # 4마디 커널: 마디 단위 코드 진행 반복은 무시하고 구간 변화만 잡음
    first = int(db_idx[0]) % 8

    def peakness(a: int) -> float:
        # 후보 위치의 novelty가 한 마디 앞/뒤보다 얼마나 더 높은가 (구간은 보통 8 count의 1에서 바뀜)
        return sum(max(0.0, nov[i] - max(nov[i - bpb] if i >= bpb else 0, nov[i + bpb] if i + bpb < nb else 0))
                   for i in range(a, nb, 8))

    anchor = max(sorted({first, (first + bpb) % 8}), key=peakness)

    beat_list = []
    db_set = set(int(i) for i in db_idx)
    for i, t in enumerate(beats):
        k = i - anchor
        beat_list.append({"t": round(float(t), 3), "count": int(k % 8) + 1, "eight": int(k // 8), "isDownbeat": i in db_set})

    # eight-count 목록
    eights = []
    starts = list(range(anchor, nb, 8))
    if anchor > 0:
        starts = [0] + starts  # 도입부(pickup)
    for j, s in enumerate(starts):
        e = starts[j + 1] if j + 1 < len(starts) else None
        eights.append({
            "index": int((s - anchor) // 8),
            "start": round(float(beats[s]), 3),
            "end": round(float(beats[e]) if e is not None else duration, 3),
            "beat": s,
        })

    # 3) 구조(section): 8 count 경계 중 novelty 피크
    en = np.array([nov[e["beat"]] for e in eights]) if eights else np.zeros(0)
    bounds = [0]
    if len(en) > 4:
        thr = en.mean() + 0.5 * en.std()
        for j in range(1, len(en)):
            local = en[max(0, j - 1) : j + 2]
            if en[j] >= thr and en[j] == local.max() and j - bounds[-1] >= 2:
                bounds.append(j)
    bounds.append(len(eights))

    stem_names = list(stems)
    rms_mix = librosa.feature.rms(y=y, hop_length=HOP)[0]
    rms_st = {k: librosa.feature.rms(y=v, hop_length=HOP)[0] for k, v in st.items()}
    t_rms = librosa.frames_to_time(np.arange(len(rms_mix)), sr=SR, hop_length=HOP)

    def seg_rms(r, a, b):
        m = (t_rms >= a) & (t_rms < b)
        return float(np.sqrt(np.mean(r[m] ** 2))) if m.any() else 0.0

    sections, protos = [], []
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b <= a:
            continue
        t0, t1 = eights[a]["start"], eights[b - 1]["end"]
        bs, be = eights[a]["beat"], (eights[b]["beat"] if b < len(eights) else nb)
        v = F[:, bs:be].mean(1) if be > bs and F.shape[1] >= be else np.zeros(F.shape[0])
        # 반복되는 구간끼리 같은 라벨 (A, B, A', ...)
        label = None
        for lab, p in protos:
            if np.dot(v, p) / (np.linalg.norm(v) * np.linalg.norm(p) + 1e-9) > 0.85:
                label = lab
                break
        if label is None:
            label = chr(ord("A") + len(protos)) if len(protos) < 26 else "Z"
            protos.append((label, v))
        active = [k for k in stem_names if seg_rms(rms_st[k], t0, t1) > 0.1 * (rms_st[k].max() + 1e-9)]
        sections.append({"label": label, "start": t0, "end": t1, "eights": b - a, "loudness": seg_rms(rms_mix, t0, t1), "activeStems": active})

    # 같은 라벨이 연속되면 하나로 합치고, 한 8 count도 안 되는 꼬리는 앞 구간에 붙인다
    merged: List[dict] = []
    for s in sections:
        tail = s["end"] - s["start"] < 8 * ibi * 0.9
        if merged and (s["label"] == merged[-1]["label"] or tail):
            m = merged[-1]
            m["loudness"] = max(m["loudness"], s["loudness"]) if tail else seg_rms(rms_mix, m["start"], s["end"])
            m["end"], m["eights"] = s["end"], m["eights"] + s["eights"]
            m["activeStems"] = [k for k in stem_names if k in m["activeStems"] or (not tail and k in s["activeStems"])]
        else:
            merged.append(s)
    sections = merged
    if sections:
        lo = np.array([s["loudness"] for s in sections])
        # 가장 큰 구간 대비 dB (0dB → 1.0, -12dB 이하 → 0.0)
        lo_n = np.clip((librosa.amplitude_to_db(lo + 1e-9, ref=lo.max()) + 12) / 12, 0, 1)
        for s, e in zip(sections, lo_n):
            s["energy"] = round(float(e), 3)
            s["loudness"] = round(float(librosa.amplitude_to_db(np.array([s["loudness"] + 1e-9]), ref=lo.max())[0]), 1)

    # 4) phrase: section 안에서 4 × 8count(=32박) 단위
    phrases = []
    for s in sections:
        idx = [j for j, e in enumerate(eights) if s["start"] <= e["start"] < s["end"]]
        for k in range(0, len(idx), 4):
            grp = idx[k : k + 4]
            phrases.append({"start": eights[grp[0]]["start"], "end": eights[grp[-1]]["end"], "section": s["label"], "eights": len(grp)})

    # 5) accent: 드럼(없으면 믹스) onset 중 강한 것 / 정박 vs 엇박
    src = st.get("drums", y)
    oenv = librosa.onset.onset_strength(y=src, sr=SR, hop_length=HOP)
    peaks = librosa.onset.onset_detect(onset_envelope=oenv, sr=SR, hop_length=HOP, units="frames")
    accents = []
    if len(peaks):
        strengths = oenv[peaks]
        cut = np.percentile(strengths, 80)
        smax = strengths.max() + 1e-9
        for f, sv in zip(peaks, strengths):
            if sv < cut:
                continue
            t = float(librosa.frames_to_time(f, sr=SR, hop_length=HOP))
            bi = int(np.argmin(np.abs(beats - t)))
            accents.append({
                "t": round(t, 3),
                "strength": round(float(sv / smax), 3),
                "count": beat_list[bi]["count"],
                "offbeat": bool(abs(beats[bi] - t) > 0.25 * ibi),
            })

    # 6) 음압 envelope (0..1, -60dB..0dB) — 앱 시각화·AI intervention 입력
    hop_env = SR // ENV_RATE

    def env(sig):
        r = librosa.feature.rms(y=sig, frame_length=hop_env * 2, hop_length=hop_env)[0]
        return np.round(np.clip((librosa.amplitude_to_db(r + 1e-9, ref=1.0) + 60) / 60, 0, 1), 3).tolist()

    envelope = {"rate": ENV_RATE, "mix": env(y), "stems": {k: env(v) for k, v in st.items()}}

    # 7) 악기 등장/퇴장 (8 count 단위)
    events = []
    for k in stem_names:
        ref = rms_st[k].max() + 1e-9
        prev = None
        for e in eights:
            on = seg_rms(rms_st[k], e["start"], e["end"]) > 0.1 * ref
            if prev is not None and on != prev:
                events.append({"t": e["start"], "stem": k, "type": "enter" if on else "exit", "eight": e["index"]})
            prev = on
    events.sort(key=lambda x: x["t"])

    for e in eights:
        e.pop("beat", None)

    return {
        "version": 1,
        "duration": round(duration, 3),
        "tempo": round(tempo, 2),
        "beatsPerBar": bpb,
        "beatMethod": method,
        "stems": stem_names,
        "beats": beat_list,
        "eights": eights,
        "sections": sections,
        "phrases": phrases,
        "accents": accents,
        "stemEvents": events,
        "envelope": envelope,
    }
