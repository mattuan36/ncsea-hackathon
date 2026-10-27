-- Folders form a tree; documents live in exactly one folder.
CREATE TABLE IF NOT EXISTS folders (
    id         SERIAL PRIMARY KEY,
    parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS documents (
    id            SERIAL PRIMARY KEY,
    folder_id     INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes    BIGINT NOT NULL,
    data          BYTEA NOT NULL,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_folder_id_idx ON documents (folder_id);

-- Large uploads (IFC models) live on disk; data is NULL for those rows.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE documents ALTER COLUMN data DROP NOT NULL;

-- Dead load materials: Kim's spreadsheet rows (id "R40" = sheet row 40), the
-- matcher's proposed rows (X1..), and rows users add (custom, id "U1"..).
CREATE TABLE IF NOT EXISTS materials (
    id           TEXT PRIMARY KEY,
    t_in         DOUBLE PRECISION,          -- dimension, inches; NULL when not thickness-based
    material     TEXT NOT NULL,
    orientation  TEXT NOT NULL DEFAULT '',  -- Horizontal / Vertical / Both
    use          TEXT NOT NULL DEFAULT '',  -- use/component
    info         TEXT NOT NULL DEFAULT '',
    psf          DOUBLE PRECISION,          -- psf at t_in
    psf_per_in   DOUBLE PRECISION,          -- set when psf scales with thickness
    psf_text     TEXT,
    source       TEXT NOT NULL DEFAULT '',
    custom       BOOLEAN NOT NULL DEFAULT false,
    edited       BOOLEAN NOT NULL DEFAULT false,  -- user changed an imported row; re-import leaves it
    position     INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS materials_custom_seq;

-- One uploaded IFC model and its extraction (gravity_ifc JSON, schema_version 1).
CREATE TABLE IF NOT EXISTS models (
    id            SERIAL PRIMARY KEY,
    filename      TEXT NOT NULL,
    document_id   INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    storage_path  TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued',  -- queued | running | ready | failed
    stage         TEXT NOT NULL DEFAULT 'Queued',
    progress      REAL NOT NULL DEFAULT 0,         -- 0..1
    error         TEXT,
    result        JSONB,
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- project name, allowance options
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

-- The user's decisions per extracted type (include, assembly name, layers,
-- merge parent, allowance, verified material), as the frontend's type patch.
CREATE TABLE IF NOT EXISTS model_type_decisions (
    model_id    INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    type_id     TEXT NOT NULL,
    decision    JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (model_id, type_id)
);
