import fs from "node:fs";
import path from "node:path";
import Script from "next/script";
import "./styles/main.css";

// The storefront markup below (product grid, cart, checkout, testimonial
// carousel, etc.) is filled in dynamically by /public/js/main.js from
// Supabase, exactly as it was on the static site — so it's kept as one
// HTML file and injected as-is rather than hand-converted line by line
// into JSX, which would only add risk without changing behaviour.
const bodyHtml = fs.readFileSync(
  path.join(process.cwd(), "app/_index-body.html"),
  "utf8"
);

const SITE_URL = "https://your-gift-story-website.vercel.app";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1F4E4A",
};

export const metadata = {
  title:
    "Your Gift Story | Handmade & Personalised Gifts in Coimbatore, Tamil Nadu – Pan India Delivery",
  description:
    "Your Gift Story — Coimbatore's handmade gift brand. Shop personalised resin art, custom photo gifts, embroidery keepsakes & gift hampers in Tamil Nadu and across India. 100% handcrafted, fully customisable, delivered pan India. Order online or on WhatsApp.",
  keywords:
    "handmade gifts coimbatore, personalised gifts coimbatore, custom gifts coimbatore, handmade gifts tamil nadu, personalised gifts tamil nadu, resin art gifts coimbatore, gift hampers coimbatore, customised gifts coimbatore, handmade gifts india, personalised gifts online india, custom gifts india, anniversary gifts tamil nadu, birthday gifts coimbatore, wedding gifts tamil nadu, corporate gifts coimbatore, handcrafted gifts india",
  robots:
    "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
  authors: [{ name: "Your Gift Story" }],
  alternates: { canonical: SITE_URL + "/" },
  openGraph: {
    type: "website",
    siteName: "Your Gift Story",
    title:
      "Your Gift Story | Handmade & Personalised Gifts in Coimbatore, Tamil Nadu – Pan India Delivery",
    description:
      "Coimbatore's handmade gift brand — personalised gifts for every occasion. Resin art, photo gifts, embroidery, hampers & more. Based in Tamil Nadu, delivered across India. Order online or on WhatsApp.",
    url: SITE_URL + "/",
    images: [
      {
        url: SITE_URL + "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Your Gift Story — Handmade Personalised Gifts India",
      },
    ],
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your Gift Story | Handmade & Personalised Gifts India",
    description:
      "Coimbatore's handmade gift brand — personalised resin art, photo gifts, embroidery & hampers. Based in Tamil Nadu, delivered pan India.",
    images: [SITE_URL + "/og-image.jpg"],
  },
  other: {
    "geo.region": "IN-TN",
    "geo.placename": "Coimbatore, Tamil Nadu, India",
    "geo.position": "11.0168;76.9558",
    ICBM: "11.0168, 76.9558",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["LocalBusiness", "Store", "OnlineBusiness"],
      "@id": SITE_URL + "/#business",
      name: "Your Gift Story",
      description:
        "Coimbatore-based handmade gift brand offering fully customisable gifts for every occasion — birthdays, anniversaries, weddings, baby showers, festivals and corporate gifting. Based in Tamil Nadu, delivered pan India.",
      url: SITE_URL + "/",
      logo: SITE_URL + "/logo.png",
      image: SITE_URL + "/og-image.jpg",
      telephone: "+919025305650",
      email: "contact.yourgiftstory@gmail.com",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Coimbatore",
        addressRegion: "Tamil Nadu",
        addressCountry: "IN",
      },
      geo: { "@type": "GeoCoordinates", latitude: 11.0168, longitude: 76.9558 },
      areaServed: [
        {
          "@type": "State",
          name: "Tamil Nadu",
          containedInPlace: { "@type": "Country", name: "India" },
        },
        { "@type": "Country", name: "India" },
      ],
      sameAs: ["https://www.instagram.com/your.giftstory/"],
      priceRange: "₹80 - ₹6399",
      currenciesAccepted: "INR",
      paymentAccepted: "UPI, Bank Transfer, WhatsApp Pay",
      openingHours: "Mo-Su 09:00-21:00",
    },
    {
      "@type": "WebSite",
      "@id": SITE_URL + "/#website",
      url: SITE_URL + "/",
      name: "Your Gift Story",
      description: "Handmade & Personalised Gifts Online India",
      inLanguage: "en-IN",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: SITE_URL + "/?search={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <Script src="/js/main.js" strategy="afterInteractive" />
    </>
  );
}
