from __future__ import annotations

from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.core.config import settings


class DbClient:
    def __init__(self) -> None:
        self._conn: psycopg.Connection[Any] | None = None

    def __enter__(self) -> "DbClient":
        self._conn = psycopg.connect(settings.dsn, autocommit=False, row_factory=dict_row)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
        if not self._conn:
            return
        if exc:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._conn.close()

    @property
    def conn(self) -> psycopg.Connection[Any]:
        if not self._conn:
            raise RuntimeError("Database connection is not initialized")
        return self._conn

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchone()

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
            return rows or []

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with self.conn.cursor() as cur:
            cur.execute(query, params)

    def table_exists(self, table_name: str) -> bool:
        row = self.fetch_one(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = %s
            ) AS ok
            """,
            (table_name,),
        )
        return bool(row and row.get("ok"))

    def table_columns(self, table_name: str) -> set[str]:
        rows = self.fetch_all(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            """,
            (table_name,),
        )
        return {r["column_name"] for r in rows}

    def safe_insert(self, table_name: str, payload: dict[str, Any], returning: str = "id") -> Any:
        columns = self.table_columns(table_name)
        filtered = {k: v for k, v in payload.items() if k in columns}
        if not filtered:
            raise ValueError(f"No matching columns found for table '{table_name}'")

        column_identifiers = [sql.Identifier(k) for k in filtered.keys()]
        placeholders = [sql.Placeholder() for _ in filtered.keys()]
        query = sql.SQL("INSERT INTO {table} ({cols}) VALUES ({vals}) RETURNING {ret}").format(
            table=sql.Identifier(table_name),
            cols=sql.SQL(", ").join(column_identifiers),
            vals=sql.SQL(", ").join(placeholders),
            ret=sql.Identifier(returning),
        )

        with self.conn.cursor() as cur:
            cur.execute(query, tuple(filtered.values()))
            row = cur.fetchone()
            return row[returning] if row else None

    def safe_update(self, table_name: str, payload: dict[str, Any], where_clause: str, where_params: tuple[Any, ...]) -> int:
        columns = self.table_columns(table_name)
        filtered = {k: v for k, v in payload.items() if k in columns}
        if not filtered:
            return 0

        set_parts = []
        params: list[Any] = []
        for key, value in filtered.items():
            set_parts.append(sql.SQL("{} = %s").format(sql.Identifier(key)))
            params.append(value)

        query = sql.SQL("UPDATE {table} SET {sets} WHERE " + where_clause).format(
            table=sql.Identifier(table_name),
            sets=sql.SQL(", ").join(set_parts),
        )

        with self.conn.cursor() as cur:
            cur.execute(query, tuple(params) + where_params)
            return cur.rowcount
