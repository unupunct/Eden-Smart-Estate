"""Smart home: integrations (Home Assistant, MQTT), devices, cameras and automations.

Principles: state shown in EDEN is only ever what an integration reported; credentials are write-only and live in the
`secrets` table; risky commands need explicit confirmation; every automation action is written to the log.
"""
import asyncio
import json
import shutil
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, smart_auto, smart_mqtt
from .smart_ha import HaError, RISKY_DOMAINS, call_service, camera_image, fetch_state, fetch_states, parse_state, validate_command

router = APIRouter(prefix="/api")

_prev_states: dict[str, str | None] = {}  # what the engine saw on its previous tick (device id -> state)


# ------------------------------------------------------------------ helpers
def _secret(conn, key: str) -> str:
    r = conn.execute("SELECT value FROM secrets WHERE key=?", (key,)).fetchone()
    return r["value"] if r else ""


def _put_secret(conn, key: str, value: str) -> None:
    if value == "":
        conn.execute("DELETE FROM secrets WHERE key=?", (key,))
    else:
        conn.execute("INSERT INTO secrets(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def _opts(row) -> dict:
    try:
        return json.loads(row["options"] or "{}")
    except ValueError:
        return {}


def _integration_public(conn, r) -> dict:
    n = conn.execute("SELECT COUNT(*) FROM devices WHERE integration_id=?", (r["id"],)).fetchone()[0]
    o = _opts(r)
    return {
        "id": r["id"], "kind": r["kind"], "name": r["name"], "url": r["url"], "options": {k: v for k, v in o.items() if k != "password"},
        "enabled": bool(r["enabled"]), "status": r["status"], "statusMsg": r["status_msg"], "lastSync": r["last_sync"],
        "hasToken": bool(_secret(conn, f"int:{r['id']}")), "deviceCount": n,
    }


def _device_public(r) -> dict:
    return {
        "id": r["id"], "integrationId": r["integration_id"], "externalId": r["external_id"], "name": r["name"], "domain": r["domain"],
        "deviceClass": r["device_class"], "unit": r["unit"], "state": r["state"], "stateUpdated": r["state_updated"],
        "attrs": json.loads(r["attrs"] or "{}"), "objectId": r["object_id"], "risky": bool(r["risky"]),
        "commandTopic": r["command_topic"], "integrationStatus": r["istatus"] if "istatus" in r.keys() else None,
        "controllable": r["domain"] in smart_auto.ALLOWED_SERVICES,
    }


def _need(conn, table: str, id_: str, what: str):
    r = conn.execute(f"SELECT * FROM {table} WHERE id=?", (id_,)).fetchone()
    if not r:
        raise HTTPException(404, f"{what} not found")
    return r


def _clean_url(kind: str, url: str) -> str:
    url = url.strip()
    if kind == "homeassistant":
        if not url.startswith(("http://", "https://")):
            raise HTTPException(422, "Home Assistant URL must start with http:// or https://")
        return url.rstrip("/")
    host = url.removeprefix("mqtt://").removeprefix("tcp://").strip().strip("/")
    if not host or " " in host:
        raise HTTPException(422, "Enter the MQTT broker host name or IP address")
    return host


# ------------------------------------------------------------------ integrations
class IntegrationIn(BaseModel):
    kind: Literal["homeassistant", "mqtt"]
    name: str = Field(min_length=1, max_length=80)
    url: str
    token: str | None = None  # HA long-lived token, or MQTT password. Write-only.
    options: dict[str, Any] = {}


class IntegrationPatch(BaseModel):
    name: str | None = None
    url: str | None = None
    token: str | None = None
    enabled: bool | None = None
    options: dict[str, Any] | None = None


@router.get("/integrations")
def list_integrations():
    with db.session() as conn:
        return [_integration_public(conn, r) for r in conn.execute("SELECT * FROM integrations ORDER BY created_at")]


@router.post("/integrations", status_code=201)
def add_integration(body: IntegrationIn):
    iid = db.new_id()
    opts = {k: v for k, v in body.options.items() if k in ("username", "port", "tls", "domains")}
    with db.session() as conn:
        conn.execute("INSERT INTO integrations(id,kind,name,url,options,enabled,status,status_msg,created_at) VALUES (?,?,?,?,?,1,'unknown','',?)",
                     (iid, body.kind, body.name.strip(), _clean_url(body.kind, body.url), db.dumps(opts), db.now()))
        if body.token:
            _put_secret(conn, f"int:{iid}", body.token.strip())
        out = _integration_public(conn, _need(conn, "integrations", iid, "Integration"))
    if body.kind == "mqtt":
        _start_mqtt(iid)
    return out


@router.patch("/integrations/{iid}")
def patch_integration(iid: str, body: IntegrationPatch):
    with db.session() as conn:
        r = _need(conn, "integrations", iid, "Integration")
        if body.name is not None:
            conn.execute("UPDATE integrations SET name=? WHERE id=?", (body.name.strip() or r["name"], iid))
        if body.url is not None:
            conn.execute("UPDATE integrations SET url=? WHERE id=?", (_clean_url(r["kind"], body.url), iid))
        if body.options is not None:
            opts = {k: v for k, v in body.options.items() if k in ("username", "port", "tls", "domains")}
            conn.execute("UPDATE integrations SET options=? WHERE id=?", (db.dumps(opts), iid))
        if body.token is not None:
            _put_secret(conn, f"int:{iid}", body.token.strip())
        if body.enabled is not None:
            conn.execute("UPDATE integrations SET enabled=?, status=? WHERE id=?", (int(body.enabled), "unknown" if body.enabled else "disabled", iid))
        r = _need(conn, "integrations", iid, "Integration")
        out = _integration_public(conn, r)
    if r["kind"] == "mqtt":
        _start_mqtt(iid) if r["enabled"] else smart_mqtt.stop(iid)
    return out


@router.delete("/integrations/{iid}", status_code=204)
def delete_integration(iid: str):
    smart_mqtt.stop(iid)
    with db.session() as conn:
        _need(conn, "integrations", iid, "Integration")
        conn.execute("DELETE FROM integrations WHERE id=?", (iid,))
        conn.execute("DELETE FROM secrets WHERE key=?", (f"int:{iid}",))


def _start_mqtt(iid: str) -> None:
    with db.session() as conn:
        r = _need(conn, "integrations", iid, "Integration")
        pw = _secret(conn, f"int:{iid}")
    if r["enabled"]:
        smart_mqtt.start(iid, r["url"], _opts(r), pw)


async def sync_integration(iid: str) -> dict:
    """Pull the real state from the integration. Updates its status; never invents values."""
    with db.session() as conn:
        r = _need(conn, "integrations", iid, "Integration")
        token = _secret(conn, f"int:{iid}")
    if r["kind"] == "mqtt":
        _start_mqtt(iid)
        return {"ok": True, "message": "MQTT client (re)started; states arrive as messages are received.", "count": 0}
    try:
        states = await fetch_states(r["url"], token)
    except HaError as e:
        with db.session() as conn:
            conn.execute("UPDATE integrations SET status='error', status_msg=? WHERE id=?", (str(e), iid))
        return {"ok": False, "message": str(e), "count": 0}
    wanted = _opts(r).get("domains")
    seen: set[str] = set()
    with db.session() as conn:
        for s in states:
            p = parse_state(s)
            if not p or (isinstance(wanted, list) and wanted and p["domain"] not in wanted):
                continue
            seen.add(p["external_id"])
            ex = conn.execute("SELECT id FROM devices WHERE integration_id=? AND external_id=?", (iid, p["external_id"])).fetchone()
            if ex:
                conn.execute("UPDATE devices SET state=?, attrs=?, state_updated=?, unit=?, device_class=? WHERE id=?",
                             (p["state"], db.dumps(p["attrs"]), p["updated"] or db.now(), p["unit"], p["device_class"], ex["id"]))
            else:
                conn.execute("INSERT INTO devices(id,integration_id,external_id,name,domain,device_class,unit,state,attrs,state_updated,risky) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (db.new_id(), iid, p["external_id"], p["name"], p["domain"], p["device_class"], p["unit"], p["state"],
                              db.dumps(p["attrs"]), p["updated"] or db.now(), int(p["domain"] in RISKY_DOMAINS)))
        # devices HA no longer reports have no known state
        for d in conn.execute("SELECT id, external_id FROM devices WHERE integration_id=?", (iid,)).fetchall():
            if d["external_id"] not in seen:
                conn.execute("UPDATE devices SET state=NULL WHERE id=?", (d["id"],))
        conn.execute("UPDATE integrations SET status='online', status_msg='', last_sync=? WHERE id=?", (db.now(), iid))
    return {"ok": True, "message": f"Connected: {len(seen)} supported entities found.", "count": len(seen)}


