import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage, type MarketingSection } from "@/components/marketing-page";
import { breadcrumbJsonLd, faqJsonLd, pageHead, type Faq } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-origin";

const PATH = "/mikrotik-hotspot-billing";

const sections: MarketingSection[] = [
  {
    heading: "Set up a router with one command",
    body: "Add the router in the console and copy the setup command it generates. Paste it into the MikroTik terminal and the router configures its network, DHCP, NAT and hotspot on its own. After that it reports in every minute, so you can see at a glance which sites are online.",
    points: [
      "Hotspot and PPPoE are configured by the same command",
      "Status, CPU, memory and uptime for every router",
    ],
  },
  {
    heading: "A captive portal with your brand",
    body: "Choose from 12 portal themes, then add your logo, brand colour and welcome text so customers land on a page that looks like your business.",
    points: [
      "Customers can buy a package, redeem a voucher, reconnect, or check the time they have left",
      "Smart TVs, which can't show a login page, are registered by their MAC address and connect after payment",
    ],
  },
  {
    heading: "Vouchers you can print",
    body: "Generate vouchers in batches for any package, print them for shops and resellers, and set when they expire. Vouchers and paid packages reach the router within about ten seconds, so customers aren't left waiting.",
    points: [
      "Limit how many devices one voucher works on",
      "Edit or delete vouchers whenever you need to",
    ],
  },
  {
    heading: "Packages by time and speed",
    body: "Sell by the minute, hour, day, week or month, with a download and an upload speed for each package.",
  },
];

const faqs: Faq[] = [
  {
    q: "Which routers does it work with?",
    a: "NetGrid is built for MikroTik routers running RouterOS. The setup command configures the router's network, DHCP, NAT and hotspot; you then switch on the Wi-Fi and name the network.",
  },
  {
    q: "How do customers pay for hotspot access?",
    a: "With M-Pesa. They pick a package on your portal, get a payment prompt on their phone, and are connected once the payment is confirmed. Customers who already have a voucher can redeem it instead.",
  },
  {
    q: "Can one voucher be shared between many devices?",
    a: "Only as many as you allow. Each package has a device limit that its vouchers follow.",
  },
  {
    q: "What does it cost?",
    a: "NetGrid charges a monthly commission on successful income: 2% of hotspot and voucher income. Your monthly invoice shows the breakdown.",
  },
];

export const Route = createFileRoute("/mikrotik-hotspot-billing")({
  head: () => {
    const origin = siteOrigin();
    return pageHead(PATH, origin, [
      breadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "Hotspot billing", path: PATH },
      ]),
      faqJsonLd(faqs),
    ]);
  },
  component: () => (
    <MarketingPage
      crumb="Hotspot billing"
      title="Hotspot billing for MikroTik routers"
      intro="Turn a MikroTik router into a paid Wi-Fi hotspot. Customers see a portal with your branding, pay with M-Pesa or enter a voucher, and get online. You see every router and every payment in one console."
      sections={sections}
      faqs={faqs}
      related={[
        {
          to: "/pppoe-billing",
          label: "PPPoE billing",
          blurb: "Monthly subscribers with a speed and an expiry.",
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
