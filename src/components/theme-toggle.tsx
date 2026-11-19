import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { applyUserPreferences, useUserPreferences } from "@/hooks/use-user-preferences";
import type { UserPreferences } from "@/lib/tenant-customization";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const { preferences, savePreferences } = useUserPreferences();
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains("dark"));
    sync();
    window.addEventListener("netgrid:user-preferences-changed", sync);
    return () => window.removeEventListener("netgrid:user-preferences-changed", sync);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const updated: UserPreferences = { ...preferences, theme: next ? "dark" : "light" };
    applyUserPreferences(updated);
    void savePreferences(updated).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Could not save your theme preference."),
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className={className}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
