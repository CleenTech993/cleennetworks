# Tenant-owned M-Pesa payments and services

Customer checkouts use each tenant's own Safaricom Daraja account. Daraja is the only supported
payment provider.

## Tenant setup

As a tenant admin, open **Tenant Console → Notifications** and enter:

- Daraja environment (`sandbox` or `production`)
- Merchant type (`PayBill` or `Buy Goods (Till)`) and merchant shortcode
- For Buy Goods, the Lipa na M-Pesa Online shortcode associated with the STK passkey, if different from the Till
- Consumer key and consumer secret
- Lipa na M-Pesa passkey
- Africa's Talking username and API key for tenant-funded SMS (optional sender ID)

The server stores every submitted value encrypted with AES-256-GCM in
`tenant_service_secrets`. The encryption key is `PLATFORM_SECRETS_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`
as a fallback. Set a stable, dedicated `PLATFORM_SECRETS_KEY` in production and retain it across
deployments; rotating it requires tenants to enter their credentials again. Browser roles cannot read
the table, and the UI only receives configuration status and a shortcode suffix.

The app sends STK Push requests to the tenant's Daraja account and routes callbacks to
`https://<app-domain>/api/public/mpesa/callback/<tenant-id>`. The app uses that tenant's credentials to
query the STK request before issuing a voucher. Configure Daraja with the deployed HTTPS callback URL
if the Daraja app requires callback allowlisting.

PayBill checkouts use `CustomerPayBillOnline`; Buy Goods checkouts use `CustomerBuyGoodsOnline`.
Existing tenants default to PayBill until they select their merchant type in Tenant Console →
Notifications. For Buy Goods, `BusinessShortCode` and the STK password use the Lipa na M-Pesa Online
shortcode; `PartyB` uses the Till. `PartyA` and `PhoneNumber` both use the customer's normalized
MSISDN. If the STK shortcode and Till are the same, the separate STK shortcode field can be left
empty.

Incoming C2B callback URLs are registered with the Daraja C2B v2 RegisterURL endpoint. C2B v2 can
mask the payer's MSISDN in its callback; the app stores the phone as unavailable in that case and
does not use a partial number to suggest a PPPoE customer.

SMS uses the tenant's own Africa's Talking balance. If the username is `sandbox`, the app uses the
Africa's Talking sandbox endpoint.

## Platform commission

Customer payments settle directly to the tenant's shortcode. The super-admin console stores the
platform's receiving PayBill shortcode under **Super Admin → Platform Payments**. A tenant sends
the commission due as a separate C2B transaction, using the invoice-specific account reference
shown on the invoice. The platform C2B callback records each receipt and matches its account
reference and exact amount to an outstanding invoice; a match marks the invoice paid immediately.
Transactions with a missing reference, wrong amount, or an already-paid invoice remain in the
platform transaction ledger for review. The callback does not initiate a deduction or move funds.

Enter the public HTTPS application URL, Daraja environment (`sandbox` or `production`), and
consumer key/secret under **Super Admin → Platform Payments**. The server encrypts the saved values
with AES-256-GCM in `platform_service_secrets`; browser roles cannot read that table and full saved
credentials are never returned to the page. The encryption key is `PLATFORM_SECRETS_KEY`, or
`SUPABASE_SERVICE_ROLE_KEY` as a fallback. Set a stable, dedicated `PLATFORM_SECRETS_KEY` in
production and retain it across deployments; rotating it requires the platform credentials to be
entered again. The Daraja app credentials must have C2B URL registration enabled for the platform
PayBill.

The callback URL includes a random secret token and is stored in the platform C2B configuration.
Treat the callback URL as a secret. C2B invoice matching requires a
PayBill that supplies the account reference (`BillRefNumber`); Buy Goods Till transactions cannot
reliably identify an invoice by that field. Existing manual receipt confirmation remains available
for older invoices or transactions that need review.

## Business email

Tenant Console → Notifications displays an address based on the tenant slug when
`TENANT_EMAIL_DOMAIN` is configured. This is only an address alias: configure SMTP and domain routing
with the platform's email provider before using it. Monthly platform commission invoices are sent
to the tenant's configured support / invoice email using the platform SMTP relay. Configure the SMTP
environment variables and scheduled billing job described in [platform-billing.md](./platform-billing.md).
Supabase Auth email delivery remains configured separately in Supabase.

The Daraja-only migration marks any older non-Daraja payments still pending at cutover as failed.
Completed historical payments remain available for reporting; they cannot be processed through
their former provider.
