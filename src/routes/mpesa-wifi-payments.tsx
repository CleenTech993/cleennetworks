import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage, type MarketingSection } from "@/components/marketing-page";
import { breadcrumbJsonLd, faqJsonLd, pageHead, type Faq } from "@/lib/seo";

const PATH = "/mpesa-wifi-payments";

const sections: MarketingSection[] = [
  {
    heading: "An M-Pesa prompt at checkout",
    body: "Customers pick a package on your portal and enter their M-Pesa number. A payment prompt appears on their phone, they enter their PIN, and they're connected.",
  },
  {
    heading: "Confirmed before access is granted",
    body: "A payment notification is never taken at face value. NetGrid checks the payment's real status with the provider before activating a package, and applies each payment only once, even if the provider sends the same notification again.",
  },
  {
    heading: "Works with PayHero and IntaSend",
    body: "NetGrid connects to the PayHero and IntaSend payment gateways.",
  },
  {
    heading: "Every payment on record",
    body: "See each payment with its status, the package it bought and the customer's phone number, and keep track of revenue across your sites.",
  },
  {
    heading: "Reconnect without paying twice",
    body: "A customer who has already paid can reconnect with their phone number, and support staff can issue a reconnect voucher when something goes wrong.",
  },
];

const faqs: Faq[] = [
  {
    q: "Which payment gateways are supported?",
    a: "PayHero and IntaSend. Customers pay with M-Pesa through either one.",
  },
  {
    q: "What if a customer pays but doesn't get connected?",
    a: "They can use Reconnect on the portal with their phone number. You can also see the payment in your console and issue a reconnect voucher.",
  },
  {
    q: "Do customers need an app?",
    a: "No. They pay from your portal in their phone's browser and approve the M-Pesa prompt that appears on their phone.",
  },
];

export const Route = createFileRoute("/mpesa-wifi-payments")({
  head: () =>
    pageHead(PATH, [
      breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "M-Pesa payments", path: PATH },
      ]),
      faqJsonLd(faqs),
    ]),
  component: () => (
    <MarketingPage
      crumb="M-Pesa payments"
      title="Accept M-Pesa for Wi-Fi and internet packages"
      intro="Customers pay for internet from their phone and get online straight away. Each payment is confirmed with the payment provider before access is granted, and every payment is on record in your console."
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
