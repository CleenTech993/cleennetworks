import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PORTAL_THEMES, portalAccent, type PortalThemeId } from "@/lib/portal-themes";
import { PortalHeader } from "./header";
import { PlanOption, type PortalPlan } from "./plan-option";
import { PortalThemeFrame } from "./theme-frame";

const SAMPLE_PLANS: PortalPlan[] = [
  { id: "a", name: "Quick browse", price: 10, duration_value: 30, duration_unit: "minutes", download_kbps: 2000 },
  { id: "b", name: "Evening", price: 30, duration_value: 3, duration_unit: "hours", download_kbps: 5000 },
  { id: "c", name: "Full day", price: 100, duration_value: 1, duration_unit: "days", download_kbps: 10000 },
];

export interface PortalPreviewProps {
  themeId: PortalThemeId;
  brand: string;
  name: string;
  logoUrl?: string | null;
  backgroundUrl?: string | null;
  welcomeText?: string | null;
}

/**
 * The real portal chrome (same header, plan list, tabs, inputs and buttons the customer sees)
 * filled with sample plans, so what the ISP previews is what their customers get.
 */
export function PortalPreview({ themeId, brand, name, logoUrl, backgroundUrl, welcomeText }: PortalPreviewProps) {
  const theme = PORTAL_THEMES[themeId];
  const accent = portalAccent(themeId, brand);
  const [picked, setPicked] = useState("b");

  return (
    <PortalThemeFrame themeId={themeId} brand={brand} className="min-h-full">
      <PortalHeader
        theme={theme}
        name={name}
        logoUrl={logoUrl}
        backgroundUrl={backgroundUrl}
        welcomeText={welcomeText || "Connect to Wi-Fi — buy, reconnect, or redeem a voucher."}
        accent={accent}
      />
      <div className={theme.sheet ? "pt-sheet pt-6" : undefined}>
        <div className="mx-auto max-w-md px-4 pb-10">
          <Tabs defaultValue="buy">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="buy">Buy</TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="reconnect">Reconnect</TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="status">Status</TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="voucher">Voucher</TabsTrigger>
              <TabsTrigger className="px-1 text-xs sm:text-sm" value="tv">TV</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="mt-4 space-y-2">
            {SAMPLE_PLANS.map((p) => (
              <PlanOption key={p.id} theme={theme} plan={p} selected={picked === p.id} onSelect={() => setPicked(p.id)} accent={accent} />
            ))}
          </div>
          <div className="mt-5">
            <Label htmlFor={`pv-phone-${themeId}`}>M-Pesa phone</Label>
            <Input id={`pv-phone-${themeId}`} inputMode="tel" placeholder="07XXXXXXXX" className="mt-1" readOnly />
          </div>
          <Button type="button" className="pt-btn mt-4 w-full" style={{ backgroundColor: accent }}>Pay with M-Pesa</Button>
        </div>
      </div>
    </PortalThemeFrame>
  );
}
