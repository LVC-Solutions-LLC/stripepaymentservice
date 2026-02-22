# Odoo 14 Replica Mapping

Source scanned: `/Users/gnanaprakash/my_project/IBO/ebo-odoo-addons`

## STO / Inbound

- Odoo: `ebo_inbound/controllers/controllers.py`
- Paths:
  - `/v1/sto/create`
  - `/v1/stn_posting`
  - `/v1/store_grn_posting`
  - `/v1/ian/node_transfer`
- Replica status:
  - Implemented: `sto/create`, `stn_posting`, `store_grn_posting`
  - Pending: `ian/node_transfer`

## Purchase

- Odoo: `bv_purchase_extension/controllers/controllers.py`
- Paths:
  - `/v1/vendor_pricelist_mrp_update`
  - `/v1/update_vendor_pricelist_mrp`
  - `/v1/purchase_state`
  - `/v1/po_lock_unlock`
  - `/v1/product_info`
- Replica status:
  - Implemented: `purchase_state`
  - Pending: all other purchase APIs

## Accounting

- Odoo: `bv_account_extension/controllers/main.py`
- Path:
  - `/v1/create_customer_invoice`
- Odoo: `bv_account_extension/controllers/payment_create_api.py`
- Path:
  - `/v1/create_payment`
- Replica status:
  - Implemented as async intake queue: `create_customer_invoice`, `create_payment`

## Related custom models (high priority)

- `sto.request`
- `sto.product.line`
- `purchase.order`
- `account.move`
- `account.payment`
- `api.log`
