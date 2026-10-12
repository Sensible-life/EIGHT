"""합성 테스트 곡: 정답(tempo/downbeat/구조)을 알고 있는 4-stem 음원."""
import numpy as np

SR = 44100


def _tone(f, dur, sr=SR, harm=(1, .5, .25)):
    t = np.arange(int(dur * sr)) / sr
    y = sum(a * np.sin(2 * np.pi * f * (i + 1) * t) for i, a in enumerate(harm))
    return y * np.exp(-3 * t)


def make_song(bpm=120, offset=0.3, plan=("A", "B", "A"), bars_per_sec=16, sr=SR):
    beat = 60 / bpm
    nbars = len(plan) * bars_per_sec
    n = int((offset + nbars * 4 * beat + 1) * sr)
    st = {k: np.zeros(n) for k in ("drums", "bass", "other", "vocals")}
    t_k = np.arange(int(0.15 * sr)) / sr
    kick = np.sin(2 * np.pi * (60 + 80 * np.exp(-30 * t_k)) * t_k) * np.exp(-20 * t_k)
    rng = np.random.default_rng(0)
    snare = rng.normal(0, .5, int(.12 * sr)) * np.exp(-25 * np.arange(int(.12 * sr)) / sr)
    hat = rng.normal(0, .15, int(.04 * sr)) * np.exp(-80 * np.arange(int(.04 * sr)) / sr)
    prog = {"A": [48, 43, 45, 41], "B": [50, 53, 55, 52]}

    def add(k, sig, t):
        i = int(t * sr); j = min(n, i + len(sig)); st[k][i:j] += sig[: j - i]

    for bar in range(nbars):
        sec = plan[bar // bars_per_sec]
        t0 = offset + bar * 4 * beat
        root = prog[sec][bar % 4]
        for b in range(4):
            tb = t0 + b * beat
            if b in (0, 2): add("drums", kick * (1.0 if b == 0 else .7), tb)
            if b in (1, 3): add("drums", snare, tb)
            if sec == "B":
                add("drums", hat, tb + beat / 2)
            add("bass", .5 * _tone(440 * 2 ** ((root - 12 - 69) / 12), beat * .9), tb)
        for k in (0, 4, 7):
            add("other", .12 * _tone(440 * 2 ** ((root + 12 + k - 69) / 12), 4 * beat), t0)
        if sec == "B":
            for b in range(4):
                add("vocals", .25 * _tone(440 * 2 ** ((root + 24 + [0, 2, 4, 7][b] - 69) / 12), beat * .8, harm=(1,)), t0 + b * beat)
    st = {k: np.stack([v, v]).astype(np.float32) for k, v in st.items()}
    mix = sum(st.values())
    truth = {"bpm": bpm, "downbeats": [offset + i * 4 * beat for i in range(nbars)],
             "sections": [offset + i * bars_per_sec * 4 * beat for i in range(len(plan))]}
    return mix, st, truth
