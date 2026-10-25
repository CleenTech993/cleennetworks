# IntaSend payments

The platform can collect M-Pesa payments through **IntaSend** (the default) or **PayHero**. A super admin
picks the active gateway on **Super admin → Platform Payments**. Switching is safe: every payment
remembers the gateway that created it, and its webhook / status check goes to that same gateway.

**Default and fallback.** Unless PayHero is explicitly selected, checkouts use IntaSend. If the selected
gateway has no server secrets yet but the other one does, checkouts use the other one (and the server
logs a warning) instead of failing, so it is safe to deploy before the IntaSend keys are added; IntaSend
takes over automatically once `INTASEND_SECRET_KEY` is set. Checkouts only fail when neither gateway is
configured. The Platform Payments page shows which gateway is really in use right now.

## Setup

1. Create an IntaSend account. Sandbox: <https://sandbox.intasend.com>, live: <https://payment.intasend.com>.
2. Add two **server secrets** (never in the database or the browser):

   | Secret | Value |
   |---|---|
   | `INTASEND_SECRET_KEY` | `ISSecretKey_test_…` to try it, `ISSecretKey_live_…` to go live. The key picks the environment. |
   | `INTASEND_WEBHOOK_CHALLENGE` | any long random string you make up |

   Optional: `INTASEND_BASE_URL` (defaults to `https://api.intasend.com`).
3. In the IntaSend dashboard: **Settings → Webhooks → New**
   - Endpoint: `https://<your-domain>/api/public/intasend/webhook` (the page shows the exact URL; it must be HTTPS, also in sandbox)
   - Challenge: the same string as `INTASEND_WEBHOOK_CHALLENGE`
   - Events: `collection_event`
4. Apply migrations `20261026000000_payment_provider.sql` and `20261027000000_default_intasend.sql`.
5. IntaSend is already the default; the Platform Payments page shows whether the secret, key mode (sandbox/live) and challenge are set, and which gateway is in use. (Migration `20261027000000_default_intasend.sql` switches the existing setting.) To go back, choose PayHero there and save.

## How a payment flows

1. The portal (or a staff member) starts a payment. We insert a `pending` payment and send IntaSend an STK push with `api_ref = <payment id>`. The returned `invoice_id` is stored as the payment's `merchant_request_id`.
2. The customer enters their PIN. IntaSend posts a `collection_event` webhook.
3. The webhook body is **not trusted**. Its challenge must match, and then it only tells us which payment to look at: we call IntaSend's status API for that invoice and require
   state `COMPLETE`, `api_ref` = our payment id, the invoice id we stored, currency KES, and an amount at least the package price.
4. Only then is the payment claimed atomically, the voucher issued and the receipt stored. Replays and parallel events cannot issue a second voucher.
5. If a webhook is missed, the portal's status poll asks IntaSend itself (at most once per 8 s per payment), so the customer still gets their voucher.

Failed or cancelled invoices are recorded as `failed`; a later successful retry of the same payment is still honoured.

## Money flow

Collections land in the platform's IntaSend wallet, exactly as PayHero collections do, and tenants are settled from there. IntaSend also supports collecting straight into a merchant's own till or paybill; that is not wired up here.

## Testing in sandbox

Sandbox STK pushes go to a real Safaricom number you own and the test amount is reversed within 48 hours. Use a low-priced package, pay once, then check that the payment shows `success`, a voucher exists, and replaying the webhook from the IntaSend dashboard does not create a second voucher.
