"""
Builds the stone golem pet in Blender, then exports it for the game.

Run inside Blender (Scripting tab, or via the MCP add-on):
    exec(open(r"C:/Users/Daryll/Documents/projects/God-Game/blender/build_golem.py").read())

Everything is generated, so the model can be rebuilt after any tweak. The rig is a
hierarchy of empties ("pivots") with identity rest rotations; every rock is rigidly
attached to one pivot. The pivot names and positions match src/creature/GolemModel.ts,
so the game's procedural animation drives this model unchanged.

Coordinates: the numbers below are in *game* space (metres, +Y up, +Z forward). G()
converts to Blender space (+Z up, -Y forward); the glTF exporter converts back.
"""

import math
import random

import bmesh
import bpy
from mathutils import Euler, Vector, noise

PROJECT = r"C:\Users\Daryll\Documents\projects\God-Game"
GLB_PATH = PROJECT + r"\public\models\golem.glb"
BLEND_PATH = PROJECT + r"\blender\golem.blend"
COLLECTION = "Golem"

# Proportions. Keep in sync with GOLEM in src/creature/GolemModel.ts.
HIP_HEIGHT = 1.55
HIP_WIDTH = 0.85
SHOULDER_WIDTH = 2.25
SHOULDER_HEIGHT = 2.5
HEAD_SCALE = 1.12

SIDES = ((-1, "R"), (1, "L"))  # the golem's right hand is at -X in game space


def G(x, y, z):
    """Game space (y-up, +z forward) -> Blender space (z-up, -y forward)."""
    return Vector((x, -z, y))


