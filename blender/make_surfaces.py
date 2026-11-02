"""Generates table-surface and wall (interior) textures into OUT (public/textures). Run inside Blender with OUT set."""
import bpy, os
import numpy as np

OUT = globals()["OUT"]
os.makedirs(OUT, exist_ok=True)
W, H = 2048, 1024


def vnoise(h, w, cy, cx, rng):
    g = rng.random((cy + 2, cx + 2))
    ys = np.linspace(0, cy, h, endpoint=False); xs = np.linspace(0, cx, w, endpoint=False)
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h, w, rng, cells=(4, 8, 16, 32, 64, 128), weights=None):
    weights = weights or [1 / (1.8 ** i) for i in range(len(cells))]
    out = sum(vnoise(h, w, max(1, c * h // w), c, rng) * k for c, k in zip(cells, weights))
    out -= out.min(); return out / out.max()


def save(name, arr, fmt="JPEG"):
    h, w, _ = arr.shape
    if name[-2:] != '_n':  # dither to avoid 8-bit banding on smooth surfaces
        arr = arr + (np.random.default_rng(1).random(arr.shape) - 0.5) * (3.0 / 255)
    rgba = np.dstack([np.clip(arr, 0, 1), np.ones((h, w))])[::-1].astype(np.float32)
    im = bpy.data.images.new(name, w, h)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = os.path.join(OUT, name + (".jpg" if fmt == "JPEG" else ".png")); im.file_format = fmt
    im.save()
    bpy.data.images.remove(im)


def thumb(name, arr):
    th, tw = 96, 160
    ys = np.linspace(0, arr.shape[0] - 1, th).astype(int); xs = np.linspace(0, arr.shape[1] - 1, tw).astype(int)
    # box-ish downsample by averaging blocks
    bh, bw = arr.shape[0] // th, arr.shape[1] // tw
    small = arr[: th * bh, : tw * bw].reshape(th, bh, tw, bw, 3).mean(axis=(1, 3))
    save("t_" + name, small)


def normal_from_height(hm, k):
    dy, dx = np.gradient(hm)
    n = np.dstack([-dx * k, dy * k, np.ones_like(hm)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def wood(rng, dark, light, planks, fine=True):
    col = np.zeros((H, W, 3)); hgt = np.zeros((H, W)); ph = H // planks
    for p in range(planks):
        y0, y1 = p * ph, (p + 1) * ph if p < planks - 1 else H; h = y1 - y0
        warp = vnoise(h, W, 2, 5, rng) * 10 + vnoise(h, W, 6, 24, rng) * 2
        yy = np.arange(h)[:, None] + warp * 8
        lines = vnoise(h, W, max(2, h // 3), 5, rng); lines2 = vnoise(h, W, max(2, h // 9), 12, rng)
        rings = 0.5 + 0.5 * np.sin(yy * 0.05 + vnoise(h, W, 2, 4, rng) * 5)
        t = 0.38 * lines + 0.22 * lines2 + 0.25 * rings + 0.15 * vnoise(h, W, 2, 3, rng)
        c = (np.array(dark) * (1 - t[..., None]) + np.array(light) * t[..., None]) * (0.92 + 0.16 * rng.random())
        c[:2] *= 0.4; c[-2:] *= 0.4
        col[y0:y1] = c
        hh = lines * 0.6 + lines2 * 0.3; hh[:2] -= 2; hh[-2:] -= 2; hgt[y0:y1] = hh
    return col, hgt


rng = np.random.default_rng(5)

# ---------------- surfaces ----------------
col, hgt = wood(rng, (0.50, 0.36, 0.20), (0.80, 0.63, 0.40), 4)            # light oak
save("oak", col); save("oak_n", normal_from_height(hgt, 1.2)); thumb("oak", col)

col, hgt = wood(rng, (0.05, 0.035, 0.03), (0.17, 0.12, 0.095), 3)           # black-stained wood
save("blackwood", col); save("blackwood_n", normal_from_height(hgt, 1.2)); thumb("blackwood", col)

n = fbm(H, W, rng, cells=(3, 12, 48)); smudge = fbm(H, W, rng, cells=(2, 6))   # white board
wb = 0.93 + 0.025 * (n - 0.5) - 0.03 * smudge
col = np.dstack([wb * 0.985, wb * 0.995, wb * 1.0])
save("whiteboard", col); thumb("whiteboard", col)

mr = np.random.default_rng(99)                                                # marble: thin, irregular, fading veins
n1 = fbm(H, W, mr, cells=(4, 9, 20, 44, 90), weights=[1, .7, .5, .35, .25])
n2 = fbm(H, W, mr, cells=(3, 7, 16, 36, 80), weights=[1, .7, .5, .35, .25])
fade = fbm(H, W, mr, cells=(2, 4, 8)) ** 1.6                                  # veins appear in patches, not everywhere
main = np.clip(1 - np.abs(n1 - 0.5) / 0.016, 0, 1) ** 1.6
fine = np.clip(1 - np.abs(n2 - 0.5) / 0.007, 0, 1) ** 1.4
veins = np.clip(main * fade * 0.85 + fine * fade * 0.45, 0, 1)
cloud = fbm(H, W, mr, cells=(3, 9, 30))
base = 0.945 - 0.05 * cloud
col = np.dstack([base, base * 0.995, base * 0.985]) - np.dstack([veins] * 3) * np.array([0.40, 0.42, 0.46])
save("marble", col); thumb("marble", col)

c = fbm(H, W, rng, cells=(2, 6, 24, 96, 300))                                # concrete
pores = (vnoise(H, W, H // 2, W // 2, rng) > 0.93) * 0.12
cg = 0.52 + 0.28 * (c - 0.5) - pores
col = np.dstack([cg, cg * 0.995, cg * 0.98])
save("concrete", col); save("concrete_n", normal_from_height(c * 1.5 + vnoise(H, W, H // 2, W // 2, rng) * 0.4, 2.2)); thumb("concrete", col)

s = fbm(H, W, rng, cells=(3, 12, 60, 240)); speck = (vnoise(H, W, H // 2, W // 2, rng) > 0.9) * 0.05   # slate
sg = 0.075 + 0.05 * s + speck
col = np.dstack([sg, sg * 1.02, sg * 1.06])
save("slate", col); save("slate_n", normal_from_height(s, 1.6)); thumb("slate", col)

# walnut thumb from the baked table texture
wp = os.path.join(os.path.dirname(OUT), "models", "wood.png")
if os.path.exists(wp):
    im = bpy.data.images.load(wp); px = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4)[::-1, :, :3]
    bpy.data.images.remove(im); thumb("walnut", px[::2, ::2])

# ---------------- interiors ----------------
p = fbm(H, W, rng, cells=(4, 16, 64, 256), weights=[1, .6, .3, .15])        # neutral plaster (tinted in the app)
pl = 0.93 + 0.07 * (p - 0.5)
save("plaster", np.dstack([pl, pl, pl]))

col = np.zeros((H, W, 3)); bh, bw = 64, 256                                   # brick wall
mort = np.array([0.60, 0.58, 0.54])
col[:] = mort * (0.9 + 0.2 * fbm(H, W, rng, cells=(8, 64)))[..., None]
for r in range(H // bh):
    off = (bw // 2) if r % 2 else 0
    for k in range(-1, W // bw + 1):
        x0 = k * bw + off; y0 = r * bh
        tone = np.array([0.46, 0.20, 0.14]) * (0.75 + 0.5 * rng.random()) + np.array([0.02, 0.03, 0.02]) * rng.random()
        xa, xb = max(0, x0 + 4), min(W, x0 + bw - 4)
        if xb <= xa: continue
        patch = tone[None, None] * (0.9 + 0.2 * vnoise(bh - 6, xb - xa, 3, 6, rng))[..., None]
        col[y0 + 3: y0 + bh - 3, xa:xb] = patch
col = np.clip(col, 0, 1)
save("brick", col); thumb("brick", col)

col = np.zeros((H, W, 3)); n_sl = 24; sw = W // n_sl                           # vertical wood slats
for k in range(n_sl):
    x0 = k * sw; t = vnoise(H, sw, 4, 3, rng) * 0.5 + vnoise(H, sw, 40, 2, rng) * 0.5
    tone = np.array([0.30, 0.17, 0.08]) + (np.array([0.46, 0.28, 0.14]) - np.array([0.30, 0.17, 0.08])) * t[..., None]
    col[:, x0:x0 + sw] = tone * (0.85 + 0.3 * rng.random())
    col[:, x0:x0 + 3] *= 0.15; col[:, x0 + sw - 2: x0 + sw] *= 0.15
save("slats", col); thumb("slats", col)
print("textures written to", OUT, sorted(os.listdir(OUT)))
