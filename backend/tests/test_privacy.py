"""Photo metadata removal. Pictures are synthetic byte structures: the parser only cares about the segment layout."""
import struct
import zlib

import pytest
from fastapi.testclient import TestClient

from app import config, privacy


def exif_segment(orientation: int | None = 6, gps: bool = True, camera: bool = True) -> bytes:
    entries = []
    if orientation:
        entries.append((0x0112, 3, 1, struct.pack("<HH", orientation, 0)))
    if camera:
        entries.append((0x010F, 2, 4, b"ACME"))  # Make
    if gps:
        entries.append((0x8825, 4, 1, struct.pack("<I", 200)))  # pointer to a GPS IFD (not needed for the parser)
    entries.sort()
    ifd = struct.pack("<H", len(entries)) + b"".join(struct.pack("<HHI", t, ty, c) + v for t, ty, c, v in entries) + struct.pack("<I", 0)
    tiff = b"II*\x00" + struct.pack("<I", 8) + ifd + b"GPS-LATLON-SECRET-4604N-2403E"
    body = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(body) + 2) + body


def jpeg(*segments: bytes) -> bytes:
    jfif = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    scan = b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00" + b"\x12\x34\x56\xff\x00\x78" + b"\xff\xd9"  # entropy data incl. a stuffed 0xFF00
    return b"\xff\xd8" + jfif + b"".join(segments) + scan


def test_jpeg_gps_and_camera_details_are_removed_picture_data_untouched():
    src = jpeg(exif_segment(orientation=None))
    out, removed = privacy.strip_jpeg(src)
    assert b"SECRET" not in out and b"ACME" not in out and b"Exif" not in out
    assert "GPS location" in removed and "camera and date details" in removed
    assert out.startswith(b"\xff\xd8\xff\xe0") and out.endswith(b"\x12\x34\x56\xff\x00\x78\xff\xd9")  # JFIF kept, entropy data byte-for-byte
    assert len(out) < len(src)


def test_orientation_is_kept_so_phone_photos_stay_upright():
    out, removed = privacy.strip_jpeg(jpeg(exif_segment(orientation=6)))
    assert b"SECRET" not in out and b"ACME" not in out and removed
    i = out.index(b"Exif\x00\x00")
    assert out[:4] == b"\xff\xd8\xff\xe0" and out.index(b"\xff\xe1") > 2  # JFIF first, then the tiny EXIF block
    o, gps, other = privacy._tiff_info(out[i + 6:])
    assert (o, gps, other) == (6, False, False)


def seg(marker: int, body: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body


def test_xmp_iptc_comment_and_multipicture_are_dropped_icc_is_kept():
    xmp = seg(0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>")
    iptc = seg(0xED, b"Photoshop 3.0\x00" + b"8BIM")
    com = seg(0xFE, b"my home address")
    mpf = seg(0xE2, b"MPF\x00abcd")
    icc = seg(0xE2, b"ICC_PROFILE\x00\x01\x01")
    out, removed = privacy.strip_jpeg(jpeg(xmp, iptc, com, mpf, icc))
    assert b"adobe" not in out and b"Photoshop" not in out and b"my home" not in out and b"MPF" not in out
    assert b"ICC_PROFILE" in out
    assert {"XMP metadata", "IPTC/Photoshop data", "comment", "multi-picture data"} <= set(removed)


def test_clean_or_broken_jpegs_are_returned_unchanged():
    clean = jpeg()
    assert privacy.strip_jpeg(clean) == (clean, [])
    broken = b"\xff\xd8\xff\xe1\x00"  # truncated
    assert privacy.strip_jpeg(broken)[0] == broken
    assert privacy.strip_jpeg(b"not a jpeg") == (b"not a jpeg", [])
    assert privacy.strip_jpeg(b"\xff\xd8garbage-after-soi")[0] == b"\xff\xd8garbage-after-soi"


def png(*extra: tuple[bytes, bytes]) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return privacy.PNG_SIG + chunk(b"IHDR", ihdr) + b"".join(chunk(t, d) for t, d in extra) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def test_png_text_time_and_exif_chunks_are_removed():
    src = png((b"tEXt", b"Comment\x00lives at 12 Oak Lane"), (b"tIME", b"\x07\xea\x06\x15\x0a\x00\x00"), (b"eXIf", b"MM\x00*" + b"GPS"), (b"gAMA", b"\x00\x00\xb1\x8f"))
    out, removed = privacy.strip_png(src)
    assert b"Oak Lane" not in out and b"eXIf" not in out and b"tIME" not in out
    assert b"gAMA" in out and b"IDAT" in out and out.endswith(b"IEND\xaeB`\x82")
    assert set(removed) == {"text and time details", "EXIF data"}
    assert privacy.strip_png(png()) == (png(), [])


def test_other_formats_are_untouched():
    for ext in (".webp", ".gif", ".pdf", ".docx", ".txt"):
        assert privacy.strip_metadata(ext, b"anything") == (b"anything", [])


# ---------------------------------------------------------------- through the upload API
@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_upload_strips_by_default_and_reports_what_it_removed(client):
    pid = client.post("/api/properties", json={"name": "T", "center": [24, 45]}).json()["id"]
    r = client.post("/api/documents", files={"file": ("gate.jpg", jpeg(exif_segment()))}, data={"propertyId": pid})
    assert r.status_code == 201
    body = r.json()
    assert "GPS location" in body["metadataRemoved"]
    stored = client.get(body["url"]).content
    assert b"SECRET" not in stored and stored.startswith(b"\xff\xd8")
    assert body["size"] == len(stored)


def test_upload_can_keep_metadata_when_asked(client):
    pid = client.post("/api/properties", json={"name": "T", "center": [24, 45]}).json()["id"]
    r = client.post("/api/documents", files={"file": ("gate.jpg", jpeg(exif_segment()))}, data={"propertyId": pid, "stripMetadata": "false"})
    assert r.json()["metadataRemoved"] == [] and b"SECRET" in client.get(r.json()["url"]).content


def test_png_upload_is_cleaned_too(client):
    pid = client.post("/api/properties", json={"name": "T", "center": [24, 45]}).json()["id"]
    r = client.post("/api/documents", files={"file": ("a.png", png((b"tEXt", b"Comment\x00secret place")))}, data={"propertyId": pid})
    assert r.json()["metadataRemoved"] == ["text and time details"] and b"secret place" not in client.get(r.json()["url"]).content
