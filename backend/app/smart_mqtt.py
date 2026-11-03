"""MQTT hub: one paho client per enabled MQTT integration. Devices are the state topics the user adds; their state is
whatever payload last arrived on that topic. Nothing is assumed before the first message."""
import json
import threading

from . import db

try:  # optional dependency: without it MQTT integrations report "paho-mqtt not installed"
    import paho.mqtt.client as paho
except Exception:  # pragma: no cover - depends on the environment
    paho = None

CLIENT_FACTORY = None  # tests inject a fake client factory: f(client_id) -> client
AVAILABLE = paho is not None
_lock = threading.Lock()
_clients: dict[str, object] = {}


def _new_client(iid: str):
    if CLIENT_FACTORY:
        return CLIENT_FACTORY(f"eden-{iid[:8]}")
    return paho.Client(paho.CallbackAPIVersion.VERSION2, client_id=f"eden-{iid[:8]}")


def _set_status(iid: str, status: str, msg: str = "") -> None:
    with db.session() as conn:
        conn.execute("UPDATE integrations SET status=?, status_msg=? WHERE id=?", (status, msg, iid))


def handle_message(iid: str, topic: str, payload: bytes) -> None:
    """Store a received payload on the matching device (if the user added that topic)."""
    try:
        text = payload.decode("utf-8", "replace").strip()[:200]
    except Exception:
        return
    with db.session() as conn:
        conn.execute("UPDATE devices SET state=?, state_updated=? WHERE integration_id=? AND external_id=?", (text, db.now(), iid, topic))


def start(iid: str, host: str, options: dict, password: str) -> None:
    """(Re)connect the integration. Never raises: problems become the integration status."""
    stop(iid)
    if not AVAILABLE and not CLIENT_FACTORY:
        _set_status(iid, "error", "The optional paho-mqtt package is not installed (pip install paho-mqtt).")
        return
    try:
        c = _new_client(iid)
        if options.get("username"):
            c.username_pw_set(options["username"], password or None)
        if options.get("tls"):
            c.tls_set()

        def on_connect(client, _ud, _flags, rc, *_a):
            ok = (getattr(rc, "value", rc) == 0)
            if not ok:
                _set_status(iid, "error", f"The broker refused the connection ({rc}).")
                return
            with db.session() as conn:
                topics = [r["external_id"] for r in conn.execute("SELECT external_id FROM devices WHERE integration_id=?", (iid,))]
            for t in topics:
                client.subscribe(t)
            _set_status(iid, "online", "")

        def on_message(_client, _ud, msg):
            handle_message(iid, msg.topic, msg.payload)

        def on_disconnect(*_a):
            _set_status(iid, "error", "Disconnected from the broker.")

        c.on_connect, c.on_message, c.on_disconnect = on_connect, on_message, on_disconnect
        c.connect_async(host, int(options.get("port") or 1883), 30)
        c.loop_start()
        with _lock:
            _clients[iid] = c
    except Exception as e:
        _set_status(iid, "error", f"Could not start the MQTT client: {type(e).__name__}: {e}")


def stop(iid: str) -> None:
    with _lock:
        c = _clients.pop(iid, None)
    if c is not None:
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass


def stop_all() -> None:
    for iid in list(_clients):
        stop(iid)


def subscribe(iid: str, topic: str) -> None:
    with _lock:
        c = _clients.get(iid)
    if c is not None:
        try:
            c.subscribe(topic)
        except Exception:
            pass


def publish(iid: str, topic: str, payload: str) -> None:
    with _lock:
        c = _clients.get(iid)
    if c is None:
        raise RuntimeError("The MQTT integration is not connected.")
    info = c.publish(topic, payload)
    rc = getattr(info, "rc", 0)
    if rc not in (0, None):
        raise RuntimeError(f"The broker did not accept the message (code {rc}).")


def is_connected(iid: str) -> bool:
    with _lock:
        return iid in _clients


def describe(options: dict) -> str:
    return json.dumps({k: v for k, v in options.items() if k != "password"})
