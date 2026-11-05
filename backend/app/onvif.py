"""ONVIF camera discovery and set-up.

ONVIF is the common standard IP cameras speak. EDEN can
  1. find cameras on the local network (WS-Discovery: one UDP multicast question, cameras answer with their address),
  2. log in with the user name and password you give (WS-Security digest; the camera's own clock is used so a camera with
     the wrong time does not reject it), list its video profiles and ask it for the picture (snapshot) and video (RTSP) addresses,
  3. add it as a normal EDEN camera. The password is stored like every other camera password: server side, never returned.

Nothing is invented: only what the camera itself reports is shown, and only addresses on private networks are contacted.
Discovery needs multicast to work on your network (some Wi-Fi guest networks and VLANs block it: then enter the camera's
address by hand). Tested here against an in-process fake device, because no real camera was available; a real camera
may need its ONVIF service switched on and a user created for it in its own settings.
"""
import asyncio
import base64
import hashlib
import ipaddress
import os
import re
import secrets
import select
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db, smart

router = APIRouter(prefix="/api/onvif")

WSD_ADDR = ("239.255.255.250", 3702)
NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "d": "http://schemas.xmlsoap.org/ws/2005/04/discovery",
    "a": "http://schemas.xmlsoap.org/ws/2004/08/addressing",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "trt": "http://www.onvif.org/ver10/media/wsdl",
    "tt": "http://www.onvif.org/ver10/schema",
}
TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport
DISCOVERY_TARGETS: list[tuple[str, int]] | None = None  # tests probe a local fake instead of the multicast group
SOAP_TIMEOUT = 10


