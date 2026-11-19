import { parseHotspotDestinationUrl } from "@/lib/hotspot-redirect";
import { normalizeMac } from "@/lib/tv";

export type OmadaPortalContext =
  | {
      kind: "eap";
      clientMac: string;
      apMac: string;
      ssidName: string;
      radioId: "0" | "1";
      siteName: string;
      redirectUrl: string | null;
    }
  | {
      kind: "gateway";
      clientMac: string;
      gatewayMac: string;
      vlanId: string;
      siteName: string;
      redirectUrl: string | null;
    };

export function readOmadaPortalContext(search: string): OmadaPortalContext | null {
  const query = new URLSearchParams(search);
  const clientMac = normalizeMac(query.get("clientMac") ?? "");
  const siteName = query.get("site")?.trim() ?? "";
  const redirectUrl = parseHotspotDestinationUrl(query.get("redirectUrl"));
  if (!clientMac || !siteName || siteName.length > 128) return null;

  const apMac = normalizeMac(query.get("apMac") ?? "");
  const gatewayMac = normalizeMac(query.get("gatewayMac") ?? "");
  if (apMac) {
    const ssidName = query.get("ssidName")?.trim() ?? "";
    const radioId = query.get("radioId");
    if (!ssidName || ssidName.length > 128 || (radioId !== "0" && radioId !== "1")) return null;
    return { kind: "eap", clientMac, apMac, ssidName, radioId, siteName, redirectUrl };
  }
  if (gatewayMac) {
    const vlanId = query.get("vid")?.trim() ?? "";
    if (!/^(?:0|[1-9]\d{0,3})$/.test(vlanId) || Number(vlanId) > 4094) return null;
    return { kind: "gateway", clientMac, gatewayMac, vlanId, siteName, redirectUrl };
  }
  return null;
}
