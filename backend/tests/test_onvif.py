"""ONVIF discovery and set-up, against an in-process fake camera (no real camera was available: see the module docstring)."""
import base64
import hashlib
import re
import socket
import threading
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, onvif, smart
from app.main import app

PASSWORD = "cam-secret"
PROBE_MATCH = """<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<s:Body><d:ProbeMatches><d:ProbeMatch><a:EndpointReference><a:Address>urn:uuid:11111111-2222-3333-4444-555555555555</a:Address></a:EndpointReference>
<d:Types>dn:NetworkVideoTransmitter</d:Types><d:Scopes>onvif://www.onvif.org/name/Gate%20cam onvif://www.onvif.org/hardware/IPC-100 onvif://www.onvif.org/location/gate</d:Scopes>
<d:XAddrs>http://192.168.1.50/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>"""


def soap(body: str) -> httpx.Response:
    return httpx.Response(200, content=f'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><s:Body>{body}</s:Body></s:Envelope>'.encode())


def fault(status=400) -> httpx.Response:
    return httpx.Response(status, content=b'<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Reason><s:Text>Sender not Authorized</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>')


class FakeCamera:
    """Implements the handful of ONVIF calls EDEN makes and really checks the WS-Security digest."""

    def __init__(self, clock_offset=timedelta(0), snapshot=True):
        self.clock_offset, self.snapshot, self.calls, self.auth_ok = clock_offset, snapshot, [], []

    def device_now(self):
        return datetime.now(timezone.utc) + self.clock_offset

    def authorised(self, text: str) -> bool:
        m = re.search(r"<Username>(.*?)</Username>.*?>([A-Za-z0-9+/=]+)</Password>.*?<Nonce[^>]*>([A-Za-z0-9+/=]+)</Nonce><Created[^>]*>(.*?)</Created>", text, re.S)
        if not m:
            return False
        user, digest, nonce, created = m.groups()
        want = base64.b64encode(hashlib.sha1(base64.b64decode(nonce) + created.encode() + PASSWORD.encode()).digest()).decode()
        when = datetime.strptime(created, "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
        fresh = abs((when - self.device_now()).total_seconds()) < 300  # cameras reject stale or future timestamps
        ok = user == "viewer" and digest == want and fresh
        self.auth_ok.append(ok)
        return ok

    def __call__(self, request: httpx.Request) -> httpx.Response:
        text = request.content.decode()
        op = re.search(r"<(?:tds|trt):(\w+)", text).group(1)
        self.calls.append((str(request.url), op))
        if op == "GetSystemDateAndTime":
            t = self.device_now()
            return soap(f"<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>{t.hour}</tt:Hour><tt:Minute>{t.minute}</tt:Minute><tt:Second>{t.second}</tt:Second></tt:Time><tt:Date><tt:Year>{t.year}</tt:Year><tt:Month>{t.month}</tt:Month><tt:Day>{t.day}</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>")
        if not self.authorised(text):
            return fault(400)
        if op == "GetDeviceInformation":
            return soap("<tds:GetDeviceInformationResponse><tds:Manufacturer>Acme</tds:Manufacturer><tds:Model>IPC-100</tds:Model><tds:FirmwareVersion>1.2</tds:FirmwareVersion><tds:SerialNumber>SN1</tds:SerialNumber></tds:GetDeviceInformationResponse>")
        if op == "GetCapabilities":
            return soap("<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Media><tt:XAddr>http://192.168.1.50/onvif/media_service</tt:XAddr></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>")
        if op == "GetProfiles":
            return soap('<trt:GetProfilesResponse><trt:Profiles token="main"><tt:Name>Main stream</tt:Name><tt:VideoEncoderConfiguration><tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>1920</tt:Width><tt:Height>1080</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>'
                        '<trt:Profiles token="sub"><tt:Name>Sub stream</tt:Name><tt:VideoEncoderConfiguration><tt:Encoding>JPEG</tt:Encoding><tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles></trt:GetProfilesResponse>')
        if op == "GetStreamUri":
            tok = re.search(r"<trt:ProfileToken>(.*?)</trt:ProfileToken>", text).group(1)
            return soap(f"<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://192.168.1.50:554/{tok}</tt:Uri></trt:MediaUri></trt:GetStreamUriResponse>")
        if op == "GetSnapshotUri":
            if not self.snapshot:
                return fault(400)
            tok = re.search(r"<trt:ProfileToken>(.*?)</trt:ProfileToken>", text).group(1)
            return soap(f"<trt:GetSnapshotUriResponse><trt:MediaUri><tt:Uri>http://192.168.1.50/snap/{tok}.jpg</tt:Uri></trt:MediaUri></trt:GetSnapshotUriResponse>")
        return fault(500)


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


def use(monkeypatch, cam):
    monkeypatch.setattr(onvif, "TRANSPORT", httpx.MockTransport(cam))


XADDR = "http://192.168.1.50/onvif/device_service"


# ------------------------------------------------------------------ discovery
def test_probe_answers_are_parsed_and_only_lan_addresses_kept():
    dev = onvif.parse_probe_match(PROBE_MATCH.encode())
    assert dev["xaddr"] == XADDR and dev["host"] == "192.168.1.50"
    assert dev["name"] == "Gate cam" and dev["hardware"] == "IPC-100" and dev["location"] == "gate"
    assert onvif.parse_probe_match(PROBE_MATCH.replace("192.168.1.50", "8.8.8.8").replace("[fe80::1]", "8.8.4.4").encode()) is None  # public addresses are never used
    assert onvif.parse_probe_match(b"not xml") is None


def test_discovery_really_sends_a_probe_and_reads_the_answer(client, monkeypatch):
    """A UDP responder on this computer plays the camera: the probe is a real datagram and the answer a real datagram."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    got = []

    def serve():
        data, addr = sock.recvfrom(65535)
        got.append(data)
        sock.sendto(PROBE_MATCH.encode(), addr)

    threading.Thread(target=serve, daemon=True).start()
    monkeypatch.setattr(onvif, "DISCOVERY_TARGETS", [("127.0.0.1", sock.getsockname()[1])])
    r = client.post("/api/onvif/discover", json={"seconds": 1})
    sock.close()
    assert r.status_code == 200
    cams = r.json()["cameras"]
    assert len(cams) == 1 and cams[0]["xaddr"] == XADDR and cams[0]["alreadyAdded"] is False
    assert b"Probe" in got[0] and b"NetworkVideoTransmitter" in got[0] and b"239" not in got[0]  # a WS-Discovery probe for cameras


def test_discovery_with_no_answers_says_what_to_do_instead_of_inventing_cameras(client, monkeypatch):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))  # nobody answers
    monkeypatch.setattr(onvif, "DISCOVERY_TARGETS", [("127.0.0.1", sock.getsockname()[1])])
    r = client.post("/api/onvif/discover", json={"seconds": 1}).json()
    sock.close()
    assert r["cameras"] == [] and "by hand" in r["note"]


# ------------------------------------------------------------------ talking to a camera
def test_profiles_with_correct_login_list_streams_and_snapshots(client, monkeypatch):
    cam = FakeCamera()
    use(monkeypatch, cam)
    r = client.post("/api/onvif/profiles", json={"xaddr": XADDR, "username": "viewer", "password": PASSWORD})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["device"]["Model"] == "IPC-100"
    main = next(p for p in res["profiles"] if p["token"] == "main")
    assert (main["width"], main["height"], main["encoding"]) == (1920, 1080, "H264")
    assert main["streamUri"] == "rtsp://192.168.1.50:554/main" and main["snapshotUri"] == "http://192.168.1.50/snap/main.jpg"
    assert cam.auth_ok and all(cam.auth_ok)  # every authenticated call carried a valid digest


def test_wrong_password_is_reported_clearly_and_nothing_is_stored(client, monkeypatch):
    use(monkeypatch, FakeCamera())
    r = client.post("/api/onvif/profiles", json={"xaddr": XADDR, "username": "viewer", "password": "wrong"})
    assert r.status_code == 502 and "user name or password" in r.json()["detail"]
    assert client.get("/api/cameras").json() == []


def test_a_camera_with_the_wrong_clock_still_logs_in_because_its_own_time_is_used(client, monkeypatch):
    cam = FakeCamera(clock_offset=timedelta(hours=-3))
    use(monkeypatch, cam)
    assert client.post("/api/onvif/profiles", json={"xaddr": XADDR, "username": "viewer", "password": PASSWORD}).status_code == 200
    assert cam.calls[0][1] == "GetSystemDateAndTime"


def test_the_digest_follows_the_ws_security_recipe():
    nonce = b"0123456789abcdef"
    now = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    h = onvif.wsse_header("viewer", "pw", now, nonce)
    want = base64.b64encode(hashlib.sha1(nonce + b"2026-05-01T12:00:00.000Z" + b"pw").digest()).decode()
    assert want in h and base64.b64encode(nonce).decode() in h and "PasswordDigest" in h and ">pw<" not in h


def test_only_addresses_on_the_local_network_are_ever_contacted(client, monkeypatch):
    cam = FakeCamera()
    use(monkeypatch, cam)
    for bad in ("http://example.com/onvif/device_service", "http://8.8.8.8/onvif", "file:///etc/passwd", "ftp://192.168.1.5/x"):
        r = client.post("/api/onvif/profiles", json={"xaddr": bad, "username": "viewer", "password": PASSWORD})
        assert r.status_code == 502, bad
    assert cam.calls == []


def test_adding_creates_a_snapshot_camera_and_stores_the_password_server_side(client, monkeypatch):
    use(monkeypatch, FakeCamera())
    r = client.post("/api/onvif/add", json={"xaddr": XADDR, "username": "viewer", "password": PASSWORD, "profileToken": "main", "name": "Gate"})
    assert r.status_code == 201, r.text
    cam = r.json()
    assert cam["kind"] == "snapshot" and cam["url"] == "http://192.168.1.50/snap/main.jpg" and cam["username"] == "viewer" and cam["hasPassword"] is True
    assert PASSWORD not in r.text and PASSWORD not in client.get("/api/cameras").text


def test_without_a_snapshot_address_an_rtsp_camera_is_added_and_the_ffmpeg_need_is_stated(client, monkeypatch):
    use(monkeypatch, FakeCamera(snapshot=False))
    r = client.post("/api/onvif/add", json={"xaddr": XADDR, "username": "viewer", "password": PASSWORD, "profileToken": "sub", "name": "Yard"}).json()
    assert r["kind"] == "rtsp" and r["url"] == "rtsp://192.168.1.50:554/sub" and "ffmpeg" in r["note"]


def test_adding_an_unknown_profile_is_refused(client, monkeypatch):
    use(monkeypatch, FakeCamera())
    assert client.post("/api/onvif/add", json={"xaddr": XADDR, "username": "viewer", "password": PASSWORD, "profileToken": "nope", "name": "x"}).status_code == 404
    assert client.get("/api/cameras").json() == []
