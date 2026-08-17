import Script from "next/script";

export const metadata = {
  metadataBase: new URL("https://www.yourgiftstory.in"),
  verification: {
    google: "IP9ETeM7FINj1ju4X-nwBqOyGYrTQ7XBGlZbu36e1iM",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://supabase.co" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this IS the root layout, shared by every route, which is the correct place for a site-wide font link */}
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}

        {/*
          Shared Supabase config — loaded once, before any page script,
          on every route. This is the ONLY file with the Supabase URL
          and anon key (see /public/js/config.js). Every page script
          (main.js, admin.js, testimonial.js) reads from window.APP_CONFIG.
        */}
        <Script src="/js/config.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
