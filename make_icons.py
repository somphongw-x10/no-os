#!/usr/bin/env python3
"""
Regenerate the site icons from letter-p.png.

The source art is a black outlined tile with a black "P" on a transparent
background, which disappears against a dark browser tab. This redraws it as a
solid brand-teal tile with a white "P" so it reads in both light and dark UI,
reusing the source's own glyph shape (including its antialiasing) so the letter
stays identical to the original.

Outputs: favicon.ico (16/32/48), icon-512.png, apple-touch-icon.png (180, opaque).
Pure stdlib — no Pillow/ImageMagick on this machine.

    python3 make_icons.py
"""
import struct, zlib, math
from collections import deque

SRC = 'letter-p.png'
TEAL = (0x00, 0x80, 0x7a)      # --accent-teal-dark, matches the "." in the logo
GLYPH = (0xFF, 0xFF, 0xFF)
# The source art sets the P at ~38% of the tile height, which turns to mush at
# 16px. Favicons need the glyph to carry the tile, so scale it up and recentre.
GLYPH_HEIGHT = 0.62            # fraction of tile height

# ---------- PNG I/O ----------

def decode_png(path):
    """Minimal decoder: 8-bit RGBA (colour type 6), non-interlaced."""
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat = 8, b''
    while pos < len(d):
        ln, typ = struct.unpack('>I4s', d[pos:pos + 8])
        body = d[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, il = struct.unpack('>IIBBBBB', body)
            assert (depth, ctype, il) == (8, 6, 0), 'expected 8-bit RGBA, non-interlaced'
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln

    raw = zlib.decompress(idat)
    bpp, stride = 4, w * 4
    out, prev, p = bytearray(), bytearray(stride), 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            x = line[i]
            if f == 1:   line[i] = (x + a) & 0xFF
            elif f == 2: line[i] = (x + b) & 0xFF
            elif f == 3: line[i] = (x + (a + b) // 2) & 0xFF
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (x + pr) & 0xFF
            elif f != 0:
                raise ValueError(f'bad filter {f}')
        out += line
        prev = line
    return w, h, bytes(out)

def encode_png(path, w, h, rgba):
    def chunk(t, data):
        c = t + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)

# ---------- glyph extraction ----------

def components(cov, w, h, thr=0.5):
    """4-connected components of covered pixels."""
    seen = bytearray(w * h)
    comps = []
    for start in range(w * h):
        if seen[start] or cov[start] <= thr:
            continue
        q, cells = deque([start]), []
        seen[start] = 1
        while q:
            i = q.popleft(); cells.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not seen[j] and cov[j] > thr:
                        seen[j] = 1; q.append(j)
        comps.append(cells)
    return comps

def bbox(cells, w):
    xs = [i % w for i in cells]; ys = [i // w for i in cells]
    return min(xs), min(ys), max(xs), max(ys)

# ---------- drawing ----------

def rounded_rect_coverage(px, py, x0, y0, x1, y1, r):
    """Signed-distance coverage of a rounded rect, antialiased over ~1px."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - r, (y1 - y0) / 2 - r
    dx, dy = abs(px - cx) - hx, abs(py - cy) - hy
    d = math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - r
    return min(max(0.5 - d, 0.0), 1.0)

def build_master(opaque=False):
    w, h, rgba = decode_png(SRC)
    cov = [rgba[i * 4 + 3] / 255 for i in range(w * h)]

    comps = components(cov, w, h)
    assert len(comps) >= 2, f'expected an outline and a glyph, found {len(comps)}'
    ring = max(comps, key=len)
    rx0, ry0, rx1, ry1 = bbox(ring, w)
    # the glyph is the component sitting fully inside the outline
    glyph_cells = None
    for c in comps:
        if c is ring:
            continue
        gx0, gy0, gx1, gy1 = bbox(c, w)
        if rx0 < gx0 and gx0 < gx1 < rx1 and ry0 < gy0 and gy0 < gy1 < ry1:
            if glyph_cells is None or len(c) > len(glyph_cells):
                glyph_cells = c
    assert glyph_cells, 'could not isolate the P glyph'

    glyph = [0.0] * (w * h)
    for i in glyph_cells:
        glyph[i] = cov[i]

    # scale the glyph about its own centre so it fills GLYPH_HEIGHT of the tile
    gx0, gy0, gx1, gy1 = bbox(glyph_cells, w)
    scale = (GLYPH_HEIGHT * (ry1 - ry0)) / (gy1 - gy0)
    gcx, gcy = (gx0 + gx1) / 2, (gy0 + gy1) / 2
    tcx, tcy = (rx0 + rx1) / 2, (ry0 + ry1) / 2

    def glyph_at(x, y):
        """Bilinear sample of the unscaled glyph for output pixel (x, y)."""
        sx = gcx + (x - tcx) / scale
        sy = gcy + (y - tcy) / scale
        x0f, y0f = math.floor(sx), math.floor(sy)
        fx, fy = sx - x0f, sy - y0f
        total = 0.0
        for dy in (0, 1):
            for dx in (0, 1):
                px_, py_ = x0f + dx, y0f + dy
                if 0 <= px_ < w and 0 <= py_ < h:
                    wt = (fx if dx else 1 - fx) * (fy if dy else 1 - fy)
                    total += glyph[py_ * w + px_] * wt
        return total

    # corner radius: distance from the outline's top edge to where its left edge starts
    top_y = ry0
    xs_top = sorted(i % w for i in ring if i // w <= top_y + 1)
    radius = max(xs_top[0] - rx0, 8)

    out = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            tile = 1.0 if opaque else rounded_rect_coverage(x + 0.5, y + 0.5, rx0, ry0, rx1, ry1, radius)
            g = glyph_at(x + 0.5, y + 0.5)
            if tile <= 0 and g <= 0:
                continue
            # white glyph composited over the teal tile
            r = TEAL[0] * (1 - g) + GLYPH[0] * g
            gg = TEAL[1] * (1 - g) + GLYPH[1] * g
            b = TEAL[2] * (1 - g) + GLYPH[2] * g
            a = max(tile, g)
            out[i*4:i*4+4] = bytes((round(r), round(gg), round(b), round(a * 255)))
    return w, h, bytes(out)

def resize(w, h, rgba, n):
    """Box-filter downscale with premultiplied alpha (keeps edges clean)."""
    out = bytearray(n * n * 4)
    sx, sy = w / n, h / n
    for y in range(n):
        for x in range(n):
            x0, x1 = int(x * sx), max(int((x + 1) * sx), int(x * sx) + 1)
            y0, y1 = int(y * sy), max(int((y + 1) * sy), int(y * sy) + 1)
            r = g = b = a = 0.0; cnt = 0
            for yy in range(y0, min(y1, h)):
                for xx in range(x0, min(x1, w)):
                    i = (yy * w + xx) * 4
                    al = rgba[i+3] / 255
                    r += rgba[i] * al; g += rgba[i+1] * al; b += rgba[i+2] * al; a += al
                    cnt += 1
            if not cnt:
                continue
            a_avg = a / cnt
            if a_avg > 0:
                px = (round(r / a), round(g / a), round(b / a), round(a_avg * 255))
            else:
                px = (0, 0, 0, 0)
            out[(y*n+x)*4:(y*n+x)*4+4] = bytes(max(0, min(255, v)) for v in px)
    return out

# ---------- ICO ----------

def dib(w, h, rgba):
    hdr = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0)
    px = bytearray()
    for y in range(h - 1, -1, -1):
        row = rgba[y * w * 4:(y + 1) * w * 4]
        for x in range(0, len(row), 4):
            r, g, b, a = row[x:x + 4]
            px += bytes((b, g, r, a))
    mask_stride = ((w + 31) // 32) * 4
    return hdr + bytes(px) + b'\x00' * (mask_stride * h)

def write_ico(path, images):
    n = len(images)
    offset = 6 + 16 * n
    entries, blobs = b'', b''
    for size, data in images:
        d = dib(size, size, data)
        entries += struct.pack('<BBBBHHII', size, size, 0, 0, 1, 32, len(d), offset)
        blobs += d
        offset += len(d)
    open(path, 'wb').write(struct.pack('<HHH', 0, 1, n) + entries + blobs)

def main():
    w, h, master = build_master()
    encode_png('icon-512.png', w, h, master)
    print('wrote icon-512.png')

    ico = [(s, resize(w, h, master, s)) for s in (16, 32, 48)]
    write_ico('favicon.ico', ico)
    print('wrote favicon.ico (16/32/48)')

    ow, oh, opaque = build_master(opaque=True)     # iOS composites on black, so no transparency
    encode_png('apple-touch-icon.png', 180, 180, bytes(resize(ow, oh, opaque, 180)))
    print('wrote apple-touch-icon.png (180x180, opaque)')

if __name__ == '__main__':
    main()
