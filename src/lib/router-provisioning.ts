export function mikrotikProvisionCommand(base: string, token: string): string {
  return `/tool fetch url="${base}/api/public/provision/${token}/router.rsc" mode=https dst-path=auto-config.rsc; :delay 1s; /import file-name=auto-config.rsc`;
}
