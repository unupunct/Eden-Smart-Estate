"""Phase 5 tests. Home Assistant, cameras and the MQTT broker are replaced by in-memory FAKES that exist only in these tests."""
import asyncio
import json
from datetime import datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app import smart, smart_auto, smart_ha, smart_mqtt


class FakeHA:
    """A stand-in for Home Assistant's REST API (test fixture, not a simulation shipped with EDEN)."""

    def __init__(self):
        self.token = "good-token"
        self.offline = False
        self.calls: list[tuple[str, str, str]] = []
        self.states = {
            "switch.pump": self.st("switch.pump", "off", friendly_name="Garden pump"),
            "light.porch": self.st("light.porch", "on", friendly_name="Porch light", brightness=200),
            "sensor.soil": self.st("sensor.soil", "31.5", friendly_name="Soil moisture", unit_of_measurement="%", device_class="moisture"),
            "lock.gate": self.st("lock.gate", "locked", friendly_name="Gate lock"),
            "camera.front": self.st("camera.front", "idle", friendly_name="Front camera", access_token="SECRET-CAMERA-TOKEN", entity_picture="/api/camera_proxy/camera.front?token=SECRET"),
            "automation.x": self.st("automation.x", "on", friendly_name="Not supported domain"),
        }

    @staticmethod
    def st(eid, state, **attrs):
        return {"entity_id": eid, "state": state, "attributes": attrs, "last_updated": "2025-06-21T10:00:00+00:00"}

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("down")
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return httpx.Response(401, json={"message": "401: Unauthorized"})
        path = request.url.path
        if path == "/api/states":
            return httpx.Response(200, json=list(self.states.values()))
        if path.startswith("/api/states/"):
            s = self.states.get(path[len("/api/states/"):])
            return httpx.Response(200, json=s) if s else httpx.Response(404)
        if path.startswith("/api/services/"):
            _a, _b, _c, dom, svc = path.split("/")
            eid = json.loads(request.content)["entity_id"]
            self.calls.append((dom, svc, eid))
            new = {"turn_on": "on", "turn_off": "off", "lock": "locked", "unlock": "unlocked", "open_cover": "open", "close_cover": "closed"}.get(svc)
            if new and eid in self.states:
                self.states[eid]["state"] = new
            return httpx.Response(200, json=[])
        if path.startswith("/api/camera_proxy/"):
            return httpx.Response(200, content=b"\xff\xd8FAKEJPEG\xff\xd9", headers={"content-type": "image/jpeg"})
        return httpx.Response(404)


@pytest.fixture()
def ha(monkeypatch):
    fake = FakeHA()
    monkeypatch.setattr(smart_ha, "TRANSPORT", httpx.MockTransport(fake.handler))
    return fake


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    smart._prev_states.clear()
    from app.main import app
    with TestClient(app) as c:
        yield c


def connect_ha(client, token="good-token"):
    r = client.post("/api/integrations", json={"kind": "homeassistant", "name": "Home", "url": "http://ha.local:8123/", "token": token})
    assert r.status_code == 201
    iid = r.json()["id"]
    t = client.post(f"/api/integrations/{iid}/test").json()
    return iid, t


def devices(client):
    return {d["externalId"]: d for d in client.get("/api/devices").json()}


# ------------------------------------------------------------------ integrations and devices
def test_token_is_never_returned_and_url_is_normalised(client, ha):
    iid, _ = connect_ha(client, "good-token")
    row = client.get("/api/integrations").json()[0]
    assert row["hasToken"] is True and row["url"] == "http://ha.local:8123"
    assert "good-token" not in json.dumps(client.get("/api/integrations").json())
    assert "token" not in row


def test_wrong_token_is_reported_not_hidden(client, ha):
    iid, t = connect_ha(client, "bad-token")
    assert t["ok"] is False and "token" in t["message"].lower()
    row = client.get("/api/integrations").json()[0]
    assert row["status"] == "error" and row["deviceCount"] == 0