@router.post("/integrations/{iid}/test")
async def test_integration(iid: str):
    with db.session() as conn:
        r = _need(conn, "integrations", iid, "Integration")
    if r["kind"] == "mqtt" and not smart_mqtt.AVAILABLE and not smart_mqtt.CLIENT_FACTORY:
        return {"ok": False, "message": "The optional paho-mqtt package is not installed (pip install paho-mqtt).", "count": 0}
    return await sync_integration(iid)


@router.post("/integrations/{iid}/sync")
async def sync_now(iid: str):
    return await sync_integration(iid)


# ------------------------------------------------------------------ devices
_DEVICE_SQL = "SELECT d.*, i.status AS istatus FROM devices d JOIN integrations i ON i.id=d.integration_id"


@router.get("/devices")
def list_devices():
    with db.session() as conn:
        return [_device_public(r) for r in conn.execute(_DEVICE_SQL + " ORDER BY d.domain, d.name")]


class DevicePatch(BaseModel):
    name: str | None = None
    objectId: str | None = None
    risky: bool | None = None
    unit: str | None = None
    commandTopic: str | None = None


@router.patch("/devices/{did}")
def patch_device(did: str, body: DevicePatch):
    with db.session() as conn:
        _need(conn, "devices", did, "Device")
        if body.name is not None and body.name.strip():
            conn.execute("UPDATE devices SET name=? WHERE id=?", (body.name.strip(), did))
        fields = body.model_fields_set
        if "objectId" in fields:
            conn.execute("UPDATE devices SET object_id=? WHERE id=?", (body.objectId or None, did))
        if body.risky is not None:
            conn.execute("UPDATE devices SET risky=? WHERE id=?", (int(body.risky), did))
        if body.unit is not None:
            conn.execute("UPDATE devices SET unit=? WHERE id=?", (body.unit.strip(), did))
        if body.commandTopic is not None:
            conn.execute("UPDATE devices SET command_topic=? WHERE id=?", (body.commandTopic.strip(), did))
        return _device_public(conn.execute(_DEVICE_SQL + " WHERE d.id=?", (did,)).fetchone())


