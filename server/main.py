"""健康记录本 · 家庭码同步后端（FastAPI + SQLite，本地优先/最后写入胜）。"""
import json
import logging
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logger = logging.getLogger("health-api")
DB_PATH = Path(__file__).resolve().parent / "health.db"

app = FastAPI(title="health-notebook-api", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


@app.on_event("startup")
def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS families (
                code TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS records (
                family_code TEXT NOT NULL,
                id TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (family_code, id)
            );
            CREATE TABLE IF NOT EXISTS profiles (
                family_code TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS devices (
                family_code TEXT NOT NULL,
                device_id TEXT NOT NULL,
                label TEXT NOT NULL,
                last_seen INTEGER NOT NULL,
                PRIMARY KEY (family_code, device_id)
            );
            """
        )


class SyncPayload(BaseModel):
    records: List[Dict[str, Any]] = Field(default_factory=list)
    profile: Optional[Dict[str, Any]] = None
    profile_updated_at: int = 0
    device_id: Optional[str] = None
    device_label: Optional[str] = None


def _require_family(conn: sqlite3.Connection, code: str) -> None:
    row = conn.execute("SELECT 1 FROM families WHERE code = ?", (code,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="家庭码不存在")


@app.post("/api/family")
def create_family() -> Dict[str, str]:
    """创建家庭，返回 6 位家庭码。"""
    with db() as conn:
        for _ in range(30):
            code = "".join(secrets.choice("0123456789") for _ in range(6))
            try:
                conn.execute(
                    "INSERT INTO families (code, created_at) VALUES (?, ?)",
                    (code, int(time.time() * 1000)),
                )
                return {"code": code}
            except sqlite3.IntegrityError:
                continue
    raise HTTPException(status_code=500, detail="家庭码分配失败，请重试")


@app.get("/api/family/{code}")
def check_family(code: str) -> Dict[str, bool]:
    """校验家庭码是否存在（加入前检查用）。"""
    with db() as conn:
        _require_family(conn, code)
    return {"ok": True}


@app.post("/api/family/{code}/sync")
def sync(code: str, payload: SyncPayload) -> Dict[str, Any]:
    """推送本地变更并拉回合并结果。记录按 updated_at 最后写入胜。"""
    now = int(time.time() * 1000)
    with db() as conn:
        _require_family(conn, code)

        for rec in payload.records:
            rec_id = str(rec.get("id", "")).strip()
            if not rec_id:
                continue
            updated_at = int(rec.get("updatedAt") or 0)
            deleted = 1 if rec.get("deleted") else 0
            row = conn.execute(
                "SELECT updated_at FROM records WHERE family_code = ? AND id = ?",
                (code, rec_id),
            ).fetchone()
            if row is None or updated_at >= row["updated_at"]:
                conn.execute(
                    "INSERT OR REPLACE INTO records "
                    "(family_code, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?)",
                    (code, rec_id, json.dumps(rec, ensure_ascii=False), updated_at, deleted),
                )

        if payload.profile is not None:
            row = conn.execute(
                "SELECT updated_at FROM profiles WHERE family_code = ?", (code,)
            ).fetchone()
            if row is None or payload.profile_updated_at >= row["updated_at"]:
                conn.execute(
                    "INSERT OR REPLACE INTO profiles (family_code, data, updated_at) "
                    "VALUES (?, ?, ?)",
                    (code, json.dumps(payload.profile, ensure_ascii=False),
                     payload.profile_updated_at),
                )

        if payload.device_id:
            conn.execute(
                "INSERT OR REPLACE INTO devices (family_code, device_id, label, last_seen) "
                "VALUES (?, ?, ?, ?)",
                (code, payload.device_id, payload.device_label or "未知设备", now),
            )

        records = [
            json.loads(r["data"])
            for r in conn.execute(
                "SELECT data FROM records WHERE family_code = ? ORDER BY updated_at",
                (code,),
            )
        ]
        prof_row = conn.execute(
            "SELECT data, updated_at FROM profiles WHERE family_code = ?", (code,)
        ).fetchone()
        devices = [
            {"label": d["label"], "lastSeen": d["last_seen"]}
            for d in conn.execute(
                "SELECT label, last_seen FROM devices WHERE family_code = ? "
                "ORDER BY last_seen DESC LIMIT 10",
                (code,),
            )
        ]

    return {
        "records": records,
        "profile": json.loads(prof_row["data"]) if prof_row else None,
        "profileUpdatedAt": prof_row["updated_at"] if prof_row else 0,
        "devices": devices,
        "serverTime": now,
    }