def test_unreachable_home_assistant_says_so(client, ha):
    ha.offline = True
    _iid, t = connect_ha(client)
    assert t["ok"] is False and "reach" in t["message"].lower()


def test_sync_adds_only_supported_entities_with_their_real_state(client, ha):
    _iid, t = connect_ha(client)
    assert t["ok"] and t["count"] == 5
    d = devices(client)
    assert "automation.x" not in d
    assert d["sensor.soil"]["state"] == "31.5" and d["sensor.soil"]["unit"] == "%" and d["sensor.soil"]["deviceClass"] == "moisture"
    assert d["light.porch"]["state"] == "on" and d["switch.pump"]["state"] == "off"
    assert d["lock.gate"]["risky"] is True and d["switch.pump"]["risky"] is False  # locks default to confirm-first
    assert d["sensor.soil"]["controllable"] is False and d["switch.pump"]["controllable"] is True


def test_camera_tokens_are_not_stored(client, ha):
    connect_ha(client)
    cam = devices(client)["camera.front"]
    assert "access_token" not in cam["attrs"] and "entity_picture" not in cam["attrs"]
    assert "SECRET" not in json.dumps(client.get("/api/devices").json())


def test_entities_that_vanish_have_no_state(client, ha):
    iid, _ = connect_ha(client)
    del ha.states["sensor.soil"]
    client.post(f"/api/integrations/{iid}/sync")
    assert devices(client)["sensor.soil"]["state"] is None


def test_renamed_and_linked_devices_keep_their_settings_across_syncs(client, ha):
    iid, _ = connect_ha(client)
    did = devices(client)["switch.pump"]["id"]
    client.patch(f"/api/devices/{did}", json={"name": "Pond pump", "objectId": "obj1", "risky": True})
    ha.states["switch.pump"]["state"] = "on"
    client.post(f"/api/integrations/{iid}/sync")
    d = devices(client)["switch.pump"]
    assert d["name"] == "Pond pump" and d["objectId"] == "obj1" and d["risky"] is True and d["state"] == "on"


def test_domain_filter_limits_what_is_imported(client, ha):
    r = client.post("/api/integrations", json={"kind": "homeassistant", "name": "H", "url": "http://ha:8123", "token": "good-token", "options": {"domains": ["sensor"]}})
    client.post(f"/api/integrations/{r.json()['id']}/sync")
    assert set(devices(client)) == {"sensor.soil"}


def test_deleting_an_integration_removes_devices_and_secret(client, ha):
    iid, _ = connect_ha(client)
    assert client.delete(f"/api/integrations/{iid}").status_code == 204
    assert client.get("/api/devices").json() == []
    from app import db
    with db.session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM secrets WHERE key LIKE 'int:%'").fetchone()[0] == 0


def test_bad_urls_rejected(client):
    assert client.post("/api/integrations", json={"kind": "homeassistant", "name": "H", "url": "ha.local"}).status_code == 422
    assert client.post("/api/integrations", json={"kind": "mqtt", "name": "M", "url": "not a host"}).status_code == 422


# ------------------------------------------------------------------ commands
def test_command_changes_state_only_via_readback(client, ha):
    connect_ha(client)
    d = devices(client)["switch.pump"]
    r = client.post(f"/api/devices/{d['id']}/command", json={"service": "turn_on"})
    assert r.status_code == 200 and r.json()["state"] == "on"
    assert ha.calls == [("switch", "turn_on", "switch.pump")]
    assert devices(client)["switch.pump"]["state"] == "on"


def test_risky_devices_need_confirmation(client, ha):
    connect_ha(client)
    d = devices(client)["lock.gate"]
    r = client.post(f"/api/devices/{d['id']}/command", json={"service": "unlock"})
    assert r.status_code == 409 and ha.calls == []
    r = client.post(f"/api/devices/{d['id']}/command", json={"service": "unlock", "confirm": True})
    assert r.status_code == 200 and r.json()["state"] == "unlocked"


