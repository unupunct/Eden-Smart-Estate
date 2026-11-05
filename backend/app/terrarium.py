"""Reading ground heights from Terrarium elevation tiles (Terrain Tiles on AWS): PNG, 8-bit RGB, height in metres = R * 256 + G + B / 256 - 32768.

EDEN downloads the few map tiles (about 5 km across at zoom 12, a pixel is about 27 m at 45 degrees north) that cover the property
and reads the heights from them itself, so the only thing the service sees is a tile number. Stdlib only: a small PNG reader
(8-bit RGB or RGBA, not interlaced, which is what elevation tiles are) so no image library is needed.
"""
import asyncio
import math
import struct
import zlib

import httpx

from . import config

TILE_ZOOM = 12
MAX_TILES = 12


def decode_png(data: bytes) -> tuple[int, int, list[bytearray]]:
    """Returns (width, height, rows of bytes). Raises ValueError for anything that is not a plain 8-bit RGB/RGBA PNG."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, hdr = 8, bytearray(), None
    while pos + 8 <= len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            idat += body
        elif typ == b"IEND":
            break
    if hdr is None:
        raise ValueError("PNG without a header")
    w, h, depth, ctype, _comp, _filt, interlace = hdr
    if depth != 8 or ctype not in (2, 6) or interlace != 0 or w > 4096 or h > 4096:
        raise ValueError("unsupported PNG")
    bpp = 3 if ctype == 2 else 4
    stride = w * bpp
    raw = zlib.decompress(bytes(idat))
    if len(raw) != h * (stride + 1):
        raise ValueError("truncated PNG")
    rows: list[bytearray] = []
    prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + (((line[i - bpp] if i >= bpp else 0) + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        elif f != 0:
            raise ValueError("bad PNG filter")
        rows.append(line)
        prev = line
    return w, h, rows


def tile_pixel(lat: float, lng: float, z: int = TILE_ZOOM) -> tuple[float, float]:
    """Position of a point in the world's pixel grid at zoom z (256 px tiles): x grows east, y grows south."""
    n = 256 * (2 ** z)
    return (lng + 180.0) / 360.0 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def tile_url(z: int, x: int, y: int) -> str:
    return config.TERRARIUM_URL.format(z=z, x=x, y=y)


async def fetch_heights(points: list[tuple[float, float]], transport: httpx.AsyncBaseTransport | None = None) -> list[float]:
    """Heights (metres) for (lat, lng) points, read bilinearly (between pixel centres) from the tiles that cover them."""
    pix = [tile_pixel(la, ln) for la, ln in points]
    need: set[tuple[int, int]] = set()
    for gx, gy in pix:
        for dx in (-0.5, 0.5):
            for dy in (-0.5, 0.5):
                need.add((int(math.floor(gx + dx)) // 256, int(math.floor(gy + dy)) // 256))
    if len(need) > MAX_TILES:
        raise ValueError("the area spans too many map tiles")
    tiles: dict[tuple[int, int], list[bytearray]] = {}
    async with httpx.AsyncClient(timeout=30, transport=transport, headers={"User-Agent": config.USER_AGENT}) as client:
        async def one(tx: int, ty: int) -> None:
            r = await client.get(tile_url(TILE_ZOOM, tx, ty))
            if r.status_code != 200:
                raise httpx.HTTPError(f"HTTP {r.status_code}")
            w, h, rows = await asyncio.to_thread(decode_png, r.content)
            if (w, h) != (256, 256):
                raise ValueError("unexpected tile size")
            tiles[(tx, ty)] = rows

        await asyncio.gather(*(one(tx, ty) for tx, ty in sorted(need)))

    def height(px: int, py: int) -> float:
        row = tiles[(px // 256, py // 256)][py % 256]
        o = (px % 256) * (3 if len(row) == 256 * 3 else 4)
        return row[o] * 256 + row[o + 1] + row[o + 2] / 256 - 32768

    out = []
    for gx, gy in pix:
        fx, fy = gx - 0.5, gy - 0.5            # pixel centres sit half a pixel in
        x0, y0 = int(math.floor(fx)), int(math.floor(fy))
        tx, ty = fx - x0, fy - y0
        top = height(x0, y0) * (1 - tx) + height(x0 + 1, y0) * tx
        bot = height(x0, y0 + 1) * (1 - tx) + height(x0 + 1, y0 + 1) * tx
        out.append(top * (1 - ty) + bot * ty)
    return out
