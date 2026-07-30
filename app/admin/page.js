import fs from "node:fs";
import path from "node:path";
import Script from "next/script";
import "../styles/admin.css";

const bodyHtml = fs.readFileSync(
  path.join(process.cwd(), "app/_admin-body.html"),
  "utf8"
);

export const metadata = {
  title: "Your Gift Story — Admin",
  robots: "noindex, nofollow",
};

export default function AdminPage() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <Script src="/js/admin.js" strategy="afterInteractive" />
    </>
  );
}
