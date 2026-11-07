# Platform commission invoices

The platform calculates commission from successful tenant payments recorded in `payments`.
Approved direct C2B payments are included because they are recorded as successful payments too.
Hotspot and voucher package income is charged at 2%, and PPPoE package income at 1%. Each invoice
shows both income totals, both commission calculations, and the total due. Payments without a
matching tenant package are excluded because they cannot be reliably classified. Tracking begins
when the billing migration is first applied; older payment history is not billed retroactively.
Already-issued invoices keep their original amounts; the new rates apply to invoices generated
after the change.

After each month closes in the `Africa/Nairobi` time zone, the scheduled job creates one invoice
for each tenant with commission due. The due time is 72 hours after the invoice is generated.
Invoices appear in **Tenant Console → Platform invoices** and **Super Admin → Platform commissions**.
Tenants can print an invoice or save it as a PDF from the browser, then submit their M-Pesa
transaction code. A Super Admin enters the received code; the invoice is marked paid only if it
exactly matches the tenant-submitted code. This comparison does not independently verify the
transaction with Safaricom, so the admin must first confirm the payment against M-Pesa records.
Once all overdue invoices are settled, customer service is restored automatically; tenant admin
access remains available while service is paused.

## Required deployment configuration

Set these server-side environment variables in the application deployment:

- `CRON_SECRET`: a randomly generated, private token shared with the Supabase scheduled job.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`: the platform's SMTP relay and sender.
- `SMTP_USER` and `SMTP_PASS`: the SMTP credentials, if required by the relay.
- `SMTP_SECURE`: set to `true` when the relay requires implicit TLS. Port 465 also enables TLS.

The same SMTP settings are used to email new team members their sign-in details and temporary
password. Team account creation is rolled back if the credentials email cannot be sent.

For example, generate a token locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The migration does not install database extensions. If `pg_cron`, `pg_net`, and Supabase Vault are
already enabled, it schedules the protected application job every 15 minutes and reads its URL and
token from Vault. Store those values by running these statements in the Supabase SQL editor:

```sql
select vault.create_secret('https://<application-domain>', 'platform_billing_app_url');
select vault.create_secret('<same-value-as-CRON_SECRET>', 'platform_billing_cron_secret');
```

If one or more extensions are unavailable, the migration still creates the billing schema and
service restrictions, reports a notice, and skips database scheduling. In that case, configure an
external scheduler to send an HTTP `POST` to
`https://<application-domain>/api/cron/platform-billing` every 15 minutes. Set the request header
named `Authorization` to `Bearer` followed by the same secret configured as `CRON_SECRET`. Do not
put the cron secret in a URL or expose it in browser code. The endpoint creates monthly invoices,
refreshes overdue status, and delivers or retries invoice emails.

To rotate a Vault value, update the existing secret row by its id using
`vault.update_secret(<secret-id>, '<new-value>')`. External schedulers do not need Vault.

The recipient is the tenant's **Support / invoice email** in **Tenant Console → Settings**. Set the
platform's receiving PayBill/Till in **Super Admin → Platform Payments**; it is displayed to the
tenant with its invoice. Failed email delivery does not lose an invoice and is visible in both
billing pages; the job retries it.

Run `npm run db:verify-gen` and `npm run test:sql` after changing the migration.
