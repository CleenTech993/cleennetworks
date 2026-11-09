import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage, type MarketingSection } from "@/components/marketing-page";
import { breadcrumbJsonLd, faqJsonLd, pageHead, type Faq } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-origin";

const PATH = "/pppoe-billing";

const sections: MarketingSection[] = [
  {
    heading: "One package, one speed",
    body: "Create PPPoE packages with a download and an upload speed, then put each client on a package. The router applies that speed profile to the client's connection.",
  },
  {
    heading: "Access follows the expiry date",
    body: "Set when each client's plan ends. When it expires, NetGrid stops provisioning the client and the router disconnects them at its next check-in, which runs every five minutes. Renew the client and their access comes back.",
  },
  {
    heading: "See where each client connects",
    body: "Every client shows the router they connect through, their MAC address, and whether that router is online, so a support call starts with the facts.",
    points: [
      "Usernames are unique, and each credential belongs to one router",
      "Add, edit and renew clients from the console",
    ],
  },
  {
    heading: "Hotspot and PPPoE together",
    body: "The same router setup command configures both, so you can sell Wi-Fi by the hour and monthly home internet from one network and one console.",
  },
];

const faqs: Faq[] = [
  {
    q: "Can I run PPPoE and hotspot on the same router?",
    a: "Yes. The setup command configures both, and you manage hotspot and PPPoE packages from the same console.",
  },
  {
    q: "How quickly do changes reach the router?",
    a: "Routers check in for PPPoE changes every five minutes, so a new client, a renewal or an expiry takes effect within about five minutes.",
  },
  {
    q: "What happens when a client's plan expires?",
    a: "NetGrid stops provisioning that client and the router disconnects them at the next check-in. Renewing the plan adds them back.",
  },
  {
    q: "What does it cost?",
    a: "NetGrid charges a monthly commission on successful income: 1% of PPPoE income. Your monthly invoice shows the breakdown.",
  },
];

export const Route = createFileRoute("/pppoe-billing")({
  head: () => {
    const origin = siteOrigin();
    return pageHead(PATH, origin, [
      breadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "PPPoE billing", path: PATH },
      ]),
      faqJsonLd(faqs),
    ]);
  },
  component: () => (
    <MarketingPage
      crumb="PPPoE billing"
      title="PPPoE billing for home and business internet"
      intro="Manage monthly subscribers on MikroTik with PPPoE. Every client has a package with a speed and an expiry date, and your routers are kept in step with your records automatically."
      sections={sections}
      faqs={faqs}
      related={[
        {
          to: "/mikrotik-hotspot-billing",
          label: "Hotspot billing",
          blurb: "Sell Wi-Fi by the hour with a branded portal.",
        },
        {
          to: "/mpesa-wifi-payments",
          label: "M-Pesa payments",
          blurb: "How customers pay and how payments are confirmed.",
        },
      ]}
    />
  ),
});