def test_disallowed_commands_are_refused(client, ha):
    connect_ha(client)
    d = devices(client)
    assert client.post(f"/api/devices/{d['sensor.soil']['id']}/command", json={"service": "turn_on"}).status_code == 422
    assert client.post(f"/api/devices/{d['switch.pump']['id']}/command", json={"service": "unlock"}).status_code == 422
    assert ha.calls == []


def test_command_failure_is_reported(client, ha):
    connect_ha(client)
    d = devices(client)["switch.pump"]
    ha.offline = True
    r = client.post(f"/api/devices/{d['id']}/command", json={"service": "turn_on"})
    assert r.status_code == 502 and devices(client)["switch.pump"]["state"] == "off"  # state untouched


# ------------------------------------------------------------------ MQTT (fake broker client)
class FakeMqtt:
    def __init__(self, client_id):
        self.subs, self.sent, self.started = [], [], False

    def username_pw_set(self, *a): pass
    def tls_set(self): pass
    def connect_async(self, *a): pass
    def loop_start(self): self.started = True
    def loop_stop(self): pass
    def disconnect(self): pass
    def subscribe(self, t): self.subs.append(t)

    def publish(self, t, p):
        self.sent.append((t, p))
        return type("I", (), {"rc": 0})()


@pytest.fixture()
def mqtt(monkeypatch):
    made = []

    def factory(cid):
        m = FakeMqtt(cid)
        made.append(m)
        return m
    monkeypatch.setattr(smart_mqtt, "CLIENT_FACTORY", factory)
    yield made
    smart_mqtt.stop_all()


def test_mqtt_state_is_exactly_the_last_payload_and_unknown_before(client, mqtt):
    iid = client.post("/api/integrations", json={"kind": "mqtt", "name": "Broker", "url": "mqtt://192.168.1.5", "token": "pw", "options": {"username": "u", "port": 1883}}).json()["id"]
    r = client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "Shed temp", "stateTopic": "shed/temp", "unit": "°C"})
    assert r.status_code == 201 and r.json()["state"] is None  # nothing received yet: no value
    assert "shed/temp" in mqtt[0].subs
    smart_mqtt.handle_message(iid, "shed/temp", b"18.4")
    assert devices(client)["shed/temp"]["state"] == "18.4"
    smart_mqtt.handle_message(iid, "other/topic", b"99")  # not a device: ignored
    assert len(client.get("/api/devices").json()) == 1


def test_mqtt_commands_publish_and_wildcards_are_refused(client, mqtt):
    iid = client.post("/api/integrations", json={"kind": "mqtt", "name": "B", "url": "broker.lan"}).json()["id"]
    assert client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "x", "stateTopic": "a/#"}).status_code == 422
    d = client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "Fan", "stateTopic": "fan/state", "commandTopic": "fan/set"}).json()
    r = client.post(f"/api/devices/{d['id']}/command", json={"service": "turn_on"})
    assert r.status_code == 200 and mqtt[0].sent == [("fan/set", "ON")]
    assert r.json()["state"] is None  # the broker has not confirmed anything
    assert client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "dup", "stateTopic": "fan/state"}).status_code == 409


def test_mqtt_without_the_library_reports_it(client, monkeypatch):
    monkeypatch.setattr(smart_mqtt, "AVAILABLE", False)
    monkeypatch.setattr(smart_mqtt, "CLIENT_FACTORY", None)
    iid = client.post("/api/integrations", json={"kind": "mqtt", "name": "B", "url": "broker.lan"}).json()["id"]
    t = client.post(f"/api/integrations/{iid}/test").json()
    assert t["ok"] is False and "paho-mqtt" in t["message"]


# ------------------------------------------------------------------ cameras
def test_camera_credentials_move_out_of_the_url(client):
    r = client.post("/api/cameras", json={"name": "Yard", "kind": "snapshot", "url": "http://admin:s3cret@192.168.1.20:8080/snap.jpg"}).json()
    assert r["url"] == "http://192.168.1.20:8080/snap.jpg" and r["username"] == "admin" and r["hasPassword"] is True
    assert "s3cret" not in json.dumps(client.get("/api/cameras").json())


