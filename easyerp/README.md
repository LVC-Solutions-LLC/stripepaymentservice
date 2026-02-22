# EasyERP Replica (Odoo 14 DB)

A fast API layer that reads/writes directly to the Odoo 14 PostgreSQL database and mirrors critical custom API paths from `ebo-odoo-addons`.

## Why this repo

Your current Odoo server handles full ORM + business logic in one process, which slows down heavy operations (purchase, accounting, GRN/STO APIs). This service separates API traffic from the Odoo worker process and supports async command processing for expensive accounting flows.

## Implemented Compatibility Endpoints

- `GET /health`
- `POST /v1/sto/create`
- `POST /v1/stn_posting`
- `POST /v1/store_grn_posting`
- `POST /v1/purchase_state`
- `POST /v1/create_customer_invoice` (queued)
- `POST /v1/create_payment` (queued)

## Notes

- `create_customer_invoice` and `create_payment` are intentionally queued in `replica_integration_job` for async processing, to avoid long synchronous latency.
- API key behavior is compatible via `Authorization` header.
- The service uses safe table/column introspection before writes so it can run across slightly different Odoo schemas.

## Local Run

1. Create `.env`:

```env
APP_NAME=EasyERP Replica
APP_ENV=dev
HOST=0.0.0.0
PORT=8090

DB_HOST=localhost
DB_PORT=5432
DB_NAME=<odoo_db_name>
DB_USER=odoo14_user
DB_PASSWORD=<db_password>

API_KEY=<same_key_used_by_external_callers>
```

2. Install and start:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --host 0.0.0.0 --port 8090 --reload
```

## Extract all Odoo custom routes

```bash
python3 scripts/extract_odoo_routes.py /Users/gnanaprakash/my_project/IBO/ebo-odoo-addons > docs/odoo_routes.json
```

## Next Work Items

- Build async workers for queued accounting jobs (`create_payment`, `create_customer_invoice`) with retry and DLQ.
- Add Redis cache for high-read endpoints (purchase status, product/warehouse lookups).
- Add idempotency keys and request hash to avoid duplicate external calls.
- Add parity tests against your production Odoo responses.
