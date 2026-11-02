"""Draws the app icon (1024px PNG) with plain Python, then turns it into an .icns with macOS sips/iconutil."""
import math, struct, zlib, subprocess, os, sys
N = 1024
def sd_round_rect(x, y, cx, cy, hw, hh, r):
    qx, qy = abs(x - cx) - hw + r, abs(y - cy) - hh + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
def smooth(d, w=1.6): return max(0.0, min(1.0, 0.5 - d / w))
rows = []
for j in range(N):
    row = bytearray()
    for i in range(N):
        x, y = i + 0.5, j + 0.5
        a_bg = smooth(sd_round_rect(x, y, 512, 512, 412, 412, 190))      # macOS-style squircle-ish tile
        t = (i + j) / (2 * N)
        r, g, b = (22 + 60 * t, 24 + 50 * t, 40 + 150 * t)                # deep navy → violet
        # soft light from the top left
        glow = max(0.0, 1 - math.hypot(x - 330, y - 260) / 700) * 38
        r, g, b = r + glow, g + glow, b + glow
        # laptop: screen
        a_scr = smooth(sd_round_rect(x, y, 512, 470, 232, 148, 26))
        a_scr_in = smooth(sd_round_rect(x, y, 512, 470, 212, 128, 12))
        # laptop: base (wider, slim)
        a_base = smooth(sd_round_rect(x, y, 512, 668, 316, 24, 22))
        # a play triangle on the screen
        px, py = x - 512, y - 470
        in_tri = (px > -34) and (px < 46) and abs(py) < (46 - px) * 0.575
        a_tri = 1.0 if in_tri else 0.0
        # compose
        def mix(c, col, a): return tuple(c[k] * (1 - a) + col[k] * a for k in range(3))
        c = (r, g, b)
        c = mix(c, (235, 238, 245), a_scr)
        c = mix(c, (30, 34, 70), a_scr_in)
        c = mix(c, (255, 255, 255), a_tri * a_scr_in)
        c = mix(c, (214, 218, 228), a_base)
        row += bytes((int(max(0, min(255, c[0]))), int(max(0, min(255, c[1]))), int(max(0, min(255, c[2]))), int(255 * a_bg)))
    rows.append(b'\x00' + bytes(row))
raw = b''.join(rows)
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'icon.png'), 'wb').write(png)
iconset = os.path.join(out, 'icon.iconset'); os.makedirs(iconset, exist_ok=True)
for s in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = s * scale
        name = f'icon_{s}x{s}{"@2x" if scale == 2 else ""}.png'
        subprocess.run(['sips', '-z', str(px), str(px), os.path.join(out, 'icon.png'), '--out', os.path.join(iconset, name)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(out, 'icon.icns')], check=True)
print('icon written to', out)
