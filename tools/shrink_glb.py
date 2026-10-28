"""Shrinks a GLB's embedded textures (default 512 px JPEG) so characters stay light on the web.

Usage: python3 tools/shrink_glb.py in.glb out.glb [max_px]
"""
import io
import json
import struct
import sys

from PIL import Image


def shrink(src: str, dst: str, max_px: int = 512) -> None:
    data = open(src, 'rb').read()
    json_len = struct.unpack('<I', data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    blob = data[bin_start:]

    views = doc['bufferViews']
    images = {img['bufferView']: i for i, img in enumerate(doc.get('images', [])) if 'bufferView' in img}
    chunks = []
    for vi, view in enumerate(views):
        start = view.get('byteOffset', 0)
        chunk = blob[start:start + view['byteLength']]
        if vi in images:
            im = Image.open(io.BytesIO(chunk)).convert('RGB')
            im.thumbnail((max_px, max_px), Image.LANCZOS)
            out = io.BytesIO()
            im.save(out, 'JPEG', quality=88)
            chunk = out.getvalue()
            doc['images'][images[vi]]['mimeType'] = 'image/jpeg'
        chunks.append(chunk)

    packed = bytearray()
    for view, chunk in zip(views, chunks):
        while len(packed) % 4:
            packed.append(0)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(chunk)
        packed += chunk
    while len(packed) % 4:
        packed.append(0)
    doc['buffers'][0]['byteLength'] = len(packed)

    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(packed)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(packed), 0x004E4942) + bytes(packed)
    open(dst, 'wb').write(out)


if __name__ == '__main__':
    shrink(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 512)
