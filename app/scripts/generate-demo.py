"""Generate original 16-second, 120 BPM bass/drum stems for the in-app demo."""
from pathlib import Path
import math
import random
import struct
import wave
random.seed(403)
root = Path(__file__).resolve().parents[1] / 'assets' / 'audio'
root.mkdir(exist_ok=True)
rate = 22050
for stem in ['bass', 'drums']:
    samples = bytearray()
    for i in range(16 * rate):
        t = i / rate
        beat = t % .5
        if stem == 'bass':
            hz = [55, 55, 65.406, 49][int(t / 2) % 4]
            value = .38 * math.sin(2 * math.pi * hz * beat) * min(1, beat / .006) * math.exp(-beat * 7)
        else:
            kick = .58 * math.sin(2 * math.pi * (48 * beat + 40 * .025 * (1 - math.exp(-beat / .025)))) * math.exp(-beat * 24)
            hat = .07 * random.uniform(-1, 1) * math.exp(-(t % .25) * 150)
            snare = .16 * random.uniform(-1, 1) * math.exp(-beat * 45) if int(t / .5) % 2 else 0
            value = kick + hat + snare
        value *= min(1, (16 - t) / .03)
        samples.extend(struct.pack('<h', round(max(-1, min(1, value)) * 32767)))
    with wave.open(str(root / f'demo-{stem}.wav'), 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(rate); out.writeframes(samples)
