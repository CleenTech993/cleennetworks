import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PORTAL_THEMES, themeVars, safeImageUrl, type PortalThemeId } from "@/lib/portal-themes";

/**
 * Wraps content in a captive-portal theme. The theme sets CSS variables on this element,
 * and seamlessly applies custom uploaded background artwork.
 */
export function PortalThemeFrame({
  themeId,
  brand,
  backgroundUrl,
  className,
  children,
}: {
  themeId: PortalThemeId;
  brand: string | null | undefined;
  backgroundUrl?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const theme = PORTAL_THEMES[themeId];
  const safeBg = safeImageUrl(backgroundUrl);
  const customBgStyle: CSSProperties =
    safeBg && (themeId === "custom" || !theme.sheet)
      ? {
          backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.65)), url("${safeBg}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }
      : {};

  return (
    <div
      data-portal-theme={themeId}
      className={cn("portal-root bg-background text-foreground", theme.dark && "dark", className)}
      style={{ ...(themeVars(themeId, brand) as CSSProperties), ...customBgStyle }}
    >
      {children}
    </div>
  );
}
