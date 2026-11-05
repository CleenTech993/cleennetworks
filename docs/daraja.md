# Tenant-owned M-Pesa payments and services

Customer checkouts use each tenant's own Safaricom Daraja account. Daraja is the only supported
payment provider.

## Tenant setup

As a tenant admin, open **Tenant Console → Notifications** and enter:

- Daraja environment (`sandbox` or `production`)
- Merchant type (`PayBill` or `Buy Goods (Till)`) and business shortcode
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
Notifications.

Incoming C2B callback URLs are registered with the Daraja C2B v2 RegisterURL endpoint. C2B v2 can
mask the payer's MSISDN in its callback; the app stores the phone as unavailable in that case and
does not use a partial number to suggest a PPPoE customer.

SMS uses the tenant's own Africa's Talking balance. If the username is `sandbox`, the app uses the
Africa's Talking sandbox endpoint.

## Platform commission

Customer payments settle directly to the tenant's shortcode. The super-admin console stores the
platform's receiving PayBill/Till shortcode under **Super Admin → Platform Payments**. A tenant sends
the commission due as a separate C2B transaction. **Platform commissions** creates a ledger entry
from successful payments; an admin records the M-Pesa receipt after independently confirming it.
This ledger does not initiate a deduction or move funds automatically.

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
