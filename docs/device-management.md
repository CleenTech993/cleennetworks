# Multi-vendor device management

## Architecture

`routers.vendor` identifies the device vendor, while `device_family`, `firmware_version`, and
`controller_version` hold detected inventory details. Adapters report their implemented management
methods and capabilities; provisioning must not infer support from a vendor or model name alone.

The fallback policy is ordered per vendor and can be overridden per vendor/family in
`src/lib/device-management.ts`. A method is eligible only when it is officially supported,
implemented, and configured. Unsupported endpoints may fall through to the next eligible official
method; authentication failures and other fatal errors stop immediately. Transient network errors,
timeouts, 429 responses, and 5xx responses use bounded exponential retries with jitter and respect a
provided retry delay.

## Current coverage

- MikroTik: the existing outbound RouterOS agent provisions the router and reports health, interfaces,
  PPPoE, guest-voucher sync, device monitoring, and inventory monitoring. Heartbeats identify the
  RouterOS family and firmware. The RouterOS bootstrap endpoint rejects non-MikroTik records.
- TP-Link Omada: vendor inventory and a tenant/site-specific captive portal URL are available. A
  tenant admin can save encrypted hotspot-operator credentials and test HTTPS login for Controller
  5.0.15–6.2.0. The Controller hostname must resolve only to public IPv4 addresses with a trusted
  TLS certificate; private addresses and redirects are not used. The external portal preserves the
  documented EAP or Gateway client context through checkout and queues authorization only after
  payment is confirmed. Authorization requests use the package's remaining expiry in microseconds,
  the Controller CSRF token and session cookie, with bounded retries surfaced in the portal. The
  implementation logs in at `/api/v2/hotspot/login` and authorizes clients at
  `/api/v2/hotspot/extPortal/auth`; it accepts either documented session-cookie name.
  Discovery, Cloud API support, and versions outside that range remain unavailable.
- Ruijie/Reyee: vendor inventory is accepted, but provisioning remains `api_unavailable` until an
  official Cloud/local API adapter is implemented and configured.
- RouterOS REST and SSH are listed as possible official methods in the policy but are not yet
  implemented adapters. They are never selected automatically while `implemented` is false.

On-premise controllers and standalone devices require an outbound local connector before a cloud
deployment can reach private network interfaces. Do not expose controller, SSH, REST, or WebFig ports
to the public internet as a workaround.

## Online customers and PPPoE self-service

The tenant NOC lists live hotspot devices and PPPoE subscribers together. RouterOS reports active
PPPoE counters and hotspot active-session counters every minute; the platform derives upload and
download rates from successive samples. The dashboard excludes stale reports and clients attached
to offline routers. A router must have received the updated sync script and be online for fresh
measurements; rates are zero until two valid samples have arrived.

The public portal (`/p/<tenant-slug>`) includes a PPPoE account renewal option for existing
subscribers. The customer selects an active PPPoE package and enters the account username and its
registered phone number. After M-Pesa confirms payment, the package and expiry are applied to that
customer, and the router receives the change on its next sync (normally within five minutes).
This page is not automatically intercepted for a disconnected PPPoE line: provide a reachable
portal URL, such as a walled-garden exception or a separate connected device, so the customer can
open it to renew.

## Hotspot payment codes

New hotspot and phone-plus-TV purchases use the verified M-Pesa receipt as the hotspot username
and password. A receipt is enabled only after a successful, tenant-scoped payment with an unexpired
hotspot package; the reconnect endpoint binds one-device packages to the requesting MAC. Router
sync imports only successful, unexpired payment receipts. A successful STK status query without the
receipt does not grant access: the portal keeps waiting for the authenticated callback that carries
the receipt. Existing voucher redemption and router sync remain available for unexpired vouchers,
but voucher generation is disabled.

## RADIUS deployment plan and current stability status

The application does **not** currently run or configure a RADIUS server. MikroTik hotspot accounts
are managed locally by the RouterOS sync agent. The Omada captive-portal integration is also
separate from RADIUS/RadSec. Receipt-code authentication does not install RADIUS.

