"""Phase 6: tasks, documents and photos, weather. The weather service is replaced by an in-memory fake that exists only here."""
import io
import json
import zipfile
from datetime import date, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, manage, recurrence

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40


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


@pytest.fixture()
def pid(client):
    return client.post("/api/properties", json={"name": "Test", "center": [24.0, 45.0]}).json()["id"]


def upload(client, pid, name="photo.png", data=PNG, **form):
    return client.post("/api/documents", files={"file": (name, data)}, data={"propertyId": pid, **form})


# ------------------------------------------------------------------ recurrence
def test_month_arithmetic_clamps_without_drifting():
    assert recurrence.add_months(date(2025, 1, 31), 1) == date(2025, 2, 28)
    assert recurrence.add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert recurrence.advance(date(2025, 1, 31), 1, "month", 2) == date(2025, 3, 31)  # computed from the anchor: no drift to the 28th
    assert recurrence.advance(date(2024, 2, 29), 1, "year", 1) == date(2025, 2, 28)
    assert recurrence.advance(date(2025, 6, 21), 2, "week", 1) == date(2025, 7, 5)


def test_next_due_keeps_rhythm_or_counts_from_completion():
    assert recurrence.next_due(date(2025, 6, 2), 1, "week", "due", date(2025, 6, 2)) == date(2025, 6, 9)
    assert recurrence.next_due(date(2025, 6, 2), 1, "week", "due", date(2025, 6, 4)) == date(2025, 6, 9)  # done late: still Monday
    assert recurrence.next_due(date(2025, 6, 2), 1, "week", "due", date(2025, 6, 30)) == date(2025, 7, 7)  # missed occurrences are skipped
    assert recurrence.next_due(date(2025, 6, 2), 3, "week", "completion", date(2025, 6, 4)) == date(2025, 6, 25)
    assert recurrence.next_due(None, 1, "day", "due", date(2025, 6, 4)) == date(2025, 6, 5)


# ------------------------------------------------------------------ tasks
def test_task_crud_and_validation(client, pid):
    r = client.post("/api/tasks", json={"propertyId": pid, "title": " Prune apple ", "due": "2025-02-15", "priority": "high", "objectId": "obj1"})
    assert r.status_code == 201 and r.json()["title"] == "Prune apple" and r.json()["objectId"] == "obj1"
    tid = r.json()["id"]
    assert client.post("/api/tasks", json={"propertyId": pid, "title": "x", "due": "15/02/2025"}).status_code == 422
    assert client.post("/api/tasks", json={"propertyId": pid, "title": "x", "due": "2025-02-31"}).status_code == 422
    assert client.post("/api/tasks", json={"propertyId": pid, "title": "x", "repeatEvery": 2}).status_code == 422  # unit missing
    assert client.post("/api/tasks", json={"propertyId": "nope", "title": "x"}).status_code == 404
    p = client.patch(f"/api/tasks/{tid}", json={"due": None, "notes": "after frost"}).json()
    assert p["due"] is None and p["notes"] == "after frost"
    assert client.get(f"/api/tasks?propertyId={pid}&objectId=obj1").json()[0]["id"] == tid
    assert client.delete(f"/api/tasks/{tid}").status_code == 204 and client.get("/api/tasks").json() == []