def test_camera_url_schemes_are_checked(client):
    assert client.post("/api/cameras", json={"name": "x", "kind": "snapshot", "url": "rtsp://cam/stream"}).status_code == 422
    assert client.post("/api/cameras", json={"name": "x", "kind": "rtsp", "url": "http://cam/stream"}).status_code == 422
    assert client.post("/api/cameras", json={"name": "x", "kind": "ha"}).status_code == 422


def test_snapshot_camera_uses_stored_credentials_and_returns_the_picture(client, monkeypatch):
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, content=b"\xff\xd8PIC\xff\xd9", headers={"content-type": "image/jpeg"})
    monkeypatch.setattr(smart, "CAM_TRANSPORT", httpx.MockTransport(handler))
    cid = client.post("/api/cameras", json={"name": "Yard", "kind": "snapshot", "url": "http://cam/s.jpg", "username": "u", "password": "p"}).json()["id"]
    r = client.get(f"/api/cameras/{cid}/snapshot")
    assert r.status_code == 200 and r.content.startswith(b"\xff\xd8") and r.headers["cache-control"] == "no-store"
    assert seen["auth"].startswith("Basic ")


def test_camera_errors_are_explained(client, monkeypatch):
    monkeypatch.setattr(smart, "CAM_TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(401)))
    cid = client.post("/api/cameras", json={"name": "Yard", "kind": "snapshot", "url": "http://cam/s.jpg"}).json()["id"]
    r = client.get(f"/api/cameras/{cid}/snapshot")
    assert r.status_code == 502 and "401" in r.json()["detail"]
    monkeypatch.setattr(smart, "CAM_TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"})))
    assert "picture" in client.get(f"/api/cameras/{cid}/snapshot").json()["detail"]


def test_home_assistant_camera_uses_the_integration(client, ha):
    iid, _ = connect_ha(client)
    cid = client.post("/api/cameras", json={"name": "Front", "kind": "ha", "integrationId": iid, "entityId": "camera.front"}).json()["id"]
    r = client.get(f"/api/cameras/{cid}/snapshot")
    assert r.status_code == 200 and b"FAKEJPEG" in r.content


def test_rtsp_needs_ffmpeg_and_says_so(client, monkeypatch):
    monkeypatch.setattr(smart.shutil, "which", lambda _n: None)
    cid = client.post("/api/cameras", json={"name": "R", "kind": "rtsp", "url": "rtsp://cam/stream"}).json()["id"]
    r = client.get(f"/api/cameras/{cid}/snapshot")
    assert r.status_code == 501 and "ffmpeg" in r.json()["detail"]
    assert client.get("/api/smart/status").json()["ffmpeg"] is False


def test_mjpeg_snapshot_and_ffmpeg_command():
    assert smart.first_jpeg(b"--frame\r\n\xff\xd8abc\xff\xd9--frame\r\n\xff\xd8def") == b"\xff\xd8abc\xff\xd9"
    assert smart.first_jpeg(b"no picture here") is None
    cmd = smart.ffmpeg_command("rtsp://10.0.0.5:554/h264", "us er", "p@ss:w/rd")
    assert cmd[cmd.index("-i") + 1] == "rtsp://us%20er:p%40ss%3Aw%2Frd@10.0.0.5:554/h264" and "-frames:v" in cmd


# ------------------------------------------------------------------ automation logic (pure)
def test_compare_never_trusts_unknown_states():
    for bad in (None, "", "unavailable", "unknown"):
        assert smart_auto.compare("eq", bad, "on") is False and smart_auto.compare("ne", bad, "on") is False and smart_auto.compare("gt", bad, 1) is False
    assert smart_auto.compare("gt", "31.5", 30) and smart_auto.compare("lt", "9", "10") and smart_auto.compare("eq", "ON", "on")
    assert not smart_auto.compare("gt", "abc", 1)


