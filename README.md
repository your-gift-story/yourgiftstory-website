# Your Gift Story — Next.js

This is a Next.js (App Router) migration of the original static site. It's a
**faithful lift-and-shift**: the storefront, admin dashboard, and testimonial
form work exactly as they did before — same cart logic, same checkout flow,
same Supabase calls — now running inside a real Next.js project.

## Why "lift-and-shift" instead of a full rewrite

The original site's product grid, cart, checkout, and admin dashboard are
built with direct DOM manipulation (`document.getElementById`, `innerHTML`,
etc.) totalling ~2,700 lines across `main.js` and `admin.js`. Rewriting all
of that into React state/components is a substantial, multi-week undertaking
with real risk of introducing bugs in tested, working checkout logic.

Instead, this migration keeps `main.js`, `admin.js`, `testimonial.js`, and
`config.js` byte-for-byte identical to the working static version, and wires
them into proper Next.js routing, layouts, and SEO metadata. You get:

- A real Next.js project (`npm run dev`, `npm run build`) an agency can work with
- File-based routing (`/`, `/admin`, `/testimonial`) — no `vercel.json` rewrites needed
- Proper per-page SEO via the Next.js **Metadata API** (previously raw `<meta>` tags)
- Route-scoped CSS — admin styles never leak onto the public site, and vice versa
- The exact same tested cart/checkout/admin JavaScript, unchanged

A developer can now incrementally convert individual pieces (e.g. the cart)
into real React components over time, without a risky big-bang rewrite.

## Project structure

```
app/
├── layout.js              # Shared HTML shell, Google Fonts, loads config.js site-wide
├── page.js                 # Home route "/" — SEO metadata + JSON-LD + storefront markup
├── _index-body.html        # Storefront markup (product grid, cart, checkout — filled by main.js)
├── admin/
│   └── page.js              # "/admin" route
├── _admin-body.html        # Admin dashboard markup
├── testimonial/
│   └── page.js              # "/testimonial" route
├── _testimonial-body.html  # Testimonial form markup
└── styles/
    ├── main.css             # Storefront styles (scoped to "/")
    ├── admin.css            # Admin styles (scoped to "/admin")
    └── testimonial.css      # Testimonial page styles (scoped to "/testimonial")

public/js/
├── config.js    # ★ Supabase URL + anon key — the ONLY file with real keys
├── main.js      # Storefront logic (cart, checkout, products) — unchanged from static version
├── admin.js     # Admin dashboard logic — unchanged
└── testimonial.js
```

The `_*-body.html` files hold the markup that main.js/admin.js/testimonial.js
dynamically fill in (products, cart items, orders, etc.). They're loaded via
`fs.readFileSync` at build time and rendered with `dangerouslySetInnerHTML` —
this is why inline `onclick="..."` handlers referencing functions in
`main.js`/`admin.js` still work exactly as before.

## Changing keys / Supabase project

Edit **`public/js/config.js`** only — every page reads from
`window.APP_CONFIG`.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000, http://localhost:3000/admin, and
http://localhost:3000/testimonial.

## Build & deploy

```bash
npm run build   # verified clean — 0 errors, 0 warnings
npm run start   # runs the production build locally
```

**Deploying:** push to GitHub and import into [vercel.com](https://vercel.com) —
Vercel detects Next.js automatically, no config needed. Unlike the static
version, this now requires a host that runs Next.js builds (Vercel, Netlify,
or any Node.js host) rather than plain static file hosting.

## What changed vs. the static version

| | Static version | This version |
|---|---|---|
| Routing | `vercel.json` rewrites | Next.js file-based routing |
| SEO tags | Raw `<meta>` in each `.html` | Next.js Metadata API (`app/page.js` etc.) |
| Hosting | Any static host | Needs a Next.js/Node.js host |
| Cart/checkout/admin logic | Vanilla JS | **Identical**, unchanged |
| Supabase key location | `js/config.js` | `public/js/config.js` (same pattern) |
