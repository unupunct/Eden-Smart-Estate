"""Automation rules: pure evaluation (testable without a server) used by the poller in smart.py.

A rule = one trigger + optional conditions + actions. Safety rules built in:
  * a missing or unavailable device state never satisfies a trigger or condition (no guessing),
  * state triggers fire on a *change* observed after the engine has seen a first value, never on startup,
  * rules that command risky devices (locks, covers, heating, valves, ...) only run unattended if the user acknowledged it,
  * a rule cannot run more often than once per COOLDOWN_S, so a flapping sensor cannot hammer a device.
"""
from datetime import datetime

from .smart_ha import ALLOWED_SERVICES

COOLDOWN_S = 60
BAD_STATES = {None, "", "unavailable", "unknown"}
OPS = {"eq", "ne", "gt", "lt"}
TRIGGER_TYPES = {"state", "time"}


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _hhmm(s) -> int | None:
    try:
        h, m = str(s).split(":")
        h, m = int(h), int(m)
        return h * 60 + m if 0 <= h < 24 and 0 <= m < 60 else None
    except ValueError:
        return None


def good(state) -> bool:
    return state not in BAD_STATES


def compare(op: str, state, value) -> bool:
    if not good(state):
        return False
    a, b = _num(state), _num(value)
    if op in ("gt", "lt"):
        if a is None or b is None:
            return False
        return a > b if op == "gt" else a < b
    same = (a == b) if a is not None and b is not None else str(state).lower() == str(value).lower()
    return same if op == "eq" else not same


def in_window(now_min: int, after, before) -> bool:
    a, b = _hhmm(after), _hhmm(before)
    if a is None or b is None:
        return False
    return a <= now_min < b if a <= b else (now_min >= a or now_min < b)  # wraps midnight


def check_conditions(conds: list[dict], states: dict[str, str | None], now: datetime) -> tuple[bool, str]:
    for c in conds:
        if c.get("type") == "time":
            if not in_window(now.hour * 60 + now.minute, c.get("after"), c.get("before")):
                return False, f"outside the time window {c.get('after')}–{c.get('before')}"
        else:
            st = states.get(c.get("deviceId"))
            if not compare(c.get("op", "eq"), st, c.get("value")):
                return False, f"condition not met (device state is {st if good(st) else 'unknown'})"
    return True, ""


def trigger_fires(trig: dict, prev: dict[str, str | None], cur: dict[str, str | None], now: datetime, last_run: datetime | None) -> bool:
    """`prev` is what the engine saw on its previous tick, `cur` what the devices report now."""
    t = trig.get("type")
    if t == "time":
        at = _hhmm(trig.get("at"))
        if at is None or now.hour * 60 + now.minute != at:
            return False
        days = trig.get("days")
        if isinstance(days, list) and days and now.weekday() not in days:
            return False
        return not (last_run and (now - last_run).total_seconds() < 90)
    if t == "state":
        did = trig.get("deviceId")
        before, after = prev.get(did, "__unseen__"), cur.get(did)
        if before == "__unseen__" or not good(after) or not good(before):
            return False  # first sighting, or either side is unknown
        if "to" in trig and trig["to"] not in (None, ""):
            return compare("eq", after, trig["to"]) and not compare("eq", before, trig["to"])
        if trig.get("above") not in (None, ""):
            return compare("gt", after, trig["above"]) and not compare("gt", before, trig["above"])
        if trig.get("below") not in (None, ""):
            return compare("lt", after, trig["below"]) and not compare("lt", before, trig["below"])
        return before != after
    return False


def validate(body: dict, devices: dict[str, dict]) -> list[str]:
    """Problems with a rule definition, in plain words (empty list = fine)."""
    errs: list[str] = []
    trig = body.get("trigger") or {}
    if trig.get("type") not in TRIGGER_TYPES:
        errs.append("Choose a trigger (a device changes, or a time of day).")
    elif trig["type"] == "state":
        if trig.get("deviceId") not in devices:
            errs.append("The trigger device does not exist.")
        else:
            n = sum(1 for k in ("to", "above", "below") if trig.get(k) not in (None, ""))
            if n > 1:
                errs.append("A state trigger may use only one of: becomes, rises above, falls below.")
            for k in ("above", "below"):
                if trig.get(k) not in (None, "") and _num(trig[k]) is None:
                    errs.append(f"'{k}' must be a number.")
    elif trig["type"] == "time":
        if _hhmm(trig.get("at")) is None:
            errs.append("The trigger time must look like 07:30.")
    for c in body.get("conditions") or []:
        if c.get("type") == "time":
            if _hhmm(c.get("after")) is None or _hhmm(c.get("before")) is None:
                errs.append("A time condition needs 'after' and 'before' times like 08:00.")
        elif c.get("deviceId") not in devices:
            errs.append("A condition refers to a device that does not exist.")
        elif c.get("op") not in OPS:
            errs.append("A condition has an unknown comparison.")
    actions = body.get("actions") or []
    if not actions:
        errs.append("Add at least one action.")
    for a in actions:
        if a.get("type") == "log":
            if not str(a.get("message", "")).strip():
                errs.append("A log action needs a message.")
        elif a.get("type") == "device":
            d = devices.get(a.get("deviceId"))
            if not d:
                errs.append("An action refers to a device that does not exist.")
            elif a.get("service") not in ALLOWED_SERVICES.get(d["domain"], set()):
                errs.append(f"'{a.get('service')}' is not possible for {d['name']}.")
        else:
            errs.append("Unknown action type.")
    return errs


def risky_actions(actions: list[dict], devices: dict[str, dict]) -> list[str]:
    """Names of risky devices an action list would command."""
    out = []
    for a in actions:
        d = devices.get(a.get("deviceId")) if a.get("type") == "device" else None
        if d and d.get("risky"):
            out.append(d["name"])
    return out


def describe_trigger(trig: dict, devices: dict[str, dict]) -> str:
    if trig.get("type") == "time":
        return f"every day at {trig.get('at')}"
    name = devices.get(trig.get("deviceId"), {}).get("name", "?")
    if trig.get("to") not in (None, ""):
        return f"when {name} becomes {trig['to']}"
    if trig.get("above") not in (None, ""):
        return f"when {name} rises above {trig['above']}"
    if trig.get("below") not in (None, ""):
        return f"when {name} falls below {trig['below']}"
    return f"when {name} changes"