# ------------------------------------------------------------------ discovery (WS-Discovery over UDP)
def probe_message() -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
<e:Header><w:MessageID>uuid:{uuid.uuid4()}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>
<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>""".encode()


def parse_probe_match(xml: bytes) -> dict | None:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    m = root.find(".//d:ProbeMatch", NS)
    if m is None:
        return None
    xaddrs = (m.findtext("d:XAddrs", "", NS) or "").split()
    scopes = (m.findtext("d:Scopes", "", NS) or "").split()
    def scope(kind: str) -> str:
        for s in scopes:
            mm = re.match(rf"onvif://www\.onvif\.org/{kind}/(.+)", s)
            if mm:
                return mm.group(1).replace("%20", " ")
        return ""
    urls = [u for u in xaddrs if _is_lan_url(u)]
    if not urls:
        return None
    return {"id": m.findtext("a:EndpointReference/a:Address", "", NS), "xaddr": urls[0], "host": urlsplit(urls[0]).hostname,
            "name": scope("name"), "hardware": scope("hardware"), "location": scope("location")}


def _local_ipv4s() -> list[str]:
    ips: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith(("127.", "169.254.")) and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips or [""]


def discover_blocking(timeout: float = 3.0) -> list[dict]:
    """Send the probe from every network interface and collect answers for `timeout` seconds."""
    targets = DISCOVERY_TARGETS or [WSD_ADDR]
    socks: list[socket.socket] = []
    for ip in (_local_ipv4s() if DISCOVERY_TARGETS is None else [""]):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        try:
            s.bind((ip, 0))
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            if ip:
                s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(ip))
            msg = probe_message()
            for t in targets:
                s.sendto(msg, t)
            socks.append(s)
        except OSError:
            s.close()
    found: dict[str, dict] = {}
    deadline = time.monotonic() + timeout
    try:
        while socks and time.monotonic() < deadline:
            ready, _, _ = select.select(socks, [], [], max(0.05, deadline - time.monotonic()))
            for s in ready:
                try:
                    data, _addr = s.recvfrom(65535)
                except OSError:
                    continue
                dev = parse_probe_match(data)
                if dev:
                    found[dev["xaddr"]] = dev
    finally:
        for s in socks:
            s.close()
    return sorted(found.values(), key=lambda d: d["host"] or "")


# ------------------------------------------------------------------ SOAP with WS-Security
def _is_lan_url(url: str) -> bool:
    """Only plain http(s) addresses of machines on a private network are ever contacted."""
    try:
        u = urlsplit(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            return False
        ip = ipaddress.ip_address(u.hostname)
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def wsse_header(username: str, password: str, now: datetime, nonce: bytes | None = None) -> str:
    nonce = nonce or secrets.token_bytes(16)
    created = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()
    esc = lambda v: v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
    return ('<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">'
            f'<UsernameToken><Username>{esc(username)}</Username>'
            f'<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</Password>'
            f'<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{base64.b64encode(nonce).decode()}</Nonce>'
            f'<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">{created}</Created></UsernameToken></Security></s:Header>')


class OnvifError(Exception):
    pass


class Camera:
    def __init__(self, xaddr: str, username: str, password: str):
        if not _is_lan_url(xaddr):
            raise OnvifError("Only camera addresses on your own network (for example http://192.168.1.20/onvif/device_service) are contacted.")
        self.xaddr, self.username, self.password = xaddr, username, password
        self.skew = timedelta(0)

    async def call(self, client: httpx.AsyncClient, url: str, body: str, auth: bool = True) -> ET.Element:
        if not _is_lan_url(url):
            raise OnvifError("The camera pointed to an address outside your network; it was not contacted.")
        header = wsse_header(self.username, self.password, datetime.now(timezone.utc) + self.skew) if auth and self.username else "<s:Header/>"
        env = f'<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="{NS["s"]}" xmlns:tds="{NS["tds"]}" xmlns:trt="{NS["trt"]}" xmlns:tt="{NS["tt"]}">{header}<s:Body>{body}</s:Body></s:Envelope>'
        try:
            r = await client.post(url, content=env.encode(), headers={"Content-Type": 'application/soap+xml; charset=utf-8'}, timeout=SOAP_TIMEOUT)
        except httpx.HTTPError as e:
            raise OnvifError(f"Cannot reach the camera ({type(e).__name__}).")
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError:
            raise OnvifError(f"The camera answered HTTP {r.status_code} with something that is not ONVIF.")
        fault = root.find(".//s:Fault", NS)
        if fault is not None or r.status_code >= 400:
            text = " ".join(t for t in (fault.itertext() if fault is not None else []) if t.strip())[:200]
            if r.status_code == 401 or "NotAuthorized" in text or "Sender not Authorized" in text:
                raise OnvifError("The camera rejected the user name or password (or has no ONVIF user with that name).")
            raise OnvifError(f"The camera reported an error: {text or r.status_code}")
        return root

    async def sync_clock(self, client: httpx.AsyncClient) -> None:
        """Use the camera's own UTC time for the digest, so a camera with a wrong clock still accepts the login."""
        try:
            root = await self.call(client, self.xaddr, "<tds:GetSystemDateAndTime/>", auth=False)
            t = root.find(".//tt:UTCDateTime", NS)
            if t is not None:
                g = lambda tag: int(t.findtext(f".//tt:{tag}", "0", NS) or 0)  # noqa: E731
                cam = datetime(g("Year") or 1970, g("Month") or 1, g("Day") or 1, g("Hour"), g("Minute"), g("Second"), tzinfo=timezone.utc)
                self.skew = cam - datetime.now(timezone.utc)
        except (OnvifError, ValueError):
            pass

    async def inspect(self) -> dict:
        async with httpx.AsyncClient(transport=TRANSPORT) as client:
            await self.sync_clock(client)
            info: dict = {}
            try:
                d = await self.call(client, self.xaddr, "<tds:GetDeviceInformation/>")
                info = {k: d.findtext(f".//tds:{k}", "", NS) for k in ("Manufacturer", "Model", "FirmwareVersion", "SerialNumber")}
            except OnvifError as e:
                if "rejected" in str(e):
                    raise
            cap = await self.call(client, self.xaddr, "<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>")
            media = cap.findtext(".//tt:Media/tt:XAddr", "", NS)
            if not media:
                raise OnvifError("The camera does not offer an ONVIF media service (no video profiles).")
            profiles = []
            prof = await self.call(client, media, "<trt:GetProfiles/>")
            for p in prof.findall(".//trt:Profiles", NS):
                token = p.get("token", "")
                if not token:
                    continue
                entry = {"token": token, "name": p.findtext("tt:Name", "", NS), "encoding": p.findtext(".//tt:VideoEncoderConfiguration/tt:Encoding", "", NS),
                         "width": int(p.findtext(".//tt:VideoEncoderConfiguration/tt:Resolution/tt:Width", "0", NS) or 0),
                         "height": int(p.findtext(".//tt:VideoEncoderConfiguration/tt:Resolution/tt:Height", "0", NS) or 0),
                         "streamUri": "", "snapshotUri": ""}
                try:
                    s = await self.call(client, media, f"<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>{token}</trt:ProfileToken></trt:GetStreamUri>")
                    entry["streamUri"] = (s.findtext(".//tt:Uri", "", NS) or "").strip()
                except OnvifError:
                    pass
                try:
                    s = await self.call(client, media, f"<trt:GetSnapshotUri><trt:ProfileToken>{token}</trt:ProfileToken></trt:GetSnapshotUri>")
                    entry["snapshotUri"] = (s.findtext(".//tt:Uri", "", NS) or "").strip()
                except OnvifError:
                    pass
                profiles.append(entry)
            if not profiles:
                raise OnvifError("The camera reported no video profiles.")
            return {"device": info, "profiles": profiles}


