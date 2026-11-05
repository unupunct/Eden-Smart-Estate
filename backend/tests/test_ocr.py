"""Reading text from documents: file text, PDF text layers, and real Tesseract OCR (skipped when it is not installed)."""
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import config, ocr
from app.main import app

HAVE_TESSERACT = ocr.find_tesseract() is not None
needs_tesseract = pytest.mark.skipif(not HAVE_TESSERACT, reason="Tesseract is not installed")


def picture(text: str, fmt="PNG") -> bytes:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (900, 220), "white")
    ImageDraw.Draw(img).text((30, 60), text, fill="black", font=ImageFont.load_default(size=64))
    out = io.BytesIO()
    img.save(out, fmt)
    return out.getvalue()


def docx(text: str) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:p><w:r><w:t>second line</w:t></w:r></w:p></w:body></w:document>')
    return out.getvalue()


def xlsx(*cells: str) -> bytes:
    out = io.BytesIO()
    items = "".join(f"<si><t>{c}</t></si>" for c in cells)
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("xl/sharedStrings.xml", f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">{items}</sst>')
    return out.getvalue()


def text_pdf(text: str) -> bytes:
    stream = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode()
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
            b"<</Length %d>>\nstream\n" % len(stream) + stream + b"\nendstream", b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    return out + b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, x)


def scanned_pdf(text: str) -> bytes:
    from PIL import Image
    img = Image.open(io.BytesIO(picture(text)))
    out = io.BytesIO()
    img.save(out, "PDF")
    return out.getvalue()


# ------------------------------------------------------------------ text that is already in the file
def test_text_in_office_files_is_taken_without_any_ocr_engine(monkeypatch):
    monkeypatch.setattr(ocr, "find_tesseract", lambda: None)
    assert ocr.extract(".txt", "Pompă de apă — ceapă".encode(), ["eng"]) == ("done", "Pompă de apă — ceapă", "file-text")
    st, t, note = ocr.extract(".docx", docx("Warranty pump"), ["eng"])
    assert st == "done" and "Warranty pump" in t and "second line" in t and note == "file-text"
    assert "Roses" in ocr.extract(".xlsx", xlsx("Roses", "Tulips"), ["eng"])[1]
    assert ocr.extract(".txt", b"   \n", ["eng"])[0] == "none"


def test_pdf_text_layer_is_read_and_labelled_as_such(monkeypatch):
    monkeypatch.setattr(ocr, "find_tesseract", lambda: None)
    st, t, note = ocr.extract(".pdf", text_pdf("Boiler service invoice"), ["eng"])
    assert st == "done" and "Boiler service invoice" in t and note == "text-layer"


def test_pictures_are_reported_as_unavailable_not_silently_empty_without_an_engine(monkeypatch):
    monkeypatch.setattr(ocr, "find_tesseract", lambda: None)
    assert ocr.extract(".png", picture("Hello"), ["eng"])[0] == "unavailable"
    assert ocr.extract(".pdf", scanned_pdf("Hello"), ["eng"])[0] == "unavailable"
    info = ocr.status_info()
    assert info["available"] is False and "Tesseract" in info["hint"]


# ------------------------------------------------------------------ the real engine
@needs_tesseract
def test_a_photo_of_text_is_really_read():
    st, t, note = ocr.extract(".png", picture("Invoice 4711 Pump"), ["eng"])
    assert st == "done" and note == "ocr"
    assert "4711" in t and "Invoice" in t


@needs_tesseract
def test_a_scanned_pdf_is_really_read():
    st, t, note = ocr.extract(".pdf", scanned_pdf("Warranty 2031"), ["eng"])
    assert st == "done" and note == "ocr" and "2031" in t


@needs_tesseract
def test_a_blank_page_gives_none_not_invented_text():
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (600, 300), "white").save(out, "PNG")
    assert ocr.extract(".png", out.getvalue(), ["eng"])[0] == "none"