def srgb(hex_color):
    """Hex sRGB -> linear RGB tuple (Blender colours are linear)."""
    out = []
    for shift in (16, 8, 0):
        c = ((hex_color >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# --------------------------------------------------------------------------- scene


def reset_scene():
    coll = bpy.data.collections.get(COLLECTION)
    if coll:
        for ob in list(coll.all_objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Curve) and data.users == 0:
                bpy.data.curves.remove(data)
        bpy.data.collections.remove(coll)
    cube = bpy.data.objects.get("Cube")
    if cube:
        bpy.data.objects.remove(cube, do_unlink=True)
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)
    return coll


COLL = None
MATS = {}


def material(name, color, rough=0.9, metal=0.0, emit=None, strength=0.0, vcol=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*srgb(emit), 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    for n in list(nt.nodes):
        if n.type == "VERTEX_COLOR":
            nt.nodes.remove(n)
    if vcol:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        attr.location = (-300, 200)
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    MATS[name] = m
    return m


def make_materials():
    # Stone carries its colour (and baked shading) in vertex colours; the game tints it per alignment.
    material("Stone", 0xFFFFFF, rough=0.88, vcol=True)
    material("Eye", 0x1A1A1A, rough=0.3, emit=0xFFF1C4, strength=6.0)
    material("Socket", 0x5E5952, rough=1.0)


def link(ob):
    COLL.objects.link(ob)
    return ob


def empty(name, parent, offset, scale=1.0):
    e = link(bpy.data.objects.new(name, None))
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.35
    e.parent = parent
    e.location = G(*offset)
    e.scale = (scale, scale, scale)
    return e


def apply_modifiers(ob):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = new_mesh
    new_mesh.name = old.name
    bpy.data.meshes.remove(old)


def set_flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


# --------------------------------------------------------------------------- rocks


def rock(name, parent, size, offset, seed, rounded=False):
    """A hewn stone: a noisy cube-sphere with dissolved facets and chamfered edges.
    `size` is half-extents in game space (x, up, forward)."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    # Boulders: a low icosphere, pushed around by noise, then near-coplanar faces are
    # dissolved into big flat facets (the hewn look from the prototype).
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    off = Vector((rnd.uniform(-90, 90), rnd.uniform(-90, 90), rnd.uniform(-90, 90)))
    amp = 0.06 if rounded else 0.16
    for v in bm.verts:
        # Two octaves: broad lumps plus a little chipping.
        n = noise.noise(v.co * 1.1 + off) + 0.35 * noise.noise(v.co * 3.0 - off)
        v.co *= 1.0 + n * amp
    sx, sy, sz = size
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.parent = parent
    ob.location = G(*offset)
    if not rounded:
        dec = ob.modifiers.new("facets", "DECIMATE")
        dec.decimate_type = "DISSOLVE"
        dec.angle_limit = math.radians(19)
    bev = ob.modifiers.new("chamfer", "BEVEL")
    bev.width = 0.045 * min(size) / 0.8
    bev.segments = 1
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(28 if not rounded else 40)
    apply_modifiers(ob)
    set_flat(ob)
    ob.data.materials.append(MATS["Stone"])
    ob["part"] = "stone"
    return ob


def uv_sphere(name, parent, radius, offset, scale_game, mat, segments=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(8, segments * 3 // 4), radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = link(bpy.data.objects.new(name, me))
    ob.parent = parent
    ob.location = G(*offset)
    sx, sy, sz = scale_game
    ob.scale = (sx, sz, sy)
    ob.data.materials.append(MATS[mat])
    return ob


# --------------------------------------------------------------------------- body

PIVOTS = {}
ROCKS = {}  # pivot name -> list of rock objects


def add_rock(pivot, name, size, offset, rounded=False):
    ob = rock(name, PIVOTS[pivot], size, offset, seed=len(bpy.data.objects) * 7919 + hash(name) % 1000, rounded=rounded)
    ROCKS.setdefault(pivot, []).append(ob)
    return ob


def build_body():
    PIVOTS["golem"] = empty("golem", None, (0, 0, 0))
    PIVOTS["hips"] = empty("hips", PIVOTS["golem"], (0, HIP_HEIGHT, 0))
    add_rock("hips", "pelvis", (0.95, 0.55, 0.75), (0, 0.2, 0))

    for side, tag in SIDES:
        PIVOTS[f"leg_{tag}"] = empty(f"leg_{tag}", PIVOTS["hips"], (side * HIP_WIDTH, 0, 0))
        add_rock(f"leg_{tag}", f"thigh_{tag}", (0.72, 0.55, 0.72), (0, -0.4, 0))
        PIVOTS[f"knee_{tag}"] = empty(f"knee_{tag}", PIVOTS[f"leg_{tag}"], (0, -0.8, 0))
        add_rock(f"knee_{tag}", f"foot_{tag}", (0.82, 0.42, 0.98), (0, -0.33, 0.16))

    PIVOTS["torso"] = empty("torso", PIVOTS["hips"], (0, 0.55, 0))
    add_rock("torso", "belly", (1.2, 0.8, 0.95), (0, 0.45, 0.15))
    add_rock("torso", "chest", (1.75, 1.3, 1.22), (0, 1.72, 0))
    add_rock("torso", "back", (1.25, 0.95, 0.75), (0, 1.9, -0.8))

    PIVOTS["head"] = empty("head", PIVOTS["torso"], (0, 2.5, 0.5), HEAD_SCALE)
    add_rock("head", "skull", (1.3, 1.12, 1.15), (0, 0.75, 0.12), rounded=True)
    for side, tag in SIDES:
        uv_sphere(f"socket_{tag}", PIVOTS["head"], 0.44, (side * 0.5, 0.8, 1.02), (1, 1.1, 0.35), "Socket", 12)
        uv_sphere(f"eye_{tag}", PIVOTS["head"], 0.34, (side * 0.5, 0.8, 1.13), (1, 1.1, 0.5), "Eye", 16)

    for side, tag in SIDES:
        sh = PIVOTS[f"shoulder_{tag}"] = empty(f"shoulder_{tag}", PIVOTS["torso"], (side * SHOULDER_WIDTH, SHOULDER_HEIGHT, 0))
        add_rock(f"shoulder_{tag}", f"pauldron_{tag}", (1.1, 1.0, 1.02), (side * 0.12, 0.05, 0))
        PIVOTS[f"upper_{tag}"] = empty(f"upper_{tag}", sh, (side * 0.15, -0.5, 0))
        add_rock(f"upper_{tag}", f"upperarm_{tag}", (0.66, 0.88, 0.66), (0, -0.8, 0))
        PIVOTS[f"elbow_{tag}"] = empty(f"elbow_{tag}", PIVOTS[f"upper_{tag}"], (0, -1.6, 0))
        add_rock(f"elbow_{tag}", f"forearm_{tag}", (0.86, 0.9, 0.86), (0, -0.78, 0.05))
        PIVOTS[f"wrist_{tag}"] = empty(f"wrist_{tag}", PIVOTS[f"elbow_{tag}"], (0, -1.5, 0))
        add_rock(f"wrist_{tag}", f"fist_{tag}", (1.15, 1.0, 1.15), (0, -0.65, 0.12))
        for k in range(3):
            add_rock(f"wrist_{tag}", f"knuckle_{tag}{k}", (0.36, 0.34, 0.38), ((k - 1) * 0.5, -1.3, 0.78))


# ------------------------------------------------------------------ colour & shading

STONE_COLOR = 0xC4B9A4  # warm grey, lighter than the island's boulders


def paint_stone(ob, seed):
    """Base colour with per-facet variation, into the 'Col' attribute."""
    rnd = random.Random(seed)
    me = ob.data
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    base = srgb(STONE_COLOR)
    for poly in me.polygons:
        f = 1.0 + rnd.uniform(-0.1, 0.1)
        warm = rnd.uniform(-0.025, 0.025)
        c = (base[0] * f * (1 + warm), base[1] * f, base[2] * f * (1 - warm), 1.0)
        for li in poly.loop_indices:
            attr.data[li].color = c
    me.color_attributes.active_color = attr


def bake_ambient_occlusion(objects, strength=1.0):
    """Bake AO (with every rock occluding the others) and multiply it into 'Col'."""
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.device = "CPU"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.light_settings.distance = 2.6
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in objects:
        me = ob.data
        ao = me.color_attributes.get("AO") or me.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
        me.color_attributes.active_color = ao
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    for ob in objects:
        me = ob.data
        col = me.color_attributes["Col"]
        ao = me.color_attributes["AO"]
        for i in range(len(col.data)):
            a = ao.data[i].color[0] ** 1.6  # extra contrast so crevices read in-game
            k = 1.0 - strength * (1.0 - a)
            c = col.data[i].color
            col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes["Col"]
        ob.select_set(False)
    scene.render.engine = prev_engine


def shade_stone():
    rocks = [ob for obs in ROCKS.values() for ob in obs]
    for i, ob in enumerate(rocks):
        paint_stone(ob, 1000 + i)
    bake_ambient_occlusion(rocks)


# ----------------------------------------------------------------- surface helpers

FRONT = Vector((0, -1, 0))  # Blender-space directions
UP = Vector((0, 0, 1))
RIGHT_SIDE = Vector((-1, 0, 0))  # the golem's right (game -X)
LEFT_SIDE = Vector((1, 0, 0))


def surface_point(rock_ob, direction):
    """Where a ray from outside the rock toward its centre hits it (rock-local), plus normal."""
    d = direction.normalized()
    hit, loc, nrm, _ = rock_ob.ray_cast(d * 10.0, -d)
    if not hit:
        return None, None
    return loc, nrm


def tangent_basis(n):
    a = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    u = n.cross(a).normalized()
    v = n.cross(u).normalized()
    return u, v


def project_to_rock(rock_ob, p, toward_center_of=Vector((0, 0, 0)), lift=0.02):
    """Shoot a ray through p toward the rock centre and return the surface point, lifted a little."""
    d = (p - toward_center_of).normalized()
    hit, loc, nrm, _ = rock_ob.ray_cast(toward_center_of + d * 10.0, -d)
    if not hit:
        return p
    return loc + nrm * lift


def tube_from_points(name, parent, points_pivot_space, radius, mat):
    """A thin tube mesh along a polyline (via a bevelled curve, converted to mesh)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 1
    cu.resolution_u = 4
    sp = cu.splines.new("POLY")
    sp.points.add(len(points_pivot_space) - 1)
    for i, p in enumerate(points_pivot_space):
        sp.points[i].co = (p.x, p.y, p.z, 1)
    cu.use_fill_caps = True
    ob = link(bpy.data.objects.new(name, cu))
    ob.parent = parent
    ob.data.materials.append(MATS[mat])
    # Convert to mesh so it exports cleanly.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mob = link(bpy.data.objects.new(name + "_mesh", me))
    mob.parent = parent
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    mob.name = name
    me.name = name
    if not me.materials:
        me.materials.append(MATS[mat])
    return mob


def rock_named(name):
    return bpy.data.objects[name]


# ------------------------------------------------------------------------- runes


def rune(rock_name, direction, scale=1.0):
    """A carved spiral rune pressed onto the rock's face in `direction` (Blender space)."""
    rk = rock_named(rock_name)
    loc, nrm = surface_point(rk, direction)
    if loc is None:
        return None
    u, v = tangent_basis(nrm)
    pts = []
    steps = 60
    for i in range(steps + 1):
        t = i / steps
        a = t * math.pi * 4.2
        r = (0.05 + t * 0.3) * scale
        p = loc + u * math.cos(a) * r + v * math.sin(a) * r
        pts.append(rk.location + project_to_rock(rk, p, lift=0.035))
    return tube_from_points(f"rune_{rock_name}", rk.parent, pts, 0.045 * scale, "Rune")


def make_runes():
    rune("chest", FRONT, 1.25)
    for tag, side_dir in (("R", RIGHT_SIDE), ("L", LEFT_SIDE)):
        rune(f"pauldron_{tag}", side_dir, 0.9)
        rune(f"fist_{tag}", (FRONT + Vector((0, 0, -0.15))).normalized(), 0.85)


# -------------------------------------------------------------------- moss & flowers

PETALS = [0xFFB3C8, 0xFFF4F0, 0xFFD84A, 0xC9A8FF]


def moss_cap(rock_name, coverage, flowers, seed):
    """Moss draped over the top of a rock: its upward-facing skin, thickened and lifted.
    `coverage` 0..1: how far down the sides it creeps."""
    rnd = random.Random(seed)
    rk = rock_named(rock_name)
    bm = bmesh.new()
    bm.from_mesh(rk.data)
    threshold = 1.0 - coverage * 1.4
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), 0))
    kill = [f for f in bm.faces if f.normal.z + noise.noise(f.calc_center_median() * 2.2 + off) * 0.25 < threshold]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.05
    me = bpy.data.meshes.new(f"moss_{rock_name}")
    bm.to_mesh(me)
    bm.free()
    if not me.polygons:
        bpy.data.meshes.remove(me)
        return None
    ob = link(bpy.data.objects.new(f"moss_{rock_name}", me))
    ob.parent = rk.parent
    ob.location = rk.location.copy()
    sol = ob.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.09
    sol.offset = 1.0
    apply_modifiers(ob)
    set_flat(ob)
    # Mossy greens, varied per face. (Drop the stone colours copied over with the rock's skin.)
    for old in list(ob.data.color_attributes):
        ob.data.color_attributes.remove(old)
    col = ob.data.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for poly in ob.data.polygons:
        base = srgb(rnd.choice([0x5F9A35, 0x6FAA3C, 0x4F8A2E, 0x7AB048]))
        f = 1 + rnd.uniform(-0.12, 0.12)
        for li in poly.loop_indices:
            col.data[li].color = (base[0] * f, base[1] * f, base[2] * f, 1)
    ob.data.color_attributes.active_color = col
    ob.data.materials.append(MATS["Moss"])

    # Flowers sit on the moss's upper faces.
    tops = [p for p in ob.data.polygons if p.normal.z > 0.6]
    fl_mesh = None
    if tops and flowers:
        fbm = bmesh.new()
        fcol = fbm.loops.layers.float_color.new("Col")
        for _ in range(flowers):
            poly = rnd.choice(tops)
            c = poly.center + Vector((0, 0, 0.02))
            petal = srgb(rnd.choice(PETALS))
            for k in range(5):
                a = k / 5 * math.pi * 2 + rnd.uniform(0, 0.3)
                ret = bmesh.ops.create_icosphere(fbm, subdivisions=1, radius=0.12)
                for v in ret["verts"]:
                    v.co = Vector((v.co.x * 1.3, v.co.y * 0.7, v.co.z * 0.45))
                    v.co.rotate(Euler((0, 0, a)))
                    v.co += c + Vector((math.cos(a) * 0.13, math.sin(a) * 0.13, 0.03))
                for f in {f for v in ret["verts"] for f in v.link_faces}:
                    for loop in f.loops:
                        loop[fcol] = (*petal, 1)
            ret = bmesh.ops.create_icosphere(fbm, subdivisions=1, radius=0.08)
            for v in ret["verts"]:
                v.co = Vector((v.co.x, v.co.y, v.co.z * 0.6)) + c + Vector((0, 0, 0.06))
            for f in {f for v in ret["verts"] for f in v.link_faces}:
                for loop in f.loops:
                    loop[fcol] = (*srgb(0xF2B630), 1)
        fl_mesh = bpy.data.meshes.new(f"flowers_{rock_name}")
        fbm.to_mesh(fl_mesh)
        fbm.free()
        fl_mesh.materials.append(MATS["Flower"])
        fl = link(bpy.data.objects.new(f"flowers_{rock_name}", fl_mesh))
        fl.parent = ob
        set_flat(fl)
    return ob


