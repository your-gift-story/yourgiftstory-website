/* ═══════════════════════════════════════
   SUPABASE CONFIG
═══════════════════════════════════════ */
const _SB = {
  u: APP_CONFIG.SUPABASE_URL,
  k: APP_CONFIG.SUPABASE_ANON_KEY
};

/* ═══════════════════════════════════════
   SAFE TEXT HELPER
   Escapes customer-typed text (testimonials,
   cart customisation notes, etc.) before it
   is inserted into the page, so it always
   displays as plain text and can never run
   as code.
═══════════════════════════════════════ */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════
   IMAGE URL HELPER
   Uses Supabase's built-in transform API to
   serve resized/compressed images on the fly.
   width=600 covers all card sizes; quality=70
   keeps it sharp while cutting file size ~85%
═══════════════════════════════════════ */
// Cache map: productId → exact img src string already loaded in browser
const _imgCache = {};

function imgUrl(src, width, quality) {
  if (!src) return src;
  width   = width   || 600;
  quality = quality || 70;
  // Only transform Supabase Storage URLs
  if (src.indexOf('supabase.co/storage') === -1) return src;
  // Append transform params (Supabase renders via /render/image/public/)
  var base = src.replace('/object/public/', '/render/image/public/');
  var sep  = base.indexOf('?') > -1 ? '&' : '?';
  return base + sep + 'width=' + width + '&quality=' + quality + '&resize=contain';
}

