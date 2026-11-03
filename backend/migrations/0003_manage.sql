-- Phase 6: tasks and maintenance, documents and photos, weather cache.

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',   -- low | normal | high
    due TEXT,                                  -- YYYY-MM-DD (local calendar day), NULL = no date
    status TEXT NOT NULL DEFAULT 'open',       -- open | done
    repeat_every INTEGER,                      -- NULL = does not repeat
    repeat_unit TEXT,                          -- day | week | month | year
    repeat_from TEXT NOT NULL DEFAULT 'due',   -- due | completion
    object_id TEXT,                            -- linked map object
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_tasks_property ON tasks(property_id, status, due);
CREATE INDEX idx_tasks_object ON tasks(object_id);

CREATE TABLE task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT,
    title TEXT NOT NULL,
    object_id TEXT,
    property_id TEXT,
    due TEXT,
    completed_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_taskhist_task ON task_history(task_id);

CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    property_id TEXT REFERENCES properties(id) ON DELETE CASCADE,
    object_id TEXT,                            -- linked map object, NULL = about the whole property
    title TEXT NOT NULL,
    filename TEXT NOT NULL,                    -- stored name inside uploads/ (flat, so backups carry it)
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    tags TEXT NOT NULL DEFAULT '',             -- comma separated
    note TEXT NOT NULL DEFAULT '',
    taken_at TEXT,                             -- date shown for photos/documents (user supplied, optional)
    created_at TEXT NOT NULL
);
CREATE INDEX idx_documents_property ON documents(property_id);
CREATE INDEX idx_documents_object ON documents(object_id);

-- Last real answer from the weather service for a location. Always shown with its fetch time.
CREATE TABLE weather_cache (
    key TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    body TEXT NOT NULL
);
