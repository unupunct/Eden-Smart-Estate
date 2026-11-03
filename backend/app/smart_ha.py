"""Home Assistant REST client and the generic device-command rules.

EDEN only shows what Home Assistant (or MQTT) really reported. A failed or missing report leaves the device state NULL
(shown as "no data"), never a default and never a guess.
"""
import json

import httpx

TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport here

SUPPORTED_DOMAINS = {
    "switch", "light", "sensor", "binary_sensor", "climate", "cover", "lock", "camera", "input_boolean", "fan", "humidifier",
    "valve", "water_heater",
}
RISKY_DOMAINS = {"lock", "cover", "climate", "valve", "water_heater"}

# What each domain may be commanded to do. Anything else is refused.
ALLOWED_SERVICES: dict[str, set[str]] = {
    "switch": {"turn_on", "turn_off", "toggle"}, "light": {"turn_on", "turn_off", "toggle"}, "fan": {"turn_on", "turn_off", "toggle"},
    "input_boolean": {"turn_on", "turn_off", "toggle"}, "humidifier": {"turn_on", "turn_off", "toggle"},
    "lock": {"lock", "unlock"}, "cover": {"open_cover", "close_cover", "stop_cover"}, "valve": {"open_valve", "close_valve"},
    "climate": {"turn_on", "turn_off"}, "water_heater": {"turn_on", "turn_off"},
    "mqtt": {"turn_on", "turn_off"},
}

DROP_ATTRS = {"access_token", "entity_picture", "entity_picture_local"}  # camera tokens must not be stored or shown
MAX_ATTR_JSON = 4000


class HaError(Exception):
    """A problem talking to Home Assistant, worded for the user."""


def _client(timeout: float = 10) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, transport=TRANSPORT)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _base(url: str) -> str:
    return url.strip().rstrip("/")


def _explain(r: httpx.Response) -> str:
    if r.status_code == 401:
        return "Home Assistant rejected the access token (401). Create a new long-lived token in your HA profile."
    if r.status_code == 404:
        return "Home Assistant answered 404: check the URL (it should look like http://homeassistant.local:8123)."
    return f"Home Assistant answered HTTP {r.status_code}."


async def fetch_states(url: str, token: str) -> list[dict]:
    try:
        async with _client() as c:
            r = await c.get(f"{_base(url)}/api/states", headers=_headers(token))
    except httpx.InvalidURL:
        raise HaError("That is not a valid URL.")
    except httpx.HTTPError as e:
        raise HaError(f"Cannot reach Home Assistant at {_base(url)} ({type(e).__name__}).")
    if r.status_code != 200:
        raise HaError(_explain(r))
    try:
        data = r.json()
    except ValueError:
        raise HaError("The server did not answer like Home Assistant (reply was not JSON).")
    if not isinstance(data, list):
        raise HaError("The server did not answer like Home Assistant (unexpected reply).")
    return data


async def fetch_state(url: str, token: str, entity_id: str) -> dict | None:
    try:
        async with _client() as c:
            r = await c.get(f"{_base(url)}/api/states/{entity_id}", headers=_headers(token))
    except httpx.HTTPError:
        return None
    return r.json() if r.status_code == 200 else None


async def call_service(url: str, token: str, domain: str, service: str, entity_id: str) -> None:
    try:
        async with _client() as c:
            r = await c.post(f"{_base(url)}/api/services/{domain}/{service}", headers=_headers(token), json={"entity_id": entity_id})
    except httpx.HTTPError as e:
        raise HaError(f"Cannot reach Home Assistant ({type(e).__name__}).")
    if r.status_code not in (200, 201):
        raise HaError(_explain(r))


async def camera_image(url: str, token: str, entity_id: str) -> tuple[bytes, str]:
    try:
        async with _client(15) as c:
            r = await c.get(f"{_base(url)}/api/camera_proxy/{entity_id}", headers=_headers(token))
    except httpx.HTTPError as e:
        raise HaError(f"Cannot reach Home Assistant ({type(e).__name__}).")
    if r.status_code != 200:
        raise HaError(_explain(r))
    return r.content, r.headers.get("content-type", "image/jpeg")


def split_entity(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


def parse_state(s: dict) -> dict | None:
    """One HA state object -> device fields, or None if unusable or unsupported."""
    eid = s.get("entity_id")
    if not isinstance(eid, str) or "." not in eid:
        return None
    domain = split_entity(eid)
    if domain not in SUPPORTED_DOMAINS:
        return None
    attrs = s.get("attributes") if isinstance(s.get("attributes"), dict) else {}
    keep = {k: v for k, v in attrs.items() if k not in DROP_ATTRS}
    blob = json.dumps(keep, separators=(",", ":"), default=str)
    if len(blob) > MAX_ATTR_JSON:
        keep = {k: keep[k] for k in ("friendly_name", "unit_of_measurement", "device_class", "temperature", "current_temperature", "brightness") if k in keep}
    state = s.get("state")
    return {
        "external_id": eid, "domain": domain, "name": str(attrs.get("friendly_name") or eid),
        "device_class": str(attrs.get("device_class") or ""), "unit": str(attrs.get("unit_of_measurement") or ""),
        "state": None if state is None else str(state)[:200], "attrs": keep, "updated": s.get("last_updated") or s.get("last_changed"),
    }


def validate_command(domain: str, service: str) -> None:
    allowed = ALLOWED_SERVICES.get(domain)
    if not allowed:
        raise HaError(f"{domain} devices cannot be controlled from EDEN.")
    if service not in allowed:
        raise HaError(f"'{service}' is not allowed for {domain} devices (allowed: {', '.join(sorted(allowed))}).")
