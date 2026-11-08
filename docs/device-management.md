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
