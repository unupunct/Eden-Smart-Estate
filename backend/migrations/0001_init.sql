-- EDEN core schema. Portable SQL: text UUID keys, JSON stored as TEXT (JSONB on PostgreSQL later).
CREATE TABLE properties (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    center_lng REAL NOT NULL,
    center_lat REAL NOT NULL,
    zoom REAL NOT NULL DEFAULT 17,
    bearing REAL NOT NULL DEFAULT 0,
    pitch REAL NOT NULL DEFAULT 0,
    base_map TEXT NOT NULL DEFAULT 'satellite',
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE map_layers (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6ee7a8',
    visible INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_layers_property ON map_layers(property_id);

-- One row per drawn object. Geometry is GeoJSON in WGS84 (lng, lat) - the single source of truth
-- for both the 2D and 3D views. Kind-specific attributes live in `props`.
CREATE TABLE map_objects (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES map_layers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    geometry TEXT NOT NULL,
    props TEXT NOT NULL DEFAULT '{}',
    rev INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_objects_property ON map_objects(property_id);
CREATE INDEX idx_objects_layer ON map_objects(layer_id);
CREATE INDEX idx_objects_kind ON map_objects(property_id, kind);

CREATE TABLE image_overlays (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    corners TEXT NOT NULL,          -- JSON [[lng,lat] x4]: top-left, top-right, bottom-right, bottom-left
    opacity REAL NOT NULL DEFAULT 0.85,
    visible INTEGER NOT NULL DEFAULT 1,
    calibration TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_overlays_property ON image_overlays(property_id);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- API keys. Never returned by the API; only used server-side (tile proxy).
CREATE TABLE secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
