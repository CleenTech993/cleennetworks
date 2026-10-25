import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PORTAL_THEMES, themeVars, type PortalThemeId } from "@/lib/portal-themes";

/**
 * Wraps content in a captive-portal theme. The theme is just CSS variables on this one element,
 * so everything inside (and nothing outside, which is what lets the settings page show several
 * themes next to the admin UI) is re-skinned.
 */
export function PortalThemeFrame({
  themeId, brand, className, children,
}: { themeId: PortalThemeId; brand: string | null | undefined; className?: string; children: ReactNode }) {
  const theme = PORTAL_THEMES[themeId];
  return (
    <div
      data-portal-theme={themeId}
      className={cn("portal-root bg-background text-foreground", theme.dark && "dark", className)}
      style={themeVars(themeId, brand) as CSSProperties}
    >
      {children}
    </div>
  );
}
