"""서버 전체 흐름 테스트 (업로드 → 분리 → 분석 → mp3 → API).

사전학습 가중치 없이 돌리기 위해 FAKE_WEIGHTS=1이면 같은 구조의 HTDemucs를
랜덤 초기화로 사용한다(분리 품질은 의미 없음, 코드 경로·형상·API 검증용).
실제 맥에서는 FAKE_WEIGHTS 없이 실행하면 진짜 가중치를 받는다.
"""
import os, sys, time, tempfile
sys.path.insert(0, ".")
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp())
if os.environ.get("FAKE_WEIGHTS"):
    import demucs.pretrained
    from demucs.htdemucs import HTDemucs
    demucs.pretrained.get_model = lambda name: HTDemucs(sources=["drums", "bass", "other", "vocals"])
import soundfile as sf
from fastapi.testclient import TestClient
from tests.synth import make_song, SR
from app.main import app

mix, _, _ = make_song(bars_per_sec=4)  # 짧게 (≈24초)
path = os.path.join(tempfile.mkdtemp(), "song.wav"); sf.write(path, mix.T / abs(mix).max(), SR)
c = TestClient(app)
print(c.get("/health").json())
with open(path, "rb") as f:
    j = c.post("/jobs", files={"file": ("song.wav", f, "audio/wav")}, data={"model": "htdemucs", "shifts": "1"}).json()
seen = set()
while True:
    s = c.get(f"/jobs/{j['id']}").json()
    key = (s["status"], round(s["progress"], 1))
    if key not in seen: seen.add(key); print(s["status"], s["progress"], s["stage"])
    if s["status"] in ("done", "error"): break
    time.sleep(0.3)
print(s.get("error") or s["files"])
a = c.get(f"/jobs/{j['id']}/analysis").json()
print("tempo", a["tempo"], "sections", [x["label"] for x in a["sections"]], "sep", a["separation"])
for name, url in s["files"].items():
    r = c.get(url.replace("http://testserver", "")); assert r.status_code == 200, name
    print(name, len(r.content) // 1024, "KB")