async function sbGet(table, qs) {
  let url = _SB.u + '/rest/v1/' + table;
  if (qs) url += '?' + qs;
  const res = await fetch(url, {
    headers: {
      'apikey': _SB.k,
      'Authorization': 'Bearer ' + _SB.k,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error('Supabase error ' + res.status + ': ' + await res.text());
  return res.json();
}

/* ═══════════════════════════════════════
   APP STATE
═══════════════════════════════════════ */
let ALL_PRODUCTS = [];
let ALL_CATEGORIES = [];
let ALL_TESTIMONIALS = [];
let cart = [];
let currentPage = 'home';
let activeCategory = 'all';
let spCur = 0, spTimer = null;
let WHATSAPP_NUMBER = '919876543210'; // fallback, overridden by site settings

/* ═══════════════════════════════════════
   INIT — All fetches run in PARALLEL
   Images start loading while loader plays
═══════════════════════════════════════ */
async function initSite() {
  const bar = document.getElementById('loaderBar');
  const setBar = (pct) => { if (bar) bar.style.width = pct + '%'; };

  setBar(15);
  const barAnim = setTimeout(() => setBar(60), 300);

  // Fire all 6 Supabase requests at the same time
  const [rawProducts, optGroups, optValues, pQuestions, cats, testimonials, settings] = await Promise.all([
    sbGet('products',              'is_active=eq.true&order=created_at.desc').catch(e => { console.error('Products:', e.message); return []; }),
    sbGet('product_option_groups', 'order=display_order.asc').catch(() => []),
    sbGet('product_option_values', 'order=display_order.asc').catch(() => []),
    sbGet('product_questions',     'order=product_id.asc,display_order.asc').catch(() => []),
    sbGet('categories',            'is_active=eq.true&order=display_order.asc').catch(e => { console.error('Categories:', e.message); return []; }),
    sbGet('testimonials',          'is_active=eq.true&order=created_at.asc').catch(e => { console.error('Testimonials:', e.message); return []; }),
    sbGet('site_settings',         'select=key,value').catch(() => [])
  ]);

  ALL_PRODUCTS = (rawProducts || []).map(function(p) {
    // Merge option groups/values
    var groups = (optGroups||[]).filter(function(g){ return g.product_id === p.id; });
    var customisation_options = groups.map(function(g) {
      var vals = (optValues||[]).filter(function(v){ return v.group_id === g.id; });
      var variantPrices = {};
      vals.forEach(function(v){ if (v.price) variantPrices[v.value] = v.price; });
      return { label: g.label, options: vals.map(function(v){ return v.value; }), priceType: g.price_type, variantPrices: variantPrices };
    });
    // Merge product_questions (flat table replaces text_customisation JSONB)
    var questions = (pQuestions||[]).filter(function(q){ return q.product_id === p.id; });
    var text_customisation = questions.length
      ? { enabled: true, questions: questions.map(function(q){ return { label: q.label, placeholder: q.placeholder||'', required: !!q.is_required }; }) }
      : null;
    return Object.assign({}, p, { customisation_options: customisation_options, text_customisation: text_customisation });
  });

  ALL_CATEGORIES   = cats        || [];
  ALL_TESTIMONIALS = testimonials || [];

  if (settings && settings.length) {
    const s = {};
    settings.forEach(r => { s[r.key] = r.value; });
    const setEl    = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    const setPhone = (id, val) => { const el = document.getElementById(id); if (el && val) { el.textContent = val; el.href = 'tel:+' + val.replace(/\D/g,''); } };
    const setEmail = (id, val) => { const el = document.getElementById(id); if (el && val) { el.textContent = val; el.href = 'mailto:' + val; } };
    setPhone('footerPhone', s.whatsapp); setPhone('footerPhone2', s.whatsapp);
    setEmail('footerEmail', s.email);   setEmail('footerEmail2', s.email);
    setEl('footerLocation', s.location); setEl('footerLocation2', s.location);
    if (s.whatsapp) {
      let num = s.whatsapp.replace(/\D/g, '');
      if (num.length === 10) num = '91' + num;
      WHATSAPP_NUMBER = num;
    }

    // Update LocalBusiness schema with the real phone/email — the placeholder
    // in the <head> is only a fallback for before this data loads
    const schemaEl = document.querySelector('script[type="application/ld+json"]');
    if (schemaEl) {
      try {
        const data = JSON.parse(schemaEl.textContent);
        const biz = (data['@graph'] || []).find(n => n['@type'] && n['@type'].includes('LocalBusiness'));
        if (biz) {
          if (WHATSAPP_NUMBER) biz.telephone = '+' + WHATSAPP_NUMBER;
          if (s.email) biz.email = s.email;
          schemaEl.textContent = JSON.stringify(data);
        }
      } catch(e) {}
    }
  }

  // Pre-warm bestseller images — browser starts downloading while loader is still visible
  ALL_PRODUCTS.filter(p => p.is_bestseller).slice(0, 8)
    .map(p => p.photos && p.photos[0]).filter(Boolean)
    .forEach(src => { const i = new Image(); i.src = imgUrl(src, 400, 70); });

  // Pre-warm ALL product first images at 600px (popup size) in background
  // Staggered with small delay so it doesn't compete with visible content
  setTimeout(function() {
    ALL_PRODUCTS.map(p => p.photos && p.photos[0]).filter(Boolean)
      .forEach(function(src, idx) {
        setTimeout(function() { var i = new Image(); i.src = imgUrl(src, 600, 75); }, idx * 80);
      });
  }, 2000);

  renderBestsellers();
  renderCategoriesGrid();
  renderFooterCategories();
  renderSidebar();
  renderShopGrid();
  buildMarquee();
  buildSpotlight();
  injectProductSchema();

  clearTimeout(barAnim);
  setBar(100);
  setTimeout(() => {
    const loader = document.getElementById('siteLoader');
    if (loader) loader.classList.add('hidden');
  }, 350);
}
/* ═══════════════════════════════════════
   INJECT PRODUCT STRUCTURED DATA
   Adds JSON-LD for every product so Google
   can show them as rich results in Search
═══════════════════════════════════════ */
function injectProductSchema() {
  if (!ALL_PRODUCTS.length) return;
  const items = ALL_PRODUCTS.map(function(p) {
    var price = Number(p.price) || 0;
    var img   = p.photos && p.photos[0] ? p.photos[0] : '';
    return {
      '@type':       'Product',
      'name':        p.name,
      'description': p.description || ('Handmade personalised ' + p.name + ' — customisable gift from Coimbatore, Tamil Nadu, delivered across India.'),
      'image':       img,
      'brand': { '@type': 'Brand', 'name': 'Your Gift Story' },
      'offers': {
        '@type':         'Offer',
        'price':         price,
        'priceCurrency': 'INR',
        'availability':  p.is_active ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        'url':           'https://your-gift-story-website.vercel.app/',
        'seller': { '@type': 'Organization', 'name': 'Your Gift Story' },
        'shippingDetails': {
          '@type': 'OfferShippingDetails',
          'shippingDestination': { '@type': 'DefinedRegion', 'addressCountry': 'IN' },
          'deliveryTime': {
            '@type': 'ShippingDeliveryTime',
            'transitTime': { '@type': 'QuantitativeValue', 'minValue': 5, 'maxValue': 7, 'unitCode': 'DAY' }
          }
        },
        'hasMerchantReturnPolicy': {
          '@type': 'MerchantReturnPolicy',
          'applicableCountry': 'IN',
          'returnPolicyCategory': 'https://schema.org/MerchantReturnNotPermitted',
          'merchantReturnLink': 'https://your-gift-story-website.vercel.app/'
        }
      },
      'category': p.category || 'Gifts'
    };
  });
  var el = document.getElementById('productSchemaTag');
  if (!el) { el = document.createElement('script'); el.type = 'application/ld+json'; el.id = 'productSchemaTag'; document.head.appendChild(el); }
  el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': items });
}

/* ═══════════════════════════════════════
   RENDER FOOTER CATEGORIES (dynamic)
   Top 4 categories by product count + All Gifts
═══════════════════════════════════════ */
function renderFooterCategories() {
  // Top 5 categories by product count, excluding 'Others', + All Gifts
  const sorted = (ALL_CATEGORIES || [])
    .map(c => ({ name: c.name, count: ALL_PRODUCTS.filter(p => p.category === c.name).length }))
    .filter(c => c.count > 0 && c.name.toLowerCase() !== 'others')
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const liHTML = sorted.map(c =>
    `<li><a onclick="showPage('shop','${c.name}')" style="cursor:pointer">${c.name}</a></li>`
  ).join('') + `<li><a onclick="showPage('shop','all')" style="cursor:pointer">All Gifts</a></li>`;

  ['footerCats1','footerCats2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = liHTML;
  });
}

/* ═══════════════════════════════════════
   RENDER BESTSELLERS
═══════════════════════════════════════ */
function renderBestsellers() {
  const grid = document.getElementById('bestsellersGrid');
  const best = ALL_PRODUCTS.filter(p => p.is_bestseller).slice(0, 8);
  if (!best.length) {
    // fallback: show first 8 active products
    const fallback = ALL_PRODUCTS.slice(0, 8);
    if (!fallback.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--gray)">Products coming soon!</div>'; return; }
    grid.innerHTML = fallback.map(p => bsCardHTML(p)).join('');
    return;
  }
  grid.innerHTML = best.map(p => bsCardHTML(p)).join('');
}

/* ═══════════════════════════════════════
   PRICE RANGE HELPER
═══════════════════════════════════════ */
function getPriceDisplay(p) {
  const base = Number(p.price) || 0;
  const opts = p.customisation_options;
  if (!opts || !opts.length) return '₹' + base.toLocaleString('en-IN');
  let prices = [base];
  opts.forEach(function(g) {
    if (g.priceType === 'per_variant' && g.variantPrices) {
      Object.values(g.variantPrices).forEach(function(v) { if (v > 0) prices.push(Number(v)); });
    } else if (g.priceType === 'addon' && g.variantPrices) {
      Object.values(g.variantPrices).forEach(function(v) { if (v > 0) prices.push(base + Number(v)); });
    }
  });
  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  if (min === max) return '₹' + min.toLocaleString('en-IN');
  return '₹' + min.toLocaleString('en-IN') + ' – ₹' + max.toLocaleString('en-IN');
}

function bsCardHTML(p) {
  const imgSrc = p.photos && p.photos[0] ? p.photos[0] : null;
  const img = imgSrc
    ? `<img src="${imgUrl(imgSrc,400,70)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover" onload="this.style.opacity=1;this.closest('.bs-img').style.background='none';_imgCache['${p.id}']=this.src" alt="${p.name}">`
    : (p.emoji || '🎁');
  const imgClass = imgSrc ? 'bs-img' : 'bs-img bs-i1';
  const imgStyle = imgSrc ? 'background:#dceae9;overflow:hidden' : '';
  return `<div class="bs-card" onclick="bsCardTap(this,'${p.id}')">   <span class="bs-badge${p.is_bestseller ? '' : ' new'}">${p.is_bestseller ? 'Bestseller' : 'New'}</span>   <div class="${imgClass}" style="${imgStyle}">${img}</div>   <div class="bs-tap-hint">Tap for photo</div>   <div class="bs-body">    <div class="bs-name">${p.name}</div>    <div class="bs-footer"><span class="bs-price">₹${Number(p.price).toLocaleString('en-IN')}</span><button class="bs-btn" onclick="event.stopPropagation();openPopup('${p.id}')">Shop Now</button></div>   </div>  </div>`;
}

/* Bestseller card tap: on mobile, tapping toggles the photo open/closed. Shop Now (separate button) always opens the buy popup. */
function bsCardTap(card, id) {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    card.classList.toggle('revealed');
    return;
  }
  openPopup(id);
}

/* ═══════════════════════════════════════
   RENDER CATEGORIES GRID (home page)
═══════════════════════════════════════ */
function renderCategoriesGrid() {
  const grid = document.getElementById('categoriesGrid');
  if (!ALL_CATEGORIES.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = ALL_CATEGORIES.map(c => {
    const count = ALL_PRODUCTS.filter(p => p.category === c.name).length;
    // Pick first available product photo in this category as cover image
    const coverProduct = ALL_PRODUCTS.find(p => p.category === c.name && p.photos && p.photos[0]);
    const coverImg = coverProduct ? coverProduct.photos[0] : null;
    if (coverImg) {
      return `<div class="cat-card" onclick="showPage('shop','${c.name}')">
        <div class="cat-img-wrap" id="catwrap-${c.name.replace(/\s+/g,'')}">
          <img class="cat-img" src="${imgUrl(coverImg,500,70)}" loading="lazy" decoding="async" alt="${c.name} gifts - handmade personalised - Your Gift Story"
            onload="this.classList.add('loaded');this.closest('.cat-img-wrap').classList.add('loaded')">
        </div>
        <div class="cat-overlay"></div>
        <div class="cat-card-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-count">${count} item${count!==1?'s':''}</div>
        </div>
      </div>`;
    } else {
      return `<div class="cat-card no-img" onclick="showPage('shop','${c.name}')">
        <div class="cat-overlay"></div>
        <div class="cat-card-body">
          <div class="cat-name">${c.name}</div>
          <div class="cat-count">${count} item${count!==1?'s':''}</div>
        </div>
      </div>`;
    }
  }).join('');
}

/* ═══════════════════════════════════════
   RENDER SHOP SIDEBAR
═══════════════════════════════════════ */
function renderSidebar() {
  const sb = document.getElementById('sidebarCats');
  const total = ALL_PRODUCTS.length;
  document.getElementById('countAll').textContent = total;
  const catItems = ALL_CATEGORIES.map(c => {
    const count = ALL_PRODUCTS.filter(p => p.category === c.name).length;
    return `<div class="sidebar-cat" data-cat="${c.name}" onclick="filterShop('${c.name}')">    <span>${c.icon||''} ${c.name}</span>    <span class="sidebar-cat-count">${count}</span>   </div>`;
  }).join('');
  // Keep "All Gifts" + append categories
  sb.innerHTML = `<div class="sidebar-cat active" data-cat="all" onclick="filterShop('all')"><span>All Gifts</span><span class="sidebar-cat-count" id="countAll">${total}</span></div>` + catItems;
}

/* ═══════════════════════════════════════
   RENDER SHOP GRID (products page)
═══════════════════════════════════════ */
function renderShopGrid(filterCat, minP, maxP, sortBy) {
  const grid = document.getElementById('shopGrid');
  const emptyEl = document.getElementById('emptyState');
  const rc = document.getElementById('resultCount');

  let prods = [...ALL_PRODUCTS];
  if (filterCat && filterCat !== 'all') prods = prods.filter(p => p.category === filterCat);
  if (minP) prods = prods.filter(p => p.price >= minP);
  if (maxP) prods = prods.filter(p => p.price <= maxP);

  // Apply sort
  if (sortBy === 'bestseller') prods.sort((a, b) => (b.is_bestseller ? 1 : 0) - (a.is_bestseller ? 1 : 0));
  else if (sortBy === 'low')  prods.sort((a, b) => Number(a.price) - Number(b.price));
  else if (sortBy === 'high') prods.sort((a, b) => Number(b.price) - Number(a.price));
  else if (sortBy === 'new')  prods.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // 'default' keeps original order

  if (rc) rc.textContent = prods.length;

  if (!prods.length) {
    // Clear all product cards but keep empty state
    grid.querySelectorAll('.product-card,.cat-section-heading').forEach(el => el.remove());
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  // Remove old cards/headings
  grid.querySelectorAll('.product-card,.cat-section-heading').forEach(el => el.remove());

  if (sortBy && sortBy !== 'default') {
    prods.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.dataset.cat = p.category;
      card.dataset.price = p.price;
      card.dataset.productId = p.id;
      card.style.cursor = 'pointer';
      card.onclick = function(e) { if (!e.target.closest('.gallery-prev,.gallery-next,.gallery-dot,.btn-buynow')) openPopup(p.id); };
      card.innerHTML = productCardHTML(p);
      grid.insertBefore(card, emptyEl);
    });
    return;
  }

  // Default: group by category with headings
  const cats = filterCat && filterCat !== 'all'
    ? [filterCat]
    : [...new Set(prods.map(p => p.category))];

  cats.forEach(cat => {
    const catProds = prods.filter(p => p.category === cat);
    if (!catProds.length) return;

    // Section heading
    const heading = document.createElement('div');
    heading.className = 'cat-section-heading';
    heading.dataset.cat = cat;
    const nameParts = cat.split(' ');
    const lastWord = nameParts.pop();
    heading.innerHTML = `<h3>${nameParts.join(' ')} <em>${lastWord}</em></h3><div class="cat-section-line"></div>`;
    grid.insertBefore(heading, emptyEl);

    // Product cards
    catProds.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.dataset.cat = cat;
      card.dataset.price = p.price;
      card.dataset.productId = p.id;
      card.style.cursor = 'pointer';
      card.onclick = function(e) { if (!e.target.closest('.gallery-prev,.gallery-next,.gallery-dot,.btn-buynow')) openPopup(p.id); };
      card.innerHTML = productCardHTML(p);
      grid.insertBefore(card, emptyEl);
    });
  });
}