def make_moss():
    caps = [
        ("skull", 0.42, 7),
        ("back", 0.4, 3),
        ("chest", 0.22, 2),
        ("pauldron_R", 0.42, 4),
        ("pauldron_L", 0.42, 4),
        ("forearm_R", 0.3, 2),
        ("forearm_L", 0.3, 2),
        ("fist_R", 0.32, 2),
        ("fist_L", 0.32, 2),
        ("thigh_R", 0.25, 0),
        ("thigh_L", 0.25, 0),
    ]
    for i, (name, cov, fl) in enumerate(caps):
        moss_cap(name, cov, fl, 500 + i)


# ------------------------------------------------------------------- lava & spikes

LAVA_CORES = [
    ("hips", 0.62, (0, 0.05, 0)),
    ("knee_R", 0.36, (0, 0.05, 0)),
    ("knee_L", 0.36, (0, 0.05, 0)),
    ("torso", 0.95, (0, 1.5, 0)),
    ("torso", 0.55, (0, 2.75, 0.3)),
    ("shoulder_R", 0.55, (0, -0.35, 0)),
    ("shoulder_L", 0.55, (0, -0.35, 0)),
    ("elbow_R", 0.42, (0, 0, 0)),
    ("elbow_L", 0.42, (0, 0, 0)),
    ("wrist_R", 0.42, (0, 0, 0)),
    ("wrist_L", 0.42, (0, 0, 0)),
]

