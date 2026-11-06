import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TenantWhatsAppSupport() {
  const supportNumber = (import.meta.env.VITE_PLATFORM_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
  if (supportNumber.length < 8 || supportNumber.length > 15) return null;

  const message = encodeURIComponent("Hello NetGrid support, I need help with my tenant account.");

  return (
    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
      <a
        href={`https://wa.me/${supportNumber}?text=${message}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contact NetGrid support on WhatsApp"
      >
        <MessageCircle className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">WhatsApp support</span>
      </a>
    </Button>
  );
}