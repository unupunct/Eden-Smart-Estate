-- v1.3: pictures of plants from Wikipedia / Wikimedia Commons (opt-in). One row per library entry that was looked up:
-- the answer (or "no free picture") with its licence and credit, so each plant is asked about only once.
CREATE TABLE plant_pictures (
    key TEXT PRIMARY KEY,            -- "plants/tomato"
    fetched_at TEXT NOT NULL,
    body TEXT NOT NULL               -- JSON: {status: "ok"|"none", file, credit...}
);
