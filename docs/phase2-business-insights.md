# Phase 2 business insights

The tenant console's **Business insights** page is available to tenant admins and billing agents.
Its SQL objects are in [`20261218000000_phase2_isp_analytics.sql`](../supabase/migrations/20261218000000_phase2_isp_analytics.sql).

## What the estimates mean

- **Collected revenue** counts successful payment records only. Pending, failed, and cancelled attempts are excluded. Monthly buckets use UTC.
- **Next 90-day outlook** adds revenue from the previous three complete calendar months. This is a simple run-rate estimate, not a guarantee or a seasonally adjusted forecast. It is unavailable until at least one of those months has recorded revenue.
- **Net estimate** subtracts manually recorded operating costs from successful payments. Add recurring costs and one-off costs in the same currency units used by the tenant's payment records. It is not a full accounting statement and does not infer unentered costs, taxes, or liabilities.
- **Retention signals** use active customer records: no activity for at least 14 days, service expiry within 7 days, and failed/cancelled payment attempts in the last 30 days. The reasons are shown with each signal; they are prompts for staff review, not a prediction that a customer will leave.
- **Package fit** flags active customers at or above 80% of a measured data allowance, and suggests an active package of the same service type with a larger allowance and a price at least as high as the current package. Router usage counters can be delayed; staff should verify the customer's current plan period before contacting them.

## Tenant isolation

Operating costs are protected by row-level security and MFA. Only tenant admins and billing agents can read or change their tenant's cost entries. Revenue and failed-payment summaries use invoker-rights database functions, so the existing payment-table policies continue to enforce tenant and role boundaries. The insights are computed locally from application data; customer details are not sent to an AI service.

Apply the Phase 2 migration after the existing migrations. In a development environment with Bash and PostgreSQL available, regenerate the live-database verifier and run the SQL suite:

```sh
npm run db:verify-gen
npm run test:sql
```
