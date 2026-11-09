import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage, type MarketingSection } from "@/components/marketing-page";
import { breadcrumbJsonLd, faqJsonLd, pageHead, type Faq } from "@/lib/seo";
import { siteOrigin } from "@/lib/site-origin";

const PATH = "/mpesa-wifi-payments";

const sections: MarketingSection[] = [
  {
    heading: "An M-Pesa prompt at checkout",
    body: "Customers pick a package on your portal and enter their M-Pesa number. A payment prompt appears on their phone, they enter their PIN, and they're connected.",
  },
  {
    heading: "Confirmed before access is granted",
    body: "A payment notification is never taken at face value. NetGrid asks Safaricom for the real status of each prompt before activating a package, and applies each payment only once, even if the same notification arrives again.",
  },
  {
    heading: "Your Paybill or Buy Goods number",
    body: "Customers pay through your own Daraja account, using either a Paybill or a Buy Goods (till) number.",
  },
  {
    heading: "Every payment on record",
    body: "Filter your payment history, export it to CSV, and see the package each payment bought. Payments customers make directly to your Paybill or till are recorded alongside the ones taken through the portal.",
  },
  {
    heading: "Reconnect without paying twice",
    body: "A customer who has already paid can reconnect with their phone number instead of paying again.",
  },
];

const faqs: Faq[] = [
  {
    q: "Which M-Pesa numbers can I use?",
    a: "Paybill and Buy Goods (till) numbers, through your own Daraja account.",
  },
  {
    q: "What if a customer pays but doesn't get connected?",
    a: "They can use Reconnect on the portal with their phone number. You can also find the payment in your payment history.",
  },
  {
    q: "Do customers need an app?",
    a: "No. They pay from your portal in their phone's browser and approve the M-Pesa prompt that appears on their phone.",
  },
  {
    q: "What does NetGrid charge?",
    a: "A monthly commission on successful income: 2% of hotspot and voucher income and 1% of PPPoE income. Your monthly invoice shows the breakdown.",
  },
];

export const Route = createFileRoute("/mpesa-wifi-payments")({
  head: () => {
    const origin = siteOrigin();
    return pageHead(PATH, origin, [
      breadcrumbJsonLd(origin, [
        { name: "Home", path: "/" },
        { name: "M-Pesa payments", path: PATH },
      ]),
      faqJsonLd(faqs),
    ]);
  },
  component: () => (
    <MarketingPage
      crumb="M-Pesa payments"
      title="Accept M-Pesa for Wi-Fi and internet packages"
      intro="Customers pay for internet from their phone and get online straight away. Each payment is confirmed with Safaricom before access is granted, and every payment is on record in your console."
      sections={sections}
      faqs={faqs}
      related={[
        {
          to: "/mikrotik-hotspot-billing",
          label: "Hotspot billing",
          blurb: "Sell Wi-Fi by the hour with a branded portal.",
        },
        {
          to: "/pppoe-billing",
          label: "PPPoE billing",
          blurb: "Monthly subscribers with a speed and an expiry.",
        },
      ]}
    />
  ),
});
