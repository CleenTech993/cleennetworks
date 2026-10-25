import { Wifi } from "lucide-react";
import { safeImageUrl, type PortalThemeDef } from "@/lib/portal-themes";

interface HeaderProps {
  theme: PortalThemeDef;
  name: string;
  logoUrl: string | null | undefined;
  backgroundUrl: string | null | undefined;
  welcomeText: string | null | undefined;
  /** Brand fill colour (already adjusted for the theme). */
  accent: string;
}

/** Top of the captive portal. One variant per theme. */
export function PortalHeader({ theme, name, logoUrl, backgroundUrl, welcomeText, accent }: HeaderProps) {
  const logo = theme.usesImages ? safeImageUrl(logoUrl) : null;
  const photo = theme.usesImages ? safeImageUrl(backgroundUrl) : null;
  const welcome = welcomeText || "Choose a plan to get online.";

  const mark = (cls: string) =>
    logo ? (
      <img src={logo} alt={name} className={cls} />
    ) : (
      <div className={`grid place-items-center ${cls}`} style={{ backgroundColor: `${accent}22`, color: accent }}>
        <Wifi className="h-1/2 w-1/2" aria-hidden />
      </div>
    );

  switch (theme.header) {
    case "left":
      return (
        <header className="mx-auto max-w-md px-4 pb-6 pt-10">
          <div className="flex items-center gap-3">
            {mark("h-11 w-11 shrink-0 rounded-lg object-contain")}
            <h1 className="pt-heading text-2xl font-semibold tracking-tight">{name}</h1>
          </div>
          <p className="mt-3 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">{welcome}</p>
          <div className="mt-5 h-px w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
        </header>
      );

    case "block":
      return (
        <header className="mb-5 border-b-[3px] px-4 pb-7 pt-10" style={{ backgroundColor: accent, color: "var(--pt-on-accent)", borderColor: "var(--pt-ink)" }}>
          <div className="mx-auto max-w-md">
            <div className="flex items-center gap-3">
              {logo ? (
                <img src={logo} alt={name} className="h-12 w-12 shrink-0 border-2 bg-white object-contain p-1" style={{ borderColor: "var(--pt-ink)" }} />
              ) : null}
              <h1 className="pt-heading text-3xl font-extrabold leading-none tracking-tight">{name}</h1>
            </div>
            <p className="mt-3 max-w-[34ch] text-sm font-medium leading-relaxed">{welcome}</p>
          </div>
        </header>
      );

    case "photo":
      return (
        <header className="relative h-64 w-full overflow-hidden" style={{ backgroundColor: accent }}>
          {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="eager" />}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.12) 70%)" }} />
          <div className="relative mx-auto flex h-full max-w-md flex-col justify-end px-4 pb-10 text-white">
            {logo && <img src={logo} alt="" className="mb-3 h-10 w-10 rounded-md bg-white object-contain p-1" />}
            <h1 className="pt-heading text-3xl font-bold leading-tight">{name}</h1>
            <p className="mt-1 max-w-[34ch] text-sm leading-relaxed text-white/90">{welcome}</p>
          </div>
        </header>
      );

    case "plain":
      return (
        <header className="mx-auto max-w-md px-4 pb-4 pt-8">
          <h1 className="pt-heading text-xl font-bold">{name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{welcome}</p>
          <div className="mt-4 border-b-2 border-dotted" style={{ borderColor: "var(--foreground)" }} />
        </header>
      );

    case "centered":
    default:
      // Unchanged from before themes existed (Classic and Ticket).
      return (
        <header className="px-4 py-10" style={{ background: `linear-gradient(160deg, ${accent}22, transparent 60%)` }}>
          <div className="mx-auto max-w-md text-center">
            {mark("mx-auto h-12 w-12 rounded-md object-contain")}
            <h1 className={`mt-3 text-2xl font-bold ${theme.id === "ticket" ? "pt-heading" : ""}`}>{name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{welcome}</p>
          </div>
        </header>
      );
  }
}
