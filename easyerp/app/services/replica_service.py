from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException

from app.db.client import DbClient


class ReplicaService:
    def queue_job(self, db: DbClient, job_type: str, payload: dict[str, Any]) -> int:
        if not db.table_exists("replica_integration_job"):
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS replica_integration_job (
                    id BIGSERIAL PRIMARY KEY,
                    job_type VARCHAR(64) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
                    payload JSONB NOT NULL,
                    error TEXT,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )

        job_id = db.safe_insert(
            "replica_integration_job",
            {
                "job_type": job_type,
                "status": "QUEUED",
                "payload": payload,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
        )
        return int(job_id)

    def get_warehouse_id(self, db: DbClient, code: str) -> int:
        row = db.fetch_one("SELECT id FROM stock_warehouse WHERE code = %s LIMIT 1", (code,))
        if not row:
            raise HTTPException(status_code=400, detail=f"Warehouse not found: {code}")
        return int(row["id"])

    def get_product_id(self, db: DbClient, sku: str) -> int:
        row = db.fetch_one("SELECT id FROM product_product WHERE default_code = %s LIMIT 1", (sku,))
        if not row:
            raise HTTPException(status_code=400, detail=f"Product not found: {sku}")
        return int(row["id"])

    def create_sto(self, db: DbClient, payload: dict[str, Any]) -> dict[str, Any]:
        if not db.table_exists("sto_request") or not db.table_exists("sto_product_line"):
            raise HTTPException(status_code=500, detail="Required STO tables are missing")

        existing = db.fetch_one(
            "SELECT id, name FROM sto_request WHERE reference_no = %s LIMIT 1",
            (payload["reference_no"],),
        )
        if existing:
            return {
                "message": f"STO {existing.get('name') or existing['id']} already exists",
                "sto_no": existing.get("name") or str(existing["id"]),
                "created": False,
            }

        store_warehouse_id = self.get_warehouse_id(db, payload["store_warehouse"])
        fulfillment_warehouse_id = self.get_warehouse_id(db, payload["fulfillment_warehouse"])

        sto_id = db.safe_insert(
            "sto_request",
            {
                "reference_no": payload["reference_no"],
                "store_warehouse": store_warehouse_id,
                "fulfillment_warehouse": fulfillment_warehouse_id,
                "sto_type": payload["sto_type"],
                "scheduled_date": payload["scheduled_date"],
                "state": "draft",
                "is_api_record": True,
                "create_date": datetime.utcnow(),
                "write_date": datetime.utcnow(),
            },
        )

        for line in payload["sto_lines"]:
            db.safe_insert(
                "sto_product_line",
                {
                    "sto_id": str(sto_id),
                    "product_id": self.get_product_id(db, line["offer_id"]),
                    "product_uom_qty": line["demand_qty"],
                    "state": "draft",
                    "create_date": datetime.utcnow(),
                    "write_date": datetime.utcnow(),
                },
            )

        return {
            "message": f"STO {sto_id} created successfully",
            "sto_no": str(sto_id),
            "created": True,
        }

    def post_stn(self, db: DbClient, payload: dict[str, Any]) -> dict[str, Any]:
        sto = db.fetch_one(
            "SELECT id, stn_number, state FROM sto_request WHERE name = %s OR id::text = %s LIMIT 1",
            (payload["sto_number"], payload["sto_number"]),
        )
        if not sto:
            raise HTTPException(status_code=404, detail="STO not found")

        stn_number = payload["stn_number"]
        prior = sto.get("stn_number")
        if prior and stn_number in str(prior).split(","):
            raise HTTPException(status_code=409, detail=f"STN already posted: {stn_number}")

        next_stn = f"{prior},{stn_number}" if prior else stn_number
        db.safe_update(
            "sto_request",
            {
                "stn_number": next_stn,
                "state": "in_transit",
                "shipment_date": payload.get("invoice_date") or datetime.utcnow(),
                "write_date": datetime.utcnow(),
            },
            "id = %s",
            (sto["id"],),
        )

        return {"message": "Transfer has been created", "sto_no": payload["sto_number"], "stn_number": stn_number}

    def post_grn(self, db: DbClient, payload: dict[str, Any]) -> dict[str, Any]:
        sto = db.fetch_one(
            "SELECT id, grn_number FROM sto_request WHERE name = %s OR id::text = %s LIMIT 1",
            (payload["sto_number"], payload["sto_number"]),
        )
        if not sto:
            raise HTTPException(status_code=404, detail="STO not found")

        batch_number = payload["batch_number"]
        prior = sto.get("grn_number")
        if prior and batch_number in str(prior).split(","):
            raise HTTPException(status_code=409, detail=f"GRN already posted: {batch_number}")

        next_grn = f"{prior},{batch_number}" if prior else batch_number
        db.safe_update(
            "sto_request",
            {
                "grn_number": next_grn,
                "grn_date": payload["grn_date"],
                "state": "done",
                "write_date": datetime.utcnow(),
            },
            "id = %s",
            (sto["id"],),
        )

        return {"message": "GRN posted successfully", "sto_no": payload["sto_number"], "batch_number": batch_number}

    def purchase_state(self, db: DbClient, po_numbers: list[str]) -> list[dict[str, Any]]:
        if not po_numbers:
            raise HTTPException(status_code=400, detail="po_numbers is required")

        results: list[dict[str, Any]] = []
        for po_number in po_numbers:
            row = db.fetch_one(
                """
                SELECT name, state, vendor_fulfillment_modes
                FROM purchase_order
                WHERE name = %s
                LIMIT 1
                """,
                (po_number,),
            )

            if not row:
                results.append(
                    {
                        "po_number": po_number,
                        "valid_po_status": False,
                        "message": f"Purchase Order not found in system for {po_number}",
                    }
                )
                continue

            is_valid = row["state"] == "purchase"
            results.append(
                {
                    "po_number": po_number,
                    "valid_po_status": is_valid,
                    "message": "PO status is valid GRN can be processed now"
                    if is_valid
                    else "PO status is not valid GRN cannot be processed now",
                }
            )
        return results
