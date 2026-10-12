import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf


def load_audio(path: Path, sr: int = 44100, channels: int = 2) -> np.ndarray:
    """ffmpeg으로 어떤 포맷이든 (channels, samples) float32로 디코드."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", str(channels), "-ar", str(sr), "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, channels).T.copy()


def write_mp3(audio: np.ndarray, sr: int, out: Path, gain: float = 1.0, bitrate: str = "192k") -> None:
    """(ch, n) float → mp3.

    모든 stem을 같은 길이·같은 인코더 설정·같은 gain으로 저장해야
    stem끼리 싱크와 상대 음량이 유지된다 (gain은 호출 측에서 공통으로 계산).
    """
    wav = out.with_suffix(".wav")
    sf.write(wav, np.clip(audio * gain, -1, 1).T, sr, subtype="PCM_16")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", bitrate, str(out)],
        check=True,
    )
    wav.unlink(missing_ok=True)


def write_wav(audio: np.ndarray, sr: int, out: Path, gain: float = 1.0, subtype: str = "PCM_16") -> None:
    """(ch, n) float → wav. stem 품질을 그대로 확인할 때 사용 (float 원본은 subtype='FLOAT')."""
    data = audio * gain
    if subtype != "FLOAT":
        data = np.clip(data, -1, 1)
    sf.write(out, data.T, sr, subtype=subtype)
