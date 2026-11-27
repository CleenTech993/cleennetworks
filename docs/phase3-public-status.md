# Public network status page

The public status page lets an ISP share a customer-facing view of aggregate network health:

1. Apply [`20261219000000_public_network_status.sql`](../supabase/migrations/20261219000000_public_network_status.sql).
2. Sign in as the tenant administrator and open **Settings**.
3. Enable **Public network status page** and share the displayed link: `/status/<tenant-slug>`.

The setting is off by default. The page reports operational only when every non-pending router has checked in within the last three minutes, degraded when some have checked in, outage when none have checked in, and unknown when no routers are enrolled. It refreshes automatically once per minute.

The unauthenticated endpoint returns only the ISP display name, aggregate status, and response timestamp. It does not expose router names, IDs, IPs, customer data, or fleet size. The endpoint is read-only, cached briefly, and rate-limited per client IP on each server instance.

This status signal reflects router check-ins, not end-to-end testing from a customer's device. A downstream ISP or access-point problem may not be reflected if the reporting router remains reachable.

The customer portal already has a PWA install prompt, and the tenant console already has a WhatsApp support link. These are existing foundations, not a full native customer app or automated WhatsApp assistant. Loyalty wallet and WhatsApp assistant work remain subsequent Phase 3 items.