def test_time_window_wraps_midnight():
    assert smart_auto.in_window(23 * 60 + 30, "22:00", "06:00") and smart_auto.in_window(60, "22:00", "06:00")
    assert not smart_auto.in_window(12 * 60, "22:00", "06:00") and smart_auto.in_window(12 * 60, "08:00", "18:00")


def test_state_trigger_fires_on_change_only():
    now = datetime(2025, 6, 21, 12, 0)
    t = {"type": "state", "deviceId": "d", "to": "on"}
    assert smart_auto.trigger_fires(t, {"d": "off"}, {"d": "on"}, now, None)
    assert not smart_auto.trigger_fires(t, {"d": "on"}, {"d": "on"}, now, None)  # already on
    assert not smart_auto.trigger_fires(t, {}, {"d": "on"}, now, None)  # first sighting
    assert not smart_auto.trigger_fires(t, {"d": "unavailable"}, {"d": "on"}, now, None)
    a = {"type": "state", "deviceId": "d", "above": 30}
    assert smart_auto.trigger_fires(a, {"d": "29"}, {"d": "31"}, now, None) and not smart_auto.trigger_fires(a, {"d": "31"}, {"d": "32"}, now, None)
    b = {"type": "state", "deviceId": "d", "below": 10}
    assert smart_auto.trigger_fires(b, {"d": "12"}, {"d": "8"}, now, None)


def test_time_trigger_matches_the_minute_and_days():
    t = {"type": "time", "at": "07:30", "days": [0, 1, 2, 3, 4]}
    assert smart_auto.trigger_fires(t, {}, {}, datetime(2025, 6, 23, 7, 30), None)  # Monday
    assert not smart_auto.trigger_fires(t, {}, {}, datetime(2025, 6, 22, 7, 30), None)  # Sunday
    assert not smart_auto.trigger_fires(t, {}, {}, datetime(2025, 6, 23, 7, 31), None)
    assert not smart_auto.trigger_fires(t, {}, {}, datetime(2025, 6, 23, 7, 30, 40), datetime(2025, 6, 23, 7, 30, 5))


# ------------------------------------------------------------------ automations through the API and engine
def rule(client, **over):
    d = devices(client)
    body = {"name": "Pump on when dry", "trigger": {"type": "state", "deviceId": d["sensor.soil"]["id"], "below": 25},
            "conditions": [], "actions": [{"type": "device", "deviceId": d["switch.pump"]["id"], "service": "turn_on"}], "enabled": True}
    body.update(over)
    return client.post("/api/automations", json=body)


def test_rule_validation_gives_plain_messages(client, ha):
    connect_ha(client)
    d = devices(client)
    assert "trigger" in rule(client, trigger={"type": "nope"}).json()["detail"].lower()
    assert "not possible" in rule(client, actions=[{"type": "device", "deviceId": d["sensor.soil"]["id"], "service": "turn_on"}]).json()["detail"]
    assert "at least one action" in rule(client, actions=[]).json()["detail"]
    assert "07:30" in rule(client, trigger={"type": "time", "at": "7h"}).json()["detail"]


def test_risky_rules_need_acknowledgement_to_be_enabled(client, ha):
    connect_ha(client)
    d = devices(client)
    acts = [{"type": "device", "deviceId": d["lock.gate"]["id"], "service": "unlock"}]
    r = rule(client, actions=acts)
    assert r.status_code == 422 and "risky" in r.json()["detail"]
    assert rule(client, actions=acts, riskAck=True).status_code == 201
    assert rule(client, name="draft", actions=acts, enabled=False).status_code == 201  # a disabled draft needs no acknowledgement