VEINS = {
    "foot_R": 1, "foot_L": 1, "belly": 1, "chest": 3, "back": 1,
    "pauldron_R": 1, "pauldron_L": 1, "upperarm_R": 1, "upperarm_L": 1,
    "forearm_R": 1, "forearm_L": 1, "fist_R": 1, "fist_L": 1, "skull": 2,
}


def lava_core(pivot, radius, offset, idx):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    me = bpy.data.meshes.new(f"lava_core_{pivot}_{idx}")
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(me.name, me))
    ob.parent = PIVOTS[pivot]
    ob.location = G(*offset)
    me.materials.append(MATS["Lava"])
    return ob


def vein(rock_name, seed):
    """A glowing crack wandering down across the rock's front and sides."""
    rnd = random.Random(seed)
    rk = rock_named(rock_name)
    th = rnd.uniform(0.45, 1.5)  # polar angle from up
    ph = rnd.uniform(-1.3, 1.3)  # around, 0 = front
    pts = []
    for _ in range(9):
        d = Vector((math.sin(th) * math.sin(ph), -math.sin(th) * math.cos(ph), math.cos(th)))
        loc, nrm = surface_point(rk, d)
        if loc is not None:
            pts.append(rk.location + loc + nrm * 0.012)
        th += rnd.uniform(0.09, 0.2)
        ph += rnd.uniform(-0.28, 0.28)
    if len(pts) < 3:
        return None
    return tube_from_points(f"vein_{rock_name}_{seed}", rk.parent, pts, 0.028, "Lava")


