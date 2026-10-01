"""
Builds the stylised tree set in Blender, then exports it for the game.

Run inside Blender (Scripting tab, or via the MCP add-on):
    exec(open(r"C:/Users/Daryll/Documents/projects/God-Game/blender/build_trees.py").read())

Same look as the golem: faceted low-poly shapes, ambient occlusion baked into vertex
colours, per-facet colour variation. Species and variant counts are in SPECIES; the
game (src/entities/Nature.ts) reads the species name from each mesh's name
("oak_0", "pine_3", ...) so keep that pattern.

Each variant is ONE mesh (trunk + canopy joined) with its origin at the base of the
trunk, +Z up in Blender (the glTF exporter converts to +Y up), roughly 5 to 10 m tall at
full growth, kept to a modest triangle count because ~500 are drawn with instancing.
"""

import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

PROJECT = r"C:\Users\Daryll\Documents\projects\God-Game"
GLB_PATH = PROJECT + r"\public\models\trees.glb"
BLEND_PATH = PROJECT + r"\blender\trees.blend"
RENDER_DIR = PROJECT + r"\docs\concept"
COLLECTION = "Trees"

# name -> variant count. Order here is the order in the file.
SPECIES = {"oak": 5, "pine": 5, "birch": 4, "blossom": 2}
SPACING = 15.0  # preview grid spacing (metres)