def test_engine_fires_once_on_a_real_change_and_sends_the_command(client, ha):
    iid, _ = connect_ha(client)
    rule(client)
    now = datetime(2025, 6, 21, 12, 0)
    assert asyncio.run(smart.run_engine(now)) == 0  # first sighting
    ha.states["sensor.soil"]["state"] = "20.0"
    client.post(f"/api/integrations/{iid}/sync")
    assert asyncio.run(smart.run_engine(now)) == 1
    assert ha.calls == [("switch", "turn_on", "switch.pump")]
    assert devices(client)["switch.pump"]["state"] == "on"
    ha.states["sensor.soil"]["state"] = "30"
    client.post(f"/api/integrations/{iid}/sync")
    asyncio.run(smart.run_engine(now))
    ha.states["sensor.soil"]["state"] = "10"
    client.post(f"/api/integrations/{iid}/sync")
    assert asyncio.run(smart.run_engine(now.replace(second=30))) == 0  # cooldown: only 30 s since the last run
    log = client.get("/api/automations-log").json()
    assert any("sent turn_on to Garden pump" in e["message"] for e in log) and any("cooldown" in e["message"] for e in log)


def test_engine_respects_conditions_and_unknown_states(client, ha):
    iid, _ = connect_ha(client)
    d = devices(client)
    rule(client, conditions=[{"type": "state", "deviceId": d["light.porch"]["id"], "op": "eq", "value": "off"}])
    now = datetime(2025, 6, 21, 12, 0)
    asyncio.run(smart.run_engine(now))
    ha.states["sensor.soil"]["state"] = "20"
    client.post(f"/api/integrations/{iid}/sync")
    assert asyncio.run(smart.run_engine(now)) == 0 and ha.calls == []  # porch light is on: condition fails
    assert any("condition not met" in e["message"] for e in client.get("/api/automations-log").json())


def test_offline_integration_stops_rules_from_acting_on_stale_values(client, ha):
    iid, _ = connect_ha(client)
    rule(client)
    now = datetime(2025, 6, 21, 12, 0)
    asyncio.run(smart.run_engine(now))
    ha.states["sensor.soil"]["state"] = "20"
    ha.offline = True
    client.post(f"/api/integrations/{iid}/sync")  # fails: integration goes into error state
    assert asyncio.run(smart.run_engine(now)) == 0 and ha.calls == []


def test_dry_run_sends_nothing_and_risky_manual_runs_ask_first(client, ha):
    connect_ha(client)
    d = devices(client)
    aid = rule(client).json()["id"]
    r = client.post(f"/api/automations/{aid}/run", json={"dryRun": True}).json()
    assert r["dryRun"] and "dry run" in r["messages"][0] and ha.calls == []
    risky = rule(client, name="gate", enabled=False, actions=[{"type": "device", "deviceId": d["lock.gate"]["id"], "service": "unlock"}]).json()["id"]
    assert client.post(f"/api/automations/{risky}/run", json={"dryRun": False}).status_code == 409
    assert client.post(f"/api/automations/{risky}/run", json={"dryRun": False, "confirm": True}).status_code == 200
    assert ("lock", "unlock", "lock.gate") in ha.calls


def test_time_rule_runs_at_its_minute(client, ha):
    connect_ha(client)
    d = devices(client)
    rule(client, name="Morning", trigger={"type": "time", "at": "07:30"}, actions=[{"type": "device", "deviceId": d["light.porch"]["id"], "service": "turn_off"}])
    assert asyncio.run(smart.run_engine(datetime(2025, 6, 21, 7, 29))) == 0
    assert asyncio.run(smart.run_engine(datetime(2025, 6, 21, 7, 30))) == 1
    assert ha.states["light.porch"]["state"] == "off"


def test_enabling_and_deleting_rules(client, ha):
    connect_ha(client)
    aid = rule(client, enabled=False).json()["id"]
    assert client.patch(f"/api/automations/{aid}", json={"enabled": True}).json()["enabled"] is True
    assert "when Soil moisture falls below 25" in client.get("/api/automations").json()[0]["summary"]
    assert client.delete(f"/api/automations/{aid}").status_code == 204
    assert client.get("/api/automations").json() == []
