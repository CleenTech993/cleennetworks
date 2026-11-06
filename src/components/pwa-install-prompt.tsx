import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISSED_UNTIL_KEY = "netgrid-pwa-prompt-dismissed-until";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

function isIosSafari(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function wasDismissedRecently(): boolean {
  try {
    const dismissedUntil = Number(localStorage.getItem(DISMISSED_UNTIL_KEY));
    return Number.isFinite(dismissedUntil) && dismissedUntil > Date.now();
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_FOR_MS));
  } catch {
    // The prompt can still be dismissed for this page session when storage is unavailable.
  }
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (
      window.location.pathname.startsWith("/p/") ||
      window.location.pathname.startsWith("/api/")
    ) {
      return;
    }

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js")
        .catch((error: unknown) =>
          console.error("Could not register the app service worker:", error),
        );
    }

    if (isStandalone()) return;

    const isIosDevice = isIosSafari();
    setIos(isIosDevice);
    if (wasDismissedRecently()) return;

    const timer = window.setTimeout(() => {
      if (isIosDevice) setVisible(true);
    }, 2500);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    const onAppInstalled = () => {
      setVisible(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    setInstalling(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      setVisible(false);
      if (choice.outcome === "dismissed") rememberDismissal();
    } catch (error) {
      console.error("Could not open the app install prompt:", error);
    } finally {
      setInstalling(false);
    }
  }

  function dismiss() {
    rememberDismissal();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      role="dialog"
      aria-labelledby="pwa-install-title"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md rounded-xl border bg-card p-4 text-card-foreground shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Download aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="pwa-install-title" className="font-semibold">
            Install NetGrid
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the web app to your home screen for quick access. NetGrid still runs online in your
            browser.
          </p>
          {ios && !installEvent && (
            <p className="mt-2 text-sm text-muted-foreground">
              In Safari, tap Share, then choose{" "}
              <span className="font-medium">Add to Home Screen</span>.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            {installEvent && (
              <Button size="sm" onClick={() => void install()} disabled={installing}>
                {installing ? "Opening…" : "Install app"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
