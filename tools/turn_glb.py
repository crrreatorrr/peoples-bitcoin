"""Turns a GLB that faces +x (Tripo's export) to face +z, the way Meshy's auto-rigger
and the game expect, and stands it on y = 0. Bakes both into every POSITION and NORMAL.

Usage: python3 tools/turn_glb.py in.glb out.glb
"""
import json
import struct
import sys


def turn(src: str, dst: str) -> None:
    data = bytearray(open(src, 'rb').read())
    json_len = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8

    positions = {p['attributes']['POSITION'] for m in doc['meshes'] for p in m['primitives']}
    floor = min(doc['accessors'][i]['min'][1] for i in positions)
    done = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            for attr in ('POSITION', 'NORMAL'):
                index = prim['attributes'].get(attr)
                if index is None or index in done:
                    continue
                done.add(index)
                acc = doc['accessors'][index]
                view = doc['bufferViews'][acc['bufferView']]
                assert acc['componentType'] == 5126 and 'byteStride' not in view
                start = bin_start + view.get('byteOffset', 0) + acc.get('byteOffset', 0)
                for i in range(acc['count']):
                    at = start + i * 12
                    x, y, z = struct.unpack_from('<fff', data, at)
                    if attr == 'POSITION':
                        y -= floor
                    struct.pack_into('<fff', data, at, -z, y, x)  # +x forward becomes +z
                if 'min' in acc:
                    lift = floor if attr == 'POSITION' else 0
                    lo, hi = acc['min'], acc['max']
                    acc['min'] = [-hi[2], lo[1] - lift, lo[0]]
                    acc['max'] = [-lo[2], hi[1] - lift, hi[0]]

    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    blob = data[bin_start:]
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    open(dst, 'wb').write(out)


if __name__ == '__main__':
    turn(sys.argv[1], sys.argv[2])