@needs_tesseract
def test_a_language_without_data_falls_back_to_english_and_says_so():
    info = ocr.status_info()
    assert info["available"] and "eng" in info["installed"]
    ocr_langs = ocr.extract(".png", picture("Pump 99"), ["ron"])  # ron is not installed here: english is used instead of failing
    assert "99" in ocr_langs[1]


# ------------------------------------------------------------------ through the API
@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    monkeypatch.setattr(config, "PASSWORD", "")
    with TestClient(app) as c:
        yield c


def prop(c):
    return c.post("/api/properties", json={"name": "Home", "center": [24, 45]}).json()["id"]


def upload(c, pid, name, data, **form):
    r = c.post("/api/documents", data={"propertyId": pid, **form}, files={"file": (name, data)})
    assert r.status_code == 201, r.text
    return r.json()


def test_upload_reads_the_text_and_search_finds_it_with_a_snippet(client):
    pid = prop(client)
    d = upload(client, pid, "warranty.docx", docx("Pump warranty valid until 2031"))
    assert client.get(f"/api/documents/{d['id']}/text").json()["status"] == "done"
    hits = client.get("/api/documents-text/search", params={"q": "valid until", "propertyId": pid}).json()
    assert [h["id"] for h in hits] == [d["id"]] and "2031" in hits[0]["snippet"]
    assert client.get("/api/documents-text/search", params={"q": "nonexistent word"}).json() == []
    assert client.get("/api/documents-text/search", params={"q": "x"}).json() == []  # too short to be useful
    t = client.get(f"/api/documents/{d['id']}/text").json()
    assert t["label"] == "Text taken from the file." and "Pump warranty" in t["text"]
    listed = client.get("/api/documents", params={"propertyId": pid}).json()[0]
    assert listed["textStatus"] == "done" and "text" not in listed


def test_reading_can_be_switched_off_per_upload_and_run_later(client):
    pid = prop(client)
    d = upload(client, pid, "notes.txt", b"hello boiler", readText="false")
    assert client.get(f"/api/documents/{d['id']}/text").json()["status"] == ""
    assert client.post("/api/ocr/run-missing", params={"propertyId": pid}).json()["queued"] == 1
    assert client.get(f"/api/documents/{d['id']}/text").json()["status"] == "done"
    assert client.post("/api/ocr/run-missing").json()["queued"] == 0


def test_a_broken_file_does_not_break_the_upload(client):
    pid = prop(client)
    d = upload(client, pid, "broken.docx", b"PK\x03\x04 this is not really a zip")
    t = client.get(f"/api/documents/{d['id']}/text").json()
    assert t["status"] == "error" and t["note"]


@needs_tesseract
def test_a_photo_uploaded_through_the_api_becomes_searchable_and_is_labelled_machine_read(client):
    pid = prop(client)
    d = upload(client, pid, "receipt.png", picture("Receipt 8842 Hardware"))
    t = client.get(f"/api/documents/{d['id']}/text").json()
    assert t["status"] == "done" and "8842" in t["text"] and "mistakes" in t["label"]
    assert client.get("/api/documents-text/search", params={"q": "8842"}).json()[0]["id"] == d["id"]


def test_language_setting_is_validated(client):
    assert client.put("/api/ocr/settings", json={"languages": ["eng", "ron"]}).json()["selected"] == ["eng", "ron"]
    assert client.put("/api/ocr/settings", json={"languages": ["../etc"]}).status_code == 422


@needs_tesseract
def test_languages_dropped_into_the_data_folder_are_used_together_with_the_installed_ones(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path
    exe = ocr.find_tesseract()
    eng = Path(exe).parent / "tessdata" / "eng.traineddata"
    (tmp_path / "tessdata").mkdir()
    shutil.copyfile(eng, tmp_path / "tessdata" / "xyz.traineddata")  # stands in for a downloaded language
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    assert ocr.installed_languages(exe)["xyz"] == str(tmp_path / "tessdata")
    st, text, _ = ocr.extract(".png", picture("Mixed 5150"), ["eng", "xyz"])
    assert st == "done" and "5150" in text