function galleryNav(card, dir) {
  var slides = card.querySelector('.gallery-slides');
  if (!slides) return;
  var total = slides.children.length;
  var cur = parseInt(slides.dataset.cur || 0);
  cur = (cur + dir + total) % total;
  slides.dataset.cur = cur;
  slides.style.transform = 'translateX(-' + (cur * 100) + '%)';
  card.querySelectorAll('.gallery-dot').forEach(function(d, i) { d.classList.toggle('active', i === cur); });
}

function setGallerySlide(btn, idx) {
  var card = btn.closest('.product-card');
  var slides = card.querySelector('.gallery-slides');
  slides.dataset.cur = idx;
  slides.style.transform = 'translateX(-' + (idx * 100) + '%)';
  card.querySelectorAll('.gallery-dot').forEach(function(d, i) { d.classList.toggle('active', i === idx); });
}

/* Swipe support for product galleries on touch devices */
(function() {
  var touchStartX = 0, touchStartY = 0, activeCard = null;
  document.addEventListener('touchstart', function(e) {
    var slides = e.target.closest('.gallery-slides');
    if (!slides) { activeCard = null; return; }
    activeCard = slides.closest('.product-card');
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    if (!activeCard) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      galleryNav(activeCard, dx < 0 ? 1 : -1);
    }
    activeCard = null;
  }, { passive: true });
})();

function trimDesc(text, maxWords) {
  if (!text) return '';
  var words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '…';
}

function productCardHTML(p) {
  var photos = (p.photos || []).filter(Boolean);
  var imgSection;
  // Use consistent quality=72 everywhere so popup can reuse exact cached URL
  var firstImgUrl = photos.length ? imgUrl(photos[0], 600, 72) : null;
  if (photos.length > 1) {
    var slidesHTML = photos.map(function(src, si) {
      var altText = p.name + ' - handmade gift - Your Gift Story' + (si > 0 ? ' ' + (si+1) : '');
      return '<div class="gallery-slide"><img src="' + imgUrl(src,600,72) + '" alt="' + altText + '" loading="lazy" onclick="event.stopPropagation();openLightbox(' + JSON.stringify(photos) + ',' + si + ')"></div>';
    }).join('');
    var dotsHTML = photos.map(function(_, i) {
      return '<button class="gallery-dot' + (i === 0 ? ' active' : '') + '" onclick="event.stopPropagation();setGallerySlide(this,' + i + ')"></button>';
    }).join('');
    imgSection = '<div class="product-gallery">'
      + '<div class="gallery-slides" data-cur="0">' + slidesHTML + '</div>'
      + '<button class="gallery-prev" onclick="event.stopPropagation();galleryNav(this.closest(\'.product-card\'),-1)">&#8249;</button>'
      + '<button class="gallery-next" onclick="event.stopPropagation();galleryNav(this.closest(\'.product-card\'),1)">&#8250;</button>'
      + '<div class="gallery-dots">' + dotsHTML + '</div>'
      + '</div>';
  } else if (photos.length === 1) {
    var cachedUrl = imgUrl(photos[0], 600, 72);
    imgSection = '<div class="product-img" style="padding:0;overflow:hidden"><img src="' + cachedUrl + '" style="width:100%;height:100%;object-fit:cover;object-position:center" alt="' + p.name + ' - handmade personalised gift - Your Gift Story" loading="lazy" onload="_imgCache[\'' + p.id + '\']=this.src" onclick="event.stopPropagation();openLightbox(' + JSON.stringify(photos) + ',0)"></div>';
  } else {
    imgSection = '<div class="product-img">' + (p.emoji || '🎁') + '</div>';
  }

  var badge = p.is_bestseller ? '<span class="product-badge">Bestseller</span>' : '';
  var price = getPriceDisplay(p);
  var shortDesc = trimDesc(p.description, 20);

  return badge + imgSection
    + '<div class="product-body">'
    + '<div class="product-name">' + p.name + '</div>'
    + '<div class="product-desc">' + shortDesc + '</div>'
    + '<div class="product-price">' + price + '</div>'
    + '<button class="btn-buynow" onclick="event.stopPropagation();openPopup(\'' + p.id + '\')">Buy Now →</button>'
    + '</div>';
}


/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
function showPage(page, cat) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  window.scrollTo(0, 0);
  currentPage = page;
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const navEl = document.getElementById('nav-' + (page === 'shop' ? 'shop' : 'home'));
  if (navEl) navEl.classList.add('active');
  if (page === 'shop') {
    // Arriving fresh at the shop page (nav link, footer link, hero button, etc.) should show
    // that category's full results — clear any price/sort filters left over from a previous visit.
    const pMin = document.getElementById('priceMin');
    const pMax = document.getElementById('priceMax');
    const sortSel = document.querySelector('.sidebar-sort select');
    if (pMin) pMin.value = '';
    if (pMax) pMax.value = '';
    if (sortSel) sortSel.value = 'default';
    filterShop(cat || 'all');
  }
}

function toggleMoreFilters() {
  document.getElementById('sidebarMoreFilters').classList.toggle('open');
  document.getElementById('filtersToggleBtn').classList.toggle('open');
}

