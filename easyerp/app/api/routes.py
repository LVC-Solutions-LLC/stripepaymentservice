from fastapi import APIRouter, Depends

from app.api.schemas import (
    CreateInvoiceRequest,
    CreatePaymentRequest,
    GrnPostingRequest,
    PurchaseStateRequest,
    StnPostingRequest,
    StoCreateRequest,
)
from app.core.auth import validate_api_key
from app.db.client import DbClient
from app.services.replica_service import ReplicaService

router = APIRouter()
service = ReplicaService()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/v1/sto/create", dependencies=[Depends(validate_api_key)])
def create_sto(payload: StoCreateRequest) -> dict:
    with DbClient() as db:
        return service.create_sto(db, payload.model_dump())


@router.post("/v1/stn_posting", dependencies=[Depends(validate_api_key)])
def stn_posting(payload: StnPostingRequest) -> dict:
    with DbClient() as db:
        return service.post_stn(db, payload.model_dump())


@router.post("/v1/store_grn_posting", dependencies=[Depends(validate_api_key)])
def store_grn_posting(payload: GrnPostingRequest) -> dict:
    with DbClient() as db:
        return service.post_grn(db, payload.model_dump())


@router.post("/v1/purchase_state", dependencies=[Depends(validate_api_key)])
def purchase_state(payload: PurchaseStateRequest) -> list[dict]:
    with DbClient() as db:
        return service.purchase_state(db, payload.po_numbers)


@router.post("/v1/create_customer_invoice", dependencies=[Depends(validate_api_key)])
def create_customer_invoice(payload: CreateInvoiceRequest) -> dict:
    with DbClient() as db:
        job_id = service.queue_job(db, "create_customer_invoice", payload.model_dump())
        return {
            "code": "202",
            "message": "Invoice request queued for asynchronous processing",
            "job_id": job_id,
        }


@router.post("/v1/create_payment", dependencies=[Depends(validate_api_key)])
def create_payment(payload: CreatePaymentRequest) -> dict:
    with DbClient() as db:
        job_id = service.queue_job(db, "create_payment", payload.model_dump())
        return {
            "code": "202",
            "message": "Payment request queued for asynchronous processing",
            "job_id": job_id,
        }