def spike(pivot, offset, rot_game, length, idx):
    """Obsidian spike. `rot_game` is a three.js-style XYZ Euler applied to an up-pointing cone."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=5, radius1=0.24 * length / 0.9, radius2=0.0, depth=length)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, length / 2))
    me = bpy.data.meshes.new(f"spike_{pivot}_{idx}")
    bm.to_mesh(me)
    bm.free()
    set_flat_mesh(me)
    ob = link(bpy.data.objects.new(me.name, me))
    ob.parent = PIVOTS[pivot]
    ob.location = G(*offset)
    # three.js 'XYZ' == matrix Rx*Ry*Rz == mathutils order 'ZYX'.
    dir_game = Euler(rot_game, "ZYX").to_matrix() @ Vector((0, 1, 0))
    dir_b = G(*dir_game)
    ob.rotation_euler = dir_b.to_track_quat("Z", "Y").to_euler()
    me.materials.append(MATS["Spike"])
    return ob


def set_flat_mesh(me):
    for p in me.polygons:
        p.use_smooth = False


def make_evil():
    for i, (pivot, r, off) in enumerate(LAVA_CORES):
        lava_core(pivot, r, off, i)
    seed = 900
    for name, count in VEINS.items():
        for _ in range(count):
            seed += 1
            vein(name, seed)
    i = 0
    for pivot, off, rot, ln in [
        ("torso", (0, 2.4, -1.15), (-1.0, 0, 0), 1.1),
        ("torso", (0, 1.7, -1.3), (-1.3, 0, 0), 1.0),
        ("torso", (0, 1.0, -1.1), (-1.5, 0, 0), 0.8),
        ("head", (-0.6, 1.6, 0.1), (0.2, 0, 0.6), 0.6),
        ("head", (0.6, 1.6, 0.1), (0.2, 0, -0.6), 0.6),
        ("head", (0, 1.85, -0.25), (-0.5, 0, 0), 0.55),
    ]:
        spike(pivot, off, rot, ln, i)
        i += 1
    for side, tag in SIDES:
        for k in range(3):
            spike(f"shoulder_{tag}", (side * (0.25 + k * 0.3), 0.8, -0.2 + k * 0.15), (-0.2, 0, -side * (0.35 + k * 0.25)), 0.85 - k * 0.12, i)
            i += 1
        spike(f"elbow_{tag}", (side * 0.78, -0.6, 0), (0, 0, -side * 1.3), 0.65, i)
        i += 1


def make_dressing_materials():
    material("Rune", 0x1D4A47, rough=0.6, emit=0x3FE8D8, strength=0.0)
    material("Moss", 0xFFFFFF, rough=1.0, vcol=True)
    material("Flower", 0xFFFFFF, rough=0.8, vcol=True)
    material("Lava", 0x2A0A00, rough=0.8, emit=0xFF3D0A, strength=8.0)
    material("Spike", 0x1B1817, rough=0.3, metal=0.1)


# --------------------------------------------------------------------------- looks


def rgba_socket(sockets, name):
    """ShaderNodeMix has same-named sockets per data type; pick the colour one."""
    return next(sk for sk in sockets if sk.name == name and sk.type == "RGBA")


def set_look(look):
    """Preview a look in Blender: 'good', 'neutral' or 'evil' (the game blends these itself)."""
    good = look == "good"
    evil = look == "evil"
    for ob in COLL.all_objects:
        n = ob.name
        if n.startswith(("moss_", "flowers_")):
            ob.hide_render = ob.hide_viewport = not good
        elif n.startswith(("lava_", "vein_", "spike_")):
            ob.hide_render = ob.hide_viewport = not evil
    bsdf = MATS["Stone"].node_tree.nodes["Principled BSDF"]
    MATS["Rune"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0 if good else 0.0
    rune_col = 0x1D4A47 if good else (0x151212 if evil else 0x8A857C)
    MATS["Rune"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(rune_col), 1)
    eye = 0x5FF2E2 if good else (0xFF3510 if evil else 0xFFF1C4)
    MATS["Eye"].node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (*srgb(eye), 1)
    # Stone tint multiplies the baked vertex colours (as the game does).
    tint = {"good": 0xE4E8D8, "neutral": 0xFFFFFF, "evil": 0x5A5350}[look]
    stone_nt = MATS["Stone"].node_tree
    mix = stone_nt.nodes.get("tint")
    if mix is None:
        mix = stone_nt.nodes.new("ShaderNodeMix")
        mix.name = "tint"
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        vc = next(n for n in stone_nt.nodes if n.type == "VERTEX_COLOR")
        stone_nt.links.new(vc.outputs["Color"], rgba_socket(mix.inputs, "A"))
        stone_nt.links.new(rgba_socket(mix.outputs, "Result"), bsdf.inputs["Base Color"])
    rgba_socket(mix.inputs, "B").default_value = (*srgb(tint), 1)
    bsdf.inputs["Roughness"].default_value = 0.45 if evil else 0.88
    bsdf.inputs["Metallic"].default_value = 0.15 if evil else 0.0


# --------------------------------------------------------------------------- export


def join(objects, name):
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in objects:
        ob.hide_viewport = False
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name
    result.data.name = name
    result.select_set(False)
    return result


def center_origin(ob):
    """Move the object's origin to its geometry's centre (so the game can scale it in place)."""
    c = sum((Vector(b) for b in ob.bound_box), Vector()) / 8
    from mathutils import Matrix

    ob.data.transform(Matrix.Translation(-c))
    ob.location += c


def prepare_for_export():
    """Neutral materials, then merge parts per pivot: stone, lava (+veins) and runes.
    Moss caps (with their flowers) and spikes stay separate so the game can grow them."""
    set_look("neutral")
    nt = MATS["Stone"].node_tree
    mix = nt.nodes.get("tint")
    if mix:
        nt.nodes.remove(mix)
        vc = next(n for n in nt.nodes if n.type == "VERTEX_COLOR")
        nt.links.new(vc.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    for ob in COLL.all_objects:
        ob.hide_viewport = False
        ob.hide_render = False
    bpy.context.view_layer.update()

    groups = {}
    for ob in list(COLL.all_objects):
        if ob.type != "MESH" or ob.name.startswith(("moss_", "flowers_", "spike_", "eye_", "socket_")):
            continue
        part = "lava" if ob.name.startswith(("lava_", "vein_")) else "rune" if ob.name.startswith("rune_") else "stone"
        groups.setdefault((ob.parent.name, part), []).append(ob)
    for (pivot, part), obs in groups.items():
        join(obs, f"{part}_{pivot}")

    for moss in [o for o in COLL.all_objects if o.name.startswith("moss_")]:
        flowers = [c for c in moss.children if c.name.startswith("flowers_")]
        name = moss.name
        joined = join([moss] + flowers, name)
        center_origin(joined)


def export_glb():
    import os

    prepare_for_export()
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in COLL.all_objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="MATERIAL",
        export_texcoords=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    for ob in COLL.all_objects:
        ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    return f"exported {GLB_PATH} ({os.path.getsize(GLB_PATH) // 1024} KB), saved {BLEND_PATH}"


# --------------------------------------------------------------------------- view


def frame_view(yaw_deg=-28, pitch_deg=78, distance=19, target=(0, 4.0, 0)):
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.shading.type = "MATERIAL"
        space.overlay.show_overlays = False
        r3d = space.region_3d
        r3d.view_perspective = "PERSP"
        r3d.view_rotation = Euler((math.radians(pitch_deg), 0, math.radians(yaw_deg))).to_quaternion()
        r3d.view_location = G(*target)
        r3d.view_distance = distance


PREVIEW = "GolemPreview"


def preview_setup():
    """Camera, sun, sky and a grass floor for checking the model. Not exported."""
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
        grass.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(0x5E9A3A), 1)
        grass.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        me.materials.append(grass)

    sun = bpy.data.objects.get("preview_sun")
    if sun is None:
        sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
        coll.objects.link(sun)
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-35)))

    cam = bpy.data.objects.get("preview_cam")
    if cam is None:
        cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
        coll.objects.link(cam)
    cam.data.lens = 50
    scene.camera = cam

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*srgb(0xBFDFF5), 1)
    bg.inputs["Strength"].default_value = 0.9

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    for name in ("Light", "Camera"):
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = True


def preview_render(path, yaw_deg=25, pitch_deg=12, distance=19, target=(0, 3.9, 0)):
    """Render the golem from a 3/4 front view (yaw 0 = straight on) to `path`."""
    preview_setup()
    cam = bpy.data.objects["preview_cam"]
    t = G(*target)
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    eye_game = Vector((
        math.sin(yaw) * math.cos(pitch) * distance,
        target[1] + math.sin(pitch) * distance,
        math.cos(yaw) * math.cos(pitch) * distance,
    ))
    cam.location = G(*eye_game)
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def build():
    global COLL
    PIVOTS.clear()
    ROCKS.clear()
    COLL = reset_scene()
    make_materials()
    make_dressing_materials()
    build_body()
    shade_stone()
    bpy.context.view_layer.update()
    make_runes()
    make_moss()
    make_evil()
    set_look("neutral")
    frame_view()
    return f"built golem: {len(COLL.all_objects)} objects"


def rebuild_and_export(render_dir=PROJECT + r"\docs\concept"):
    """The whole pipeline: build, render the three looks, export the GLB, save the .blend."""
    out = [build()]
    if render_dir:
        for look in ("neutral", "good", "evil"):
            set_look(look)
            out.append(preview_render(render_dir + rf"\golem-blender-{look}.png", yaw_deg=22, pitch_deg=16, distance=18))
        set_look("neutral")
    out.append(export_glb())
    return "\n".join(out)


print(rebuild_and_export())