# ------------------------------------------------------------------ API
class ProbeIn(BaseModel):
    xaddr: str = Field(max_length=500)
    username: str = Field(default="", max_length=100)
    password: str = Field(default="", max_length=200)


class AddIn(ProbeIn):
    profileToken: str = Field(max_length=200)
    name: str = Field(min_length=1, max_length=80)
    objectId: str | None = None


class DiscoverIn(BaseModel):
    seconds: float = Field(default=3.0, ge=1, le=10)


@router.post("/discover")
async def discover(body: DiscoverIn | None = None):
    seconds = body.seconds if body else 3.0
    found = await asyncio.to_thread(discover_blocking, seconds)
    with db.session() as conn:
        known = {r["url"] for r in conn.execute("SELECT url FROM cameras")}
    for d in found:
        host = d["host"] or ""
        d["alreadyAdded"] = any(host and host in (k or "") for k in known)
    return {"cameras": found, "note": "Cameras that answered on this network. If yours is missing, multicast may be blocked here, or ONVIF is switched off in the camera: enter its address by hand."}


@router.post("/profiles")
async def profiles(body: ProbeIn):
    try:
        return await Camera(body.xaddr, body.username, body.password).inspect()
    except OnvifError as e:
        raise HTTPException(502, str(e))


@router.post("/add", status_code=201)
async def add(body: AddIn):
    """Ask the camera again (never trusting addresses sent by the browser) and create the EDEN camera from its answer."""
    try:
        res = await Camera(body.xaddr, body.username, body.password).inspect()
    except OnvifError as e:
        raise HTTPException(502, str(e))
    p = next((x for x in res["profiles"] if x["token"] == body.profileToken), None)
    if not p:
        raise HTTPException(404, "That video profile does not exist on the camera.")
    if p["snapshotUri"] and _is_lan_url(p["snapshotUri"]):
        kind, url = "snapshot", p["snapshotUri"]  # works without ffmpeg
    elif p["streamUri"] and p["streamUri"].lower().startswith(("rtsp://", "rtsps://")):
        kind, url = "rtsp", p["streamUri"]        # needs ffmpeg on this computer
    else:
        raise HTTPException(422, "The camera did not give a usable picture or stream address for that profile.")
    cam = smart.add_camera(smart.CameraIn(name=body.name, kind=kind, url=url, username=body.username, password=body.password or None, objectId=body.objectId))
    cam["note"] = ("Added as a snapshot camera." if kind == "snapshot" else "Added as an RTSP camera: EDEN needs ffmpeg on this computer to show it.")
    return cam
