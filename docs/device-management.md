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
- TP-Link Omada: vendor inventory is accepted, but provisioning remains `api_unavailable` until an
  official Controller/Cloud API adapter is implemented and configured.
- Ruijie/Reyee: vendor inventory is accepted, but provisioning remains `api_unavailable` until an
  official Cloud/local API adapter is implemented and configured.
- RouterOS REST and SSH are listed as possible official methods in the policy but are not yet
  implemented adapters. They are never selected automatically while `implemented` is false.

On-premise controllers and standalone devices require an outbound local connector before a cloud
deployment can reach private network interfaces. Do not expose controller, SSH, REST, or WebFig ports
to the public internet as a workaround.

## Provisioning requirements

Each adapter must detect vendor, family, firmware, controller version, and available capabilities
before it offers setup. An operation should validate its proposed configuration, capture a backup
where the vendor supports it, apply an idempotent change, verify the result, and record an audit log.
Rollback is offered only where the vendor supports a verified rollback. Unsupported capabilities must
be shown explicitly and must not be emulated using undocumented endpoints or browser automation.