function openFiltersSheet() {
  document.getElementById('shopSidebar').classList.add('open');
  document.getElementById('mobileFiltersOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeFiltersSheet() {
  document.getElementById('shopSidebar').classList.remove('open');
  document.getElementById('mobileFiltersOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function updateFiltersBadge() {
  const badge = document.getElementById('filtersBadge');
  if (!badge) return;
  let count = 0;
  if (activeCategory && activeCategory !== 'all') count++;
  const pMin = document.getElementById('priceMin')?.value;
  const pMax = document.getElementById('priceMax')?.value;
  if (pMin) count++;
  if (pMax) count++;
  const sortSel = document.querySelector('.sidebar-sort select');
  if (sortSel && sortSel.value !== 'default') count++;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function filterShop(cat) {
  activeCategory = cat;
  document.querySelectorAll('.sidebar-cat').forEach(el => el.classList.toggle('active', el.dataset.cat === cat));
  applyFilters();
}

function applyFilters() {
  const minP = parseInt(document.getElementById('priceMin')?.value) || 0;
  const maxP = parseInt(document.getElementById('priceMax')?.value) || 999999;
  const sortSelect = document.querySelector('.sidebar-sort select');
  let sortVal = sortSelect?.value || 'default';
  // When a price range is set, always show results ordered min → max, unless the
  // shopper has deliberately chosen a different sort (bestsellers / newest / high-low).
  if ((minP > 0 || maxP < 999999) && (sortVal === 'default' || sortVal === 'low')) {
    sortVal = 'low';
    if (sortSelect) sortSelect.value = 'low';
  }
  renderShopGrid(activeCategory, minP || null, maxP >= 999999 ? null : maxP, sortVal);
  updateFiltersBadge();
}

function toggleOcc(el) { el.classList.toggle('active'); }

function resetFilters() {
  const pMin = document.getElementById('priceMin');
  const pMax = document.getElementById('priceMax');
  if (pMin) pMin.value = '';
  if (pMax) pMax.value = '';
  const sortSel = document.querySelector('.sidebar-sort select');
  if (sortSel) sortSel.value = 'default';
  filterShop('all');
}

/* ═══════════════════════════════════════
   MARQUEE — auto from categories
═══════════════════════════════════════ */
function buildMarquee() {
  const el = document.getElementById('marqueeInner');
  if (!el) return;
  // Auto-read categories from Supabase data
  const items = ALL_CATEGORIES.length
    ? ALL_CATEGORIES.map(c => (c.icon && c.icon !== 'null' ? c.icon + ' ' : '') + c.name)
    : ['Resin Art','Craft Items','Embroidery & Crochet','Photo Gifts','Gift Hampers','Occasion Gifts'];
  // Build triple set for seamless loop
  const single = items.map(t => '<span class="marquee-item">' + t + ' <span class="marquee-sep">✦</span></span>').join('');
  el.innerHTML = single + single + single;
  // Wait for layout then measure
  requestAnimationFrame(() => {
    const oneW = el.scrollWidth / 3;
    let x = 0, paused = false;
    el.parentElement.addEventListener('mouseenter', () => paused = true);
    el.parentElement.addEventListener('mouseleave', () => paused = false);
    function tick() {
      if (!paused) {
        x -= 0.7;
        if (x <= -oneW) x = 0;
        el.style.transform = 'translateX(' + x + 'px)';
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}



function buildSpotlight() {
  const stage = document.getElementById('spStage');
  const dotsEl = document.getElementById('spDots');
  const thumbsEl = document.getElementById('spThumbs');
  if (!stage) return;
  const testiData = ALL_TESTIMONIALS.length ? ALL_TESTIMONIALS.map(t => ({stars:"★".repeat(t.rating||5),text:escapeHtml(t.review_text),name:escapeHtml(t.customer_name),occasion:escapeHtml((t.occasion||"")+(t.location?(" · "+t.location):"")),initials:t.customer_name.split(" ").map(w=>w[0]).join("").substring(0,2).toUpperCase()})) : [{stars:"★★★★★",text:"Wonderful handcrafted gifts, made with so much love and care!",name:"Happy Customer",occasion:"Coimbatore",initials:"HC"}];
  const CHAR_LIMIT = 180;
  stage.innerHTML = testiData.map((t,i) => {
    const long = t.text.length > CHAR_LIMIT;
    const textEl = `<p class="sp-text${long?' truncated':''}" id="sp-text-${i}">${t.text}</p>`;
    const btn = long ? `<button class="sp-readmore" id="sp-rm-${i}" onclick="spToggleRead(${i})">Read more</button>` : '';
    return `<div class="sp-card${i===0?' active':''}" id="sp-card-${i}"><div class="sp-bar"></div><div class="sp-inner"><div class="sp-stars">${t.stars}</div>${textEl}${btn}<div class="sp-author"><div class="sp-info"><div class="sp-name">${t.name}</div><div class="sp-occ">${t.occasion}</div></div></div></div></div>`;
  }).join('');
  dotsEl.innerHTML = ALL_TESTIMONIALS.map((_,i) =>
    `<button class="sp-dot${i===0?' active':''}" onclick="spGo(${i})" aria-label="Review ${i+1}"></button>`
  ).join('');
  thumbsEl.innerHTML = testiData.map((t,i) =>
    `<div class="sp-thumb${i===0?' active':''}" onclick="spGo(${i})">    <span class="sp-thumb-name">${t.name}</span>    <span class="sp-thumb-occ">${t.occasion.split('·')[0].trim()}</span>   </div>`
  ).join('');
  spTimer = setInterval(() => spGo(spCur + 1), 4500);
}

function spGo(idx) {
  const total = document.querySelectorAll(".sp-card").length || 1;
  idx = ((idx % total) + total) % total;
  document.querySelectorAll('.sp-card').forEach((c,i) => c.classList.toggle('active', i===idx));
  document.querySelectorAll('.sp-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
  document.querySelectorAll('.sp-thumb').forEach((t,i) => t.classList.toggle('active', i===idx));
  spCur = idx;
  clearInterval(spTimer);
  spTimer = setInterval(() => spGo(spCur + 1), 4500);
}

function spToggleRead(i) {
  const txt = document.getElementById('sp-text-'+i);
  const btn = document.getElementById('sp-rm-'+i);
  if (!txt || !btn) return;
  const isTruncated = txt.classList.toggle('truncated');
  btn.textContent = isTruncated ? 'Read more' : 'Read less';
}

/* ═══════════════════════════════════════
   IMAGE LIGHTBOX
═══════════════════════════════════════ */
var lbPhotos = [], lbCur = 0;
var _lbCache = {}; // rawUrl -> loaded high-res src, so revisiting a photo is instant

function openLightbox(photos, idx) {
  lbPhotos = photos;
  lbCur = idx || 0;
  var overlay = document.getElementById('lightboxOverlay');
  var prevBtn = document.getElementById('lightboxPrev');
  var nextBtn = document.getElementById('lightboxNext');
  prevBtn.style.display = photos.length > 1 ? 'flex' : 'none';
  nextBtn.style.display = photos.length > 1 ? 'flex' : 'none';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  lbSetSlide(lbCur);
}

function closeLightbox() {
  document.getElementById('lightboxOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function lightboxNav(dir) {
  lbCur = (lbCur + dir + lbPhotos.length) % lbPhotos.length;
  lbSetSlide(lbCur);
}

function lbSetSlide(idx) {
  var img = document.getElementById('lightboxImg');
  var spinner = document.getElementById('lightboxSpinner');
  var counter = document.getElementById('lightboxCounter');
  var rawSrc = lbPhotos[idx];
  counter.textContent = lbPhotos.length > 1 ? (idx + 1) + ' / ' + lbPhotos.length : '';

  // Already viewed this exact photo in this session at full quality — show instantly
  if (_lbCache[rawSrc]) {
    img.src = _lbCache[rawSrc];
    img.style.opacity = '1';
    spinner.classList.remove('show');
    return;
  }

  // Hide the old photo immediately — never show the wrong one while loading
  img.style.opacity = '0';
  spinner.classList.add('show');

  // Compressed sizes instead of raw multi-MB originals — same size as
  // gallery thumbnails first (likely already cached = instant), then
  // quietly upgrade to a sharper version once it's ready
  var smallSrc = imgUrl(rawSrc, 600, 72);
  var bigSrc   = imgUrl(rawSrc, 1400, 82);

  var loader = new Image();
  loader.onload = function() {
    if (lbPhotos[lbCur] !== rawSrc) return; // user already navigated away
    img.src = smallSrc;
    img.style.opacity = '1';
    spinner.classList.remove('show');

    var upgrader = new Image();
    upgrader.onload = function() {
      if (lbPhotos[lbCur] !== rawSrc) return;
      img.src = bigSrc;
      _lbCache[rawSrc] = bigSrc;
    };
    upgrader.src = bigSrc;
  };
  loader.src = smallSrc;
}

document.addEventListener('keydown', function(e) {
  var lb = document.getElementById('lightboxOverlay');
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav(-1);
  if (e.key === 'ArrowRight') lightboxNav(1);
});

/* ═══════════════════════════════════════
   BUY NOW POPUP
═══════════════════════════════════════ */
var popupProduct = null;

function openPopup(productId) {
  var p = ALL_PRODUCTS.find(function(x){ return x.id === productId; });
  if (!p) return;
  popupProduct = p;

  var imgWrap = document.getElementById('popupImgWrap');
  var popupBox = document.getElementById('popupBox');
  var photos = (p.photos || []).filter(Boolean);

  // ── STEP 1: Instantly hide the image wrap and clear it ──
  // Setting display:none forces the GPU to drop the old texture immediately
  imgWrap.style.display = 'none';
  imgWrap.style.cssText = 'display:none';

  // Remove old image src before it can flash
  var oldImg = imgWrap.querySelector('img');
  if (oldImg) { oldImg.src = ''; oldImg.remove(); }
  imgWrap.innerHTML = '';

  // Clear body instantly too — old name/price must not flash
  document.getElementById('popupBody').innerHTML = '';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'popup-close';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = closePopup;

  // ── STEP 2: In next frame, show shimmer and start loading new image ──
  requestAnimationFrame(function() {
    // Show shimmer — GPU now paints fresh teal, old image completely gone
    imgWrap.style.cssText = 'display:block;background:linear-gradient(90deg,#dceae9 25%,#c9dedd 50%,#dceae9 75%);background-size:800px 100%;animation:bsShimmer 1.5s infinite linear';

    if (photos.length) {
      var img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;position:relative;z-index:1';
      img.alt = p.name;
      img.title = 'Click to view full image';
      img.onclick = function(e) { e.stopPropagation(); openLightbox(photos, 0); };

      // Use cache if available — guaranteed same URL = instant from browser memory
      var finalSrc = _imgCache[p.id] || imgUrl(photos[0], 600, 72);
      img.src = finalSrc;

      if (img.complete && img.naturalWidth) {
        // Already cached — show in next frame after shimmer has painted
        requestAnimationFrame(function() {
          img.style.opacity = '1';
          imgWrap.style.cssText = 'display:block';
        });
      } else {
        img.onload = function() {
          img.style.transition = 'opacity .2s ease';
          img.style.opacity = '1';
          imgWrap.style.cssText = 'display:block';
        };
      }
      imgWrap.appendChild(img);
    } else {
      imgWrap.style.cssText = 'display:block';
      var ph = document.createElement('div');
      ph.className = 'popup-img-placeholder';
      ph.textContent = p.emoji || '🎁';
      imgWrap.appendChild(ph);
    }
    imgWrap.appendChild(closeBtn);
  });

  // Build body content
  var opts = p.customisation_options || [];
  var tc = p.text_customisation;
  var price = getPriceDisplay(p);

  var optHTML = opts.map(function(g, gi) {
    var options = (g.options || []).slice();
    if (g.priceType === 'per_variant' && g.variantPrices) {
      options.sort(function(a, b) {
        return (Number(g.variantPrices[a]) || 0) - (Number(g.variantPrices[b]) || 0);
      });
    }
    var chips = options.map(function(o, i) {
      var priceHint = (g.priceType === 'per_variant' && g.variantPrices && g.variantPrices[o])
        ? ' <span style="font-size:10px;opacity:.7">₹' + Number(g.variantPrices[o]).toLocaleString('en-IN') + '</span>' : '';
      return '<span class="popup-chip' + (i === 0 ? ' active' : '') + '" data-option="' + o + '" onclick="popupSelectChip(this,' + gi + ')">' + o + priceHint + '</span>';
    }).join('');
    return '<div class="popup-ctrl-label">' + g.label + '</div><div class="popup-chips" data-group="' + gi + '">' + chips + '</div>';
  }).join('');

  var textHTML = '';
  if (tc && tc.enabled) {
    var questions = tc.questions && tc.questions.length ? tc.questions
      : [{ label: tc.label || 'Custom message', placeholder: tc.placeholder || 'Type here…', required: !!tc.required }];
    textHTML = questions.map(function(q, qi) {
      return '<div class="popup-ctrl-label">' + (q.label || 'Custom message')
        + (q.required ? ' <span style="color:#E24B4A">*</span>' : '') + '</div>'
        + '<textarea id="popupTextInput_' + qi + '" class="popup-input" rows="2" style="resize:vertical;min-height:38px" placeholder="' + (q.placeholder || 'Type here…') + '" '
        + (q.required ? 'data-required="1"' : '') + '></textarea>';
    }).join('');
  }

  var badgeHTML = p.is_bestseller ? '<span class="popup-badge">Bestseller</span><br>' : '';
  var bodyHTML = badgeHTML
    + '<div class="popup-name">' + p.name + '</div>'
    + '<div class="popup-price" id="popupPrice">' + price + '</div>'
    + '<div class="popup-desc">' + (p.description || '') + '</div>'
    + optHTML + textHTML
    + (p.notice_message
        ? ('<div style="background:#fff8ee;border:1px solid #f0d080;border-radius:12px;padding:.85rem 1rem;margin:.5rem 0;font-size:13px;color:#5a4200;line-height:1.6">'
          + '<div style="font-weight:600;margin-bottom:.4rem">&#128204; Please note</div>'
          + '<div>' + p.notice_message + '</div>'
          + '<label style="display:flex;align-items:flex-start;gap:.5rem;margin-top:.65rem;cursor:pointer;font-size:12px">'
          + '<input type="checkbox" id="popupNoticeCheck" style="margin-top:2px;flex-shrink:0" onchange="toggleAtcBtn(this.checked)">'
          + ' I have read and understood the above</label></div>')
        : '')
    + '<button class="popup-atc" id="popupAtcBtn" onclick="popupAddToCart()"'
        + (p.notice_message ? ' disabled style="opacity:.5;cursor:not-allowed"' : '') + '>&#128722; Add to Cart</button>';

  // Open overlay and set body in the SAME frame as shimmer — atomic, no flash possible
  document.getElementById('popupBody').innerHTML = bodyHTML;
  document.getElementById('popupOverlay').classList.add('open');
  document.getElementById('popupBox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function toggleAtcBtn(checked) {
  var btn = document.getElementById('popupAtcBtn');
  if (!btn) return;
  btn.disabled = !checked;
  btn.style.opacity = checked ? '1' : '0.5';
  btn.style.cursor = checked ? 'pointer' : 'not-allowed';
}

function closePopup() {
  document.getElementById('popupOverlay').classList.remove('open');
  document.getElementById('popupBox').classList.remove('open');
  document.body.style.overflow = '';
  popupProduct = null;
}

function popupSelectChip(el, groupIdx) {
  var container = el.closest('.popup-chips');
  container.querySelectorAll('.popup-chip').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
  // Update price
  if (!popupProduct) return;
  var opts = popupProduct.customisation_options || [];
  var basePrice = Number(popupProduct.price) || 0;
  var finalPrice = basePrice;
  var allGroups = document.querySelectorAll('#popupBody .popup-chips');
  opts.forEach(function(g, gi) {
    var grp = allGroups[gi];
    if (!grp) return;
    var active = grp.querySelector('.popup-chip.active');
    var sel = active ? active.textContent.trim() : (g.options ? g.options[0] : '');
    if (g.priceType === 'per_variant' && g.variantPrices && g.variantPrices[sel]) {
      finalPrice = Number(g.variantPrices[sel]);
    } else if (g.priceType === 'addon' && g.variantPrices && g.variantPrices[sel]) {
      finalPrice = basePrice + Number(g.variantPrices[sel]);
    }
  });
  var priceEl = document.getElementById('popupPrice');
  if (priceEl) priceEl.textContent = '₹' + finalPrice.toLocaleString('en-IN');
}

function popupAddToCart() {
  if (!popupProduct) return;
  var p = popupProduct;

  // Validate all required question inputs
  var allInputs = document.querySelectorAll('#popupBody .popup-input[data-required="1"]');
  for (var ri = 0; ri < allInputs.length; ri++) {
    var inp = allInputs[ri];
    if (!inp.value.trim()) {
      inp.style.borderColor = '#E24B4A';
      inp.focus();
      showToast('Please fill in all required fields.');
      setTimeout(function(){ inp.style.borderColor = ''; }, 2000);
      return;
    }
  }

  // Gather customisation — chips + all text inputs
  var parts = [];
  document.querySelectorAll('#popupBody .popup-chips').forEach(function(grp) {
    var active = grp.querySelector('.popup-chip.active');
    if (active) parts.push(active.dataset.option || active.textContent.trim());
  });
  document.querySelectorAll('#popupBody .popup-input').forEach(function(inp) {
    if (inp.value.trim()) parts.push(inp.value.trim());
  });
  var custom = parts.join(' · ') || 'Standard';

  // Get displayed price
  var priceEl = document.getElementById('popupPrice');
  var priceText = priceEl ? priceEl.textContent.replace(/[₹,\s]/g,'').split('–')[0].trim() : String(p.price);
  var price = Number(priceText) || Number(p.price) || 0;

  cart.push({ name: p.name, price: price, icon: p.emoji || '🎁', imgClass: '', custom: custom, id: Date.now() });
  updateCartUI();
  closePopup();
  showToast('✓ ' + p.name + ' added to cart!');
  openCart();
}

/* ═══════════════════════════════════════
   CART
═══════════════════════════════════════ */
function selectChip(el) {
  el.parentElement.querySelectorAll('.chip').forEach(function(c){ c.classList.remove('active'); });
  el.classList.add('active');
  // Update price display based on selected variants
  var card = el.closest('[data-product-id]');
  if (!card) return;
  var p = ALL_PRODUCTS.find(function(x){ return x.id === card.dataset.productId; });
  if (!p) return;
  var priceEl = card.querySelector('.product-price');
  if (!priceEl) return;
  var opts = p.customisation_options || [];
  var allChipGroups = card.querySelectorAll('.chips');
  var basePrice = Number(p.price) || 0;
  var finalPrice = basePrice;
  opts.forEach(function(g, gi) {
    var grp = allChipGroups[gi];
    if (!grp) return;
    var activeChip = grp.querySelector('.chip.active');
    var sel = activeChip ? activeChip.textContent.trim() : (g.options ? g.options[0] : '');
    if (g.priceType === 'per_variant' && g.variantPrices && g.variantPrices[sel]) {
      finalPrice = Number(g.variantPrices[sel]);
    } else if (g.priceType === 'addon' && g.variantPrices && g.variantPrices[sel]) {
      finalPrice = basePrice + Number(g.variantPrices[sel]);
    }
  });
  priceEl.textContent = '₹' + finalPrice.toLocaleString('en-IN');
}


function getCustomisation(card) {
  let parts = [];
  card.querySelectorAll('.chips').forEach(g => { const a = g.querySelector('.chip.active'); if (a) parts.push(a.textContent.trim()); });
  card.querySelectorAll('.gift-input').forEach(i => { if (i.value.trim()) parts.push(i.value.trim()); });
  return parts.join(' · ') || 'Standard';
}

function addToCartFromCard(btn, name, icon) {
  const card = btn.closest('.product-card');

  // Check required text customisation fields
  const reqInput = card.querySelector('.gift-input[data-tc-required="1"]');
  if (reqInput && !reqInput.value.trim()) {
    reqInput.style.borderColor = '#E24B4A';
    reqInput.focus();
    showToast('Please fill in the required field before adding to cart.');
    setTimeout(() => reqInput.style.borderColor = '', 2000);
    return;
  }

  const priceEl = card.querySelector('.product-price');
  let priceText = priceEl ? priceEl.textContent.trim() : '0';
  priceText = priceText.split('–')[0].replace(/[₹,\s]/g, '').trim();
  const price = Number(priceText) || 0;
  cart.push({ name, price, icon, imgClass: '', custom: getCustomisation(card), id: Date.now() });
  updateCartUI();
  showToast('✓ ' + name + ' added!');
}

function addToCart(btn, name, price, icon, imgClass) {
  const card = btn.closest('.product-card');
  cart.push({ name, price, icon, imgClass, custom: getCustomisation(card), id: Date.now() });
  updateCartUI();
  showToast('✓ ' + name + ' added!');
}

function removeFromCart(id) { cart = cart.filter(i => i.id !== id); updateCartUI(); }

function updateCartUI() {
  document.getElementById('cartCount').textContent = cart.length;
  const el = document.getElementById('cartItems');
  document.getElementById('cartEmpty').style.display = cart.length ? 'none' : 'block';
  el.querySelectorAll('.cart-item').forEach(e => e.remove());
  cart.forEach(item => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `<div class="cart-item-img ${item.imgClass}">${item.icon}</div>    <div class="cart-item-info">     <div class="cart-item-name">${escapeHtml(item.name)}</div>     <div class="cart-item-custom">${escapeHtml(item.custom)}</div>     <div class="cart-item-row">      <span class="cart-item-price">₹${Number(item.price).toLocaleString('en-IN')}</span>      <button class="btn-remove" onclick="removeFromCart(${item.id})">✕</button>     </div>    </div>`;
    el.appendChild(div);
  });
  updateTotal();
}

function updateTotal() {
  const sub = cart.reduce((s,i) => s + i.price, 0);
  document.getElementById('cartSubtotal').textContent = '₹' + sub.toLocaleString('en-IN');
  document.getElementById('cartTotal').textContent = '₹' + sub.toLocaleString('en-IN');
}

function openCart() { document.getElementById('cartDrawer').classList.add('open'); document.getElementById('overlay').classList.add('open'); }

function toggleMobileNav() {
  const drawer = document.getElementById('mobileNavDrawer');
  const isOpen = drawer.classList.contains('open');
  if (isOpen) { closeMobileNav(); } else { openMobileNav(); }
}
function openMobileNav() {
  document.getElementById('mobileNavDrawer').classList.add('open');
  document.getElementById('mobileNavOverlay').classList.add('open');
  document.getElementById('hamburgerBtn').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileNav() {
  document.getElementById('mobileNavDrawer').classList.remove('open');
  document.getElementById('mobileNavOverlay').classList.remove('open');
  document.getElementById('hamburgerBtn').classList.remove('open');
  document.body.style.overflow = '';
}
function closeCart() { document.getElementById('cartDrawer').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

/* ═══════════════════════════════════════
   CHECKOUT FLOW
═══════════════════════════════════════ */
function checkout() {
  if (!cart.length) { showToast('Your cart is empty!'); return; }
  closeCart();
  // Reset to step 1
  document.getElementById('coStep1').classList.add('active');
  document.getElementById('coStep2').classList.remove('active');
  document.getElementById('coTitle').textContent = 'Your Details';
  document.getElementById('coOverlay').classList.add('open');
  document.getElementById('coBox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCheckoutForm() {
  document.getElementById('coOverlay').classList.remove('open');
  document.getElementById('coBox').classList.remove('open');
  document.body.style.overflow = '';
}

function coGoReview() {
  // Validate
  const name = document.getElementById('co-name').value.trim();
  const phone = document.getElementById('co-phone').value.trim();
  const address = document.getElementById('co-address').value.trim();
  const city = document.getElementById('co-city').value.trim();
  const pincode = document.getElementById('co-pincode').value.trim();
  let valid = true;
  [['co-name', name], ['co-phone', phone], ['co-address', address], ['co-city', city], ['co-pincode', pincode]].forEach(function([id, val]) {
    const el = document.getElementById(id);
    if (!val) { el.classList.add('error'); valid = false; } else { el.classList.remove('error'); }
  });
  if (!valid) { showToast('Please fill in all required fields.'); return; }

  // Phone: exactly 10 digits
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length !== 10) {
    document.getElementById('co-phone').classList.add('error');
    showToast('Phone number must be exactly 10 digits.');
    return;
  }

  // Pincode: exactly 6 digits
  const pincodeDigits = pincode.replace(/\D/g, '');
  if (pincodeDigits.length !== 6) {
    document.getElementById('co-pincode').classList.add('error');
    showToast('Pincode must be exactly 6 digits.');
    return;
  }

  // Populate review step
  document.getElementById('coReviewCustomer').innerHTML =
    '<strong>' + name + '</strong> · ' + phone + '<br>' + address + ', ' + city + ' – ' + pincode;

  const sub = cart.reduce(function(s,i){ return s + i.price; }, 0);
  document.getElementById('coReviewItems').innerHTML = cart.map(function(i) {
    return '<div class="co-review-item">'
      + '<div><div class="co-review-item-name">' + i.name + '</div><div class="co-review-item-custom">' + (i.custom || '') + '</div></div>'
      + '<div class="co-review-item-price">₹' + Number(i.price).toLocaleString('en-IN') + '</div>'
      + '</div>';
  }).join('');
  document.getElementById('coReviewSubtotal').textContent = '₹' + sub.toLocaleString('en-IN');

  // Switch to step 2
  document.getElementById('coStep1').classList.remove('active');
  document.getElementById('coStep2').classList.add('active');
  document.getElementById('coTitle').textContent = 'Review Order';
}

function coGoBack() {
  document.getElementById('coStep2').classList.remove('active');
  document.getElementById('coStep1').classList.add('active');
  document.getElementById('coTitle').textContent = 'Your Details';
}

async function coConfirm() {
  const name    = document.getElementById('co-name').value.trim();
  const phone   = document.getElementById('co-phone').value.trim();
  const address = document.getElementById('co-address').value.trim();
  const city    = document.getElementById('co-city').value.trim();
  const pincode = document.getElementById('co-pincode').value.trim();
  const items   = cart.map(function(i){ return { name: i.name, price: i.price, custom: i.custom }; });

  // Disable button to prevent double submit
  const btn = document.querySelector('#coStep2 .co-btn-next');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

  const orderNumber = await saveOrderToSupabase({ name, phone, address, city, pincode, items });

  if (btn) { btn.disabled = false; btn.textContent = '✓ Confirm & Order'; }

  closeCheckoutForm();

  // Build WhatsApp message with full order details
  const sub = items.reduce(function(s, i){ return s + i.price; }, 0);
  const itemLines = items.map(function(i) {
    return '• ' + i.name + (i.custom ? ' (' + i.custom + ')' : '') + ' — ₹' + Number(i.price).toLocaleString('en-IN');
  }).join('\n');
  const waMsg = encodeURIComponent(
    'Hi! I just placed an order on Your Gift Story 🎁\n\n' +
    '*Order:* ' + (orderNumber || 'New Order') + '\n' +
    '*Name:* ' + name + '\n' +
    '*Phone:* ' + phone + '\n' +
    '*Address:* ' + address + ', ' + city + ' – ' + pincode + '\n\n' +
    '*Items:*\n' + itemLines + '\n\n' +
    '*Subtotal:* ₹' + Number(sub).toLocaleString('en-IN') + '\n\n' +
    'Please confirm my order. Thank you!'
  );
  window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + waMsg, '_blank');

  cart = [];
  updateCartUI();
  showSuccessPopup(orderNumber);
}

function showSuccessPopup(orderNumber) {
  const numEl = document.getElementById('successOrderNum');
  if (numEl) numEl.textContent = orderNumber || '';
  document.getElementById('successOverlay').classList.add('open');
  document.getElementById('successBox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSuccessPopup() {
  document.getElementById('successOverlay').classList.remove('open');
  document.getElementById('successBox').classList.remove('open');
  document.body.style.overflow = '';
  // Go to shop page so they can browse more
  showPage('shop');
}

async function saveOrderToSupabase(details) {
  try {
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    const fyStart = m >= 3 ? y : y - 1;
    const fy = String(fyStart).slice(2) + String(fyStart+1).slice(2);
    const fyStartDate = '20' + fy.slice(0,2) + '-04-01';
    const fyEndDate   = '20' + fy.slice(2)   + '-03-31T23:59:59';

    // Count existing FY orders for sequence number
    let seq = 1;
    try {
      const countRes = await fetch(
        _SB.u + '/rest/v1/orders?select=id&created_at=gte.' + fyStartDate + '&created_at=lte.' + fyEndDate,
        { headers: { 'apikey': _SB.k, 'Authorization': 'Bearer ' + _SB.k } }
      );
      if (countRes.ok) { const d = await countRes.json(); seq = (d||[]).length + 1; }
    } catch(e) {}

    const orderNumber = '#YGS' + fy + '-' + String(seq).padStart(3,'0');

    // Insert order (no items column — now in order_items table)
    const res = await fetch(_SB.u + '/rest/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        _SB.k,
        'Authorization': 'Bearer ' + _SB.k,
        'Prefer':        'return=representation'
      },
      body: JSON.stringify({
        order_number:     orderNumber,
        customer_name:    details.name,
        customer_phone:   details.phone,
        customer_address: details.address,
        customer_city:    details.city,
        customer_pincode: details.pincode,
        status:           'Pending',
        source:           'website',
        notes:            ''
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Order insert failed:', res.status, errText);
      return orderNumber;
    }

    const orderData = await res.json();
    const orderId = orderData && orderData[0] ? orderData[0].id : null;

    // Insert order_items rows (flat table)
    if (orderId && details.items && details.items.length) {
      const itemRows = details.items.map(function(item, idx) {
        return {
          order_id:     orderId,
          product_name: item.name || '',
          price:        Number(item.price) || 0,
          custom_notes: item.custom || '',
          display_order: idx
        };
      });
      await fetch(_SB.u + '/rest/v1/order_items', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        _SB.k,
          'Authorization': 'Bearer ' + _SB.k,
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify(itemRows)
      });
    }

    return orderNumber;
  } catch(e) {
    console.error('saveOrderToSupabase error:', e.message);
    return '';
  }
}

function whatsappOrder() {}  // kept for compatibility

function bulkOrderWhatsapp() {
  const msg = encodeURIComponent(
    "Hi! I'm interested in placing a bulk order with Your Gift Story.\n\n" +
    "Could you please share details on:\n" +
    "\u2022 Minimum order quantity\n" +
    "\u2022 Customisation options\n" +
    "\u2022 Pricing & delivery timeline\n\n" +
    "Thank you!"
  );
  window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + msg, '_blank');
}

/* ═══════════════════════════════════════
   POLICY PAGES
═══════════════════════════════════════ */
const POLICIES = {
  shipping: {
    title: 'Shipping Policy',
    body: `
      <div class="policy-tag">Last updated · June 2026</div>
      <h3>Delivery Timeline</h3>
      <p>Delivery timelines vary depending on the gift you choose. Once your order is confirmed, we'll reach out on WhatsApp and let you know the <strong>exact delivery timeline</strong> based on the complexity and crafting time of your specific gift. Typically, most orders are delivered within <strong>5 to 7 working days</strong> — but we'll always keep you informed every step of the way.</p>
      <h3>Where We Deliver</h3>
      <p>We deliver <strong>pan India</strong> — from Kashmir to Kanyakumari. No matter where your loved one is, we'll make sure your gift reaches them safely.</p>
      <h3>How It Works</h3>
      <ul>
        <li><strong>Order Confirmation</strong> — You'll receive a confirmation on WhatsApp within a few hours.</li>
        <li><strong>Personalisation Details</strong> — We collect your customisation details (names, photos, messages etc.).</li>
        <li><strong>Crafting</strong> — Our artisans handcraft your gift with love.</li>
        <li><strong>Quality Check</strong> — Every gift is carefully checked before packing.</li>
        <li><strong>Dispatched & Delivered</strong> — Packed securely and shipped to your door.</li>
      </ul>
      <h3>Tracking Your Order</h3>
      <p>Once dispatched, we'll share tracking details via WhatsApp so you can follow your gift every step of the way.</p>
      <h3>Urgent Orders</h3>
      <p>Need a gift in a hurry? Reach out on WhatsApp <strong>before placing your order</strong> — we'll do our best to accommodate based on availability.</p>
      <h3>Damaged or Lost Shipments</h3>
      <p>In the rare case your gift arrives damaged or is lost in transit, contact us within <strong>48 hours of delivery</strong> with photos. A replacement or refund will be arranged after review.</p>
      <h3>Important Notes</h3>
      <ul>
        <li>Working days are Monday to Saturday, excluding public holidays.</li>
        <li>Delivery may be slightly longer during peak seasons — order early.</li>
        <li>We are not responsible for delays due to incorrect addresses.</li>
        <li>International shipping is not available at the moment.</li>
      </ul>
      <h3>Contact Us</h3>
      <p>For shipping queries, reach us on WhatsApp at <strong>+91 90253 05650</strong> or email <strong>contact.yourgiftstory@gmail.com</strong>.</p>`
  },
  returns: {
    title: 'Returns & Refunds',
    body: `
      <div class="policy-tag">Last updated · June 2026</div>
      <h3>Our Promise</h3>
      <p>Every gift at Your Gift Story is handcrafted and personalised just for you. We follow a <strong>no return, no exchange</strong> policy on personalised items — however, we always stand by the quality of our work and will make it right if something goes wrong on our end.</p>
      <h3>When We Offer a Refund or Replacement</h3>
      <ul>
        <li><strong>Damaged in transit</strong> — Gift arrives broken or unusable.</li>
        <li><strong>Wrong item sent</strong> — You receive a different product from what you ordered.</li>
        <li><strong>Manufacturing defect</strong> — A quality issue with the product itself.</li>
        <li><strong>Error on our part</strong> — Personalisation details incorrectly applied due to our mistake.</li>
      </ul>
      <p>Please contact us within <strong>48 hours of delivery</strong> via WhatsApp or email with your order details and clear photos.</p>
      <h3>When We Cannot Accept Returns</h3>
      <ul>
        <li>Personalisation details were provided incorrectly by the customer.</li>
        <li>Change of mind after crafting has begun.</li>
        <li>Minor natural variations in handmade products — these are part of the handmade charm.</li>
        <li>Request raised after 48 hours of delivery.</li>
        <li>Damage caused by improper handling after delivery.</li>
      </ul>
      <h3>Cancellation Policy</h3>
      <p>Orders can be cancelled within <strong>2 hours</strong> of placing them, before personalisation begins. Once crafting has started, cancellations are not possible. To cancel, contact us immediately on WhatsApp.</p>
      <h3>Refund Process</h3>
      <p>Approved refunds are processed within <strong>5 to 7 working days</strong> back to your original payment method. You'll receive a WhatsApp confirmation once initiated.</p>
      <h3>Contact Us</h3>
      <p>Reach us on WhatsApp at <strong>+91 90253 05650</strong> or email <strong>contact.yourgiftstory@gmail.com</strong>. We put our heart into every gift — if something isn't right, please reach out.</p>`
  },
  faqs: {
    title: 'FAQs',
    body: `
      <div class="policy-tag">Frequently Asked Questions</div>
      <h3>1. How long does delivery take?</h3>
      <p>Delivery timelines vary depending on the gift you choose. Once your order is confirmed, we'll reach out on WhatsApp and let you know the exact timeline based on your specific gift. Most orders are delivered within <strong>5 to 7 working days</strong> — we'll keep you informed every step of the way.</p>
      <h3>2. Can I fully customise my gift?</h3>
      <p>Absolutely! Every product at Your Gift Story is <strong>100% customisable</strong> — names, photos, messages, colours, and more. After you place your order, we'll reach out on WhatsApp to collect all your personalisation details.</p>
      <h3>3. What if my gift arrives damaged?</h3>
      <p>In the rare case your gift arrives damaged, contact us within <strong>48 hours of delivery</strong> with photos via WhatsApp or email. We'll review and arrange a replacement or refund as quickly as possible.</p>
      <h3>4. Can I cancel my order?</h3>
      <p>Orders can be cancelled within <strong>2 hours</strong> of placing them, before personalisation work begins. Once our artisans have started crafting, cancellations are not possible as materials and time have already been invested.</p>
      <h3>5. Do you deliver across India?</h3>
      <p>Yes! We are based in <strong>Coimbatore, Tamil Nadu</strong> and deliver pan India — no matter which city or town your loved one is in. All orders are placed and managed <strong>100% online</strong>.</p>`
  }
};

function openPolicy(type) {
  const p = POLICIES[type];
  if (!p) return;
  document.getElementById('policyTitle').textContent = p.title;
  document.getElementById('policyBody').innerHTML = p.body;
  document.getElementById('policyOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePolicy() {
  document.getElementById('policyOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Close on Escape key
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closePolicy(); closeMobileNav(); closeFiltersSheet(); } });

function scrollToAbout() { if (currentPage !== 'home') showPage('home'); setTimeout(() => document.getElementById('about-section').scrollIntoView({behavior:'smooth'}), 100); }
function scrollToContact() { if (currentPage !== 'home') showPage('home'); setTimeout(() => document.getElementById('contact-section').scrollIntoView({behavior:'smooth'}), 100); }

/* ════ FAQ STRUCTURED DATA — boosts featured snippets & voice search ════ */
/* Kept in sync with the visible FAQ popup content above (POLICIES.faqs) —
   Google requires FAQPage schema to match what's actually shown on the page */
(function() {
  var faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': [
      { '@type': 'Question', 'name': 'How long does delivery take?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'Delivery timelines vary depending on the gift you choose. Once your order is confirmed, we will reach out on WhatsApp and let you know the exact timeline based on your specific gift. Most orders are delivered within 5 to 7 working days.' } },
      { '@type': 'Question', 'name': 'Can I fully customise my gift?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'Every product at Your Gift Story is fully customisable — names, photos, messages, colours and more. After you place your order, we will reach out on WhatsApp to collect all your personalisation details.' } },
      { '@type': 'Question', 'name': 'What if my gift arrives damaged?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'In the rare case your gift arrives damaged, contact us within 48 hours of delivery with photos via WhatsApp or email. We will review and arrange a replacement or refund as quickly as possible.' } },
      { '@type': 'Question', 'name': 'Can I cancel my order?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'Orders can be cancelled within 2 hours of placing them, before personalisation work begins. Once our artisans have started crafting, cancellations are not possible as materials and time have already been invested.' } },
      { '@type': 'Question', 'name': 'Do you deliver across India?',
        'acceptedAnswer': { '@type': 'Answer', 'text': 'Yes! We are based in Coimbatore, Tamil Nadu and deliver pan India — no matter which city or town your loved one is in. All orders are placed and managed 100% online.' } }
    ]
  };
  var s = document.createElement('script');
  s.type = 'application/ld+json';
  s.textContent = JSON.stringify(faq);
  document.head.appendChild(s);
})();

/* start */
initSite();
