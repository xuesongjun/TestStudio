"""仅保存新版连接配置、操作日志；运行中的连接对象不写入数据库。"""

import json
import sqlite3
from pathlib import Path


class Repository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY, config TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL, level TEXT NOT NULL,
                    source TEXT NOT NULL, message TEXT NOT NULL,
                    connection_id TEXT, task_id TEXT
                );
                CREATE TABLE IF NOT EXISTS register_catalog (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    revision INTEGER NOT NULL, definitions TEXT NOT NULL
                );
            """)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def connections(self) -> list[dict]:
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT config FROM connections ORDER BY rowid")]

    def save_connection(self, config: dict):
        with self.connect() as db:
            db.execute("INSERT INTO connections(id, config) VALUES (?, ?)", (config["id"], json.dumps(config)))

    def delete_connection(self, connection_id: str):
        with self.connect() as db:
            db.execute("DELETE FROM connections WHERE id=?", (connection_id,))

    def update_connection(self, config: dict):
        with self.connect() as db:
            db.execute("UPDATE connections SET config=? WHERE id=?", (json.dumps(config), config["id"]))

    def append_log(self, entry: dict):
        with self.connect() as db:
            cursor = db.execute(
                "INSERT INTO logs(timestamp, level, source, message, connection_id, task_id) VALUES (?, ?, ?, ?, ?, ?)",
                tuple(entry[key] for key in ("timestamp", "level", "source", "message", "connection_id", "task_id")),
            )
            return {"id": cursor.lastrowid, **entry}

    def logs(self, limit: int = 300) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return [dict(row) for row in reversed(rows)]

    def clear_logs(self) -> int:
        with self.connect() as db:
            count = db.execute("SELECT COUNT(*) FROM logs").fetchone()[0]
            db.execute("DELETE FROM logs")
            return count

    def register_catalog(self) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT revision, definitions FROM register_catalog WHERE id=1").fetchone()
            return {"revision": row["revision"], "registers": json.loads(row["definitions"])} if row else None

    def save_register_catalog(self, revision: int, definitions: list[dict]):
        with self.connect() as db:
            db.execute("INSERT INTO register_catalog(id, revision, definitions) VALUES (1, ?, ?) "
                       "ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, definitions=excluded.definitions",
                       (revision, json.dumps(definitions, ensure_ascii=False)))
