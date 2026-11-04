# Router troubleshooting (MikroTik)

Run these in a MikroTik terminal (WinBox → New Terminal, or SSH). Nothing here changes the router
unless it says so.

## 1. Is the router configured at all?

```
/interface bridge port print where bridge=netgrid-lan
/ip address print where comment=netgrid
/ip hotspot print
/interface pppoe-server server print
/ip dhcp-server print
/ip firewall nat print where comment~"netgrid"
```

- **No ports in `netgrid-lan`**: the setup script stopped before its last step. Customers cannot reach the
  hotspot or the PPPoE server. Re-run the setup command from the dashboard (Routers → the router → setup).
- Nothing at all: the setup command was never run on this router.

## 2. Is the router talking to the platform?

```
/system scheduler print where name~"netgrid"
/log print where message~"NetGrid"
/system script run netgrid-sync
/log print where message~"NetGrid"
```

You should see `NetGrid: users synced`. A line starting `NetGrid: ... sync skipped (database problem)`
means the platform could not read that part of its database; the router keeps what it already has.
Send that line to whoever runs the platform.

If the log shows `failure: ... 404` after `fetch`, the router's token is no longer valid. In the dashboard
open the router and generate a new setup command, then run it.

## 3. Hotspot

```
/ip hotspot user print count-only where comment="netgrid-voucher"
/ip hotspot user print where name="THECODE"
/ip hotspot active print
/ip hotspot host print
/ip hotspot profile print where name=netgrid-hsprof
/file print where name~"hotspot/login.html"
/ip dns static print where name~"hotspot"
```

- The voucher is missing from `hotspot user print`: it has not reached the router yet (the router learns
  about new vouchers every ~2 minutes). Run `/system script run netgrid-sync` and check again.
- The user's `mac-address` is not the customer's phone: the voucher is pinned to another device.
- `login.html` missing: the sync restores it on its next run (look for `hotspot login page restored`).

Watch a login attempt live:

```
/system logging add topics=hotspot,info,debug action=memory
/log print follow where topics~"hotspot"
```

(Remove it afterwards: `/system logging remove [find topics~"hotspot"]`.)

## 4. PPPoE

```
/ppp secret print count-only where comment="netgrid"
/ppp secret print where name="THEUSER"
/ppp active print
/interface pppoe-server server print
/log print where topics~"pppoe"
```

- The client is not in `ppp secret`: check it in the dashboard (active, not expired, assigned to this router
  or to "All routers") and run `/system script run netgrid-sync`.
- `ppp active` is empty but secrets exist: the customer's router/device is not reaching the server; check the
  bridge ports (section 1) and that the customer is on a port in `netgrid-lan`.

## 5. Internet from the router itself

```
/ping 8.8.8.8 count=3
/ping google.com count=3
/ip dhcp-client print
/ip route print where dst-address=0.0.0.0/0
```

If the first works and the second does not, DNS is the problem (`/ip dns print`).

## 6. Scripts written by the platform

```
/system script print where name~"netgrid"
/system script run netgrid-devices
/log print where topics~"script" and message~"error"
```

A script that was stored with `\$` in its body (older platform versions) fails with a syntax error here.
The next sync replaces it with a correct one.
