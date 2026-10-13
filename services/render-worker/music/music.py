"""Original ambient track: warm pad chords + soft kick/hat pulse + sub bass, 44.1kHz stereo.

Usage: python3 music.py OUT.wav [SECONDS]
Fully generated (fixed seed) -> deterministic and free of copyright claims.
"""
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 44100
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 26.0
BPM = 92
beat = 60 / BPM
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)  # fixed seed -> deterministic

def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)

def env_adsr(n, a, r):
    e = np.ones(n)
    ai, ri = int(a * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, ai)
    e[-ri:] *= np.linspace(1, 0, ri)
    return e

# Chord progression (A minor feel): Am - F - C - G, 2 bars each
chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
bar = beat * 4
pad = np.zeros(N)
bass = np.zeros(N)
seg = bar * 2
i = 0
start = 0.0
while start < DUR:
    ch = chords[i % 4]
    s, e = int(start * SR), min(int((start + seg + 0.6) * SR), N)
    n = e - s
    tt = np.arange(n) / SR
    voice = np.zeros(n)
    for m in ch:
        f = note(m)
        for det in (-0.12, 0.0, 0.12):  # detuned saws-ish via few harmonics
            ff = f * 2 ** (det / 12)
            for h in range(1, 6):
                voice += np.sin(2 * np.pi * ff * h * tt + rng.uniform(0, 6)) / (h * 1.6)
    voice *= env_adsr(n, 1.2, 1.2)
    pad[s:e] += voice
    # sub bass root, one octave down
    fb = note(ch[0] - 12)
    bass[s:e] += np.sin(2 * np.pi * fb * tt) * env_adsr(n, 0.3, 0.8)
    start += seg
    i += 1

sos = butter(4, 1800, 'low', fs=SR, output='sos')
pad = sosfilt(sos, pad)
pad /= np.max(np.abs(pad)) + 1e-9
bass /= np.max(np.abs(bass)) + 1e-9

# slow filter-ish swell via amplitude LFO
pad *= 0.75 + 0.25 * np.sin(2 * np.pi * 0.08 * t)

# drums: soft kick on 1 & 3, hats on offbeats, start at 5s (after hook)
drums = np.zeros(N)
kick_len = int(0.35 * SR)
kt = np.arange(kick_len) / SR
kick = np.sin(2 * np.pi * (45 + 90 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 9)
hat_len = int(0.06 * SR)
hat = rng.normal(0, 1, hat_len) * np.exp(-np.arange(hat_len) / SR * 70)
hat = sosfilt(butter(2, 7000, 'high', fs=SR, output='sos'), hat)
k = 5.0
while k < DUR - 3.0:
    pos = int(k * SR)
    beat_idx = round((k - 5.0) / beat)
    if beat_idx % 2 == 0:
        drums[pos:pos + kick_len] += kick[: max(0, min(kick_len, N - pos))]
    hp = int((k + beat / 2) * SR)
    drums[hp:hp + hat_len] += 0.25 * hat[: max(0, min(hat_len, N - hp))]
    k += beat

mix = 0.55 * pad + 0.35 * bass + 0.45 * drums
# master fade in/out
fade = np.ones(N)
fi, fo = int(1.0 * SR), int(3.0 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.linspace(1, 0, fo)
mix *= fade
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.6  # headroom; leaves room for voiceover later
# light stereo widening via tiny delay
d = int(0.012 * SR)
left = mix
right = np.concatenate([np.zeros(d), mix[:-d]])
stereo = np.stack([left, right], axis=1)
wavfile.write(sys.argv[1], SR, (stereo * 32767).astype(np.int16))
print("wrote", sys.argv[1])