@router.delete("/devices/{did}", status_code=204)
def delete_device(did: str):
    with db.session() as conn:
        _need(conn, "devices", did, "Device")
        conn.execute("DELETE FROM devices WHERE id=?", (did,))


class MqttDeviceIn(BaseModel):
    integrationId: str
    name: str = Field(min_length=1, max_length=80)
    stateTopic: str = Field(min_length=1, max_length=200)
    commandTopic: str = ""
    unit: str = ""
    risky: bool = False


@router.post("/devices/mqtt", status_code=201)
def add_mqtt_device(body: MqttDeviceIn):
    if any(c in body.stateTopic for c in "#+"):
        raise HTTPException(422, "Use one exact topic per device (no # or + wildcards).")
    with db.session() as conn:
        i = _need(conn, "integrations", body.integrationId, "Integration")
        if i["kind"] != "mqtt":
            raise HTTPException(422, "That integration is not an MQTT broker.")
        if conn.execute("SELECT 1 FROM devices WHERE integration_id=? AND external_id=?", (i["id"], body.stateTopic)).fetchone():
            raise HTTPException(409, "That topic is already a device.")
        did = db.new_id()
        conn.execute("INSERT INTO devices(id,integration_id,external_id,name,domain,unit,state,risky,command_topic) VALUES (?,?,?,?,?,?,NULL,?,?)",
                     (did, i["id"], body.stateTopic, body.name.strip(), "mqtt", body.unit.strip(), int(body.risky), body.commandTopic.strip()))
        out = _device_public(conn.execute(_DEVICE_SQL + " WHERE d.id=?", (did,)).fetchone())
    smart_mqtt.subscribe(body.integrationId, body.stateTopic)
    return out


