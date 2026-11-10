export type StaticIpCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  pppoe_username: string | null;
  status: string;
  static_ip: string | null;
};

export type StaticIpAssignment = {
  staticIp: string | null;
};

export function isIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

export function parseStaticIpAssignment(value: unknown): StaticIpAssignment | null {
  if (typeof value !== "object" || value === null || !("staticIp" in value)) return null;
  const staticIp = value.staticIp;
  if (staticIp !== null && (typeof staticIp !== "string" || !isIpv4(staticIp))) return null;
  return { staticIp };
}
