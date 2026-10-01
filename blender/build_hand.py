"""
Builds the god's Hand in Blender, rigs it, and exports it for the game.

Run inside Blender (Scripting tab, or via the MCP add-on):
    exec(open(r"C:/Users/Daryll/Documents/projects/God-Game/blender/build_hand.py").read())

Everything is generated: a right hand (palm down, fingers along game -Z, thumb toward -X)
plus a forearm that fades to nothing through vertex alpha. Pipeline:
  1. loft tubes for fingers / palm+forearm, plus thenar bulges   (parts)
  2. voxel-remesh the union into one smooth skin, smooth, decimate
  3. weights: each part knows its bone blend; transferred to the skin by nearest sample
  4. nails (and claw variants), colours (skin tone, redder knuckles/tips, AO), armature
  5. shape key "evil" (claws, bony knuckles, tendons, gaunt fingers), previews, GLB export

Coordinates are written in *game* space (metres-ish, +Y up, -Z forward). G() converts to
Blender space; the glTF exporter converts back, so the GLB is in game space.
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

PROJECT = r"C:\Users\Daryll\Documents\projects\God-Game"
GLB_PATH = PROJECT + r"\public\models\hand.glb"
BLEND_PATH = PROJECT + r"\blender\hand.blend"
COLLECTION = "Hand"

# ------------------------------------------------------------------ tuning knobs
AO_DIST = 0.17  # creases only: tight AO radius
VOXEL = 0.024  # remesh resolution (smaller = finer)
DECIMATE_RATIO = 0.30  # keep this fraction of triangles after remesh
SMOOTH_ITER = 5
RING_N = 16  # verts around each tube
SKIN = 0xE2A47E  # warm peach
SKIN_RED = 0xCC6C58  # knuckles / fingertips
FADE_START, FADE_END = 0.8, 1.75  # forearm alpha fade (game z)

# Fingers: x of the knuckle, knuckle z, yaw (deg, + = toward +X), lengths (prox, mid, dist), base/tip radius.
# Index sits at -X next to the thumb (right hand, palm down).
FINGERS = [
    ("index", -0.30, -0.44, -3.0, (0.43, 0.27, 0.22), 0.100, 0.072),
    ("middle", -0.10, -0.475, 0.5, (0.47, 0.29, 0.23), 0.102, 0.074),
    ("ring", 0.10, -0.45, 4.0, (0.44, 0.27, 0.22), 0.096, 0.069),
    ("pinky", 0.285, -0.38, 10.0, (0.34, 0.22, 0.17), 0.080, 0.058),
]
REST_FLEX = (0.08, 0.14, 0.10)  # natural downward flex at each joint (radians)
THUMB = dict(base=(-0.28, -0.05, 0.25), yaw=-35.0, pitch=-0.12, lens=(0.42, 0.30, 0.26), flex=(0.0, 0.10, 0.12), w0=0.14, w1=0.092)


def G(x, y, z):
    return Vector((x, -z, y))


def Ginv(v):
    return Vector((v.x, v.z, -v.y))


def srgb(h):
    out = []
    for shift in (16, 8, 0):
        c = ((h >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def sm(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# --------------------------------------------------------------------------- scene


def reset_scene():
    # Work in our own file: the session may have golem/trees open, which we must not touch.
    if os.path.basename(bpy.data.filepath).lower() != "hand.blend":
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
        for name in ("Golem", "GolemPreview", "Trees", "TreesPreview", "Collection"):
            c = bpy.data.collections.get(name)
            if c:
                for ob in list(c.all_objects):
                    bpy.data.objects.remove(ob, do_unlink=True)
                bpy.data.collections.remove(c)
        for ob in list(bpy.data.objects):
            if ob.users_collection == () or ob.name in ("Cube", "Camera", "Light"):
                bpy.data.objects.remove(ob, do_unlink=True)
        for ob in list(bpy.context.scene.collection.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    coll = bpy.data.collections.get(COLLECTION)
    if coll:
        for ob in list(coll.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(coll)
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)
    return coll


def mesh_object(name, bm, coll):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


# ------------------------------------------------------------------- finger model


class Finger:
    """A finger (or thumb) as a bent centre line with a radius profile."""

    def __init__(self, name, base, yaw_deg, lens, flex, w0, w1, pitch0=0.0, bones=None):
        self.name = name
        self.lens = lens
        self.w0, self.w1 = w0, w1
        yaw = math.radians(yaw_deg)
        self.pts = [Vector(base)]
        self.dirs = []
        pitch = pitch0
        for ln, fx in zip(lens, flex):
            pitch -= fx
            d = Vector((math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch)))
            self.dirs.append(d)
            self.pts.append(self.pts[-1] + d * ln)
        self.cum = [0.0]
        for ln in lens:
            self.cum.append(self.cum[-1] + ln)
        self.L = self.cum[-1]
        self.bones = bones or [f"{name}{i + 1}" for i in range(3)]

    def seg(self, s):
        for i in range(3):
            if s <= self.cum[i + 1] or i == 2:
                return i

    def at(self, s):
        """Centre point and unit tangent at arclength s (extrapolated straight beyond the ends)."""
        i = self.seg(s)
        d = self.dirs[i]
        return self.pts[i] + d * (s - self.cum[i]), d

    def radii(self, s):
        sc = max(0.0, min(s, self.L))
        t = sc / self.L
        r = self.w0 + (self.w1 - self.w0) * (t**0.85)
        swell = 1.0 + 0.10 * math.exp(-(sc / 0.07) ** 2)
        swell += 0.075 * math.exp(-((sc - self.cum[1]) / 0.05) ** 2) + 0.06 * math.exp(-((sc - self.cum[2]) / 0.045) ** 2)
        swell -= 0.035 * math.exp(-((sc - (self.cum[1] + self.cum[2]) / 2) / 0.07) ** 2)
        if t > 0.8:
            swell *= 1.0 + 0.04 * sm((t - 0.8) / 0.2)  # soft spatulate pad
        r *= swell
        return r, r * 0.9

    def frame(self, s):
        c, t = self.at(s)
        side = t.cross(Vector((0, 1, 0))).normalized()
        up = side.cross(t).normalized()
        return c, t, side, up

    def weights(self, s, h=0.06, palm_blend=None):
        """Bone weights at arclength s: palm -> bone1 -> bone2 -> bone3 with smooth joint blends."""
        j1, j2 = self.cum[1], self.cum[2]
        if palm_blend is None:
            a = sm((s + h) / (2 * h))
        else:
            a = sm((s - palm_blend[0]) / (palm_blend[1] - palm_blend[0]))
        b = sm((s - j1 + h) / (2 * h))
        c = sm((s - j2 + h) / (2 * h))
        w = {}
        if a < 1:
            w["palm"] = 1 - a
        w[self.bones[0]] = a * (1 - b)
        w[self.bones[1]] = b * (1 - c)
        w[self.bones[2]] = c
        return {k: v for k, v in w.items() if v > 1e-4}

    def top_y(self, s, xo):
        """Skin surface height (game y) above the centre line at arclength s, lateral offset xo."""
        rw, rh = self.radii(s)
        sc = 1.0
        if s > self.L:
            sc = math.cos(math.asin(min(1.0, (s - self.L) / rw)))
        across = math.sqrt(max(0.0, 1 - (xo / max(rw * sc, 1e-5)) ** 2))
        return rh * sc * across


# --------------------------------------------------------------------- tube lofts

BY_NAME = {}
SAMPLES = []  # (game-space position, owner name, arclength, centre-line point, weights)


def ellipse_pt(a, b, phi, n=2.0, flat_below=1.0):
    c, s = math.cos(phi), math.sin(phi)
    x = a * math.copysign(abs(c) ** (2 / n), c)
    y = b * math.copysign(abs(s) ** (2 / n), s)
    if y < 0:
        y *= flat_below
    return x, y


def build_loft(bm, stations, caps=True, cap_len=None):
    """stations: list of (centre, side, up, a, b, n, sample_fn(pos)->(owner, s, centre, weights)).
    Rounds both ends with quarter-circle caps. Returns nothing; appends geometry to bm."""
    rings = []
    K = 5

    def make_ring(c, side, up, a, b, n, info):
        ring = []
        for i in range(RING_N):
            phi = i / RING_N * math.tau
            x, y = ellipse_pt(a, b, phi, n)
            p = c + side * x + up * y
            ring.append(bm.verts.new(G(*p)))
            if info:
                SAMPLES.append((p.copy(),) + info(p))
        return ring

    first, last = stations[0], stations[-1]
    seq = []
    if caps:
        for k in range(K, 0, -1):  # start cap, from the tip inward
            th = k / K * math.pi / 2
            c, side, up, a, b, n, info = first
            tdir = side.cross(up)  # points toward +tangent? (side x up = -t for our frames) -> see below
            seq.append((c + tdir * (b * math.sin(th)), side, up, a * math.cos(th), b * math.cos(th), n, first[6]))
    seq += list(stations)
    if caps:
        for k in range(1, K + 1):
            th = k / K * math.pi / 2
            c, side, up, a, b, n, info = last
            tdir = up.cross(side)
            seq.append((c + tdir * (b * math.sin(th)), side, up, a * math.cos(th), b * math.cos(th), n, last[6]))
    for st in seq:
        c, side, up, a, b, n, info = st
        rings.append(make_ring(c, side, up, max(a, 1e-4), max(b, 1e-4), n, None if a < 1e-3 else info))
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(RING_N):
            j = (i + 1) % RING_N
            try:
                bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            except ValueError:
                pass


def finger_part(bm, f, s0=-0.16, step=0.04):
    ss = []
    s = s0
    while s < f.L - 1e-6:
        ss.append(s)
        s += step
    ss.append(f.L)
    stations = []
    for s in ss:
        c, t, side, up = f.frame(s)
        rw, rh = f.radii(max(s, 0.0))
        if s < 0:  # buried root: widen into the palm
            k = 1.0 + min(0.5, -s * 2.0)
            rw *= k
            rh *= k

        def info(p, s=s, f=f):
            cc, _ = f.at(s)
            return (f.name, s, cc, f.weights(s) if f.name != "thumb" else f.weights(s, palm_blend=(-0.12, 0.2)))

        stations.append((c, side, up, rw, rh, 2.0, info))
    build_loft(bm, stations, caps=True)


# ---------------------------------------------------------------- palm / forearm

# (z, half-width, half-height, y-centre, superellipse n)
PALM = [
    (-0.52, 0.42, 0.10, 0.0, 2.6),
    (-0.42, 0.46, 0.135, 0.01, 2.5),
    (-0.2, 0.465, 0.16, 0.015, 2.4),
    (0.1, 0.43, 0.168, 0.01, 2.3),
    (0.32, 0.36, 0.17, 0.0, 2.2),
    (0.5, 0.315, 0.175, 0.0, 2.1),
    (0.72, 0.31, 0.19, 0.0, 2.0),
    (1.1, 0.35, 0.235, 0.0, 2.0),
    (1.6, 0.39, 0.275, 0.0, 2.0),
    (2.0, 0.42, 0.30, 0.0, 2.0),
]


def palm_weights(z):
    a = sm((0.75 - z) / 0.5)  # 0 in the forearm -> 1 in the palm
    w = {}
    if a > 1e-4:
        w["palm"] = a
    if a < 1:
        w["wrist"] = 1 - a
    return w


def palm_part(bm):
    zs = [p[0] for p in PALM]
    stations = []
    z = zs[0]
    while z <= zs[-1] + 1e-6:
        # linear interpolation between station rows, eased
        for i in range(len(PALM) - 1):
            if PALM[i][0] <= z <= PALM[i + 1][0]:
                t = sm((z - PALM[i][0]) / (PALM[i + 1][0] - PALM[i][0]))
                a = PALM[i][1] + (PALM[i + 1][1] - PALM[i][1]) * t
                b = PALM[i][2] + (PALM[i + 1][2] - PALM[i][2]) * t
                yc = PALM[i][3] + (PALM[i + 1][3] - PALM[i][3]) * t
                n = PALM[i][4] + (PALM[i + 1][4] - PALM[i][4]) * t
                break

        def info(p, z=z):
            return ("palm", z, Vector((0, p.y * 0, z)), palm_weights(z))

        stations.append((Vector((0, yc, z)), Vector((-1, 0, 0)), Vector((0, 1, 0)), a, b, n, info))
        z += 0.07
    build_loft(bm, stations, caps=True)


def blob(bm, centre, radii, yaw_deg, weights, owner, seg=14, pitch_deg=0.0):
    ret = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg * 2 // 3), radius=1.0)
    yaw = math.radians(yaw_deg)
    pit = math.radians(pitch_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pit), math.sin(pit)
    for v in ret["verts"]:
        # sphere is built in Blender space; operate in game space
        g = Ginv(v.co)
        x, y, z = g.x * radii[0], g.y * radii[1], g.z * radii[2]
        y, z = y * cp - z * sp, y * sp + z * cp
        x, z = x * cy + z * sy, -x * sy + z * cy
        p = Vector((x, y, z)) + Vector(centre)
        v.co = G(*p)
        SAMPLES.append((p, owner, 0.0, Vector(centre), weights))


# --------------------------------------------------------------------------- nails


def nail_grid(f, evil):
    """A nail (or claw) as a grid on the fingertip. Same topology for both, so it can morph."""
    U, V = 9, 7
    L = f.L
    rwt, _ = f.radii(L)
    s0 = L - f.lens[2] * 0.66
    if evil:
        s_end = L + rwt + 0.34
        W = rwt * 0.72
    else:
        s_end = L + rwt * 0.45
        W = rwt * 0.72
    pts = []
    for iu in range(U):
        u = iu / (U - 1)
        s = s0 + u * (s_end - s0)
        c, t, side, up = f.frame(s)
        if evil:
            wid = W * (1 - u) ** 0.85 * (0.55 + 0.45 * math.sin(min(1, u * 3) * math.pi / 2))
        else:
            wid = W * (1 - (2 * u - 1) ** 6) ** 0.5 * (0.88 + 0.12 * u)
        for iv in range(V):
            v = -1 + 2 * iv / (V - 1)
            xo = v * wid
            if s <= L + rwt:
                y = f.top_y(s, xo)
            else:  # free claw: continue off the tip, curving down
                ds = s - (L + rwt)
                y = -1.4 * ds * ds * (1.0 if evil else 0)
            edge = (1 - v * v) ** (0.9 if evil else 0.6)
            lift = (0.034 if evil else 0.016) * edge * min(1.0, u * 6) - 0.006
            if evil:
                lift += 0.006 * u
            p = c + side * xo + Vector((0, y + lift, 0))
            pts.append(p)
    return pts, U, V


def add_nails(bm, fingers):
    """Append nails (good shape) to bm. Returns the bone of each new vertex and its evil position."""
    bones, evil_pos = [], []
    for f in fingers:
        good, U, V = nail_grid(f, False)
        evil, _, _ = nail_grid(f, True)
        base = []
        for p, pe in zip(good, evil):
            base.append(bm.verts.new(G(*p)))
            bones.append(f.bones[2])
            evil_pos.append(G(*pe))
        faces = []
        for iu in range(U - 1):
            for iv in range(V - 1):
                fc = bm.faces.new((base[iu * V + iv], base[iu * V + iv + 1], base[(iu + 1) * V + iv + 1], base[(iu + 1) * V + iv]))
                fc.material_index = 1
                faces.append(fc)
        bm.normal_update()
        if faces[len(faces) // 2].normal.z < 0:
            for fc in faces:
                fc.normal_flip()
    return bones, evil_pos


# ------------------------------------------------------------------------ materials


def make_materials():
    skin = bpy.data.materials.get("Skin") or bpy.data.materials.new("Skin")
    skin.use_nodes = True
    nt = skin.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL" and n.type != "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Subsurface Weight"].default_value = 0.25
    bsdf.inputs["Subsurface Radius"].default_value = (0.9, 0.35, 0.2)
    bsdf.inputs["Subsurface Scale"].default_value = 0.05
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(attr.outputs["Alpha"], bsdf.inputs["Alpha"])
    skin.surface_render_method = "DITHERED"
    nail = bpy.data.materials.get("Nail") or bpy.data.materials.new("Nail")
    nail.use_nodes = True
    nb = nail.node_tree.nodes["Principled BSDF"]
    nb.inputs["Base Color"].default_value = (*srgb(0xF2C9C0), 1)
    nb.inputs["Roughness"].default_value = 0.4
    return skin, nail


# ----------------------------------------------------------------------- build


def apply_mods(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = new_mesh
    new_mesh.name = old.name
    bpy.data.meshes.remove(old)


BONE_ORDER = None
JOINTS = []  # game-space joint positions (for knuckle redness / bumps)
FINGER_OBJS = []


def build():
    global COLL, SAMPLES, JOINTS, FINGER_OBJS
    COLL = reset_scene()
    SAMPLES = []
    JOINTS = []
    skin_mat, nail_mat = make_materials()

    fingers = [Finger(n, (x, 0.0, z), yaw, lens, REST_FLEX, w0, w1) for (n, x, z, yaw, lens, w0, w1) in FINGERS]
    th = THUMB
    thumb = Finger("thumb", th["base"], th["yaw"], th["lens"], th["flex"], th["w0"], th["w1"], pitch0=th["pitch"])
    FINGER_OBJS = fingers + [thumb]
    for f in FINGER_OBJS:
        JOINTS += [f.pts[i] for i in range(4)]

    # 1. parts
    bm = bmesh.new()
    palm_part(bm)
    for f in FINGER_OBJS:
        finger_part(bm, f)
    blob(bm, (-0.28, -0.075, 0.08), (0.20, 0.10, 0.30), -22, {"palm": 0.55, "thumb1": 0.45}, "thenar")
    blob(bm, (0.31, -0.05, 0.1), (0.12, 0.085, 0.27), 6, {"palm": 1.0}, "hypo")
    for f in fingers:  # knuckle domes on the back of the hand
        rw, rh = f.radii(0)
        blob(bm, (f.pts[0].x, 0.055, f.pts[0].z + 0.03), (rw * 0.95, rh * 0.8, rw * 1.0), 0, {"palm": 0.6, f.bones[0]: 0.4}, f.name, seg=10)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts = mesh_object("hand_parts", bm, COLL)
    bm.free()

    # 2. voxel remesh -> smooth -> decimate
    skin = bpy.data.objects.new("HandSkin", parts.data.copy())
    COLL.objects.link(skin)
    rm = skin.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = VOXEL
    rm.adaptivity = 0.0
    apply_mods(skin)
    sm_mod = skin.modifiers.new("smooth", "SMOOTH")
    sm_mod.factor = 0.6
    sm_mod.iterations = SMOOTH_ITER
    apply_mods(skin)
    dec = skin.modifiers.new("dec", "DECIMATE")
    dec.ratio = DECIMATE_RATIO
    apply_mods(skin)
    bpy.data.objects.remove(parts, do_unlink=True)
    me = skin.data
    for p in me.polygons:
        p.use_smooth = True

    # 3. samples -> weights, finger parameters
    kd = KDTree(len(SAMPLES))
    for i, smp in enumerate(SAMPLES):
        kd.insert(smp[0], i)
    kd.balance()
    n = len(me.vertices)
    gco = [Ginv(v.co) for v in me.vertices]
    weights = []
    owner_of = []
    for co in gco:
        near = kd.find_n(co, 4)
        acc = {}
        tot = 0.0
        for _, idx, d in near:
            w = 1.0 / (d + 0.004) ** 3
            tot += w
            for b, bw in SAMPLES[idx][4].items():
                acc[b] = acc.get(b, 0.0) + bw * w
        weights.append({b: v / tot for b, v in acc.items() if v / tot > 0.02})
        owner_of.append(near[0][1])
    # normalise
    for w in weights:
        t = sum(w.values())
        for b in w:
            w[b] /= t

    # 4. nails appended to the same mesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    nail_bones, evil_nail_pos = add_nails(bm, list(fingers) + [thumb])
    bm.to_mesh(me)
    bm.free()
    skin.data.materials.clear()
    skin.data.materials.append(skin_mat)
    skin.data.materials.append(nail_mat)
    for p in me.polygons:
        p.use_smooth = True
        p.material_index = 1 if min(p.vertices) >= n else 0  # nails live after the skin verts
    me.update()
    total = len(me.vertices)

    # vertex groups
    bone_names = ["wrist", "palm"]
    for f in FINGER_OBJS:
        bone_names += f.bones
    for b in bone_names:
        skin.vertex_groups.new(name=b)
    for i, w in enumerate(weights):
        for b, bw in w.items():
            skin.vertex_groups[b].add([i], bw, "REPLACE")
    # nails ride on their fingertip bone
    for k, bone in enumerate(nail_bones):  # nail vertices were appended after the skin verts
        skin.vertex_groups[bone].add([n + k], 1.0, "REPLACE")

    # 5. colours: skin tone, redder knuckles/tips, AO in creases, forearm alpha
    BY_NAME.update({f.name: f for f in FINGER_OBJS})
    colour_skin(skin, gco, weights, n, total, owner_of)

    # 6. armature
    arm = make_armature(fingers, thumb)
    skin.parent = arm
    mod = skin.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

    # 7. evil shape key
    make_evil_key(skin, gco, owner_of, n, evil_nail_pos, fingers, thumb)

    skin.name = "Hand"
    skin.data.name = "Hand"
    return skin, arm


# ------------------------------------------------------------------ colours & AO


def colour_skin(skin, gco, weights, n, total, owner_of):
    me = skin.data
    for old in list(me.color_attributes):
        me.color_attributes.remove(old)
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    base = Vector(srgb(SKIN))
    red = Vector(srgb(SKIN_RED))
    # Ambient occlusion by ray casting against the skin itself.
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    rnd = random.Random(7)
    dirs = []
    for _ in range(26):  # cosine-weighted hemisphere (z up)
        u1, u2 = rnd.random(), rnd.random()
        r = math.sqrt(u1)
        a = math.tau * u2
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(1 - u1))))
    out = []
    for i in range(n):
        v = bm.verts[i]
        nrm = v.normal.normalized()
        tx = nrm.cross(Vector((0, 0, 1)) if abs(nrm.z) < 0.9 else Vector((1, 0, 0))).normalized()
        ty = nrm.cross(tx)
        occ = 0.0
        for d in dirs:
            w = tx * d.x + ty * d.y + nrm * d.z
            hit = tree.ray_cast(v.co + nrm * 0.006, w, AO_DIST)
            if hit[0] is not None:
                occ += 1.0 - hit[3] / AO_DIST
        ao = 1.0 - occ / len(dirs)
        g = gco[i]
        w = weights[i]
        tip = w.get("index3", 0) + w.get("middle3", 0) + w.get("ring3", 0) + w.get("pinky3", 0) + w.get("thumb3", 0)
        k = 0.45 * tip
        nrm_g = Ginv(nrm)
        for j in JOINTS:
            d = (g - j).length
            if d < 0.14:
                k = max(k, 0.5 * math.exp(-(d / 0.06) ** 2) * (0.5 + 0.5 * max(0.0, nrm_g.y)))
        # blotchy warmth + fine mottling
        nz = noise.noise(g * 5.0 + Vector((3, 7, 1)))
        k = max(0.0, min(1.0, k + nz * 0.10))
        c = base.lerp(red, k)
        shade = 0.38 + 0.62 * (max(0.0, ao) ** 1.5)
        _, owner, fs, _c, _w = SAMPLES[owner_of[i]]
        f_ = BY_NAME.get(owner)
        if f_ is not None and fs > 0.1:  # skin creases at the finger joints, so bent fingers read
            for jc in (f_.cum[1], f_.cum[2]):
                shade *= 1.0 - 0.28 * math.exp(-((fs - jc) / 0.022) ** 2)
        warm = Vector((1.0, 0.82 + 0.18 * shade, 0.78 + 0.22 * shade))  # creases go ruddy, not grey
        c = Vector((c.x * shade * warm.x, c.y * shade * warm.y, c.z * shade * warm.z))
        alpha = 1.0 - sm((g.z - FADE_START) / (FADE_END - FADE_START))
        out.append((c.x, c.y, c.z, alpha))
    bm.free()
    for i in range(total):
        col.data[i].color = out[i] if i < n else (1, 1, 1, 1)
    me.color_attributes.active_color = col
    me.color_attributes.default_color_name = "Col"


# --------------------------------------------------------------------- armature


def make_armature(fingers, thumb):
    amd = bpy.data.armatures.new("HandRig")
    arm = bpy.data.objects.new("HandRig", amd)
    COLL.objects.link(arm)
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = amd.edit_bones

    def bone(name, head, tail, parent):
        b = eb.new(name)
        b.head = G(*head)
        b.tail = G(*tail)
        if parent:
            b.parent = eb[parent]
        return b

    bone("wrist", (0, 0, 2.0), (0, 0, 0.5), None)
    bone("palm", (0, 0, 0.5), (0, 0, -0.42), "wrist")
    for f in list(fingers) + [thumb]:
        for i in range(3):
            parent = "palm" if i == 0 else f.bones[i - 1]
            bone(f.bones[i], f.pts[i], f.pts[i + 1], parent)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    return arm


# ------------------------------------------------------------------- evil morph


def make_evil_key(skin, gco, owner_of, n, evil_nail_pos, fingers, thumb):
    me = skin.data
    skin.shape_key_add(name="Basis", from_mix=False)
    key = skin.shape_key_add(name="evil", from_mix=False)
    key.value = 0.0
    nrm = [Ginv(v.normal) for v in me.vertices]
    by_name = {f.name: f for f in list(fingers) + [thumb]}
    for i in range(n):
        g = gco[i]
        _, owner, s, centre, _w = SAMPLES[owner_of[i]]
        p = g.copy()
        f = by_name.get(owner)
        if f is not None:
            fingerness = sm((s + 0.02) / 0.2)
            c, _ = f.at(max(s, 0.0))
            rad = p - c
            p = c + rad * (1.0 - 0.14 * fingerness)  # gaunt
            # a little extra reach, and pulled-in fingertips
        # bony knuckles: raised bumps at each joint, mostly on the back of the hand
        bump = 0.0
        for j in JOINTS:
            d = (g - j).length
            if d < 0.15:
                bump += 0.06 * math.exp(-(d / 0.06) ** 2)
        p += nrm[i] * bump * (0.4 + 0.6 * max(0.0, nrm[i].y))
        # tendons / metacarpal ridges on the back of the hand
        if 0.0 < g.z < 0.75 and nrm[i].y > 0.35:
            for f2 in fingers:
                dx = abs(g.x - (f2.pts[0].x * (1 - 0.35 * g.z)))
                if dx < 0.07:
                    p += Vector((0, 1, 0)) * 0.03 * math.exp(-(dx / 0.03) ** 2) * sm(g.z / 0.15) * (1 - sm((g.z - 0.5) / 0.25))
        # sunken palm bone: the whole hand a touch bonier at the wrist
        if g.z > 0.35:
            p.x *= 1.0 - 0.06 * sm((g.z - 0.35) / 0.4)
        key.data[i].co = G(*p)
    for k, pe in enumerate(evil_nail_pos):
        key.data[n + k].co = pe


# ----------------------------------------------------------------------- previews

PREVIEW = "HandPreview"


def look_materials(look):
    """Preview a look in Blender (the game blends these itself)."""
    skin = bpy.data.materials["Skin"]
    b = skin.node_tree.nodes["Principled BSDF"]
    nb = bpy.data.materials["Nail"].node_tree.nodes["Principled BSDF"]
    mix = skin.node_tree.nodes.get("tint")
    attr = next(nd for nd in skin.node_tree.nodes if nd.type == "VERTEX_COLOR")
    if mix is None:
        mix = skin.node_tree.nodes.new("ShaderNodeMix")
        mix.name = "tint"
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        a = next(sk for sk in mix.inputs if sk.name == "A" and sk.type == "RGBA")
        skin.node_tree.links.new(attr.outputs["Color"], a)
        res = next(sk for sk in mix.outputs if sk.name == "Result" and sk.type == "RGBA")
        skin.node_tree.links.new(res, b.inputs["Base Color"])
    tint = {"good": 0xFFF3E0, "neutral": 0xFFFFFF, "evil": 0x8A7570}[look]
    next(sk for sk in mix.inputs if sk.name == "B" and sk.type == "RGBA").default_value = (*srgb(tint), 1)
    glow = {"good": (0xFFD98A, 0.35), "neutral": (0x000000, 0.0), "evil": (0xFF2A10, 0.12)}[look]
    b.inputs["Emission Color"].default_value = (*srgb(glow[0]), 1)
    b.inputs["Emission Strength"].default_value = glow[1]
    nb.inputs["Base Color"].default_value = (*srgb(0x1A0A08 if look == "evil" else 0xF2C9C0), 1)
    hand = bpy.data.objects["Hand"]
    hand.data.shape_keys.key_blocks["evil"].value = 1.0 if look == "evil" else 0.0


def preview_setup():
    coll = bpy.data.collections.get(PREVIEW)
    if coll is None:
        coll = bpy.data.collections.new(PREVIEW)
        bpy.context.scene.collection.children.link(coll)
    scene = bpy.context.scene
    floor = bpy.data.objects.get("preview_floor")
    if floor is None:
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
        me = bpy.data.meshes.new("preview_floor")
        bm.to_mesh(me)
        bm.free()
        floor = bpy.data.objects.new("preview_floor", me)
        coll.objects.link(floor)
        grass = bpy.data.materials.get("PreviewGrass") or bpy.data.materials.new("PreviewGrass")
        grass.use_nodes = True
        grass.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(0x6BA23F), 1)
        grass.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        me.materials.append(grass)
    floor.location = G(0, -4.0, 0)
    sun = bpy.data.objects.get("preview_sun")
    if sun is None:
        sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
        coll.objects.link(sun)
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.93, 0.82)
    sun.data.angle = math.radians(10)
    sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(-35))
    cam = bpy.data.objects.get("preview_cam")
    if cam is None:
        cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
        coll.objects.link(cam)
    cam.data.lens = 55
    scene.camera = cam
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*srgb(0xBFDFF5), 1)
    bg.inputs["Strength"].default_value = 0.8
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.view_settings.view_transform = "Standard"


def preview_render(path, elev_deg=62, yaw_deg=0, distance=5.2, target=(0, 0, 0.35), tilt=0.0):
    """Render from behind/above (yaw 0 = looking along -Z, the way the game camera looks)."""
    preview_setup()
    cam = bpy.data.objects["preview_cam"]
    e, y = math.radians(elev_deg), math.radians(yaw_deg)
    eye = Vector((target[0] + math.sin(y) * math.cos(e) * distance, target[1] + math.sin(e) * distance, target[2] + math.cos(y) * math.cos(e) * distance))
    t = G(*target)
    cam.location = G(*eye)
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def pose_curl(arm, amount, thumb_amount=None):
    """Quick pose for previews: curl every finger bone about the hand's X axis (game space)."""
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
    if amount == 0:
        return
    for pb in arm.pose.bones:
        n = pb.name
        if n in ("wrist", "palm") or n.startswith("thumb"):
            continue
        k = {"1": 0.95, "2": 1.05, "3": 0.8}[n[-1]]
        pb.rotation_euler = (-amount * k * 1.35, 0, 0)  # local X; bones point along +Y, so negative curls down
    for pb in arm.pose.bones:
        if pb.name.startswith("thumb"):
            k = {"1": 0.4, "2": 0.7, "3": 0.6}[pb.name[-1]]
            pb.rotation_euler = (0, 0, 0)
            pb.rotation_euler = (-amount * k, 0, 0)


