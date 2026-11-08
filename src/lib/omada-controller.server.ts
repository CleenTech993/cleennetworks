import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { request } from "node:https";

const SUPPORTED_MINIMUM = [5, 0, 15];
const SUPPORTED_MAXIMUM = [6, 2, 0];

export type OmadaControllerTarget = {
  host: string;
  port: number;
  controllerId: string;
};

function versionParts(version: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Enter a controller version in major.minor.patch format.");
  }
  return version.split(".").map(Number);
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

export function assertSupportedOmadaVersion(version: string): void {
  const parsed = versionParts(version);
  if (
    compareVersions(parsed, SUPPORTED_MINIMUM) < 0 ||
    compareVersions(parsed, SUPPORTED_MAXIMUM) > 0
  ) {
    throw new Error(
      "This integration supports Omada Controller versions 5.0.15 through 6.2.0 only.",
    );
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
  );
}

async function resolvePublicControllerAddress(
  host: string,
): Promise<{ address: string; hostname: string }> {
  const normalizedHost = domainToASCII(host.trim().replace(/\.$/, "").toLowerCase());
  if (
    !normalizedHost ||
    normalizedHost.length > 253 ||
    isIP(normalizedHost) !== 0 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizedHost)
  ) {
    throw new Error("Use a public HTTPS controller hostname, not a local or IP address.");
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(normalizedHost, { all: true, family: 4, verbatim: true });
  } catch {
    throw new Error("The controller hostname could not be resolved.");
  }
  const usableAddresses = addresses.filter(({ address }) => isPublicIpv4(address));
  if (!usableAddresses.length || usableAddresses.length !== addresses.length) {
    throw new Error("The controller hostname must resolve only to public IPv4 addresses.");
  }
  return { address: usableAddresses[0]!.address, hostname: normalizedHost };
}

async function postJson(
  target: OmadaControllerTarget,
  address: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<{ body: Record<string, unknown>; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      {
        hostname: address,
        servername: target.host,
        port: target.port,
        path,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          host: `${target.host}:${target.port}`,
          ...headers,
        },
        rejectUnauthorized: true,
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        res.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 32_768) {
            req.destroy(new Error("Controller response exceeded the size limit."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error("The Omada Controller rejected the API request."));
            return;
          }
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
          } catch {
            reject(new Error("The Omada Controller returned an invalid response."));
            return;
          }
          resolve({ body: parsed, cookies: res.headers["set-cookie"] ?? [] });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Controller connection timed out.")));
    req.on("error", () =>
      reject(new Error("Could not establish a trusted HTTPS connection to the controller.")),
    );
    req.end(body);
  });
}

export async function testOmadaControllerLogin(
  target: OmadaControllerTarget,
  credentials: { username: string; password: string },
): Promise<void> {
  const { address, hostname } = await resolvePublicControllerAddress(target.host);
  const normalizedTarget = { ...target, host: hostname };
  const { body, cookies } = await postJson(
    normalizedTarget,
    address,
    `/${normalizedTarget.controllerId}/api/v2/hotspot/login`,
    { name: credentials.username, password: credentials.password },
  );
  const result = body.result;
  const token =
    result && typeof result === "object" && "token" in result
      ? (result as { token?: unknown }).token
      : undefined;
  const cookieNames = cookies.map((cookie) => cookie.split("=", 1)[0]);
  if (
    body.errorCode !== 0 ||
    typeof token !== "string" ||
    !cookieNames.some((name) => name === "TPEAP_SESSIONID" || name === "TPOMADA_SESSIONID")
  ) {
    throw new Error(
      "Omada login failed. Check the controller ID and dedicated hotspot operator credentials.",
    );
  }
}