async def command_device(device_id: str, service: str) -> str | None:
    """Send a command. Returns the state the integration reports afterwards (None if it could not be read back)."""
    with db.session() as conn:
        d = _need(conn, "devices", device_id, "Device")
        i = _need(conn, "integrations", d["integration_id"], "Integration")
        token = _secret(conn, f"int:{i['id']}")
    try:
        validate_command(d["domain"], service)
        if i["kind"] == "mqtt":
            if not d["command_topic"]:
                raise HaError("This MQTT device has no command topic.")
            o = _opts(i)
            payload = o.get("payloadOn", "ON") if service == "turn_on" else o.get("payloadOff", "OFF")
            try:
                smart_mqtt.publish(i["id"], d["command_topic"], payload)
            except RuntimeError as e:
                raise HaError(str(e))
            return None  # the state topic will report the result
        await call_service(i["url"], token, d["domain"], service, d["external_id"])
        await asyncio.sleep(0.5 if config.POLL_SECONDS else 0)
        st = await fetch_state(i["url"], token, d["external_id"])
    except HaError as e:
        raise HTTPException(502 if "reach" in str(e) else 422, str(e))
    p = parse_state(st) if st else None
    if p:
        with db.session() as conn:
            conn.execute("UPDATE devices SET state=?, state_updated=? WHERE id=?", (p["state"], p["updated"] or db.now(), device_id))
    return p["state"] if p else None


class CommandIn(BaseModel):
    service: str
    confirm: bool = False


@router.post("/devices/{did}/command")
async def device_command(did: str, body: CommandIn):
    with db.session() as conn:
        d = _need(conn, "devices", did, "Device")
    if d["risky"] and not body.confirm:
        raise HTTPException(409, f"Confirmation required: {d['name']} is marked as risky. Send confirm=true after the user agrees.")
    state = await command_device(did, body.service)
    _log(None, "info", f"Manual command {body.service} sent to {d['name']}.")
    return {"ok": True, "state": state}


# ------------------------------------------------------------------ cameras
class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["snapshot", "mjpeg", "rtsp", "ha"]
    url: str = ""
    username: str = ""
    password: str | None = None
    integrationId: str | None = None
    entityId: str = ""
    objectId: str | None = None


class CameraPatch(BaseModel):
    name: str | None = None
    url: str | None = None
    username: str | None = None
    password: str | None = None
    objectId: str | None = None


def _split_credentials(kind: str, url: str, username: str, password: str | None) -> tuple[str, str, str | None]:
    """Credentials typed into the URL are moved out of it (so the stored/returned URL is clean)."""
    url = url.strip()
    if not url:
        return url, username, password
    allowed = ("rtsp://", "rtsps://") if kind == "rtsp" else ("http://", "https://")
    if not url.lower().startswith(allowed):
        raise HTTPException(422, f"The URL must start with {' or '.join(allowed)}")
    p = urlsplit(url)
    if p.username:
        username = username or unquote(p.username)
        if p.password and not password:
            password = unquote(p.password)
        host = p.hostname or ""
        netloc = f"[{host}]" if ":" in host else host
        if p.port:
            netloc += f":{p.port}"
        url = urlunsplit((p.scheme, netloc, p.path, p.query, p.fragment))
    return url, username, password


def _camera_public(conn, r) -> dict:
    return {
        "id": r["id"], "name": r["name"], "kind": r["kind"], "url": r["url"], "username": r["username"], "hasPassword": bool(_secret(conn, f"cam:{r['id']}")),
        "integrationId": r["integration_id"], "entityId": r["entity_id"], "objectId": r["object_id"],
    }


@router.get("/cameras")
def list_cameras():
    with db.session() as conn:
        return [_camera_public(conn, r) for r in conn.execute("SELECT * FROM cameras ORDER BY created_at")]