def srgb(hex_color):
    out = []
    for shift in (16, 8, 0):
        c = ((hex_color >> shift) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# --------------------------------------------------------------------------- scene

COLL = None
MAT = None


def reset_scene():
    coll = bpy.data.collections.get(COLLECTION)
    if coll:
        for ob in list(coll.all_objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
        bpy.data.collections.remove(coll)
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)
    # Park any other model that happens to be open (e.g. the golem): hide, never delete.
    for lc in bpy.context.view_layer.layer_collection.children:
        if lc.name not in (COLLECTION, "TreesPreview"):
            lc.exclude = True
    return coll


def make_material():
    m = bpy.data.materials.get("Foliage") or bpy.data.materials.new("Foliage")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.9
    for n in list(nt.nodes):
        if n.type == "VERTEX_COLOR":
            nt.nodes.remove(n)
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


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


def paint(ob, colour_fn):
    """colour_fn(poly) -> linear rgb. One colour per facet."""
    me = ob.data
    for old in list(me.color_attributes):
        me.color_attributes.remove(old)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for poly in me.polygons:
        r, g, b = colour_fn(poly)
        for li in poly.loop_indices:
            attr.data[li].color = (r, g, b, 1.0)
    me.color_attributes.active_color = attr


def shade(rgb, k):
    return (rgb[0] * k, rgb[1] * k, rgb[2] * k)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# --------------------------------------------------------------------------- parts


def tube(name, points, radii, sides, rnd, lumps=0.0):
    """A tapered tube along a polyline (z-up). `lumps` jitters each ring's radius per side
    (hewn, root-like look). Open at both ends: the base is buried, the top is inside foliage."""
    bm = bmesh.new()
    rings = []
    for i, (p, r) in enumerate(zip(points, radii)):
        if i < len(points) - 1:
            d = points[i + 1] - p
        else:
            d = p - points[i - 1]
        d.normalize()
        q = d.to_track_quat("Z", "Y")
        ring = []
        for s in range(sides):
            a = s / sides * math.tau + (0.0 if i % 2 == 0 else math.pi / sides * 0.6)
            k = 1.0 + rnd.uniform(-lumps, lumps) * (1.6 if i == 0 else 1.0)
            v = Vector((math.cos(a) * r * k, math.sin(a) * r * k, 0))
            ring.append(bm.verts.new(p + q @ v))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(sides):
            t = (s + 1) % sides
            bm.faces.new((rings[i][s], rings[i][t], rings[i + 1][t], rings[i + 1][s]))
    # Cap the top so no light leaks through the canopy.
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_object(name, bm)
    bev = ob.modifiers.new("chamfer", "BEVEL")
    bev.width = 0.03
    bev.segments = 1
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(35)
    apply_modifiers(ob)
    set_flat(ob)
    return ob


def blob(name, centre, radii, rnd, subdiv=2, amp=0.2, facet=24, flat_bottom=0.55, bevel=0.0):
    """A lumpy faceted canopy mass: noisy icosphere, flatter underneath, near-coplanar faces dissolved."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((rnd.uniform(-90, 90), rnd.uniform(-90, 90), rnd.uniform(-90, 90)))
    rx, ry, rz = radii
    for v in bm.verts:
        n = noise.noise(v.co * 1.3 + off) + 0.4 * noise.noise(v.co * 3.1 - off)
        v.co *= 1.0 + n * amp
        if v.co.z < 0:
            v.co.z *= flat_bottom
        v.co = Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz))
    ob = new_object(name, bm)
    ob.location = Vector(centre)
    dec = ob.modifiers.new("facets", "DECIMATE")
    dec.decimate_type = "DISSOLVE"
    dec.angle_limit = math.radians(facet)
    if bevel:
        bev = ob.modifiers.new("chamfer", "BEVEL")
        bev.width = bevel
        bev.segments = 1
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(30)
    apply_modifiers(ob)
    # Bake the offset into the mesh so joins keep world positions.
    ob.data.transform(Matrix.Translation(ob.location))
    ob.location = (0, 0, 0)
    set_flat(ob)
    return ob


def tier(name, z, radius, height, rnd, sides=8):
    """One drooping pine skirt: a squat cone with a ragged rim and a flat underside."""
    bm = bmesh.new()
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=radius, radius2=0.0, depth=height)
    rot = rnd.uniform(0, math.tau)
    for v in ret["verts"]:
        v.co.z += height / 2
        if v.co.z < height * 0.1:  # the rim: ragged, with a lifted underside
            k = 1.0 + rnd.uniform(-0.16, 0.16)
            v.co.x *= k
            v.co.y *= k
            v.co.z += rnd.uniform(0.0, 0.25)
        else:
            v.co.x += rnd.uniform(-0.06, 0.06)
            v.co.y += rnd.uniform(-0.06, 0.06)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Euler((0, 0, rot)).to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z))
    ob = new_object(name, bm)
    bev = ob.modifiers.new("chamfer", "BEVEL")
    bev.width = 0.05
    bev.segments = 1
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(35)
    apply_modifiers(ob)
    set_flat(ob)
    return ob


# --------------------------------------------------------------------------- colour

TRUNK_BROWN = [0x82593A, 0x8E6340, 0x7A5030, 0x88603B]
OAK_LEAF = [0x5B9A33, 0x4C8A2E, 0x68A53A, 0x437F2B, 0x78AE3E]
PINE_LEAF = [0x2D6A47, 0x275E3F, 0x347550, 0x2B6342]
BIRCH_LEAF = [0x8DB84A, 0x9AC24F, 0x7FAE45, 0xA9C95A, 0x86B34A]
BLOSSOM_LEAF = [0xE98FAE, 0xEEA2BB, 0xE27FA2, 0xF2B3C7, 0xE893B0]
MOSS = 0x5E8A3A


def leaf_colour(base_hex, centre_z, rz, rnd, warm=0.07):
    """Canopy facet colour: per-facet jitter, brighter and warmer on top, cooler and deeper below."""
    base = srgb(base_hex)

    def fn(poly):
        t = max(-1.0, min(1.0, (poly.center.z - centre_z) / max(rz, 0.01)))
        k = 0.76 + 0.24 * (t * 0.5 + 0.5) + poly.normal.z * 0.04
        k *= 1.0 + rnd.uniform(-0.09, 0.09)
        c = shade(base, k)
        # Warm the lit tops (toward sunny yellow-green), cool the undersides slightly.
        w = warm * (t * 0.5 + 0.5)
        return (c[0] * (1 + w * 1.6), c[1] * (1 + w * 0.4), c[2] * (1 - w * 1.2))

    return fn


def trunk_colour(base_hex, rnd, birch=False):
    base = srgb(base_hex)
    moss = srgb(MOSS)

    def fn(poly):
        z = poly.center.z
        k = 1.0 + rnd.uniform(-0.1, 0.1)
        c = shade(base, k)
        if birch and rnd.random() < 0.2:
            c = shade(srgb(0x3A3430), 1 + rnd.uniform(-0.2, 0.2))  # birch bark marks
        if z < 0.9:  # a little moss and shade at the roots
            c = mix(c, shade(moss, 0.8), max(0.0, (0.9 - z) / 0.9) * 0.35)
        return c

    return fn


def ground_contact(ob):
    """Cheap contact shadow at the very base (the baked AO can't see the terrain)."""
    attr = ob.data.color_attributes["Col"]
    for poly in ob.data.polygons:
        for li in poly.loop_indices:
            z = ob.data.vertices[ob.data.loops[li].vertex_index].co.z
            k = 0.72 + 0.28 * max(0.0, min(1.0, z / 1.1))
            c = attr.data[li].color
            attr.data[li].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)


# --------------------------------------------------------------------------- species


def join(objects, name):
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    result = bpy.context.view_layer.objects.active
    result.name = name
    result.data.name = name
    result.select_set(False)
    return result


def lean_points(rnd, height, lean, bend, steps=7):
    """Trunk centreline: rises to `height`, leaning toward a random heading with a gentle S-bend."""
    a = rnd.uniform(0, math.tau)
    b = rnd.uniform(0, math.tau)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = math.cos(a) * lean * t * t + math.cos(b) * bend * math.sin(t * math.pi)
        y = math.sin(a) * lean * t * t + math.sin(b) * bend * math.sin(t * math.pi)
        pts.append(Vector((x, y, -0.15 + (height + 0.15) * t)))
    return pts


def trunk_radii(r_base, r_top, flare=1.7, steps=7):
    out = []
    for i in range(steps + 1):
        t = i / steps
        r = r_base + (r_top - r_base) * t ** 0.85
        r *= 1.0 + (flare - 1.0) * max(0.0, 1.0 - t * 3.2) ** 2  # root flare near the ground
        out.append(r)
    return out


def broadleaf(kind, idx, seed):
    rnd = random.Random(seed)
    if kind == "oak":
        H = rnd.uniform(6.8, 8.8)
        trunk_h = H * rnd.uniform(0.34, 0.4)
        r_base, r_top = rnd.uniform(0.5, 0.62), 0.3
        palette, sides, lean, bend = OAK_LEAF, 7, rnd.uniform(0.0, 0.5), 0.25
        n_blobs = rnd.randint(5, 7)
        rmin, rmax, spread = 1.9, 2.8, 2.1
        bark = TRUNK_BROWN
    elif kind == "birch":
        H = rnd.uniform(6.2, 8.4)
        trunk_h = H * rnd.uniform(0.45, 0.55)
        r_base, r_top = rnd.uniform(0.26, 0.33), 0.14
        palette, sides, lean, bend = BIRCH_LEAF, 6, rnd.uniform(0.2, 0.8), 0.3
        n_blobs = rnd.randint(4, 6)
        rmin, rmax, spread = 1.2, 1.85, 1.35
        bark = [0xE6E0D2, 0xDCD5C4, 0xEFEADF]
    else:  # blossom
        H = rnd.uniform(5.4, 6.8)
        trunk_h = H * rnd.uniform(0.32, 0.38)
        r_base, r_top = rnd.uniform(0.4, 0.5), 0.24
        palette, sides, lean, bend = BLOSSOM_LEAF, 7, rnd.uniform(0.3, 0.9), 0.45
        n_blobs = rnd.randint(5, 6)
        rmin, rmax, spread = 1.7, 2.5, 2.5
        bark = [0x7A5238, 0x84583C, 0x704A31]

    name = f"{kind}_{idx}"
    pts = lean_points(rnd, trunk_h, lean, bend)
    parts = []
    trunk = tube(name + "_trunk", pts, trunk_radii(r_base, r_top, flare=1.8 if kind != "birch" else 1.45), sides, rnd, lumps=0.1)
    paint(trunk, trunk_colour(rnd.choice(bark), rnd, birch=(kind == "birch")))
    parts.append(trunk)

    top = pts[-1]
    crown_z = H - (rmax * 0.7)
    blob_specs = []
    for i in range(n_blobs):
        ang = i / n_blobs * math.tau + rnd.uniform(-0.4, 0.4)
        d = spread * rnd.uniform(0.55, 1.0) if i else 0.0  # first blob sits on top
        r = rnd.uniform(rmin, rmax) * (1.12 if i == 0 else 1.0)
        c = Vector((top.x + math.cos(ang) * d, top.y + math.sin(ang) * d, crown_z + rnd.uniform(-0.55, 0.65) - (0.0 if i == 0 else 0.5)))
        z_sq = {"oak": 1.0, "birch": 0.9, "blossom": 0.72}[kind]  # blossom is a wide, flatter crown
        blob_specs.append((c, (r, r * rnd.uniform(0.9, 1.1), r * z_sq)))
    # Branches into the two lowest side blobs so the canopy reads as held up, not floating.
    side = sorted(blob_specs[1:], key=lambda s: s[0].z)[:2]
    start_t = 0.72
    for bi, (c, _r) in enumerate(side):
        p0 = pts[-2] + (pts[-1] - pts[-2]) * 0.4
        p1 = (p0 + c) / 2 + Vector((0, 0, 0.1))
        br = tube(f"{name}_br{bi}", [p0, p1, c - Vector((0, 0, 0.2))], [r_top * 0.7, r_top * 0.5, r_top * 0.3], 5, rnd, lumps=0.05)
        paint(br, trunk_colour(rnd.choice(bark), rnd, birch=(kind == "birch")))
        parts.append(br)

    for bi, (c, radii) in enumerate(blob_specs):
        b = blob(f"{name}_blob{bi}", c, radii, rnd, subdiv=2, amp=0.2, facet=22 if kind != "blossom" else 20)
        paint(b, leaf_colour(rnd.choice(palette), c.z, radii[2], rnd, warm=0.07 if kind != "blossom" else 0.03))
        parts.append(b)
    ob = join(parts, name)
    ob["species"] = kind
    return ob


def pine(idx, seed):
    rnd = random.Random(seed)
    H = rnd.uniform(8.2, 10.4)
    tiers = rnd.randint(5, 6)
    r_base = rnd.uniform(0.34, 0.42)
    pts = lean_points(rnd, H * 0.78, rnd.uniform(0, 0.3), 0.12)
    parts = []
    name = f"pine_{idx}"
    trunk = tube(name + "_trunk", pts, trunk_radii(r_base, 0.12, flare=1.7), 6, rnd, lumps=0.1)
    paint(trunk, trunk_colour(rnd.choice([0x5C3F2A, 0x6A4630, 0x573A26]), rnd))
    parts.append(trunk)
    base = rnd.choice(PINE_LEAF)
    z0 = H * 0.2
    for i in range(tiers):
        t = i / (tiers - 1)
        r = (2.5 - 1.85 * t) * rnd.uniform(0.92, 1.08)
        h = H * (0.27 - 0.05 * t)
        z = z0 + (H * 0.8 - z0 - h * 0.7) * t
        # Follow the trunk's lean a little.
        k = z / max(pts[-1].z, 0.01)
        idx_f = min(len(pts) - 1, k * (len(pts) - 1))
        lo = pts[int(idx_f)]
        hi = pts[min(len(pts) - 1, int(idx_f) + 1)]
        f = idx_f - int(idx_f)
        cx = lo.x + (hi.x - lo.x) * f
        cy = lo.y + (hi.y - lo.y) * f
        tr = tier(f"{name}_tier{i}", z, r, h, rnd, sides=rnd.choice([7, 8]))
        tr.data.transform(Matrix.Translation((cx, cy, 0)))
        shade_k = 0.82 + 0.28 * t
        tint = srgb(base)
        paint(tr, leaf_colour_tier(tint, z, h, shade_k, rnd))
        parts.append(tr)
    ob = join(parts, name)
    ob["species"] = "pine"
    return ob


def leaf_colour_tier(tint, z0, h, shade_k, rnd):
    def fn(poly):
        up = poly.normal.z
        k = shade_k * (0.9 + 0.16 * (poly.center.z - z0) / max(h, 0.01)) * (1.0 + up * 0.08) * (1 + rnd.uniform(-0.09, 0.09))
        c = shade(tint, k)
        if up > 0.3:  # sunlit upper facets: a touch yellower
            c = (c[0] * 1.12, c[1] * 1.05, c[2] * 0.9)
        return c

    return fn


def build_all():
    global COLL, MAT
    COLL = reset_scene()
    MAT = make_material()
    trees = []
    seed = 100
    for kind, count in SPECIES.items():
        for i in range(count):
            seed += 7919
            ob = pine(i, seed) if kind == "pine" else broadleaf(kind, i, seed)
            ob.data.materials.append(MAT)
            trees.append(ob)
    # Preview grid: one row per species. (Origins are reset before export.)
    for row, kind in enumerate(SPECIES):
        col = 0
        for ob in trees:
            if ob["species"] == kind:
                ob.location = (col * SPACING, row * SPACING * 1.0, 0)
                col += 1
    bpy.context.view_layer.update()
    return trees


# --------------------------------------------------------------------------- AO


def bake_ambient_occlusion(objects, strength=1.0):
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.device = "CPU"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.light_settings.distance = 3.4
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
            a = ao.data[i].color[0] ** 1.5
            k = 1.0 - strength * (1.0 - a)
            c = col.data[i].color
            col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
        me.color_attributes.remove(ao)
        me.color_attributes.active_color = me.color_attributes["Col"]
        ob.select_set(False)
    scene.render.engine = prev_engine


# --------------------------------------------------------------------------- preview

PREVIEW = "TreesPreview"


def preview_setup():
    coll = bpy.data.collections.get(PREVIEW)
    if coll is None:
        coll = bpy.data.collections.new(PREVIEW)
        bpy.context.scene.collection.children.link(coll)
    scene = bpy.context.scene

    floor = bpy.data.objects.get("trees_floor")
    if floor is None:
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=120)
        me = bpy.data.meshes.new("trees_floor")
        bm.to_mesh(me)
        bm.free()
        floor = bpy.data.objects.new("trees_floor", me)
        coll.objects.link(floor)
        grass = bpy.data.materials.get("TreesPreviewGrass") or bpy.data.materials.new("TreesPreviewGrass")
        grass.use_nodes = True
        grass.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb(0x6AA33F), 1)
        grass.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        me.materials.append(grass)
    floor.location = (30, 20, -0.02)

    sun = bpy.data.objects.get("trees_sun")
    if sun is None:
        sun = bpy.data.objects.new("trees_sun", bpy.data.lights.new("trees_sun", "SUN"))
        coll.objects.link(sun)
    sun.data.energy = 3.4
    sun.data.angle = math.radians(10)
    sun.rotation_euler = Euler((math.radians(48), math.radians(8), math.radians(-40)))

    cam = bpy.data.objects.get("trees_cam")
    if cam is None:
        cam = bpy.data.objects.new("trees_cam", bpy.data.cameras.new("trees_cam"))
        coll.objects.link(cam)
    cam.data.lens = 70
    scene.camera = cam

    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*srgb(0xBFDFF5), 1)
    bg.inputs["Strength"].default_value = 1.0

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    for name in ("Light", "Camera"):
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = True


