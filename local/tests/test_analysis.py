"""정답을 아는 합성 곡으로 분석 정확도 확인 (Demucs 없이 정답 stem 사용)."""
import sys, time, json, numpy as np
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from tests.synth import make_song, SR
from choreo.analysis import analyze

mix, stems, truth = make_song()
t = time.time()
r = analyze(mix, stems, SR, beat_method=sys.argv[1] if len(sys.argv) > 1 else "auto")
print("time %.1fs  method=%s tempo=%.1f (truth %d) bpb=%d" % (time.time()-t, r["beatMethod"], r["tempo"], truth["bpm"], r["beatsPerBar"]))
one = [b["t"] for b in r["beats"] if b["count"] == 1]
tr8 = truth["downbeats"][::2]
err = [min(abs(np.array(one) - x)) for x in tr8]
print("count-1 vs truth 8-count starts: median err %.3fs, max %.3fs (n=%d/%d)" % (np.median(err), max(err), len(one), len(tr8)))
print("sections:", [(s["label"], s["start"], s["end"], s["activeStems"], s["energy"]) for s in r["sections"]], " truth starts", [round(x,2) for x in truth["sections"]])
print("phrases:", len(r["phrases"]), " eights:", len(r["eights"]))
print("accents:", len(r["accents"]), "offbeat:", sum(a["offbeat"] for a in r["accents"]), "counts:", sorted(set(a["count"] for a in r["accents"])))
print("events:", r["stemEvents"])
print("json size KB:", len(json.dumps(r))//1024)