@router.post("/cameras", status_code=201)
def add_camera(body: CameraIn):
    if body.kind == "ha":
        if not body.integrationId or "." not in body.entityId:
            raise HTTPException(422, "Choose the Home Assistant integration and enter the camera entity id (camera.front_door).")
    elif not body.url.strip():
        raise HTTPException(422, "Enter the camera URL.")
    url, user, pw = _split_credentials(body.kind, body.url, body.username, body.password)
    cid = db.new_id()
    with db.session() as conn:
        if body.integrationId:
            _need(conn, "integrations", body.integrationId, "Integration")
        conn.execute("INSERT INTO cameras(id,name,kind,url,username,integration_id,entity_id,object_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (cid, body.name.strip(), body.kind, url, user, body.integrationId, body.entityId.strip(), body.objectId, db.now()))
        if pw:
            _put_secret(conn, f"cam:{cid}", pw)
        return _camera_public(conn, _need(conn, "cameras", cid, "Camera"))


@router.patch("/cameras/{cid}")
def patch_camera(cid: str, body: CameraPatch):
    with db.session() as conn:
        r = _need(conn, "cameras", cid, "Camera")
        if body.name is not None and body.name.strip():
            conn.execute("UPDATE cameras SET name=? WHERE id=?", (body.name.strip(), cid))
        if body.url is not None or body.username is not None or body.password is not None:
            url, user, pw = _split_credentials(r["kind"], body.url if body.url is not None else r["url"],
                                               body.username if body.username is not None else r["username"], body.password)
            conn.execute("UPDATE cameras SET url=?, username=? WHERE id=?", (url, user, cid))
            if pw is not None:
                _put_secret(conn, f"cam:{cid}", pw)
        if "objectId" in body.model_fields_set:
            conn.execute("UPDATE cameras SET object_id=? WHERE id=?", (body.objectId or None, cid))
        return _camera_public(conn, _need(conn, "cameras", cid, "Camera"))


@router.delete("/cameras/{cid}", status_code=204)
def delete_camera(cid: str):
    with db.session() as conn:
        _need(conn, "cameras", cid, "Camera")
        conn.execute("DELETE FROM cameras WHERE id=?", (cid,))
        conn.execute("DELETE FROM secrets WHERE key=?", (f"cam:{cid}",))


def _auth(user: str, pw: str):
    return httpx.BasicAuth(user, pw) if user else None


def first_jpeg(buf: bytes) -> bytes | None:
    """The first complete JPEG inside an MJPEG byte stream."""
    a = buf.find(b"\xff\xd8")
    if a < 0:
        return None
    b = buf.find(b"\xff\xd9", a + 2)
    return buf[a:b + 2] if b >= 0 else None


def ffmpeg_command(url: str, user: str, pw: str) -> list[str]:
    p = urlsplit(url)
    if user:
        host = p.hostname or ""
        netloc = f"{quote(user, safe='')}:{quote(pw, safe='')}@{f'[{host}]' if ':' in host else host}" + (f":{p.port}" if p.port else "")
        url = urlunsplit((p.scheme, netloc, p.path, p.query, p.fragment))
    return ["ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", url, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]


async def camera_snapshot(cid: str) -> tuple[bytes, str]:
    with db.session() as conn:
        c = _need(conn, "cameras", cid, "Camera")
        pw = _secret(conn, f"cam:{cid}")
        integ = conn.execute("SELECT * FROM integrations WHERE id=?", (c["integration_id"],)).fetchone() if c["integration_id"] else None
        token = _secret(conn, f"int:{integ['id']}") if integ else ""
    try:
        if c["kind"] == "ha":
            if not integ:
                raise HaError("The Home Assistant integration for this camera was removed.")
            return await camera_image(integ["url"], token, c["entity_id"])
        if c["kind"] == "rtsp":
            exe = shutil.which("ffmpeg")
            if not exe:
                raise HaError("RTSP cameras need ffmpeg on this computer (not found). Install ffmpeg, or use the camera's snapshot URL or Home Assistant.")
            cmd = ffmpeg_command(c["url"], c["username"], pw)
            cmd[0] = exe
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                out, _err = await asyncio.wait_for(proc.communicate(), 20)
            except asyncio.TimeoutError:
                proc.kill()
                raise HaError("The camera did not deliver a picture within 20 seconds.")
            if proc.returncode != 0 or not out:
                raise HaError("ffmpeg could not read a frame from the camera (check URL, user name and password).")
            return out, "image/jpeg"
        async with httpx.AsyncClient(timeout=15, transport=_cam_transport()) as client:
            if c["kind"] == "mjpeg":
                buf = b""
                async with client.stream("GET", c["url"], auth=_auth(c["username"], pw)) as r:
                    if r.status_code != 200:
                        raise HaError(f"The camera answered HTTP {r.status_code}.")
                    async for chunk in r.aiter_bytes():
                        buf += chunk
                        jpg = first_jpeg(buf)
                        if jpg or len(buf) > 3_000_000:
                            break
                jpg = first_jpeg(buf)
                if not jpg:
                    raise HaError("No picture found in the camera's MJPEG stream.")
                return jpg, "image/jpeg"
            r = await client.get(c["url"], auth=_auth(c["username"], pw))
            if r.status_code == 401 and c["username"]:
                r = await client.get(c["url"], auth=httpx.DigestAuth(c["username"], pw))
            if r.status_code != 200:
                raise HaError("The camera rejected the user name/password (401)." if r.status_code == 401 else f"The camera answered HTTP {r.status_code}.")
            ctype = r.headers.get("content-type", "image/jpeg").split(";")[0]
            if not ctype.startswith("image/"):
                raise HaError("The snapshot URL did not return a picture.")
            return r.content, ctype
    except httpx.HTTPError as e:
        raise HaError(f"Cannot reach the camera ({type(e).__name__}).")


CAM_TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport


def _cam_transport():
    return CAM_TRANSPORT


@router.get("/cameras/{cid}/snapshot")
async def snapshot(cid: str):
    try:
        data, mime = await camera_snapshot(cid)
    except HaError as e:
        raise HTTPException(501 if "ffmpeg" in str(e) and "not found" in str(e) else 502, str(e))
    return Response(data, media_type=mime, headers={"Cache-Control": "no-store"})


@router.get("/cameras/{cid}/stream")
async def stream(cid: str):
    with db.session() as conn:
        c = _need(conn, "cameras", cid, "Camera")
        pw = _secret(conn, f"cam:{cid}")
    if c["kind"] != "mjpeg":
        raise HTTPException(422, "Only MJPEG cameras can be streamed; other kinds refresh snapshots.")
    client = httpx.AsyncClient(timeout=None, transport=_cam_transport())
    req = client.build_request("GET", c["url"], auth=_auth(c["username"], pw))
    try:
        r = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(502, f"Cannot reach the camera ({type(e).__name__}).")
    if r.status_code != 200:
        await r.aclose()
        await client.aclose()
        raise HTTPException(502, f"The camera answered HTTP {r.status_code}.")

    async def gen():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()
    return StreamingResponse(gen(), media_type=r.headers.get("content-type", "multipart/x-mixed-replace"), headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ automations
class AutomationIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    trigger: dict[str, Any]
    conditions: list[dict[str, Any]] = []
    actions: list[dict[str, Any]]
    enabled: bool = False
    riskAck: bool = False


class AutomationPatch(BaseModel):
    name: str | None = None
    trigger: dict[str, Any] | None = None
    conditions: list[dict[str, Any]] | None = None
    actions: list[dict[str, Any]] | None = None
    enabled: bool | None = None
    riskAck: bool | None = None


def _devices_map(conn) -> dict[str, dict]:
    return {r["id"]: {"id": r["id"], "name": r["name"], "domain": r["domain"], "risky": bool(r["risky"]), "state": r["state"],
                      "online": r["istatus"] == "online"} for r in conn.execute(_DEVICE_SQL)}


def _auto_public(conn, r, devices) -> dict:
    trig, acts = json.loads(r["trigger"]), json.loads(r["actions"])
    return {
        "id": r["id"], "name": r["name"], "enabled": bool(r["enabled"]), "trigger": trig, "conditions": json.loads(r["conditions"]),
        "actions": acts, "riskAck": bool(r["risk_ack"]), "lastRun": r["last_run"], "lastResult": r["last_result"],
        "summary": smart_auto.describe_trigger(trig, devices), "riskyDevices": smart_auto.risky_actions(acts, devices),
    }


@router.get("/automations")
def list_automations():
    with db.session() as conn:
        dev = _devices_map(conn)
        return [_auto_public(conn, r, dev) for r in conn.execute("SELECT * FROM automations ORDER BY created_at")]


def _check_rule(body: dict, enabled: bool, ack: bool, conn) -> None:
    dev = _devices_map(conn)
    errs = smart_auto.validate(body, dev)
    if errs:
        raise HTTPException(422, " ".join(errs))
    risky = smart_auto.risky_actions(body.get("actions") or [], dev)
    if enabled and risky and not ack:
        raise HTTPException(422, f"This rule controls risky devices ({', '.join(sorted(set(risky)))}). Tick the acknowledgement to let it run on its own.")


@router.post("/automations", status_code=201)
def add_automation(body: AutomationIn):
    aid = db.new_id()
    with db.session() as conn:
        _check_rule(body.model_dump(), body.enabled, body.riskAck, conn)
        conn.execute("INSERT INTO automations(id,name,enabled,trigger,conditions,actions,risk_ack,created_at) VALUES (?,?,?,?,?,?,?,?)",
                     (aid, body.name.strip(), int(body.enabled), db.dumps(body.trigger), db.dumps(body.conditions), db.dumps(body.actions), int(body.riskAck), db.now()))
        return _auto_public(conn, _need(conn, "automations", aid, "Automation"), _devices_map(conn))


@router.patch("/automations/{aid}")
def patch_automation(aid: str, body: AutomationPatch):
    with db.session() as conn:
        r = _need(conn, "automations", aid, "Automation")
        merged = {"trigger": body.trigger if body.trigger is not None else json.loads(r["trigger"]),
                  "conditions": body.conditions if body.conditions is not None else json.loads(r["conditions"]),
                  "actions": body.actions if body.actions is not None else json.loads(r["actions"])}
        enabled = body.enabled if body.enabled is not None else bool(r["enabled"])
        ack = body.riskAck if body.riskAck is not None else bool(r["risk_ack"])
        _check_rule(merged, enabled, ack, conn)
        conn.execute("UPDATE automations SET name=?, enabled=?, trigger=?, conditions=?, actions=?, risk_ack=? WHERE id=?",
                     ((body.name or r["name"]).strip(), int(enabled), db.dumps(merged["trigger"]), db.dumps(merged["conditions"]), db.dumps(merged["actions"]), int(ack), aid))
        return _auto_public(conn, _need(conn, "automations", aid, "Automation"), _devices_map(conn))


@router.delete("/automations/{aid}", status_code=204)
def delete_automation(aid: str):
    with db.session() as conn:
        _need(conn, "automations", aid, "Automation")
        conn.execute("DELETE FROM automations WHERE id=?", (aid,))


def _log(aid: str | None, level: str, message: str, dry: bool = False) -> None:
    with db.session() as conn:
        conn.execute("INSERT INTO automation_log(automation_id, at, level, dry_run, message) VALUES (?,?,?,?,?)", (aid, db.now(), level, int(dry), message[:500]))
        conn.execute("DELETE FROM automation_log WHERE id <= (SELECT MAX(id) FROM automation_log) - 500")


async def execute_actions(aid: str, name: str, actions: list[dict], dry: bool) -> list[str]:
    out: list[str] = []
    with db.session() as conn:
        dev = _devices_map(conn)
    for a in actions:
        if a.get("type") == "log":
            msg = f"{name}: {a.get('message')}"
            out.append(msg)
            _log(aid, "info", msg, dry)
            continue
        d = dev.get(a.get("deviceId"))
        if not d:
            msg = f"{name}: device no longer exists, action skipped."
            out.append(msg)
            _log(aid, "warn", msg, dry)
            continue
        if dry:
            msg = f"{name}: would send {a['service']} to {d['name']} (dry run, nothing was sent)."
            out.append(msg)
            _log(aid, "info", msg, True)
            continue
        try:
            state = await command_device(d["id"], a["service"])
            msg = f"{name}: sent {a['service']} to {d['name']}" + (f"; it now reports '{state}'." if state is not None else ".")
            out.append(msg)
            _log(aid, "info", msg)
        except HTTPException as e:
            msg = f"{name}: {a['service']} on {d['name']} failed: {e.detail}"
            out.append(msg)
            _log(aid, "error", msg)
    return out


class RunIn(BaseModel):
    dryRun: bool = True
    confirm: bool = False


@router.post("/automations/{aid}/run")
async def run_automation(aid: str, body: RunIn):
    with db.session() as conn:
        r = _need(conn, "automations", aid, "Automation")
        dev = _devices_map(conn)
    actions = json.loads(r["actions"])
    risky = smart_auto.risky_actions(actions, dev)
    if not body.dryRun and risky and not body.confirm:
        raise HTTPException(409, f"Confirmation required: this rule controls risky devices ({', '.join(sorted(set(risky)))}).")
    msgs = await execute_actions(aid, r["name"], actions, body.dryRun)
    if not body.dryRun:
        with db.session() as conn:
            conn.execute("UPDATE automations SET last_run=?, last_result=? WHERE id=?", (db.now(), "ran manually", aid))
    return {"ok": True, "dryRun": body.dryRun, "messages": msgs}


@router.get("/automations-log")
def automation_log(automationId: str | None = None, limit: int = 100):
    with db.session() as conn:
        q, args = "SELECT l.*, a.name AS aname FROM automation_log l LEFT JOIN automations a ON a.id=l.automation_id", []
        if automationId:
            q += " WHERE l.automation_id=?"
            args.append(automationId)
        q += " ORDER BY l.id DESC LIMIT ?"
        args.append(max(1, min(limit, 500)))
        return [{"id": r["id"], "automationId": r["automation_id"], "automation": r["aname"], "at": r["at"], "level": r["level"], "dryRun": bool(r["dry_run"]), "message": r["message"]}
                for r in conn.execute(q, args)]


async def run_engine(now: datetime | None = None) -> int:
    """Evaluate every enabled rule once. Returns how many fired."""
    now = now or datetime.now()
    with db.session() as conn:
        rows = conn.execute("SELECT * FROM automations WHERE enabled=1").fetchall()
        dev = _devices_map(conn)
    # offline integrations report nothing we can trust
    cur = {i: (d["state"] if d["online"] or dev[i]["domain"] == "mqtt" else None) for i, d in dev.items()}
    fired = 0
    for r in rows:
        trig, conds, actions = json.loads(r["trigger"]), json.loads(r["conditions"]), json.loads(r["actions"])
        last = datetime.fromisoformat(r["last_run"]).astimezone().replace(tzinfo=None) if r["last_run"] else None
        if not smart_auto.trigger_fires(trig, _prev_states, cur, now, last):
            continue
        if last and (now - last).total_seconds() < smart_auto.COOLDOWN_S:
            _log(r["id"], "info", f"{r['name']}: triggered again within {smart_auto.COOLDOWN_S} s, skipped (cooldown).")
            continue
        ok, why = smart_auto.check_conditions(conds, cur, now)
        if not ok:
            _log(r["id"], "info", f"{r['name']}: triggered but not run: {why}.")
            continue
        risky = smart_auto.risky_actions(actions, dev)
        if risky and not r["risk_ack"]:
            _log(r["id"], "warn", f"{r['name']}: not run, it controls risky devices ({', '.join(sorted(set(risky)))}) and was never acknowledged.")
            continue
        msgs = await execute_actions(r["id"], r["name"], actions, False)
        with db.session() as conn:
            conn.execute("UPDATE automations SET last_run=?, last_result=? WHERE id=?", (db.now(), f"fired: {len(msgs)} action(s)", r["id"]))
        fired += 1
    _prev_states.clear()
    _prev_states.update(cur)
    return fired


async def tick() -> None:
    with db.session() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM integrations WHERE enabled=1 AND kind='homeassistant'")]
    for iid in ids:
        try:
            await sync_integration(iid)
        except Exception:  # one broken integration must not stop the others
            pass
    try:
        await run_engine()
    except Exception as e:
        _log(None, "error", f"Automation engine error: {type(e).__name__}: {e}")


async def poll_loop(seconds: float) -> None:
    while True:
        await tick()
        await asyncio.sleep(seconds)


def start_mqtt_all() -> None:
    with db.session() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM integrations WHERE enabled=1 AND kind='mqtt'")]
    for iid in ids:
        _start_mqtt(iid)


@router.get("/smart/status")
def smart_status():
    return {"pollSeconds": config.POLL_SECONDS, "mqttAvailable": smart_mqtt.AVAILABLE, "ffmpeg": shutil.which("ffmpeg") is not None}