RADIUS should be a separate infrastructure project, not an untested change on live routers:

1. Inventory router models and RouterOS versions, access sites, peak concurrent sessions, and
   required availability. Decide the hosting location, data-retention policy, and recovery target.
2. Select a RADIUS implementation and deploy it privately (for example, FreeRADIUS with a
   supported SQL-backed entitlement/accounting store). Provide a private routed or VPN path from
   routers; do not expose unauthenticated RADIUS UDP ports to the public internet.
3. Configure each router as a scoped NAS with unique, protected shared secrets. Enable accounting
   and define how a confirmed payment receipt, expiry, device limit, and existing voucher are
   represented and revoked. Verify timeout and temporary-server-outage behavior before choosing a
   local fallback.
4. Pilot one non-critical router, compare authentication and accounting records with the current
   local-user path, test expiry/revocation and server failover, then roll out gradually with a
   tested rollback to local authentication.

The network-disconnect reports are not yet diagnosed or proven fixed by this change. Router
heartbeats provide periodic latency, loss, jitter, DNS, CPU, and memory signals; correlate those
with the router's active-session state and RouterOS logs at the time of a reported drop. A RADIUS
deployment can centralize authentication and accounting, but does not by itself repair WAN, Wi-Fi,
power, or router stability. Choose hosting and availability requirements before provisioning
servers or changing production router authentication.

## Omada RadSec

RadSec carries RADIUS traffic over TLS and is separate from the Omada external captive-portal API
described above. NetGrid's Omada integration does not configure a RADIUS server, RadSec profiles,
or certificates; these steps are performed in Omada Controller and on a RadSec-capable RADIUS
server.

1. Create a root CA, or use an existing CA whose private key is securely protected.
2. Issue a RADIUS server certificate and a client certificate from a CA trusted by the
   corresponding peer. Configure the server certificate on the RADIUS server. The client
   certificate is used by the access device to authenticate to the RADIUS server when client
   authentication is required.
3. In Omada Controller, import the CA certificate and client certificate into a Certificate Profile.
   Protect the client private key with a passphrase and enter that passphrase when importing it.
4. In the RADIUS Profile, enable RadSec and select the CA certificate used to validate the RADIUS
   server. Select a client certificate when the RADIUS server requires mutual TLS authentication;
   otherwise, follow the server's certificate-authentication requirements.
5. Verify that the RADIUS server trusts the client certificate's issuer when client authentication
   is enabled, and that Omada trusts the issuer of the server certificate.

Keep CA and private-key material protected; do not upload private CA keys to NetGrid or commit
certificates, keys, or passphrases to the repository. Follow the Omada Controller documentation for
the exact certificate formats and profile fields supported by the installed Controller version.

## Customer egress restrictions

The managed MikroTik sync installs forward-chain drops for customer traffic headed to the WAN on
common explicit SSH and VPN ports, plus GRE and IPsec ESP. The rules cover the managed hotspot
(`10.5.50.0/24`) and PPPoE (`10.10.0.0/24`) pools, and are refreshed with the router's normal sync.
This can block legitimate outbound SSH or VPN use on those protocols.

This is a baseline, not tunnel detection: it does not inspect encrypted HTTPS or block port 443,
custom tunnel ports, unrecognized protocols, or traffic through unmanaged routers. Customers can
also modify a router's local configuration. Do not treat these rules as proof that a session is
being used by only one person; retain per-account usage limits and device/tethering controls. For
stronger enforcement, use an explicit customer service allowlist and account for its compatibility
impact.

## Provisioning requirements

Each adapter must detect vendor, family, firmware, controller version, and available capabilities
before it offers setup. An operation should validate its proposed configuration, capture a backup
where the vendor supports it, apply an idempotent change, verify the result, and record an audit log.
Rollback is offered only where the vendor supports a verified rollback. Unsupported capabilities must
be shown explicitly and must not be emulated using undocumented endpoints or browser automation.
