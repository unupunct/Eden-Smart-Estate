"""MQTT against a REAL broker (amqtt, run in-process) with the real paho client: no fakes. Skipped when amqtt is not installed."""
import asyncio
import socket
import threading
import time

import pytest

amqtt = pytest.importorskip("amqtt.broker")
paho = pytest.importorskip("paho.mqtt.client")
from fastapi.testclient import TestClient  # noqa: E402

from app import config, smart_mqtt  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def broker():
    port = free_port()
    loop = asyncio.new_event_loop()
    holder: dict = {}
    ready = threading.Event()

    async def run():
        b = amqtt.Broker({
            "listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{port}"}},
            "sys_interval": 0,
            "auth": {"allow-anonymous": True, "plugins": ["auth_anonymous"]},
            "topic-check": {"enabled": False},
        }, loop=loop) if "loop" in amqtt.Broker.__init__.__code__.co_varnames else amqtt.Broker({
            "listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{port}"}},
            "sys_interval": 0,
            "auth": {"allow-anonymous": True, "plugins": ["auth_anonymous"]},
            "topic-check": {"enabled": False},
        })
        holder["broker"] = b
        await b.start()
        ready.set()
        holder["stop"] = asyncio.Event()
        await holder["stop"].wait()
        await b.shutdown()

    t = threading.Thread(target=lambda: loop.run_until_complete(run()), daemon=True)
    t.start()
    assert ready.wait(20), "the test broker did not start"
    yield port
    loop.call_soon_threadsafe(holder["stop"].set)
    t.join(timeout=10)


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
    smart_mqtt.stop_all()


def wait_for(f, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        v = f()
        if v:
            return v
        time.sleep(0.1)
    return None


def external_client(port):
    c = paho.Client(paho.CallbackAPIVersion.VERSION2, client_id="outsider")
    got: list[tuple[str, bytes]] = []
    c.on_message = lambda _c, _u, m: got.append((m.topic, m.payload))
    c.connect("127.0.0.1", port)
    c.loop_start()
    return c, got


def test_eden_connects_receives_state_and_sends_commands_through_a_real_broker(client, broker):
    iid = client.post("/api/integrations", json={"kind": "mqtt", "name": "Test broker", "url": "127.0.0.1", "options": {"port": broker}}).json()["id"]
    assert wait_for(lambda: client.get("/api/integrations").json()[0]["status"] == "online"), client.get("/api/integrations").json()
    dev = client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "Shed temp", "stateTopic": "shed/temp", "unit": "°C"}).json()
    fan = client.post("/api/devices/mqtt", json={"integrationId": iid, "name": "Shed fan", "stateTopic": "shed/fan/state", "commandTopic": "shed/fan/set"}).json()
    assert dev["state"] is None  # nothing reported yet
    outsider, got = external_client(broker)
    try:
        outsider.subscribe("shed/fan/set")
        time.sleep(0.5)
        outsider.publish("shed/temp", "18.4")
        assert wait_for(lambda: next((d for d in client.get("/api/devices").json() if d["id"] == dev["id"] and d["state"] == "18.4"), None)), client.get("/api/devices").json()
        outsider.publish("shed/temp", "19.1")
        assert wait_for(lambda: next((d for d in client.get("/api/devices").json() if d["id"] == dev["id"] and d["state"] == "19.1"), None))
        assert next(d for d in client.get("/api/devices").json() if d["id"] == fan["id"])["state"] is None  # other topics untouched
        r = client.post(f"/api/devices/{fan['id']}/command", json={"service": "turn_on"})
        assert r.status_code == 200 and r.json()["state"] is None  # EDEN does not claim a state it has not been told
        assert wait_for(lambda: ("shed/fan/set", b"ON") in got), got
    finally:
        outsider.loop_stop()
        outsider.disconnect()


def test_a_stopped_broker_is_reported_as_a_problem_not_hidden(client, broker):
    iid = client.post("/api/integrations", json={"kind": "mqtt", "name": "Test broker", "url": "127.0.0.1", "options": {"port": free_port()}}).json()["id"]
    time.sleep(1.5)  # nothing listens on that port
    row = client.get("/api/integrations").json()[0]
    assert row["id"] == iid and row["status"] != "online"
