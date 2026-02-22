from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class StoLine(BaseModel):
    offer_id: str
    demand_qty: int = Field(ge=1)


class StoCreateRequest(BaseModel):
    store_warehouse: str
    fulfillment_warehouse: str
    sto_type: str
    scheduled_date: datetime
    reference_no: str
    sto_lines: list[StoLine]


class StnProduct(BaseModel):
    offer_id: str
    quantity: int = Field(ge=1)


class StnPostingRequest(BaseModel):
    stn_type: str
    sto_number: str
    stn_number: str
    source_node: str
    source_location: str
    invoice_date: datetime | None = None
    products: list[StnProduct]


class GrnProduct(BaseModel):
    product_sku: str
    received_quantity: int = Field(ge=1)
    destination_location: str


class GrnPostingRequest(BaseModel):
    sto_number: str
    batch_number: str
    grn_date: datetime
    products: list[GrnProduct]


class PurchaseStateRequest(BaseModel):
    po_numbers: list[str]


class CreateInvoiceRequest(BaseModel):
    type: str
    order_number: str
    invoice_number: str
    invoice_line: list[dict]


class CreatePaymentRequest(BaseModel):
    payment_type: str
    customer_id: str
    psp_id: str
    payment_option_id: str
    amount: float | None = None
    reason_code: str | None = None
    payment_transaction_id: str | None = None
    order_number: str | None = None
    consignment_number: str | None = None
