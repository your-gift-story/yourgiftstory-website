import fs from "node:fs";
import path from "node:path";
import Script from "next/script";
import "../styles/testimonial.css";

const bodyHtml = fs.readFileSync(
  path.join(process.cwd(), "app/_testimonial-body.html"),
  "utf8"
);

export const metadata = {
  title: "Share Your Story — Your Gift Story",
};

export default function TestimonialPage() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <Script src="/js/testimonial.js" strategy="afterInteractive" />
    </>
  );
}
