-- Phase 5: integrations, devices, cameras, automations.
-- Credentials (HA tokens, MQTT passwords, camera passwords) live in the `secrets` table and are never returned by the API.
-- Device state is only ever written by an integration that really reported it: no defaults, no simulated values.

CREATE TABLE integrations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                 -- homeassistant | mqtt
    name TEXT NOT NULL,
    url TEXT NOT NULL,                  -- HA base URL, or MQTT host
    options TEXT NOT NULL DEFAULT '{}', -- JSON: MQTT port/username/tls, HA domains filter
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',   -- unknown | online | error | disabled
    status_msg TEXT NOT NULL DEFAULT '',
    last_sync TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,          -- HA entity_id, or MQTT state topic
    name TEXT NOT NULL,
    domain TEXT NOT NULL,               -- switch, light, sensor, binary_sensor, climate, cover, lock, camera, mqtt...
    device_class TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    state TEXT,                         -- NULL until the integration has reported a value
    attrs TEXT NOT NULL DEFAULT '{}',
    state_updated TEXT,
    object_id TEXT,                     -- linked map object (outlet, light, sensor, camera...)
    risky INTEGER NOT NULL DEFAULT 0,   -- commands need explicit confirmation
    command_topic TEXT NOT NULL DEFAULT '',   -- MQTT only
    UNIQUE (integration_id, external_id)
);
CREATE INDEX idx_devices_object ON devices(object_id);

CREATE TABLE cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                 -- snapshot | mjpeg | rtsp | ha
    url TEXT NOT NULL DEFAULT '',       -- never contains credentials (moved to secrets on save)
    username TEXT NOT NULL DEFAULT '',
    integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    object_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    trigger TEXT NOT NULL,              -- JSON
    conditions TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    risk_ack INTEGER NOT NULL DEFAULT 0,  -- user confirmed this rule may run risky actions on its own
    last_run TEXT,
    last_result TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE automation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    automation_id TEXT,
    at TEXT NOT NULL,
    level TEXT NOT NULL,                -- info | warn | error
    dry_run INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL
);
CREATE INDEX idx_autolog_auto ON automation_log(automation_id, id);
