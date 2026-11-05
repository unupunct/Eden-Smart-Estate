"""Calendar (.ics) export of tasks."""
import pytest
from fastapi.testclient import TestClient

from app import config, manage


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


def unfold(text: str) -> list[str]:
    return text.replace("\r\n ", "").split("\r\n")


def test_open_dated_tasks_become_all_day_events_with_an_alarm(client):
    pid = client.post("/api/properties", json={"name": "Eden, Hollow", "center": [24, 45]}).json()["id"]
    client.post("/api/tasks", json={"propertyId": pid, "title": "Prune; apples, pears", "due": "2025-02-15", "notes": "line one\nline two", "category": "orchard", "priority": "high"})
    client.post("/api/tasks", json={"propertyId": pid, "title": "No date"})
    done = client.post("/api/tasks", json={"propertyId": pid, "title": "Finished", "due": "2025-03-01"}).json()["id"]
    client.post(f"/api/tasks/{done}/complete", json={})
    r = client.get(f"/api/properties/{pid}/tasks.ics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar") and "attachment" in r.headers["content-disposition"]
    lines = unfold(r.text)
    assert lines[0] == "BEGIN:VCALENDAR" and "END:VCALENDAR" in lines and "VERSION:2.0" in lines
    assert r.text.count("BEGIN:VEVENT") == 1 and r.text.count("END:VEVENT") == 1  # undated and finished tasks are left out
    assert "DTSTART;VALUE=DATE:20250215" in lines and "DTEND;VALUE=DATE:20250216" in lines
    assert "SUMMARY:Prune\\; apples\\, pears" in lines
    assert "DESCRIPTION:line one\\nline two" in lines and "CATEGORIES:orchard" in lines and "PRIORITY:1" in lines
    assert "X-WR-CALNAME:EDEN: Eden\\, Hollow" in lines
    assert "BEGIN:VALARM" in lines and "TRIGGER;RELATED=START:PT9H" in lines
    assert r.text.endswith("END:VCALENDAR\r\n")


def test_repeats_that_follow_the_due_date_become_rrules_but_completion_based_ones_do_not(client):
    pid = client.post("/api/properties", json={"name": "T", "center": [24, 45]}).json()["id"]
    client.post("/api/tasks", json={"propertyId": pid, "title": "Mow", "due": "2025-06-02", "repeatEvery": 2, "repeatUnit": "week"})
    client.post("/api/tasks", json={"propertyId": pid, "title": "Feed", "due": "2025-06-03", "repeatEvery": 3, "repeatUnit": "week", "repeatFrom": "completion"})
    text = client.get(f"/api/properties/{pid}/tasks.ics").text
    assert "RRULE:FREQ=WEEKLY;INTERVAL=2" in text and text.count("RRULE") == 1
    assert "after completion" in text


def test_long_lines_are_folded_at_75_octets_without_splitting_characters():
    folded = manage._ics_fold("SUMMARY:" + "é" * 80)
    for part in folded.split("\r\n"):
        assert len(part.encode("utf-8")) <= 75
    assert "".join(p.lstrip(" ") if i else p for i, p in enumerate(folded.split("\r\n"))) == "SUMMARY:" + "é" * 80
    assert manage._ics_escape("a\\b;c,d\ne") == "a\\\\b\\;c\\,d\\ne"


def test_unknown_property_is_a_404(client):
    assert client.get("/api/properties/nope/tasks.ics").status_code == 404
