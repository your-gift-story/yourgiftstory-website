const SITE_URL = "https://www.yourgiftstory.in";

export default function sitemap() {
  return [
    {
      url: SITE_URL + "/",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: SITE_URL + "/testimonial",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    // /admin is intentionally excluded — see app/robots.js
  ];
}
