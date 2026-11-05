"""Remove location and camera metadata from uploaded photos (JPEG and PNG) without touching the picture itself.

JPEG: the EXIF/XMP block (APP1), IPTC (APP13), comments and multi-picture data are dropped. A photo's orientation lives in
EXIF, and dropping it would make phone pictures appear sideways, so a minimal EXIF block holding only the orientation is kept.
PNG: text, time and EXIF chunks are dropped. Other formats (WebP, GIF, PDF, Office files) are stored unchanged.
The image data is copied byte for byte: nothing is re-encoded.
"""
import struct

JPEG_SOI = b"\xff\xd8"


def _tiff_info(tiff: bytes) -> tuple[int | None, bool, bool]:
    """(orientation, has_gps, has_other_tags) from a TIFF block (the part of EXIF after 'Exif\\0\\0')."""
    if len(tiff) < 8 or tiff[:2] not in (b"II", b"MM"):
        return None, False, False
    end = "<" if tiff[:2] == b"II" else ">"
    try:
        off = struct.unpack(end + "I", tiff[4:8])[0]
        n = struct.unpack(end + "H", tiff[off:off + 2])[0]
        orient, gps, other = None, False, False
        for i in range(n):
            e = tiff[off + 2 + i * 12: off + 14 + i * 12]
            tag, typ, cnt = struct.unpack(end + "HHI", e[:8])
            if tag == 0x0112 and typ == 3 and cnt == 1:
                orient = struct.unpack(end + "H", e[8:10])[0]
            elif tag == 0x8825:
                gps = True
            else:
                other = True
        return orient, gps, other
    except (struct.error, IndexError):
        return None, False, False


def _orientation_exif(orientation: int) -> bytes:
    """A complete APP1 segment containing only the orientation tag."""
    tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHI", 0x0112, 3, 1) + struct.pack("<HH", orientation, 0) + struct.pack("<I", 0)
    body = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(body) + 2) + body


def strip_jpeg(data: bytes) -> tuple[bytes, list[str]]:
    if not data.startswith(JPEG_SOI):
        return data, []
    out = bytearray(JPEG_SOI)
    removed: list[str] = []
    orientation: int | None = None
    i = 2
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF:
            return data, []  # not a structure we understand: leave the file alone
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker == 0xDA:  # start of scan: the rest is picture data
            out += data[i:]
            break
        if marker == 0xD9 or 0xD0 <= marker <= 0xD7 or marker == 0x01:  # markers without a length
            out += data[i:i + 2]
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i:i + 2 + length]
        body = seg[4:]
        if marker == 0xE1:  # EXIF or XMP
            if body.startswith(b"Exif\x00\x00"):
                o, gps, other = _tiff_info(body[6:])
                if o:
                    orientation = o
                if gps:
                    removed.append("GPS location")
                if other:
                    removed.append("camera and date details")
            else:
                removed.append("XMP metadata")
        elif marker == 0xED:
            removed.append("IPTC/Photoshop data")
        elif marker == 0xFE:
            removed.append("comment")
        elif marker == 0xE2 and body.startswith(b"MPF\x00"):
            removed.append("multi-picture data")
        else:
            out += seg
        i += 2 + length
    else:
        return data, []
    if not removed:
        return data, []
    if orientation and orientation != 1:
        # keep the picture upright: the orientation tag goes right after SOI/JFIF
        rest = bytes(out[2:])
        head = b""
        if rest[:2] == bytes([0xFF, 0xE0]):  # JFIF has to stay first
            head = rest[:2 + struct.unpack(">H", rest[2:4])[0]]
        out = bytearray(JPEG_SOI + head + _orientation_exif(orientation) + rest[len(head):])
    return bytes(out), sorted(set(removed))


PNG_SIG = b"\x89PNG\r\n\x1a\n"
PNG_DROP = {b"tEXt", b"zTXt", b"iTXt", b"tIME", b"eXIf"}


def strip_png(data: bytes) -> tuple[bytes, list[str]]:
    if not data.startswith(PNG_SIG):
        return data, []
    out = bytearray(PNG_SIG)
    removed: list[str] = []
    i = len(PNG_SIG)
    while i + 8 <= len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        end = i + 12 + length
        if end > len(data):
            return data, []
        if typ in PNG_DROP:
            removed.append("EXIF data" if typ == b"eXIf" else "text and time details")
        else:
            out += data[i:end]
        i = end
        if typ == b"IEND":
            break
    if not removed:
        return data, []
    return bytes(out), sorted(set(removed))


def strip_metadata(ext: str, data: bytes) -> tuple[bytes, list[str]]:
    if ext in (".jpg", ".jpeg"):
        return strip_jpeg(data)
    if ext == ".png":
        return strip_png(data)
    return data, []
