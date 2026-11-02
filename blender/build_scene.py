"""Builds the laptop / table / wall scene and exports public/models/scene.glb.
Run inside Blender:  exec(open(path).read())  with OUT_DIR set beforehand.
Object names are used by the web app: Screen, Body*, Wall, Table, Notch.
"""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector

OUT_DIR = globals().get("OUT_DIR")
assert OUT_DIR, "set OUT_DIR first"
TEX_PATH = os.path.join(OUT_DIR, "wood.png")
GLB_PATH = os.path.join(OUT_DIR, "scene.glb")

# ---------- reset ----------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    for b in list(blk):
        blk.remove(b)

# ---------- helpers ----------
def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

def box(name, size, loc, m, bevel=0.002, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        md = o.modifiers.new("bv", "BEVEL")
        md.width = bevel
        md.segments = segs
        md.limit_method = "ANGLE"
        bpy.ops.object.modifier_apply(modifier="bv")
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o

# ---------- wood texture (numpy) ----------
def vnoise(h, w, cells_y, cells_x, rng):
    g = rng.random((cells_y + 2, cells_x + 2))
    ys = np.linspace(0, cells_y, h, endpoint=False)
    xs = np.linspace(0, cells_x, w, endpoint=False)
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def make_wood(path, npath, W=4096, H=2048, planks=3):
    """Smooth satin walnut: long straight fine grain, soft cathedral bands, subtle seams + a matching normal map."""
    rng = np.random.default_rng(21)
    col = np.zeros((H, W, 3), np.float32); hgt = np.zeros((H, W), np.float32)
    dark = np.array([0.060, 0.028, 0.013]); light = np.array([0.235, 0.112, 0.048])
    ph = H // planks
    for p in range(planks):
        y0, y1 = p * ph, ((p + 1) * ph if p < planks - 1 else H); h = y1 - y0
        warp = vnoise(h, W, 2, 5, rng) * 10 + vnoise(h, W, 6, 24, rng) * 2
        yy = np.arange(h)[:, None] + warp * 8
        lines = vnoise(h, W, h // 3, 5, rng)
        lines2 = vnoise(h, W, h // 9, 12, rng)
        rings = 0.5 + 0.5 * np.sin(yy * 0.045 + vnoise(h, W, 2, 4, rng) * 5)
        t = 0.38 * lines + 0.22 * lines2 + 0.25 * rings + 0.15 * vnoise(h, W, 2, 3, rng)
        c = (dark[None, None] * (1 - t[..., None]) + light[None, None] * t[..., None]) * (0.9 + 0.2 * rng.random())
        c[:2] *= 0.35; c[-2:] *= 0.35                       # fine seams
        col[y0:y1] = c
        hh = lines * 0.6 + lines2 * 0.3; hh[:3] -= 2.0; hh[-3:] -= 2.0
        hgt[y0:y1] = hh
    srgb = np.clip(col, 0, 1) ** (1 / 2.2)
    rgba = np.dstack([srgb, np.ones((H, W), np.float32)])[::-1]
    im = bpy.data.images.new("wood", W, H)
    im.pixels.foreach_set(rgba.ravel()); im.filepath_raw = path; im.file_format = "PNG"; im.save()
    hb = hgt[::-1]
    dy, dx = np.gradient(hb)
    k = 1.6
    n = np.dstack([-dx * k, -dy * k, np.ones_like(hb)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    nrgba = np.dstack([n * 0.5 + 0.5, np.ones((H, W), np.float32)]).astype(np.float32)
    nim = bpy.data.images.new("wood_n", W, H)
    nim.pixels.foreach_set(nrgba.ravel()); nim.filepath_raw = npath; nim.file_format = "PNG"; nim.save()
    nim.colorspace_settings.name = "Non-Color"
    return im, nim

wood_img, wood_n = make_wood(TEX_PATH, os.path.join(OUT_DIR, 'wood_n.png'))

# ---------- materials ----------
M_ALU = mat("Body", (0.72, 0.73, 0.75), 0.32, 1.0)
M_DECK = mat("BodyDeck", (0.05, 0.05, 0.055), 0.6, 0.0)
M_KEY = mat("Keys", (0.025, 0.025, 0.028), 0.55, 0.0)
M_PAD = mat("Trackpad", (0.62, 0.63, 0.65), 0.2, 1.0)
M_BEZEL = mat("Bezel", (0.004, 0.004, 0.005), 0.25, 0.0)

M_WOOD = bpy.data.materials.new("Wood"); M_WOOD.use_nodes = True
nt = M_WOOD.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = wood_img
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.5
for nme, val in (("Coat Weight", 0.35), ("Coat Roughness", 0.22), ("Specular IOR Level", 0.5)):
    if nme in bsdf.inputs: bsdf.inputs[nme].default_value = val
ntex = nt.nodes.new("ShaderNodeTexImage"); ntex.image = wood_n
nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 1.0
nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

def make_wall(path, W=1024, H=512):
    rng = np.random.default_rng(3)
    v = np.linspace(1.0, 0.0, H)[:, None]                      # top -> bottom (rows are bottom-up later)
    grad = 0.9 + 0.1 * (1 - v) * 0 + 0.0
    base = np.array([0.93, 0.87, 0.76])
    light = 0.96 + 0.06 * (np.linspace(0, 1, H)[:, None] ** 1.5)  # slightly brighter toward the top
    plaster = 1 + (vnoise(H, W, 64, 128, rng) - 0.5) * 0.035 + (vnoise(H, W, 8, 16, rng) - 0.5) * 0.03
    img = np.clip(base[None, None] * (light * plaster)[..., None], 0, 1)
    rgba = np.dstack([img, np.ones((H, W), np.float32)]).astype(np.float32)
    im = bpy.data.images.new("wall", W, H)
    im.pixels.foreach_set(rgba.ravel()); im.filepath_raw = path; im.file_format = "PNG"; im.save()
    return im

wall_img = make_wall(os.path.join(OUT_DIR, "wall.png"))
M_WALL = bpy.data.materials.new("Wall"); M_WALL.use_nodes = True
_nt = M_WALL.node_tree
_b = next(n for n in _nt.nodes if n.type == "BSDF_PRINCIPLED")
_t = _nt.nodes.new("ShaderNodeTexImage"); _t.image = wall_img
_nt.links.new(_t.outputs["Color"], _b.inputs["Base Color"])
_b.inputs["Roughness"].default_value = 0.95
M_CERAMIC = mat("Ceramic", (0.9, 0.88, 0.84), 0.22, 0.0)
M_COFFEE = mat("Coffee", (0.025, 0.012, 0.006), 0.15, 0.0)
M_BEAN = mat("Bean", (0.09, 0.04, 0.018), 0.4, 0.0)

# ---------- laptop base ----------
W, D, T = 0.312, 0.221, 0.0155        # width, depth, thickness
hinge_y = D / 2
base = box("Body_Base", (W, D, T), (0, 0, T / 2), M_ALU, bevel=0.003)

# keyboard well (dark deck) on top face
box("Body_Deck", (0.276, 0.100, 0.0008), (0, 0.028, T + 0.0001), M_DECK, bevel=0.0004, segs=1)

# keys: build one joined object
rows = [(14, 0.0165), (14, 0.0165), (14, 0.0165), (13, 0.0165), (12, 0.0165)]
key_objs = []
y = 0.028 + 0.05 - 0.011
for r, (n, kh) in enumerate(rows):
    kw = 0.0178
    x0 = -(n - 1) * (kw + 0.0012) / 2
    for i in range(n):
        k = box(f"k{r}_{i}", (kw, kh, 0.0022), (x0 + i * (kw + 0.0012), y, T + 0.0015), M_KEY, bevel=0.0006, segs=1)
        key_objs.append(k)
    y -= kh + 0.0013
# space bar row
for (xw, xc) in [(0.0178, -0.1), (0.0178, -0.08), (0.07, 0.0), (0.0178, 0.08), (0.0178, 0.1)]:
    key_objs.append(box("ks", (xw, 0.0165, 0.0022), (xc, y, T + 0.0015), M_KEY, bevel=0.0006, segs=1))
bpy.ops.object.select_all(action="DESELECT")
for k in key_objs:
    k.select_set(True)
bpy.context.view_layer.objects.active = key_objs[0]
bpy.ops.object.join()
bpy.context.active_object.name = "Keys"

# trackpad
box("Body_Trackpad", (0.115, 0.074, 0.0006), (0, -0.063, T + 0.0003), M_PAD, bevel=0.0005, segs=1)

# ---------- lid ----------
LID_L, LID_T = 0.2145, 0.0058
lid = box("Body_Lid", (W, LID_L, LID_T), (0, -LID_L / 2, LID_T / 2), M_ALU, bevel=0.0028)
# bezel slab on the inner (screen) face, slightly proud
bz = box("Bezel", (W - 0.004, LID_L - 0.004, 0.0004), (0, -LID_L / 2, -0.0001), M_BEZEL, bevel=0.0006, segs=1)

# screen plane (faces -Z in lid space, i.e. toward the viewer once opened)
sw, sh = 0.2905, 0.1815
top_y = -0.0065 - sh
mesh = bpy.data.meshes.new("ScreenMesh")
vs = [(-sw / 2, -0.0065, -0.0004), (sw / 2, -0.0065, -0.0004), (sw / 2, top_y, -0.0004), (-sw / 2, top_y, -0.0004)]
mesh.from_pydata(vs, [], [(0, 3, 2, 1)])
mesh.update()
uv = mesh.uv_layers.new(name="UVMap")
# viewer sees +x on right; local y near hinge (-0.0065) is screen bottom
uvmap = {0: (0, 0), 1: (1, 0), 2: (1, 1), 3: (0, 1)}
for loop in mesh.loops:
    uv.data[loop.index].uv = uvmap[loop.vertex_index]
scr = bpy.data.objects.new("Screen", mesh)
bpy.context.collection.objects.link(scr)
scr.data.materials.append(mat("ScreenMat", (0.02, 0.02, 0.02), 0.2, 0.0))

# notch
notch = box("Notch", (0.0125, 0.0058, 0.0006), (0, -0.0065 - 0.0029, -0.0008), M_BEZEL, bevel=0.0012, segs=3)

# parent lid parts under a hinge empty and open it
hinge = bpy.data.objects.new("LidHinge", None)
bpy.context.collection.objects.link(hinge)
hinge.location = (0, hinge_y, T)
for o in (lid, bz, scr, notch):
    o.parent = hinge
hinge.rotation_euler[0] = math.radians(-103)

# ---------- table & wall ----------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.1, -0.0002))
tbl = bpy.context.active_object
tbl.name = "Table"
tbl.scale = (3.2, 1.6, 1)
bpy.ops.object.transform_apply(scale=True)
tbl.data.materials.append(M_WOOD)

bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.9, 1.4))
wall = bpy.context.active_object
wall.name = "Wall"
wall.rotation_euler[0] = math.radians(90)
wall.scale = (10, 3, 1)
bpy.ops.object.transform_apply(rotation=True, scale=True)
wall.data.materials.append(M_WALL)

# laptop sits slightly rotated like the reference
grp = bpy.data.objects.new("Laptop", None)
bpy.context.collection.objects.link(grp)
for o in bpy.data.objects:
    if o.parent is None and o.name not in ("Laptop", "Table", "Wall"):
        o.parent = grp

# ---------- export ----------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB", use_selection=False,
                          export_apply=True, export_lights=False, export_cameras=False)
print("exported", GLB_PATH, os.path.getsize(GLB_PATH))
