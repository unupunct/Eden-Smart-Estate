"""Pictures of plants from Wikipedia / Commons: opt-in, free licences only, credited, remembered, never for mushrooms."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, plantpictures
from app.main import app

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 2000 + b"\xff\xd9"
COMMONS = "https://upload.wikimedia.org/wikipedia/commons"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    monkeypatch.setattr(config, "PASSWORD", "")
    with TestClient(app) as c:
        yield c


def wiki(monkeypatch, *, summary=None, licence="CC BY-SA 4.0", artist='<a href="//commons.wikimedia.org/wiki/User:X">Jane <b>Doe</b></a>', image=JPEG,
         ctype="image/jpeg", status=200, thumb=None, calls=None):
    """A fake Wikipedia + Commons + image server."""
    summary = summary if summary is not None else {"type": "standard", "title": "Tomato", "originalimage": {"source": f"{COMMONS}/a/ab/Tomato_je.jpg"},
                                                  "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Tomato"}}}
    thumb = thumb or "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Tomato_je.jpg/500px-Tomato_je.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo"

    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        host, path = request.url.host, request.url.path
        if host == "en.wikipedia.org":
            return httpx.Response(status, json=summary) if status == 200 else httpx.Response(status)
        if host == "commons.wikimedia.org":
            meta = {"LicenseShortName": {"value": licence}, "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"}, "Artist": {"value": artist}}
            return httpx.Response(200, json={"query": {"pages": [{"title": "File:Tomato_je.jpg", "imageinfo": [{"thumburl": thumb, "descriptionurl": "https://commons.wikimedia.org/wiki/File:Tomato_je.jpg", "extmetadata": meta}]}]}})
        if host in ("upload.wikimedia.org", "thumb.wikimedia.org"):
            return httpx.Response(200, content=image, headers={"content-type": ctype})
        return httpx.Response(404)
    monkeypatch.setattr(plantpictures, "TRANSPORT", httpx.MockTransport(handler))


def on(c):
    assert c.put("/api/library/pictures/settings", json={"enabled": True}).json()["enabled"] is True


# ------------------------------------------------------------------ pure helpers
@pytest.mark.parametrize("src,name", [
    (f"{COMMONS}/thumb/a/ab/Tomato_je.jpg/330px-Tomato_je.jpg", "Tomato_je.jpg"),
    (f"{COMMONS}/a/ab/Tomato_je.jpg", "Tomato_je.jpg"),
    (f"{COMMONS}/8/89/Tomato_je.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled", "Tomato_je.jpg"),   # what the REST API really returns
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/8/89/Tomato_je.jpg/500px-Tomato_je.jpg", "Tomato_je.jpg"),
    (f"{COMMONS}/thumb/a/ab/Caf%C3%A9_plant.jpg/200px-x.jpg", "Café_plant.jpg"),
    ("https://upload.wikimedia.org/wikipedia/en/a/ab/Fair_use.jpg", None),   # a local, often non-free, file
    ("https://example.com/wikipedia/commons/a/ab/x.jpg", None),
    ("", None),
])
def test_only_commons_files_are_recognised(src, name):
    assert plantpictures.commons_file_name(src) == name


@pytest.mark.parametrize("lic,free", [("CC BY-SA 4.0", True), ("CC BY 2.0", True), ("CC0", True), ("Public domain", True), ("CC BY-SA 3.0", True), ("PD", True),
                                      ("CC BY-NC 4.0", False), ("CC BY-ND 2.0", False), ("CC BY-NC-SA 3.0", False), ("GFDL", False), ("Fair use", False), ("", False), ("All rights reserved", False)])
def test_only_free_licences_pass(lic, free):
    assert bool(plantpictures.free_licence({"LicenseShortName": {"value": lic}})) is free


def test_search_title_uses_two_words_of_the_accepted_name():
    assert plantpictures.search_title({"sci": "Brassica oleracea var. italica", "taxon": None}) == "Brassica oleracea"
    assert plantpictures.search_title({"sci": "Pisum sativum", "taxon": {"name": "Pisum sativum", "acceptedName": "Lathyrus oleraceus"}}) == "Pisum sativum"
    assert plantpictures.search_title({"sci": "Cucurbita maxima / pepo", "taxon": None}) == "Cucurbita maxima"
    assert plantpictures.search_title({"sci": "Forsythia x intermedia", "taxon": None}) == "Forsythia × intermedia"


def test_credit_text_has_no_markup():
    assert plantpictures.plain('<a href="x">Jane <b>Doe</b></a> &amp; Co') == "Jane Doe & Co"


# ------------------------------------------------------------------ the API
def test_off_by_default_and_nothing_is_requested(env, monkeypatch):
    calls = []
    wiki(monkeypatch, calls=calls)
    assert env.get("/api/library/pictures/settings").json()["enabled"] is False
    r = env.get("/api/library/pictures/plants/tomato")
    assert r.status_code == 403 and calls == []


def test_a_free_picture_is_downloaded_credited_and_served(env, monkeypatch):
    wiki(monkeypatch)
    on(env)
    r = env.get("/api/library/pictures/plants/tomato").json()
    assert r["status"] == "ok" and r["url"].startswith("/api/library/picture-file/")
    c = r["credit"]
    assert c["artist"] == "Jane Doe" and c["licence"] == "CC BY-SA 4.0" and c["licenceUrl"].startswith("https://creativecommons.org/") and c["source"] == "Wikimedia Commons"
    assert c["page"].startswith("https://commons.wikimedia.org/wiki/File:") and c["article"].endswith("/wiki/Tomato")
    f = env.get(r["url"])
    assert f.status_code == 200 and f.content == JPEG and "immutable" in f.headers["cache-control"]


def test_each_plant_is_asked_about_once(env, monkeypatch):
    calls = []
    wiki(monkeypatch, calls=calls)
    on(env)
    env.get("/api/library/pictures/plants/tomato")
    n = len(calls)
    env.get("/api/library/pictures/plants/tomato")
    assert len(calls) == n and n == 3  # article, picture details, picture file


def test_only_the_scientific_name_is_sent(env, monkeypatch):
    calls = []
    wiki(monkeypatch, calls=calls)
    on(env)
    env.get("/api/library/pictures/plants/tomato")
    assert all("?" not in u or u.startswith(("https://commons.wikimedia.org", "https://thumb.wikimedia.org")) for u in calls)
    assert any("Solanum_lycopersicum" in u for u in calls)
    assert not any(k in u.lower() for u in calls for k in ("eden", "property", "home"))


@pytest.mark.parametrize("licence", ["CC BY-NC 4.0", "CC BY-ND 2.0", "All rights reserved", "Fair use"])
def test_a_non_free_licence_means_no_picture_and_nothing_is_saved(env, monkeypatch, licence, tmp_path):
    wiki(monkeypatch, licence=licence)
    on(env)
    r = env.get("/api/library/pictures/plants/tomato").json()
    assert r["status"] == "none" and "not a free one" in r["why"]
    assert not list((tmp_path / "plant_pictures").glob("*.jpg"))


def test_a_picture_that_is_not_on_commons_is_skipped(env, monkeypatch):
    wiki(monkeypatch, summary={"type": "standard", "originalimage": {"source": "https://upload.wikimedia.org/wikipedia/en/a/ab/Local.jpg"}})
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"


@pytest.mark.parametrize("summary", [{"type": "disambiguation"}, {"type": "standard"}, {"type": "standard", "thumbnail": {}}])
def test_no_article_or_no_picture_is_a_clear_none(env, monkeypatch, summary):
    wiki(monkeypatch, summary=summary)
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"


def test_a_missing_article_is_none_and_the_none_is_remembered(env, monkeypatch):
    calls = []
    wiki(monkeypatch, status=404, calls=calls)
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"
    n = len(calls)
    env.get("/api/library/pictures/plants/tomato")
    assert len(calls) == n


def test_a_wrong_file_type_or_a_huge_file_is_refused(env, monkeypatch):
    wiki(monkeypatch, ctype="text/html", image=b"<html>")
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"
    wiki(monkeypatch, image=b"0" * (plantpictures.MAX_BYTES + 1))
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"


def test_the_picture_must_come_from_wikimedia(env, monkeypatch):
    wiki(monkeypatch, thumb="https://evil.example/pic.jpg")
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "none"


def test_the_service_being_down_is_an_error_to_retry_not_a_stored_none(env, monkeypatch):
    wiki(monkeypatch, status=503)
    on(env)
    assert env.get("/api/library/pictures/plants/tomato").status_code == 502
    wiki(monkeypatch)
    assert env.get("/api/library/pictures/plants/tomato").json()["status"] == "ok"


def test_there_are_never_pictures_of_mushrooms_or_unknown_entries(env, monkeypatch):
    calls = []
    wiki(monkeypatch, calls=calls)
    on(env)
    assert env.get("/api/library/pictures/mushrooms/chanterelle").status_code == 404
    assert env.get("/api/library/pictures/fish/koi").status_code == 404
    assert env.get("/api/library/pictures/plants/no-such-plant").status_code == 404
    assert calls == []


def test_aquatic_plants_get_pictures_too(env, monkeypatch):
    wiki(monkeypatch)
    on(env)
    from app.library import AQUATIC
    assert env.get(f"/api/library/pictures/aquatic/{AQUATIC[0]['id']}").json()["status"] == "ok"


@pytest.mark.parametrize("name", ["../eden.db", "..%2Feden.db", "a.jpg", "0" * 40 + ".exe", "0" * 40 + ".jpg/../x"])
def test_picture_files_cannot_be_used_to_read_other_files(env, name):
    r = env.get(f"/api/library/picture-file/{name}")
    assert not r.content.startswith(b"SQLite format") and r.headers.get("content-type", "").split(";")[0] != "application/octet-stream"
    assert r.status_code == 404 or "text/html" in r.headers.get("content-type", "")  # a refusal, or the app's own page: never a file


def test_forgetting_removes_pictures_and_answers(env, monkeypatch, tmp_path):
    wiki(monkeypatch)
    on(env)
    r = env.get("/api/library/pictures/plants/tomato").json()
    assert env.get(r["url"]).status_code == 200
    assert env.delete("/api/library/pictures").status_code == 204
    assert env.get(r["url"]).status_code == 404
    calls = []
    wiki(monkeypatch, calls=calls)
    env.get("/api/library/pictures/plants/tomato")
    assert calls  # asked again


def test_switching_off_stops_lookups_but_keeps_nothing_new(env, monkeypatch):
    calls = []
    wiki(monkeypatch, calls=calls)
    on(env)
    env.put("/api/library/pictures/settings", json={"enabled": False})
    assert env.get("/api/library/pictures/plants/tomato").status_code == 403 and calls == []


def test_when_the_library_uses_an_older_name_the_accepted_one_is_tried(env, monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.host == "en.wikipedia.org":
            return httpx.Response(404) if "Pisum_sativum" in request.url.path else httpx.Response(200, json={"type": "standard"})
        return httpx.Response(404)
    monkeypatch.setattr(plantpictures, "TRANSPORT", httpx.MockTransport(handler))
    on(env)
    assert env.get("/api/library/pictures/plants/pea").json()["status"] == "none"
    assert any("Pisum_sativum" in p for p in seen) and any("Lathyrus_oleraceus" in p for p in seen)