# ------------------------------------------------------------------------ export


def export_glb(hand, arm):
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    hand.select_set(True)
    arm.select_set(True)
    pose_curl(arm, 0)
    look_materials("neutral")
    # The tint node is preview-only: exporter should see the plain vertex-colour graph.
    skin = bpy.data.materials["Skin"]
    mix = skin.node_tree.nodes.get("tint")
    if mix:
        skin.node_tree.nodes.remove(mix)
        attr = next(nd for nd in skin.node_tree.nodes if nd.type == "VERTEX_COLOR")
        skin.node_tree.links.new(attr.outputs["Color"], skin.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_texcoords=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_apply=False,
    )
    hand.select_set(False)
    arm.select_set(False)
    return f"exported {GLB_PATH} ({os.path.getsize(GLB_PATH) // 1024} KB)"


def rebuild_and_export(render_dir=PROJECT + r"\docs\concept"):
    hand, arm = build()
    out = [f"built hand: {len(hand.data.vertices)} verts, {sum(len(p.vertices) - 2 for p in hand.data.polygons)} tris"]
    if render_dir:
        arm.data.pose_position = "POSE"
        shots = [
            ("open", "neutral", 0.0, dict(elev_deg=64)),
            ("grab", "neutral", 0.8, dict(elev_deg=56)),
            ("evil", "evil", 0.0, dict(elev_deg=60)),
            ("good", "good", 0.2, dict(elev_deg=60)),
        ]
        for name, look, curl, kw in shots:
            look_materials(look)
            pose_curl(arm, curl)
            out.append(preview_render(render_dir + rf"\hand-blender-{name}.png", **kw))
        pose_curl(arm, 0)
        look_materials("neutral")
    out.append(export_glb(hand, arm))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    return "\n".join(out)


print(rebuild_and_export())
