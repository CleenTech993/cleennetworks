const INTERFACE_PUSH_URL =
  /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/api\/public\/router\/interfaces\/[A-Za-z0-9_-]+$/;

const INTERFACE_REPORT_SCRIPT = `
:local d ""
:foreach i in=[/interface find] do={
  :local x [/interface get $i];
  :set d ($d . ($x->"name") . "|" . ($x->"running") . "|" . ($x->"disabled") . "|" . ($x->"rx-byte") . "|" . ($x->"tx-byte") . "|" . ($x->"rx-error") . "|" . ($x->"tx-error") . "|" . ($x->"rx-drop") . "|" . ($x->"tx-drop") . ";")
}
:do { /tool fetch url="__URL__" http-method=post http-data=$d mode=https keep-result=no } on-error={ :log warning "NetGrid: interface push failed" }
`;

export function buildInterfaceAgentLines(pushUrl: string): string[] {
  if (!INTERFACE_PUSH_URL.test(pushUrl)) return [];
  const source = INTERFACE_REPORT_SCRIPT.split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .replace("__URL__", pushUrl);
  return [
    "/system script",
    ":do { remove [find where name=netgrid-ifaces] } on-error={}",
    `:do { add name=netgrid-ifaces source={${source}} } on-error={}`,
    ':do { :if ([:len [/system scheduler find where name=netgrid-ifaces]] = 0) do={ /system scheduler add name=netgrid-ifaces interval=1m on-event="/system script run netgrid-ifaces" } else={ /system scheduler set [find where name=netgrid-ifaces] interval=1m } } on-error={}',
  ];
}
