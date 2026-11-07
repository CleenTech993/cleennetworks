# Customer communications and maintenance

Tenant administrators manage customer notices from **Tenant Console → Communications**. They can
send a notice to every customer of their ISP or select one customer. Broadcast messages appear in
the signed-in customer inbox and on the captive portal. A message to one customer appears in the
inbox associated with that customer's registered email.

Platform administrators manage platform-wide notices from **Super Admin → Communications**. They
can also select a tenant to send a message to all of that tenant's customers or one customer.

Maintenance notices can end at a selected time or remain active until an administrator ends them.
Tenant administrators can target all sites or one router/site; platform administrators can target
the whole platform.

Maintenance modes:

- **Notice only** displays the notice without changing access.
- **Pause new connections** pauses portal checkout, voucher redemption and reconnect flows. Router
  sync also stops publishing unused vouchers and newly created PPPoE accounts while leaving existing
  managed access in place.
- **Pause all connections** pauses new access and removes managed PPPoE, hotspot voucher and TV
  access during router sync. Existing connections may take up to the router's next sync to be
  disconnected.

Site-specific captive portal notices use the router ID included by the provisioned router login
page. A portal opened directly without router context shows platform-wide and ISP-wide notices only.

When a customer reopens the captive portal, it checks the device's latest router report. After its
next regular sync installs the updated reporter, the router reports hotspot devices every minute.
If a fresh report shows the device disconnected and a valid voucher is saved in that portal session,
the portal logs the device back in automatically.
