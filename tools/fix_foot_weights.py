"""Fixes a Meshy-rigged character's shoes in Blender. The auto-rigger bleeds shin
(LeftLeg/RightLeg) weight into the shoe, so the sole sinks into the ground
whenever the knee bends: below the ankle the shin's share moves to the foot,
ramping back in across the ankle so the trouser cuff still follows the shin.
It also splits the toe cap about evenly between foot and toe bones, which digs
the toe tip into the ground at push-off: in front of the ball joint the shoe
goes to the toe bone. Exports without the baked clip (the game animates
procedurally).

Usage: blender -b --factory-startup -P tools/fix_foot_weights.py -- in.glb out.glb
Then:  python3 tools/shrink_glb.py out.glb src/assets/models/<id>.glb
"""
import sys

import bpy
from mathutils import Vector

# The shin's weight is gone this far below the ankle, and back in full this far above it,
# as fractions of the ankle's height.
CLEAR_BELOW = 0.5
FULL_ABOVE = 1.25
# The foot-to-toe ramp starts this far behind the ball joint and ends this far in front (metres).
TOE_RAMP_BEHIND = 0.015
TOE_RAMP_AHEAD = 0.035


def smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def fix(src: str, dst: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.find_armature() == arm]

    for side in ('Left', 'Right'):
        ankle = arm.matrix_world @ arm.data.bones[f'{side}Foot'].head_local
        lo, hi = ankle.z * CLEAR_BELOW, ankle.z * FULL_ABOVE
        moved = 0
        for mesh in meshes:
            groups = mesh.vertex_groups
            shin, foot = groups.get(f'{side}Leg'), groups.get(f'{side}Foot')
            if shin is None or foot is None:
                continue
            for v in mesh.data.vertices:
                p = mesh.matrix_world @ v.co
                # This side's shoe: below the ankle band, on the ankle's side of the body.
                if p.z >= hi or p.x * ankle.x <= 0:
                    continue
                w = next((g.weight for g in v.groups if g.group == shin.index), 0.0)
                if w <= 0:
                    continue
                keep = w * smoothstep((p.z - lo) / (hi - lo))
                shin.add([v.index], keep, 'REPLACE')
                foot.add([v.index], w - keep, 'ADD')
                moved += 1
        print(f'{side}: moved shin weight to the foot on {moved} vertices (ankle {ankle.z:.3f})')

        # Toes: in front of the ball joint the shoe belongs to the toe bone, behind it to
        # the foot, with a short ramp across the joint so the shoe creases there at push-off.
        ball = arm.matrix_world @ arm.data.bones[f'{side}ToeBase'].head_local
        # Straight ahead (the way the toes point), not along ankle -> ball: the toe joint
        # often sits off to one side, which would slant the split across the shoe.
        axis = Vector((0, 1 if ball.y > ankle.y else -1, 0))
        bent = 0
        for mesh in meshes:
            groups = mesh.vertex_groups
            foot, toe = groups.get(f'{side}Foot'), groups.get(f'{side}ToeBase')
            if foot is None or toe is None:
                continue
            for v in mesh.data.vertices:
                p = mesh.matrix_world @ v.co
                if p.z >= hi or p.x * ankle.x <= 0:
                    continue
                w = {g.group: g.weight for g in v.groups}
                share = w.get(foot.index, 0.0) + w.get(toe.index, 0.0)
                if share <= 0:
                    continue
                ahead = (p - ball).dot(axis)
                t = smoothstep((ahead + TOE_RAMP_BEHIND) / (TOE_RAMP_BEHIND + TOE_RAMP_AHEAD))
                foot.add([v.index], share * (1 - t), 'REPLACE')
                toe.add([v.index], share * t, 'REPLACE')
                bent += 1
        print(f'{side}: split foot and toe weight across the ball joint on {bent} vertices')

    for mesh in meshes:
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_yup=True,
    )


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    fix(args[0], args[1])
