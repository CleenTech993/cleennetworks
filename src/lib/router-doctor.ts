// "Router doctor": one block of RouterOS that checks, in plain words, everything that has to be true
// for hotspot and PPPoE customers to connect, and prints OK / FAIL / WARN / INFO lines.
//
// It is read-only. It exists in two forms:
//   * pasted into a MikroTik terminal (copy button on the router page), which works even when the
//     router has stopped syncing, and
//   * installed on the router by the sync as the script "netgrid-doctor", so afterwards
//     /system script run netgrid-doctor  is all that is needed.
//
// Plain $ (not \$): inside a braced script source that is how RouterOS wants variables written.
// Strings avoid "[" so there is no doubt about command substitution inside quotes.

export const DOCTOR_VERSION = "v1";

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

/** The portal host goes into RouterOS code, so only a plain host name is ever accepted. */
export function safeHost(host: string | null | undefined): string | null {
  return host && host.length <= 253 && HOST.test(host) ? host.replace(/:\d+$/, "") : null;
}

export function doctorLines(portalHost?: string | null): string[] {
  const host = safeHost(portalHost);
  const L: string[] = [];
  const put = (s: string) => L.push(s);

  put(':put "=== NetGrid router doctor ==="');
  put(":local n 0");
  put(':local s ""');

  // 1. LAN: ports, address, DHCP
  put("");
  put(':put "--- Customer network ---"');
  put(":set n [:len [/interface bridge port find where bridge=netgrid-lan]]");
  put(':if ($n > 0) do={ :put ("OK    Ports in bridge netgrid-lan: " . $n) } else={ :put "FAIL  No ports in bridge netgrid-lan. Customers cannot reach the hotspot or PPPoE. Re-run the setup command from the dashboard." }');
  put(":set n [:len [/ip address find where interface=netgrid-lan]]");
  put(':if ($n > 0) do={ :put "OK    netgrid-lan has an IP address" } else={ :put "FAIL  netgrid-lan has no IP address (expected 10.5.50.1/24)" }');
  put(":set n [:len [/ip dhcp-server find where interface=netgrid-lan disabled=no]]");
  put(':if ($n > 0) do={ :put "OK    DHCP server is running on netgrid-lan" } else={ :put "FAIL  No DHCP server on netgrid-lan: phones will not get an address" }');

  // 2. Hotspot
  put("");
  put(':put "--- Hotspot ---"');
  put(":set n [:len [/ip hotspot find where name=netgrid-hs disabled=no]]");
  put(':if ($n > 0) do={ :put "OK    Hotspot server netgrid-hs exists and is enabled" } else={ :put "FAIL  Hotspot server netgrid-hs is missing or disabled. Vouchers cannot connect. Re-run the setup command." }');
  put(":do {");
  put("  :set s [/ip hotspot profile get [/ip hotspot profile find where name=netgrid-hsprof] login-by]");
  put('  :if ([:typeof [:find $s "http-pap"]] != "nil") do={ :put ("OK    Hotspot login methods: " . $s) } else={ :put ("FAIL  Hotspot login methods (" . $s . ") do not include http-pap. Voucher login by link will be refused.") }');
  put('} on-error={ :put "FAIL  Hotspot profile netgrid-hsprof is missing. Re-run the setup command." }');
  put(':set n [:len [/ip hotspot user profile find where name~"^netgrid-d"]]');
  put(':if ($n > 0) do={ :put ("OK    Voucher user profiles (netgrid-d*): " . $n) } else={ :put "WARN  No voucher user profiles yet. The sync creates them; run: /system script run netgrid-sync" }');
  put(':set n [:len [/ip hotspot user find where comment="netgrid-voucher"]]');
  put(':if ($n > 0) do={ :put ("OK    Voucher users on this router: " . $n) } else={ :put "WARN  No voucher users on this router. Vouchers reach the router with the sync (every 2 minutes). If this stays 0 after the sync, see the sync section below." }');
  put(':put ("INFO  Logged-in hotspot users: " . [:len [/ip hotspot active find]] . ", devices seen: " . [:len [/ip hotspot host find]])');
  put(":do {");
  put('  :local body [/file get [/file find where name="hotspot/login.html"] contents]');
  put('  :if ([:typeof [:find $body "netgrid:"]] != "nil") do={ :put "OK    Hotspot login page sends customers to the portal" } else={ :put "WARN  Hotspot login page is not the NetGrid redirect, so customers see MikroTik\'s own login page. The sync restores it." }');
  put('} on-error={ :put "WARN  hotspot/login.html not found. The sync installs it." }');
  put(":do {");
  put("  :local ip [:resolve hotspot.netgrid]");
  put('  :put ("OK    hotspot.netgrid resolves to " . $ip)');
  put('} on-error={ :put "FAIL  hotspot.netgrid does not resolve on the router. The hand-off to the hotspot login will fail." }');

  // 3. PPPoE
  put("");
  put(':put "--- PPPoE ---"');
  put(":set n [:len [/interface pppoe-server server find where service-name=netgrid disabled=no]]");
  put(':if ($n > 0) do={ :put "OK    PPPoE server netgrid is enabled" } else={ :put "FAIL  PPPoE server netgrid is missing or disabled. Re-run the setup command." }');
  put(':put ("INFO  PPPoE secrets from NetGrid: " . [:len [/ppp secret find where comment="netgrid"]] . ", connected now: " . [:len [/ppp active find]])');

  // 4. Internet
  put("");
  put(':put "--- Internet ---"');
  put(":local p [:ping 8.8.8.8 count=2]");
  put(':if ($p > 0) do={ :put "OK    Router reaches the internet (8.8.8.8)" } else={ :put "FAIL  Router cannot reach the internet (8.8.8.8). Check the cable on ether1 and the ISP link." }');
  put(':set n [:len [/ip firewall nat find where chain=srcnat action=masquerade comment~"netgrid"]]');
  put(':if ($n > 0) do={ :put "OK    Internet sharing (NAT) rules: present" } else={ :put "FAIL  No NetGrid NAT rule: customers cannot get online. Re-run the setup command." }');
  if (host) {
    put(":do {");
    put(`  :local ip [:resolve ${host}]`);
    put(`  :put ("OK    Portal ${host} resolves to " . $ip)`);
    put(`} on-error={ :put "FAIL  Router cannot resolve ${host}. The sync and the portal will not work." }`);
  }

  // 5. Sync
  put("");
  put(':put "--- Sync with the platform ---"');
  put(":do {");
  put("  :local id [/system scheduler find where name=netgrid-sync]");
  put('  :if ([:len $id] = 0) do={ :put "FAIL  Scheduler netgrid-sync is missing: this router never receives vouchers or PPPoE users. Re-run the setup command." } else={');
  put('    :put ("INFO  netgrid-sync runs every " . [/system scheduler get $id interval] . ", has run " . [/system scheduler get $id run-count] . " times, disabled=" . [/system scheduler get $id disabled])');
  put("  }");
  put("} on-error={}");
  put(":do {");
  put('  :local ids [/log find where message~"NetGrid"]');
  put("  :local c [:len $ids]");
  put("  :local i 0");
  put('  :if ($c = 0) do={ :put "WARN  No NetGrid lines in the log yet: the sync has not completed here. Run: /system script run netgrid-sync" }');
  put('  :if ($c > 0) do={ :put "Last NetGrid log lines:" }');
  put("  :foreach l in=$ids do={");
  put("    :set i ($i + 1)");
  put('    :if ($i > ($c - 8)) do={ :put ("  " . [/log get $l time] . " " . [/log get $l message]) }');
  put("  }");
  put("} on-error={}");

  // 6. Settings that commonly surprise people
  put("");
  put(':put "--- Settings that can block customers ---"');
  put(':if ([:len [/ip firewall mangle find where comment="netgrid-ttl-enforce"]] > 0) do={ :put "WARN  Anti-tethering is ON. Customers behind their own router, an access point in router mode, or sharing their phone hotspot will have NO internet. Turn it off on the router page in the dashboard if that is not intended." } else={ :put "OK    Anti-tethering is off" }');

  put("");
  put(':put "=== end of report ==="');
  return L;
}

/** For pasting into a terminal: one block, so the local variables live for the whole run. */
export function buildDoctorPaste(portalHost?: string | null): string {
  return ["{", ...doctorLines(portalHost), "}"].join("\n");
}

/** Lines for the router's sync script: (re)installs the script when missing or older than this version. */
export function buildDoctorInstallLines(portalHost?: string | null): string[] {
  return [
    ":do {",
    `  :if ([:len [/system script find where name=netgrid-doctor comment="${DOCTOR_VERSION}"]] = 0) do={`,
    "    :do { /system script remove [find where name=netgrid-doctor] } on-error={}",
    `    /system script add name=netgrid-doctor comment="${DOCTOR_VERSION}" source={`,
    ...doctorLines(portalHost).map((l) => `      ${l}`),
    "    }",
    "  }",
    '} on-error={ :log warning "NetGrid: could not install the router doctor script" }',
  ];
}