def test_completing_a_one_off_task_records_history(client, pid):
    tid = client.post("/api/tasks", json={"propertyId": pid, "title": "Fix gate", "due": "2025-06-01"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/complete", json={"note": "new hinge", "completedOn": "2025-06-03"}).json()
    assert r["status"] == "done" and r["completedAt"] == "2025-06-03"
    h = client.get(f"/api/tasks-history?propertyId={pid}").json()
    assert h[0]["title"] == "Fix gate" and h[0]["note"] == "new hinge" and h[0]["completedOn"] == "2025-06-03" and h[0]["due"] == "2025-06-01"
    assert client.post(f"/api/tasks/{tid}/complete", json={}).status_code == 409
    assert client.get("/api/tasks?status=open").json() == []


def test_repeating_tasks_roll_forward_and_keep_a_history(client, pid):
    tid = client.post("/api/tasks", json={"propertyId": pid, "title": "Mow", "due": "2025-06-02", "repeatEvery": 1, "repeatUnit": "week"}).json()["id"]
    r = client.post(f"/api/tasks/{tid}/complete", json={"completedOn": "2025-06-04"}).json()
    assert r["status"] == "open" and r["due"] == "2025-06-09"
    r = client.post(f"/api/tasks/{tid}/complete", json={"completedOn": "2025-06-09"}).json()
    assert r["due"] == "2025-06-16"
    assert len(client.get(f"/api/tasks-history?propertyId={pid}").json()) == 2
    fed = client.post("/api/tasks", json={"propertyId": pid, "title": "Feed tomatoes", "due": "2025-06-02", "repeatEvery": 3, "repeatUnit": "week", "repeatFrom": "completion"}).json()["id"]
    assert client.post(f"/api/tasks/{fed}/complete", json={"completedOn": "2025-06-10"}).json()["due"] == "2025-07-01"


def test_task_ordering_and_csv_is_safe_against_formula_injection(client, pid):
    client.post("/api/tasks", json={"propertyId": pid, "title": "later", "due": "2025-09-01"})
    client.post("/api/tasks", json={"propertyId": pid, "title": "=HYPERLINK(\"http://evil\")", "due": "2025-05-01", "notes": "+cmd"})
    client.post("/api/tasks", json={"propertyId": pid, "title": "no date"})
    titles = [t["title"] for t in client.get("/api/tasks").json()]
    assert titles[1] == "later" and titles[2] == "no date"  # dated first (soonest first), undated last
    csv_text = client.get(f"/api/properties/{pid}/tasks.csv").text
    assert "'=HYPERLINK" in csv_text and ",'+cmd" in csv_text and "\n=HYPERLINK" not in csv_text


def test_deleting_a_property_removes_its_tasks_and_documents(client, pid):
    client.post("/api/tasks", json={"propertyId": pid, "title": "x"})
    d = upload(client, pid).json()
    stored = list(config.UPLOAD_DIR.glob("doc_*"))
    assert len(stored) == 1
    client.delete(f"/api/properties/{pid}")
    assert client.get("/api/tasks").json() == [] and client.get("/api/documents").json() == [] and not list(config.UPLOAD_DIR.glob("doc_*"))
    assert d["id"]


# ------------------------------------------------------------------ documents
def test_upload_list_search_edit_delete(client, pid):
    d = upload(client, pid, "front gate 2025.png", title="Front gate", tags="Gate, repair,GATE", note="before painting", takenAt="2025-05-02", objectId="obj1")
    assert d.status_code == 201
    d = d.json()
    assert d["isImage"] and d["tags"] == ["gate", "repair"] and d["takenAt"] == "2025-05-02" and d["objectId"] == "obj1"
    pdf = upload(client, pid, "warranty.pdf", b"%PDF-1.4 fake", title="Greenhouse warranty").json()
    assert not pdf["isImage"]
    assert [x["title"] for x in client.get(f"/api/documents?propertyId={pid}&q=warranty").json()] == ["Greenhouse warranty"]
    assert [x["title"] for x in client.get(f"/api/documents?propertyId={pid}&q=PAINTING").json()] == ["Front gate"]
    assert [x["id"] for x in client.get(f"/api/documents?propertyId={pid}&kind=photo").json()] == [d["id"]]
    assert [x["id"] for x in client.get(f"/api/documents?propertyId={pid}&objectId=obj1").json()] == [d["id"]]
    p = client.patch(f"/api/documents/{d['id']}", json={"title": "Gate (repaired)", "tags": "done", "objectId": None}).json()
    assert p["title"] == "Gate (repaired)" and p["tags"] == ["done"] and p["objectId"] is None
    assert client.delete(f"/api/documents/{d['id']}").status_code == 204
    assert len(list(config.UPLOAD_DIR.glob("doc_*"))) == 1


def test_upload_rejects_dangerous_or_fake_files(client, pid):
    assert upload(client, pid, "run.exe", b"MZ....").status_code == 415
    assert upload(client, pid, "page.html", b"<script>alert(1)</script>").status_code == 415
    assert upload(client, pid, "noext", b"data").status_code == 415
    assert upload(client, pid, "fake.png", b"<script>alert(1)</script>").status_code == 415  # claims PNG, is not
    assert upload(client, pid, "fake.pdf", b"not a pdf").status_code == 415
    assert upload(client, pid, "empty.png", b"").status_code == 422
    assert upload(client, "no-such-property").status_code == 404
    assert upload(client, pid, takenAt="yesterday").status_code == 422
    assert not list(config.UPLOAD_DIR.glob("doc_*"))


def test_size_limit(client, pid, monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 100)
    assert upload(client, pid, "big.png", PNG + b"0" * 200).status_code == 413


def test_filenames_cannot_escape_the_data_folder(client, pid):
    d = upload(client, pid, "../../evil.png").json()
    assert d["originalName"] == "evil.png"
    files = list(config.UPLOAD_DIR.glob("doc_*"))
    assert len(files) == 1 and files[0].parent == config.UPLOAD_DIR and files[0].name.startswith("doc_")
    assert not (config.DATA_DIR.parent / "evil.png").exists()


def test_files_are_served_safely(client, pid):
    img = upload(client, pid, "a.png").json()
    r = client.get(img["url"])
    assert r.status_code == 200 and r.content == PNG and r.headers["content-type"] == "image/png"
    assert r.headers["content-disposition"].startswith("inline") and r.headers["x-content-type-options"] == "nosniff" and "sandbox" in r.headers["content-security-policy"]
    txt = upload(client, pid, "notes.txt", b"hello <b>x</b>").json()
    r = client.get(txt["url"])
    assert r.headers["content-disposition"].startswith("attachment") and r.headers["content-type"].startswith("text/plain")
    assert client.get(img["url"] + "?download=true").headers["content-disposition"].startswith("attachment")
    (config.UPLOAD_DIR / f"doc_{img['id']}.png").unlink()
    assert client.get(img["url"]).status_code == 404


def test_backup_and_restore_carry_documents_and_tasks(client, pid):
    d = upload(client, pid, "keep.png", title="Keep me").json()
    client.post("/api/tasks", json={"propertyId": pid, "title": "Remember"})
    z = client.get("/api/backup").content
    assert f"uploads/doc_{d['id']}.png" in zipfile.ZipFile(io.BytesIO(z)).namelist()
    client.delete(f"/api/documents/{d['id']}")
    client.delete(f"/api/properties/{pid}")
    assert client.post("/api/restore", files={"file": ("b.zip", z)}).status_code == 200
    assert client.get("/api/documents").json()[0]["title"] == "Keep me"
    assert client.get(f"/api/documents/{d['id']}/file").content == PNG
    assert client.get("/api/tasks").json()[0]["title"] == "Remember"


# ------------------------------------------------------------------ weather
def forecast(now: datetime, tmin=4.0):
    hours = [(now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(-3, 80)]
    return {
        "timezone": "Europe/Bucharest", "elevation": 400.0, "current_units": {"temperature_2m": "°C"}, "daily_units": {"temperature_2m_min": "°C"}, "hourly_units": {},
        "current": {"time": now.strftime("%Y-%m-%dT%H:%M"), "temperature_2m": 17.5, "relative_humidity_2m": 60, "weather_code": 2, "wind_speed_10m": 9.0, "precipitation": 0.0},
        "daily": {"time": [(now.date() + timedelta(days=i)).isoformat() for i in range(7)], "temperature_2m_min": [tmin] * 7, "temperature_2m_max": [20.0] * 7, "precipitation_sum": [0.0] * 7, "weather_code": [2] * 7},
        "hourly": {"time": hours, "temperature_2m": [10.0] * len(hours), "soil_temperature_0cm": [9.0] * len(hours)},
    }


class FakeWeather:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.last_params = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        self.last_params = dict(request.url.params)
        if self.fail:
            raise httpx.ConnectError("offline")
        return httpx.Response(200, json=forecast(datetime.now()))


@pytest.fixture()
def wx(monkeypatch):
    f = FakeWeather()
    monkeypatch.setattr(manage, "WEATHER_TRANSPORT", httpx.MockTransport(f.handler))
    return f


def test_weather_is_off_until_enabled_and_nothing_is_sent(client, wx):
    assert client.get("/api/weather/settings").json()["enabled"] is False
    r = client.get("/api/weather?lat=45&lng=24")
    assert r.status_code == 403 and "coordinates" in r.json()["detail"] and wx.calls == 0


def test_weather_fetch_is_cached_trimmed_and_attributed(client, wx):
    client.put("/api/weather/settings", json={"enabled": True})
    r = client.get("/api/weather?lat=45.0512&lng=24.0498").json()
    assert r["source"] == "Open-Meteo" and r["stale"] is False and r["data"]["current"]["temperature_2m"] == 17.5
    assert len(r["data"]["hourly"]["time"]) == 48 and len(r["data"]["daily"]["time"]) == 7
    assert wx.last_params["latitude"] == "45.0512" and wx.last_params["timezone"] == "auto"
    client.get("/api/weather?lat=45.0512&lng=24.0498")
    assert wx.calls == 1  # second request inside the cache window does not call the service


def test_weather_failure_shows_the_last_real_forecast_as_stale(client, wx, monkeypatch):
    client.put("/api/weather/settings", json={"enabled": True})
    fresh = client.get("/api/weather?lat=45&lng=24").json()
    monkeypatch.setattr(manage, "WEATHER_TTL_S", 0)
    wx.fail = True
    r = client.get("/api/weather?lat=45&lng=24").json()
    assert r["stale"] is True and "last real forecast" in r["error"] and r["fetchedAt"] == fresh["fetchedAt"] and r["data"]["current"]["temperature_2m"] == 17.5


def test_weather_failure_with_nothing_stored_is_an_error_not_a_guess(client, wx):
    client.put("/api/weather/settings", json={"enabled": True})
    wx.fail = True
    r = client.get("/api/weather?lat=10&lng=10")
    assert r.status_code == 502 and "nothing is stored" in r.json()["detail"]


def test_weather_rejects_bad_coordinates_and_can_be_switched_off_again(client, wx):
    client.put("/api/weather/settings", json={"enabled": True})
    assert client.get("/api/weather?lat=95&lng=0").status_code == 422
    client.put("/api/weather/settings", json={"enabled": False})
    assert client.get("/api/weather?lat=45&lng=24").status_code == 403
