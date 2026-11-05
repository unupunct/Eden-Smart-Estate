-- v1.2: the admin account, push subscriptions, OCR text for documents, terrain cache.

-- Exactly one admin account (the CHECK makes a second row impossible). The password is stored only as a salted scrypt hash.
CREATE TABLE admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    pw_changed_at TEXT NOT NULL
);

-- Web Push subscriptions (one per browser that agreed to receive notifications).
CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_ok TEXT,
    failures INTEGER NOT NULL DEFAULT 0
);

-- Remembers which notifications were already sent (daily digest) so a restart never repeats them.
CREATE TABLE push_sent (
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
);

-- OCR: machine-read text of images and scanned PDFs. NULL until read; always shown as "machine-read, may contain errors".
ALTER TABLE documents ADD COLUMN ocr_text TEXT;
ALTER TABLE documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT '';   -- '' | pending | done | none | unavailable | error
ALTER TABLE documents ADD COLUMN ocr_note TEXT NOT NULL DEFAULT '';

-- Elevation grid and the figures derived from it, per property. The last real answer is kept with its fetch time.
CREATE TABLE terrain_cache (
    property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    fetched_at TEXT NOT NULL,
    body TEXT NOT NULL
);