def preview_render(path, centre, width_m, res=(1500, 640), pitch_deg=13, yaw_deg=0, extra=0.0):
    """Look at `centre` (Blender space) from the south, framing `width_m` metres across."""
    preview_setup()
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    cam = bpy.data.objects["trees_cam"]
    fov = 2 * math.atan(18 / cam.data.lens)  # 36 mm sensor
    dist = (width_m / 2) / math.tan(fov / 2) + extra
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    c = Vector(centre)
    cam.location = c + Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))) * dist
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def render_previews(trees):
    out = []
    for row, kind in enumerate(SPECIES):
        n = SPECIES[kind]
        for ob in trees:
            ob.hide_render = ob["species"] != kind
        centre = ((n - 1) * SPACING / 2, row * SPACING, 4.3)
        out.append(preview_render(RENDER_DIR + rf"\trees-blender-{kind}.png", centre, n * SPACING * 0.62 + 8))
    for ob in trees:
        ob.hide_render = False
    # Everyone together, from above-ish.
    cols = max(SPECIES.values())
    centre = ((cols - 1) * SPACING / 2, (len(SPECIES) - 1) * SPACING / 2, 3.0)
    out.append(preview_render(RENDER_DIR + r"\trees-blender-all.png", centre, cols * SPACING * 0.82, res=(1600, 1000), pitch_deg=38))
    return out


# --------------------------------------------------------------------------- export


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def export_glb(trees):
    import os

    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    saved = {}
    for ob in trees:
        saved[ob.name] = ob.location.copy()
        ob.location = (0, 0, 0)  # every mesh keeps its origin at the trunk base
        ob.select_set(True)
    bpy.context.view_layer.update()
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
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
    for ob in trees:
        ob.select_set(False)
        ob.location = saved[ob.name]
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    return f"exported {GLB_PATH} ({os.path.getsize(GLB_PATH) // 1024} KB), saved {BLEND_PATH}"


def rebuild_and_export(render=True):
    trees = build_all()
    bake_ambient_occlusion(trees)
    for ob in trees:
        ground_contact(ob)
    out = ["built " + ", ".join(f"{ob.name}:{tri_count(ob)}" for ob in trees)]
    if render:
        out += render_previews(trees)
    out.append(export_glb(trees))
    return "\n".join(out)


if __name__ == "__main__" or True:
    print(rebuild_and_export())
