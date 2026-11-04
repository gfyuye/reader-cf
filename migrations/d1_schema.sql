CREATE TABLE IF NOT EXISTS book_sources (
    user_ns TEXT NOT NULL DEFAULT 'default',
    book_source_url TEXT NOT NULL,
    book_source_name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_source_url),
    FOREIGN KEY (user_ns) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_sources_user_ns_updated ON book_sources(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS book_cache (
    book_url TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_cache (
    book_url TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (book_url, chapter_index)
);

CREATE TABLE IF NOT EXISTS users (
    username TEXT NOT NULL PRIMARY KEY,
    password TEXT NOT NULL,
    salt TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    last_login_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    enable_webdav INTEGER NOT NULL DEFAULT 0,
    enable_local_store INTEGER NOT NULL DEFAULT 0,
    enable_ai_model INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_sessions (
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    expire_at INTEGER NOT NULL,
    PRIMARY KEY (username, token),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire_at ON user_sessions(expire_at);

CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_attempted ON login_attempts(identifier, attempted_at);

CREATE TABLE IF NOT EXISTS json_documents (
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (namespace, name)
);

CREATE INDEX IF NOT EXISTS idx_json_documents_namespace ON json_documents(namespace);

CREATE TABLE IF NOT EXISTS book_details (
    book_id TEXT PRIMARY KEY,
    user_ns TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_book_details_user_ns ON book_details(user_ns, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_book_memories (
    user_ns TEXT NOT NULL,
    book_key TEXT NOT NULL,
    book_url TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_ns, book_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_book_memories_user_ns ON ai_book_memories(user_ns);

CREATE TABLE IF NOT EXISTS user_remote_webdav (
    username TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    server_url TEXT NOT NULL DEFAULT '',
    webdav_user TEXT NOT NULL DEFAULT '',
    webdav_password TEXT NOT NULL DEFAULT '',
    sync_on_change INTEGER NOT NULL DEFAULT 1,
    sync_interval_mins INTEGER NOT NULL DEFAULT 5,
    last_sync_at INTEGER NOT NULL DEFAULT 0,
    last_sync_status TEXT NOT NULL DEFAULT '',
    last_sync_error TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_remote_webdav_enabled ON user_remote_webdav(enabled);
