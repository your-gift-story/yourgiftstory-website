/* ═══════════════════════════════════════
   SUPABASE CONFIG — not displayed in UI
═══════════════════════════════════════ */
const _cfg = Object.freeze({
  u: APP_CONFIG.SUPABASE_URL,
  k: APP_CONFIG.SUPABASE_ANON_KEY
});

/* ═══════════════════════════════════════
   SAFE TEXT HELPER
   Escapes customer-typed text (name, address,
   order notes, item customisation) before it
   is shown in the dashboard, so a malicious
   entry can never run as code in your browser.
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

/* Supabase REST helpers */
const sb = {
  headers: () => ({ 'Content-Type':'application/json', 'apikey': _cfg.k, 'Authorization': 'Bearer ' + (_session?.access_token || _cfg.k), 'Cache-Control': 'no-store' }),
  url: (table, params='') => _cfg.u + '/rest/v1/' + table + params,
  auth: (path) => _cfg.u + '/auth/v1/' + path,
  storage: (bucket, path) => _cfg.u + '/storage/v1/object/' + bucket + '/' + path,
  storagePublic: (bucket, path) => _cfg.u + '/storage/v1/object/public/' + bucket + '/' + path,

  async query(table, params='') {
    const r = await fetch(sb.url(table, params), { headers: sb.headers() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async insert(table, data) {
    const r = await fetch(sb.url(table), { method:'POST', headers: {...sb.headers(), 'Prefer':'return=representation'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async update(table, id, data) {
    const r = await fetch(sb.url(table, '?id=eq.' + id), { method:'PATCH', headers: {...sb.headers(), 'Prefer':'return=representation'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async delete(table, id) {
    const r = await fetch(sb.url(table, '?id=eq.' + id), { method:'DELETE', headers: sb.headers() });
    if (!r.ok) throw new Error(await r.text());
    return true;
  },
  async uploadImage(file, path) {
    const r = await fetch(sb.storage('product-images', path), {
      method:'POST', headers: { 'apikey': _cfg.k, 'Authorization': 'Bearer ' + (_session?.access_token || _cfg.k), 'Content-Type': file.type, 'x-upsert': 'true', 'Cache-Control': 'no-store' },
      body: file
    });
    if (!r.ok) throw new Error(await r.text());
    return sb.storagePublic('product-images', path);
  }
};

/* ═══════════════════════════════════════  STATE  */
let _session = null;
let _products = [];
let _categories = [];
let _editingId = null;
let _chipGroups = [];
let _photoFiles = [];   // only NEW files (not yet uploaded)
let _photoUrls = [];    // ALL urls: existing + newly uploaded
let _existingPhotoCount = 0; // how many urls were pre-loaded (not new files)

/* ═══════════════════════════════════════  AUTH — uses admin_users table  */

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  if (!username || !pass) { showErr('Enter username and password.'); return; }

  setLoginState('loading');
  try {
    // Query admin_users table — match username and password
    const r = await fetch(
      sb.url('admin_users', '?username=eq.' + encodeURIComponent(username) + '&password=eq.' + encodeURIComponent(pass) + '&select=id,username'),
      { headers: { 'apikey': _cfg.k, 'Authorization': 'Bearer ' + _cfg.k } }
    );
    if (!r.ok) throw new Error('Connection error. Check your network.');
    const data = await r.json();
    if (!data || data.length === 0) throw new Error('Incorrect username or password.');

    // Store session locally
    _session = { user: data[0], access_token: _cfg.k };
    sessionStorage.setItem('ygs_admin_session', JSON.stringify(_session));
    document.getElementById('sidebarUser').textContent = username;
    const tu = document.getElementById('topbarUser'); if(tu) tu.textContent = username;
    enterApp();
  } catch(e) {
    setLoginState('error', e.message);
  }
}

function setLoginState(state, msg='') {
  document.getElementById('loginErr').style.display = state === 'error' ? 'block' : 'none';
  document.getElementById('loginErr').textContent = msg;
  document.getElementById('loginLoading').style.display = state === 'loading' ? 'block' : 'none';
}

function showErr(msg) { setLoginState('error', msg); }

function doLogout() {
  if (!confirm('Sign out?')) return;
  _session = null;
  sessionStorage.removeItem('ygs_admin_session');
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginPass').value = '';
  document.getElementById('loginUser').value = '';
}

function checkExistingSession() {
  const saved = sessionStorage.getItem('ygs_admin_session');
  if (saved) {
    try {
      _session = JSON.parse(saved);
      document.getElementById('sidebarUser').textContent = _session.user?.username || 'Admin';
      enterApp();
      return true;
    } catch(e) {}
  }
  return false;
}

async function enterApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').style.display = 'grid';
  document.getElementById('loadingOverlay').classList.remove('hidden');
  const loaderMsgs = ['Loading products…','Fetching categories…','Almost ready…','Preparing your dashboard…'];
  let msgIdx = 0;
  const loaderInterval = setInterval(() => {
    const el = document.getElementById('loaderText');
    if (el) el.textContent = loaderMsgs[msgIdx++ % loaderMsgs.length];
  }, 800);
  try {
    await Promise.all([loadCategories(), loadProducts(), loadTestimonials(), loadSettings()]);
    clearInterval(loaderInterval);
    renderDashboard();
    renderCategoryFilter();
    renderCategoryDropdown();
    renderCategoryGrid();
  } catch(e) {
    clearInterval(loaderInterval);
    showToast('Error loading data: ' + e.message, 'error');
  }
  document.getElementById('loadingOverlay').classList.add('hidden');
}

async function loadProducts() {
  _products = await sb.query('products', '?order=created_at.desc');
}

async function loadCategories() {
  _categories = await sb.query('categories', '?order=display_order.asc');
}

function showPanel(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (el) el.classList.add('active');
  const titles = {dashboard:'Dashboard',orders:'Orders',products:'Products',categories:'Categories',testimonials:'Testimonials',settings:'Site Settings'};
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  if (name === 'products') renderProducts();
  if (name === 'categories') renderCategoryGrid();
  if (name === 'testimonials') renderTestiTable();
  if (name === 'dashboard') renderDashboard();
  if (name === 'orders') loadOrders();
}

/* ═══════════════════════════════════════
   ORDERS
═══════════════════════════════════════ */
let _orders = [];
let _currentOrderId = null;

/* ── Financial Year helpers ── */
function getFY(date) {
  const d = date ? new Date(date) : null;
  // If date is invalid or null, treat as current FY
  if (!d || isNaN(d.getTime())) return currentFY();
  const y = d.getFullYear();
  const m = d.getMonth();
  const fyStart = m >= 3 ? y : y - 1;
  const s = String(fyStart).slice(2);
  const e = String(fyStart + 1).slice(2);
  return s + e;
}

function currentFY() { return getFY(new Date()); }

function buildFYOptions() {
  const sel = document.getElementById('orderFYFilter');
  if (!sel) return;
  const fys = new Set([currentFY()]);
  _orders.forEach(o => { if (o.created_at) fys.add(getFY(o.created_at)); });
  const sorted = Array.from(fys).sort((a,b) => b.localeCompare(a));
  sel.innerHTML = '<option value="all">All Years</option>' + sorted.map(fy =>
    `<option value="${fy}" ${fy === currentFY() ? 'selected' : ''}>FY 20${fy.slice(0,2)}–${fy.slice(2)}</option>`
  ).join('');
}

/* Generate YGS order number — uses order_number stored in DB if present, else derive from sequence */
function getOrderLabel(o) {
  if (o.order_number) return o.order_number;
  return '#YGS' + getFY(o.created_at) + '-???';
}

async function loadOrders() {
  const body = document.getElementById('orderTableBody');
  body.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto 1rem"></div><div>Loading orders…</div></div>';
  try {
    // Use raw fetch so we can see exact response even if it's an error object
    const res = await fetch(
      _cfg.u + '/rest/v1/orders?order=created_at.desc',
      { headers: { 'Content-Type':'application/json', 'apikey': _cfg.k, 'Authorization': 'Bearer ' + (_session?.access_token || _cfg.k) } }
    );
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div style="color:#dc2626">Supabase error ' + res.status + ':<br><small>' + JSON.stringify(data) + '</small></div></div>';
      return;
    }
    _orders = Array.isArray(data) ? data : [];
    if (_orders.length) {
      const ids = _orders.map(o=>o.id).join(',');
      try {
        const ir=await fetch(_cfg.u+'/rest/v1/order_items?order_id=in.('+ids+')&order=order_id.asc,display_order.asc',{headers:sb.headers()});
        if(ir.ok){const allItems=await ir.json();_orders.forEach(function(o){o.items=(allItems||[]).filter(function(i){return i.order_id===o.id;}).map(function(i){return{name:i.product_name,price:i.price,custom:i.custom_notes};});});}
      }catch(e){console.error('order_items:',e.message);}
    }
    buildFYOptions();
    renderOrders();
  } catch(e) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div style="color:#dc2626">Network error:<br><small>' + e.message + '</small></div></div>';
  }
}

function statusBadge(status) {
  const cls = {Pending:'status-pending',Confirmed:'status-confirmed',Shipped:'status-shipped',Delivered:'status-delivered',Cancelled:'status-cancelled'}[status] || 'status-pending';
  const icons = {Pending:'🕐',Confirmed:'✓',Shipped:'🚚',Delivered:'✅',Cancelled:'✕'};
  return '<span class="status-badge ' + cls + '">' + (icons[status]||'') + ' ' + (status||'Pending') + '</span>';
}

function renderOrders() {
  const body = document.getElementById('orderTableBody');
  const search = (document.getElementById('orderSearch')?.value || '').toLowerCase();
  const statusF = document.getElementById('orderStatusFilter')?.value || '';
  const fyF = document.getElementById('orderFYFilter')?.value || currentFY();

  let filtered = _orders.filter(o => {
    const oFY = getFY(o.created_at);
    const matchFY = fyF === 'all' || oFY === fyF;
    const matchSearch = !search ||
      (o.customer_name||'').toLowerCase().includes(search) ||
      (o.customer_phone||'').toLowerCase().includes(search) ||
      (o.order_number||'').toLowerCase().includes(search);
    const matchStatus = !statusF || o.status === statusF;
    return matchFY && matchSearch && matchStatus;
  });

  if (!filtered.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><div>' + (_orders.length ? 'No orders match your filters.' : 'No orders yet. They\'ll appear here when customers checkout.') + '</div></div>';
    return;
  }

  body.innerHTML = filtered.map(o => {
    const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items||'[]') : []);
    const itemsPreview = items.map(i => i.name).join(', ') || '—';
    const subtotal = items.reduce((s,i) => s + (Number(i.price)||0), 0);
    const date = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const label = getOrderLabel(o);
    return `<div class="order-row" onclick="openOrderDetail('${o.id}')">
      <div class="order-id">${label}</div>
      <div class="order-customer"><div class="order-customer-name">${o.customer_name||'—'}</div><div class="order-customer-phone">${o.customer_phone||''}</div></div>
      <div class="order-items-preview" title="${itemsPreview}">${itemsPreview}</div>
      <div class="order-date">${date}</div>
      <div class="order-total">₹${subtotal.toLocaleString('en-IN')}</div>
      <div>${statusBadge(o.status)}</div>
    </div>`;
  }).join('');
}

function openOrderDetail(id) {
  const o = _orders.find(x => x.id === id);
  if (!o) return;
  _currentOrderId = id;
  const items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items||'[]') : []);
  const subtotal = items.reduce((s,i) => s + (Number(i.price)||0), 0);
  const date = o.created_at ? new Date(o.created_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const label = getOrderLabel(o);
  document.getElementById('orderDetailTitle').textContent = label;

  const addressLine = [o.customer_address, o.customer_city, o.customer_pincode].filter(Boolean).join(', ') || '—';

  document.getElementById('orderDetailBody').innerHTML = `
    <div class="order-detail-section">
      <div class="order-detail-label">Customer</div>
      <div style="background:#f9f7f4;border-radius:12px;padding:1rem;display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
        <div><div style="font-size:11px;color:var(--gray);margin-bottom:3px">Name</div><div style="font-size:14px;font-weight:500">${escapeHtml(o.customer_name)||'—'}</div></div>
        <div><div style="font-size:11px;color:var(--gray);margin-bottom:3px">Phone</div><div style="font-size:14px;font-weight:500">${escapeHtml(o.customer_phone)||'—'}</div></div>
        <div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray);margin-bottom:3px">Delivery Address</div><div style="font-size:13px;font-weight:500">${escapeHtml(addressLine)}</div></div>
        <div><div style="font-size:11px;color:var(--gray);margin-bottom:3px">Date & Time</div><div style="font-size:13px">${date}</div></div>
        <div><div style="font-size:11px;color:var(--gray);margin-bottom:3px">Source</div><div style="font-size:13px;text-transform:capitalize">${o.source||'website'}</div></div>
      </div>
    </div>
    <div class="order-detail-section">
      <div class="order-detail-label">Items Ordered</div>
      <div class="order-items-list">${items.map(i => `
        <div class="order-item-row">
          <div><div class="order-item-name">${escapeHtml(i.name)}</div><div class="order-item-custom">${escapeHtml(i.custom)}</div></div>
          <div class="order-item-price">₹${Number(i.price).toLocaleString('en-IN')}</div>
        </div>`).join('')}
        <div style="text-align:right;padding:.5rem 1rem 0;font-size:13px;color:var(--gray)">Subtotal: <strong style="color:var(--teal);font-family:var(--font-display);font-size:16px">₹${subtotal.toLocaleString('en-IN')}</strong></div>
        <div style="text-align:right;padding:0 1rem;font-size:11px;color:var(--gray)">+ delivery charges confirmed separately</div>
      </div>
    </div>
    ${o.notes ? `<div class="order-detail-section"><div class="order-detail-label">Notes</div><div style="background:#f9f7f4;border-radius:10px;padding:.75rem 1rem;font-size:13px">${escapeHtml(o.notes)}</div></div>` : ''}
    <div class="order-detail-section">
      <div class="order-detail-label">Update Status</div>
      <select class="status-select" id="orderStatusSelect">
        ${['Pending','Confirmed','Shipped','Delivered','Cancelled'].map(s => `<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>`;
  document.getElementById('orderDetailModal').classList.add('open');
}

function closeOrderDetail() {
  document.getElementById('orderDetailModal').classList.remove('open');
  _currentOrderId = null;
}

async function saveOrderStatus() {
  if (!_currentOrderId) return;
  const status = document.getElementById('orderStatusSelect').value;
  try {
    await sb.update('orders', _currentOrderId, { status });
    const o = _orders.find(x => x.id === _currentOrderId);
    if (o) o.status = status;
    renderOrders();
    closeOrderDetail();
    showToast('Order status updated to ' + status);
  } catch(e) { showToast('Failed to update: ' + e.message, 'error'); }
}

async function deleteCurrentOrder() {
  if (!_currentOrderId) return;
  if (!confirm('Delete this order permanently? This cannot be undone.')) return;
  try {
    await sb.delete('orders', _currentOrderId);
    _orders = _orders.filter(o => o.id !== _currentOrderId);
    renderOrders();
    closeOrderDetail();
    showToast('Order deleted.');
  } catch(e) { showToast('Failed to delete: ' + e.message, 'error'); }
}

/* ── Manual Order Entry ── */
let _manualItems = [];

function openManualOrderModal() {
  _manualItems = [];
  document.getElementById('mo-name').value = '';
  document.getElementById('mo-phone').value = '';
  document.getElementById('mo-notes').value = '';
  document.getElementById('mo-status').value = 'Pending';
  renderManualItems();
  document.getElementById('manualOrderModal').classList.add('open');
}

function closeManualOrderModal() {
  document.getElementById('manualOrderModal').classList.remove('open');
}

function addManualItem() {
  _manualItems.push({ name: '', price: 0, custom: '' });
  renderManualItems();
}

function renderManualItems() {
  const list = document.getElementById('mo-items-list');
  if (!_manualItems.length) { list.innerHTML = '<div style="font-size:12px;color:var(--gray);padding:.5rem 0">No items yet. Click "+ Add Item" below.</div>'; return; }
  list.innerHTML = _manualItems.map((item, i) => `
    <div class="manual-item-row">
      <input placeholder="Item name · customisation" value="${item.name}" oninput="_manualItems[${i}].name=this.value">
      <input type="number" placeholder="Price ₹" value="${item.price||''}" oninput="_manualItems[${i}].price=Number(this.value)||0">
      <button class="variant-row-del" onclick="_manualItems.splice(${i},1);renderManualItems()">✕</button>
    </div>`).join('');
}

/* Generate next order number for a given FY */
async function generateOrderNumber(fy) {
  try {
    // Count orders in this FY from DB
    const fyStart = '20' + fy.slice(0,2) + '-04-01';
    const fyEnd   = '20' + fy.slice(2)   + '-03-31';
    const existing = await sb.query('orders', '?created_at=gte.' + fyStart + '&created_at=lte.' + fyEnd + 'T23:59:59&select=order_number&order=created_at.asc');
    const seq = (existing||[]).length + 1;
    return '#YGS' + fy + '-' + String(seq).padStart(3, '0');
  } catch(e) {
    return '#YGS' + fy + '-' + String(Date.now()).slice(-3);
  }
}

async function saveManualOrder() {
  const name = document.getElementById('mo-name').value.trim();
  if (!name) { showToast('Customer name is required.', 'error'); return; }
  if (!_manualItems.length || !_manualItems[0].name) { showToast('Add at least one item.', 'error'); return; }
  const fy = currentFY();
  const orderNumber = await generateOrderNumber(fy);
  const order = {
    order_number:   orderNumber,
    customer_name:  name,
    customer_phone: document.getElementById('mo-phone').value.trim(),
    items:          _manualItems,
    status:         document.getElementById('mo-status').value,
    notes:          document.getElementById('mo-notes').value.trim(),
    source:         'manual'
  };
  try {
    const saved = await sb.insert('orders', order);
    _orders.unshift(saved[0]);
    buildFYOptions();
    renderOrders();
    closeManualOrderModal();
    showToast('✓ Order ' + orderNumber + ' saved!');
  } catch(e) { showToast('Failed to save order: ' + e.message, 'error'); }
}

function renderDashboard() {
  document.getElementById('stat-total').innerHTML = '<em>' + _products.length + '</em>';
  document.getElementById('stat-active').innerHTML = '<em>' + _products.filter(p=>p.is_active).length + '</em>';
  document.getElementById('stat-best').innerHTML = '<em>' + _products.filter(p=>p.is_bestseller).length + '</em>';
  document.getElementById('stat-cats').innerHTML = '<em>' + _categories.length + '</em>';

  const recent = _products.slice(0,5);
  const best = _products.filter(p=>p.is_bestseller).slice(0,4);

  document.getElementById('recentList').innerHTML = recent.length
    ? recent.map(p => quickItem(p)).join('')
    : '<div style="text-align:center;padding:2rem;color:var(--gray);font-size:13px">No products yet. Add your first!</div>';

  document.getElementById('bestList').innerHTML = best.length
    ? best.map(p => quickItem(p, 'best')).join('')
    : '<div style="text-align:center;padding:2rem;color:var(--gray);font-size:13px">No bestsellers set yet.<br>Toggle bestseller on any product.</div>';
}

function quickItem(p, type) {
  const thumb = p.photos && p.photos[0]
    ? `<img src="${p.photos[0]}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">`
    : (p.emoji || '🎁');
  const badge = type === 'best' ? '<span class="badge badge-best">⭐ Best</span>'
    : `<span class="badge ${p.is_active ? 'badge-active' : 'badge-hidden'}">${p.is_active ? 'Active' : 'Hidden'}</span>`;
  return `<div class="quick-item"><div class="quick-item-icon">${thumb}</div><div class="quick-item-name">${p.name}</div><div class="quick-item-price">₹${Number(p.price).toLocaleString('en-IN')}</div>${badge}</div>`;
}

function renderProducts() {
  const q = document.querySelector('.search-box')?.value.toLowerCase() || '';
  const cf = document.getElementById('catFilter')?.value || '';
  const sf = document.getElementById('statusFilter')?.value || '';

  let list = [..._products];
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q));
  if (cf) list = list.filter(p => p.category === cf);
  if (sf === 'active') list = list.filter(p => p.is_active);
  else if (sf === 'hidden') list = list.filter(p => !p.is_active);
  else if (sf === 'bestseller') list = list.filter(p => p.is_bestseller);

  const body = document.getElementById('productTableBody');
  if (!list.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">🎁</div><div>No products found.</div></div>';
    return;
  }

  body.innerHTML = list.map(p => {
    const thumb = p.photos && p.photos[0]
      ? `<img src="${p.photos[0]}" alt="${p.name}">`
      : (p.emoji || '🎁');
    return `<div class="table-row">
      <div class="product-thumb">${thumb}</div>
      <div class="product-name-cell"><div class="product-name">${p.name}</div><div class="product-cat">${p.category}</div></div>
      <div class="product-price-cell">₹${Number(p.price).toLocaleString('en-IN')}</div>
      <div><span class="badge badge-active" style="font-size:11px">${p.category}</span></div>
      <div><label class="toggle" title="${p.is_bestseller?'Remove from bestsellers':'Mark as bestseller'}" onclick="toggleBestseller('${p.id}',${!p.is_bestseller})"><input type="checkbox" ${p.is_bestseller?'checked':''}><div class="toggle-track"></div><div class="toggle-thumb"></div><span class="toggle-star">★</span></label></div>
      <div><span class="badge ${p.is_active?'badge-active':'badge-hidden'}">${p.is_active?'Active':'Hidden'}</span></div>
      <div class="row-actions">
        <button class="act-btn" onclick="openProductModal('${p.id}')" title="Edit">✏️</button>
        <button class="act-btn" onclick="toggleActive('${p.id}',${!p.is_active})" title="${p.is_active?'Hide':'Show'}">${p.is_active?'👁️':'🚫'}</button>
        <button class="act-btn del" onclick="deleteProduct('${p.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openProductModal(id) {
  _editingId = id || null;
  _chipGroups = [];
  _photoFiles = [];
  _photoUrls = [];
  _compressStates = {};
  _existingPhotoCount = 0;
  try { clearCurrentGroup(); } catch(e) {}
  const _og = document.getElementById('optionGroupsList'); if(_og) _og.innerHTML = '';
  const _pp = document.getElementById('photoPreviews'); if(_pp) _pp.innerHTML = '';
  const _up = document.getElementById('uploadProgress'); if(_up) _up.style.display = 'none';

  if (id) {
    const p = _products.find(x => x.id === id);
    document.getElementById('modalTitle').textContent = 'Edit Product';
    document.getElementById('f-name').value = p.name || '';
    document.getElementById('f-price').value = p.price || '';
    document.getElementById('f-category').value = p.category || '';

    document.getElementById('f-desc').value = p.description || '';
    document.getElementById('f-bestseller').checked = !!p.is_bestseller;
    document.getElementById('f-active').checked = !!p.is_active;

    // Restore text customisation
    _questions = [];
    renderQuestions();
    document.getElementById('f-notice').value = p.notice_message || '';
    loadProductQuestions(id).then(function(qs){ _questions = qs; renderQuestions(); });
    _chipGroups = [];
    _variantRowCount = 0;
    // Use async load with proper await — show loading state
    loadProductOptions(id).then(opts => {
      _chipGroups = Array.isArray(opts) ? opts : [];
      renderOptionGroups();
    }).catch(() => {
      _chipGroups = [];
      renderOptionGroups();
    });
    if (p.photos && p.photos.length) {
      _photoUrls = p.photos.filter(u => u && u.startsWith('http'));
      _existingPhotoCount = _photoUrls.length;
      renderPhotoPreviews();
    }
  } else {
    document.getElementById('modalTitle').textContent = 'Add New Product';
    ['f-name','f-price','f-desc','f-opt-label'].forEach(i => { const el=document.getElementById(i); if(el) el.value=''; });
    document.getElementById('f-category').value = '';
    document.getElementById('f-bestseller').checked = false;
    document.getElementById('f-active').checked = true;
    clearCurrentGroup();
    addVariantRow();
  }
  document.getElementById('productModal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('open');
  _editingId = null;
}

async function saveProduct() {
  const name = document.getElementById('f-name').value.trim();
  const price = document.getElementById('f-price').value;
  const cat = document.getElementById('f-category').value;
  if (!name || !price || !cat) { showToast('Fill in Name, Price and Category.', 'error'); return; }

  // add any pending chip group
  collectPendingChipGroup();

  const btn = document.getElementById('saveBtn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  try {
    // Upload new photo files to Supabase Storage
    if (_photoFiles.length) {
      document.getElementById('uploadProgress').style.display = 'block';
      const _toSlug=function(s){return s.toLowerCase().trim().replace(/[^\w\s-]/g,'').replace(/[\s_]+/g,'-').replace(/-+/g,'-').slice(0,55);};
      const _buildSeoSlug=function(productName,photoIdx,photoTotal){var n=productName.toLowerCase();var prefix=n.includes('custom')||n.includes('personalised')||n.includes('personalized')?'custom':n.includes('resin')||n.includes('embroidery')||n.includes('quilling')||n.includes('string')?'handmade':'personalised';var suffix=photoTotal>1?'-'+(photoIdx+1):'';return prefix+'-'+_toSlug(productName)+'-gift-coimbatore'+suffix+'.jpg';};
      for (let i = 0; i < _photoFiles.length; i++) {
        const { file, insertIdx } = _photoFiles[i];
        const seoName = _buildSeoSlug(name, i, _photoFiles.length);
        const path = 'products/' + seoName;
        const url = await sb.uploadImage(file, path);
        _photoUrls[insertIdx] = url; // replace the base64 preview with the real URL
        document.getElementById('uploadProgressBar').style.width = ((i+1)/_photoFiles.length*100) + '%';
      }
      _photoFiles = [];
    }

    // Only save real remote URLs — strip out any base64 previews or nulls
    const cleanPhotos = _photoUrls.filter(u => u && u.startsWith('http'));

    const payload = {
      name, price: parseFloat(price), category: cat,
      emoji: null,
      description: document.getElementById('f-desc').value.trim(),
      photos: cleanPhotos,
      // Note: customisation_options saved separately via saveProductOptions()
      is_bestseller: document.getElementById('f-bestseller').checked,
      is_active: document.getElementById('f-active').checked,
      notice_message: (document.getElementById('f-notice') ? document.getElementById('f-notice').value.trim() : '') || null,
    };

    let savedId = _editingId;
    if (_editingId) {
      const updated = await sb.update('products', _editingId, payload);
      const idx = _products.findIndex(p => p.id === _editingId);
      if (idx >= 0) _products[idx] = updated[0] || {...payload, id: _editingId};
      showToast('Product updated!', 'success');
    } else {
      const created = await sb.insert('products', payload);
      _products.unshift(created[0] || payload);
      savedId = created && created[0] ? created[0].id : null;
      showToast('Product added!', 'success');
    }

    if (savedId) {
      await saveProductOptions(savedId);
      await saveProductQuestions(savedId);
    }
    closeProductModal();
    renderProducts();
    renderDashboard();
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
  }
  btn.textContent = 'Save Product'; btn.disabled = false;
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    await sb.delete('products', id);
    _products = _products.filter(p => p.id !== id);
    renderProducts(); renderDashboard();
    showToast('Product deleted.', 'error');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function toggleBestseller(id, val) {
  try {
    await sb.update('products', id, {is_bestseller: val});
    const p = _products.find(x => x.id === id);
    if (p) p.is_bestseller = val;
    renderProducts(); renderDashboard();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function toggleActive(id, val) {
  try {
    await sb.update('products', id, {is_active: val});
    const p = _products.find(x => x.id === id);
    if (p) p.is_active = val;
    renderProducts();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

let _compressStates = {};
function fmtSize(bytes){if(bytes<1024)return bytes+' B';if(bytes<1024*1024)return (bytes/1024).toFixed(0)+' KB';return (bytes/(1024*1024)).toFixed(1)+' MB';}
function compressImage(file,maxPx,quality){
  maxPx=maxPx||1200;quality=quality||0.82;
  return new Promise(function(resolve){
    var reader=new FileReader();
    reader.onload=function(e){
      var img=new Image();
      img.onload=function(){
        var w=img.width,h=img.height;
        if(w>maxPx||h>maxPx){if(w>=h){h=Math.round(h*maxPx/w);w=maxPx;}else{w=Math.round(w*maxPx/h);h=maxPx;}}
        var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        var ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
        canvas.toBlob(function(blob){
          var name=file.name.replace(/\.[^.]+$/,'')+'.jpg';
          var compressed=new File([blob],name,{type:'image/jpeg'});
          resolve({compressed:compressed,originalSize:file.size,compressedSize:compressed.size});
        },'image/jpeg',quality);
      };img.src=e.target.result;
    };reader.readAsDataURL(file);
  });
}
function handlePhotoSelect(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (file.size > 20*1024*1024) { showToast('File too large: ' + file.name + ' (max 20MB)', 'error'); return; }
    const insertIdx = _photoUrls.length;
    _photoUrls.push(null);
    _photoFiles.push({ file: null, insertIdx });
    const tempReader = new FileReader();
    tempReader.onload = function(ev) {
      _photoUrls[insertIdx] = ev.target.result;
      _compressStates[insertIdx] = 'compressing';
      renderPhotoPreviews();
    };
    tempReader.readAsDataURL(file);
    compressImage(file).then(function(result) {
      const entry = _photoFiles.find(f => f.insertIdx === insertIdx);
      if (entry) entry.file = result.compressed;
      var fr = new FileReader();
      fr.onload = function(ev2) {
        _photoUrls[insertIdx] = ev2.target.result;
        _compressStates[insertIdx] = fmtSize(result.originalSize) + ' → ' + fmtSize(result.compressedSize);
        renderPhotoPreviews();
      };
      fr.readAsDataURL(result.compressed);
    });
  });
  e.target.value = '';
}

function renderPhotoPreviews() {
  document.getElementById('photoPreviews').innerHTML = _photoUrls.map((src,i) => {
    const state=_compressStates[i];const isComp=state==='compressing';
    const badge=state?`<span class="photo-compress-badge${isComp?' compressing':''}">${isComp?'Compressing…':state}</span>`:'';
    return `<div class="photo-preview-wrap${isComp?' compressing':''}"><img src="${src||''}" alt="">${badge}<button class="photo-preview-del" onclick="removePhoto(${i})">✕</button></div>`;
  }).join('');
}

function removePhoto(i) {
  _photoUrls.splice(i, 1);
  const ns={};Object.keys(_compressStates).forEach(function(k){var ki=parseInt(k);if(ki<i)ns[ki]=_compressStates[k];if(ki>i)ns[ki-1]=_compressStates[k];});_compressStates=ns;
  _photoFiles=_photoFiles.filter(f=>f.insertIdx!==i).map(f=>({...f,insertIdx:f.insertIdx>i?f.insertIdx-1:f.insertIdx}));
  if(i<_existingPhotoCount)_existingPhotoCount--;
  renderPhotoPreviews();
}

function renderCategoryFilter() {
  const el = document.getElementById('catFilter');
  const cur = el.value;
  el.innerHTML = '<option value="">All Categories</option>' + _categories.map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
  el.value = cur;
}

function renderCategoryDropdown() {
  const el = document.getElementById('f-category');
  el.innerHTML = '<option value="">Select category</option>' + _categories.map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
}

function renderCategoryGrid() {
  const grid = document.getElementById('catAdminGrid');
  if (!_categories.length) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🗂️</div><div>No categories yet.</div></div>'; return; }
  grid.innerHTML = _categories.map((c, idx) => `
    <div class="cat-admin-card" draggable="true" data-cat-id="${c.id}" data-idx="${idx}"
      ondragstart="catDragStart(event,${idx})" ondragover="catDragOver(event)" ondrop="catDrop(event,${idx})" ondragend="catDragEnd()"
      style="cursor:grab;position:relative">
      <div style="position:absolute;top:10px;right:10px;color:#ccc;font-size:18px" title="Drag to reorder">⠿</div>
      <div class="cat-admin-name" style="font-size:16px;font-weight:600">${c.name}</div>
      <div class="cat-admin-count">${_products.filter(p=>p.category===c.name).length} products</div>
      <div class="cat-admin-actions">
        <button class="btn-sm btn-outline" style="font-size:11px;padding:5px 12px" onclick="editCat('${c.id}')">Edit</button>
        <button class="btn-sm ${c.is_active?'btn-outline':'btn-primary'}" style="font-size:11px;padding:5px 12px" onclick="toggleCat('${c.id}',${!c.is_active})">${c.is_active?'Hide':'Show'}</button>
        <button class="btn-sm btn-danger" style="font-size:11px;padding:5px 12px" onclick="deleteCat('${c.id}')">Delete</button>
      </div>
    </div>`).join('');
}
let _catDragIdx = null;
function catDragStart(e,idx){_catDragIdx=idx;e.currentTarget.style.opacity='0.4';}
function catDragEnd(){document.querySelectorAll('.cat-admin-card').forEach(el=>{el.style.opacity='';el.style.background='';});}
function catDragOver(e){e.preventDefault();e.currentTarget.style.background='var(--teal-light)';}
async function catDrop(e,toIdx){
  e.preventDefault();
  if(_catDragIdx===null||_catDragIdx===toIdx){catDragEnd();return;}
  const moved=_categories.splice(_catDragIdx,1)[0];
  _categories.splice(toIdx,0,moved);
  await Promise.all(_categories.map((c,i)=>sb.update('categories',c.id,{display_order:i+1})));
  renderCategoryGrid();renderCategoryFilter();renderCategoryDropdown();
  showToast('Category order saved!','success');
  _catDragIdx=null;
}

function addCategory() {
  _editingCatId = null;
  document.getElementById('catModalTitle').textContent = 'Add Category';
  document.getElementById('cat-name').value = '';
  document.getElementById('catModal').classList.add('open');
}

function editCat(id) {
  const c = _categories.find(x => x.id === id);
  if (!c) return;
  _editingCatId = id;
  document.getElementById('catModalTitle').textContent = 'Edit Category';
  document.getElementById('cat-name').value = c.name;
  document.getElementById('cat-icon').value = c.icon || '';
  document.getElementById('catModal').classList.add('open');
}

function closeCatModal() {
  document.getElementById('catModal').classList.remove('open');
  _editingCatId = null;
}

async function saveCat() {
  const name = document.getElementById('cat-name').value.trim();
  const icon = document.getElementById('cat-icon').value.trim() || null;
  if (!name) { showToast('Category name is required.', 'error'); return; }
  try {
    if (_editingCatId) {
      await sb.update('categories', _editingCatId, {name, icon});
      const c = _categories.find(x => x.id === _editingCatId);
      if (c) { c.name = name; c.icon = icon; }
      showToast('Category updated!', 'success');
    } else {
      const created = await sb.insert('categories', {name, icon, display_order: _categories.length + 1, is_active: true});
      _categories.push(created[0]);
      showToast('Category added!', 'success');
    }
    closeCatModal();
    renderCategoryGrid(); renderCategoryFilter(); renderCategoryDropdown();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function toggleCat(id, val) {
  try {
    await sb.update('categories', id, {is_active: val});
    const c = _categories.find(x=>x.id===id); if(c) c.is_active=val;
    renderCategoryGrid(); renderCategoryFilter(); renderCategoryDropdown();
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

async function deleteCat(id) {
  if (!confirm('Delete this category?')) return;
  try {
    await sb.delete('categories', id);
    _categories = _categories.filter(c=>c.id!==id);
    renderCategoryGrid(); renderCategoryFilter(); renderCategoryDropdown();
    showToast('Category deleted.','error');
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

async function loadTestimonials() {
  try {
    _testimonials = await sb.query('testimonials', '?order=created_at.desc');
  } catch(e) {
    _testimonials = [];
    console.error('Testimonials load error:', e.message);
  }
}

function renderTestiTable() {
  const body = document.getElementById('testiTableBody');
  if (!_testimonials.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><div>No testimonials yet.<br>Add your first customer review!</div></div>';
    return;
  }
  body.innerHTML = _testimonials.map(t => {
    const stars = '★'.repeat(parseInt(t.rating||5)) + '☆'.repeat(5-parseInt(t.rating||5));
    return `<div class="table-row" style="grid-template-columns:1fr 120px 80px 100px">
      <div>
        <div style="font-size:13px;font-weight:500;color:var(--char);margin-bottom:2px">${t.review_text ? t.review_text.substring(0,80) + (t.review_text.length>80?'…':'') : ''}</div>
        <div style="font-size:11px;color:var(--gray)">${t.occasion||''}</div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:500;color:var(--char)">${t.customer_name||''}</div>
        <div style="font-size:11px;color:var(--gray)">${t.location||''}</div>
      </div>
      <div style="color:var(--gold);font-size:12px;letter-spacing:1px">${stars}</div>
      <div class="row-actions">
        <button class="act-btn" onclick="openTestiModal('${t.id}')" title="Edit">✏️</button>
        <button class="act-btn" onclick="toggleTesti('${t.id}',${!t.is_active})" title="${t.is_active?'Hide':'Show'}">${t.is_active?'👁️':'🚫'}</button>
        <button class="act-btn del" onclick="deleteTesti('${t.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openTestiModal(id) {
  _editingTestiId = id || null;
  if (id) {
    const t = _testimonials.find(x => x.id === id);
    document.getElementById('testiModalTitle').textContent = 'Edit Review';
    document.getElementById('t-name').value = t.customer_name || '';
    document.getElementById('t-location').value = t.location || '';
    document.getElementById('t-occasion').value = t.occasion || '';
    document.getElementById('t-rating').value = t.rating || '5';
    document.getElementById('t-text').value = t.review_text || '';
    document.getElementById('t-active').checked = !!t.is_active;
  } else {
    document.getElementById('testiModalTitle').textContent = 'Add Review';
    ['t-name','t-location','t-occasion','t-text'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('t-rating').value = '5';
    document.getElementById('t-active').checked = true;
  }
  document.getElementById('testiModal').classList.add('open');
}

function closeTestiModal() {
  document.getElementById('testiModal').classList.remove('open');
  _editingTestiId = null;
}

async function saveTesti() {
  const name = document.getElementById('t-name').value.trim();
  const text = document.getElementById('t-text').value.trim();
  if (!name || !text) { showToast('Name and review text are required.', 'error'); return; }

  const payload = {
    customer_name: name,
    location: document.getElementById('t-location').value.trim(),
    occasion: document.getElementById('t-occasion').value.trim(),
    rating: parseInt(document.getElementById('t-rating').value),
    review_text: text,
    is_active: document.getElementById('t-active').checked
  };

  try {
    if (_editingTestiId) {
      const updated = await sb.update('testimonials', _editingTestiId, payload);
      const idx = _testimonials.findIndex(t => t.id === _editingTestiId);
      if (idx >= 0) _testimonials[idx] = {..._testimonials[idx], ...payload};
      showToast('Review updated!', 'success');
    } else {
      const created = await sb.insert('testimonials', payload);
      _testimonials.unshift(created[0] || payload);
      showToast('Review added!', 'success');
    }
    closeTestiModal();
    renderTestiTable();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function toggleTesti(id, val) {
  try {
    await sb.update('testimonials', id, {is_active: val});
    const t = _testimonials.find(x => x.id === id);
    if (t) t.is_active = val;
    renderTestiTable();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function deleteTesti(id) {
  if (!confirm('Delete this review?')) return;
  try {
    await sb.delete('testimonials', id);
    _testimonials = _testimonials.filter(t => t.id !== id);
    renderTestiTable();
    showToast('Review deleted.', 'error');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function saveSettings() {
  const settings = [
    {key:'whatsapp', value: document.getElementById('waNumber').value.trim()},
    {key:'email',    value: document.getElementById('shopEmail').value.trim()},
    {key:'shopName', value: document.getElementById('shopName').value.trim()},
    {key:'tagline',  value: document.getElementById('shopTagline').value.trim()},
    {key:'location', value: document.getElementById('shopLocation').value.trim()},
  ];
  try {
    for (const s of settings) {
      // Upsert: insert or update based on key
      await fetch(_cfg.u + '/rest/v1/site_settings', {
        method: 'POST',
        headers: {
          'apikey': _cfg.k,
          'Authorization': 'Bearer ' + (_session?.access_token || _cfg.k),
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(s)
      });
    }
    showToast('Settings saved and live on website!', 'success');
  } catch(e) {
    showToast('Error saving: ' + e.message, 'error');
  }
}

async function loadSettings() {
  try {
    const res = await fetch(_cfg.u + '/rest/v1/site_settings?select=key,value', {
      headers: {'apikey': _cfg.k, 'Authorization': 'Bearer ' + _cfg.k}
    });
    const data = await res.json();
    if (data && data.length) {
      const s = {};
      data.forEach(r => { s[r.key] = r.value; });
      if (s.whatsapp) document.getElementById('waNumber').value = s.whatsapp;
      if (s.email) document.getElementById('shopEmail').value = s.email;
      if (s.shopName) document.getElementById('shopName').value = s.shopName;
      if (s.tagline) document.getElementById('shopTagline').value = s.tagline;
      if (s.location) document.getElementById('shopLocation').value = s.location;
    }
  } catch(e) { console.error('Settings load:', e.message); }
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(() => t.className='toast', 3500);
}

/* === VARIANT UI === */
let _variantRowCount = 0;

function togglePriceCol() {
  const pt = document.getElementById('f-price-type');
  const show = pt && pt.value !== 'none';
  document.querySelectorAll('#variantRows .vt-price-input').forEach(function(el){ el.style.display = show ? 'block' : 'none'; });
  const np = document.getElementById('newVariantPrice');
  if (np) np.style.display = show ? 'inline-block' : 'none';
}
function quickAddVariant() {
  const ni = document.getElementById('newVariantName'), pi = document.getElementById('newVariantPrice');
  const name = ni ? ni.value.trim() : '';
  if (!name) { if(ni) ni.focus(); return; }
  const price = pi ? (parseFloat(pi.value)||0) : 0;
  addVariantRow(name, price);
  if(ni) ni.value=''; if(pi) pi.value=''; if(ni) ni.focus();
}
function addVariantRow(name, price) {
  _variantRowCount++;
  const id = 'vrow_' + _variantRowCount;
  const pt = document.getElementById('f-price-type');
  const showP = pt && pt.value !== 'none';
  const vr = document.getElementById('variantRows');
  if (!vr) return;

  const row = document.createElement('div');
  row.id = id;
  row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 6px;background:var(--white);border:1px solid var(--border);border-radius:8px';

  // Name display span
  const nameSpan = document.createElement('span');
  nameSpan.className = 'vt-name-display';
  nameSpan.textContent = name || '';
  nameSpan.style.cssText = 'flex:1;font-size:13px;font-weight:500;color:var(--char)';

  // Price display span
  const priceSpan = document.createElement('span');
  priceSpan.className = 'vt-price-display';
  priceSpan.textContent = price ? '₹' + price : '';
  priceSpan.style.cssText = 'font-size:12px;color:var(--teal);font-weight:600;min-width:40px;display:'+(showP?'inline':'none');

  // Name edit input (hidden by default)
  const ni = document.createElement('input');
  ni.type='text'; ni.className='vt-name-input form-input'; ni.value=name||''; ni.placeholder='Variant name';
  ni.style.cssText='flex:1;font-size:12px;padding:5px 8px;display:none;border-color:var(--gold);background:#fef9e7';

  // Price edit input (hidden by default)
  const pi2 = document.createElement('input');
  pi2.type='number'; pi2.className='vt-price-input form-input'; pi2.value=price||''; pi2.placeholder='₹';
  pi2.style.cssText='width:70px;font-size:12px;padding:5px 8px;display:none;border-color:var(--gold);background:#fef9e7';

  // Edit button
  const eb = document.createElement('button');
  eb.className='vt-act'; eb.textContent='✏️ Edit';
  eb.onclick = function() {
    const isEditing = eb.textContent.includes('Save');
    if (isEditing) {
      // Save
      const newName = ni.value.trim();
      if (!newName) { ni.focus(); return; }
      nameSpan.textContent = newName;
      const newPrice = parseFloat(pi2.value)||0;
      priceSpan.textContent = newPrice ? '₹'+newPrice : '';
      // switch back to display
      nameSpan.style.display=''; ni.style.display='none';
      const showPrice = pt && pt.value !== 'none';
      priceSpan.style.display = showPrice ? 'inline' : 'none'; pi2.style.display='none';
      eb.textContent='✏️ Edit';
    } else {
      // Enter edit mode
      ni.value = nameSpan.textContent;
      pi2.value = priceSpan.textContent.replace('₹','');
      nameSpan.style.display='none'; ni.style.display='block';
      const showPrice = pt && pt.value !== 'none';
      priceSpan.style.display='none'; pi2.style.display = showPrice ? 'block' : 'none';
      eb.textContent='💾 Save';
      ni.focus();
    }
  };

  // Delete button
  const db = document.createElement('button');
  db.className='vt-act del'; db.textContent='🗑️';
  db.onclick=function(){row.remove();};

  row.appendChild(nameSpan);
  row.appendChild(priceSpan);
  row.appendChild(ni);
  row.appendChild(pi2);
  row.appendChild(eb);
  row.appendChild(db);
  vr.appendChild(row);
}
function toggleEditRow(id) { /* kept for compat */ }
function startNewGroup() { try{clearCurrentGroup();}catch(e){} setTimeout(function(){const l=document.getElementById('f-opt-label');if(l)l.focus();},50); }

function clearCurrentGroup() {
  const lbl=document.getElementById('f-opt-label'); if(lbl) lbl.value='';
  const pt=document.getElementById('f-price-type'); if(pt) pt.value='none';
  const vr=document.getElementById('variantRows'); if(vr) vr.innerHTML='';
  const ni=document.getElementById('newVariantName'); if(ni) ni.value='';
  const np=document.getElementById('newVariantPrice'); if(np){np.value='';np.style.display='none';}
  const ph=document.getElementById('priceColHeader'); if(ph) ph.style.display='none';
  _variantRowCount=0;
}
function saveOptionGroup() {
  const lbl=document.getElementById('f-opt-label'), label=lbl?lbl.value.trim():'';
  const pt=document.getElementById('f-price-type'), priceType=pt?pt.value:'none';
  if(!label){showToast('Enter a group label first.','error');if(lbl)lbl.focus();return;}
  const rows=document.querySelectorAll('#variantRows > div');
  if(!rows.length){showToast('Add at least one variant.','error');return;}
  const options=[],vp={};
  rows.forEach(function(r){
    // Get name: prefer the edit input if in edit mode, else the display span
    const ni=r.querySelector('.vt-name-input'), ns=r.querySelector('.vt-name-display');
    const pi=r.querySelector('.vt-price-input'), ps=r.querySelector('.vt-price-display');
    const name=(ni&&ni.style.display!=='none'?ni.value.trim():ns?ns.textContent.trim():'');
    const price=(pi&&pi.style.display!=='none'?parseFloat(pi.value)||0:ps?parseFloat(ps.textContent.replace('₹',''))||0:0);
    if(!name)return; options.push(name); if(priceType!=='none')vp[name]=price;
  });
  if(!options.length){showToast('Add at least one variant.','error');return;}
  _chipGroups.push({label:label,options:options,priceType:priceType,variantPrices:vp});
  renderOptionGroups(); clearCurrentGroup(); showToast('Group saved!');
}
function addOptionGroup(){saveOptionGroup();}
function renderOptionGroups() {
  const list=document.getElementById('optionGroupsList'); if(!list)return;
  list.innerHTML=_chipGroups.map(function(g,i){
    const tl=g.priceType==='per_variant'?'Own price':g.priceType==='addon'?'Add-on ₹':'Same price';
    const tlColor=g.priceType!=='none'?'background:#fef3c7;color:#92400e':'background:#f0fdf4;color:#166534';
    const chips=(g.options||[]).map(function(o){
      const p=g.variantPrices?g.variantPrices[o]:0;
      return '<span style="font-size:11px;padding:4px 10px;background:var(--teal-l);border:1px solid rgba(31,78,74,.2);border-radius:20px;color:var(--teal);display:inline-flex;gap:4px;align-items:center">'+o+(p?'<b style="color:var(--gold)">+₹'+p+'</b>':'')+'</span>';
    }).join('');
    return '<div style="background:var(--white);border:1.5px solid var(--border);border-radius:12px;padding:.85rem 1rem">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      +'<div style="display:flex;gap:8px;align-items:center">'
      +'<span style="font-size:13px;font-weight:600;color:var(--teal)">'+g.label+'</span>'
      +'<span style="font-size:10px;padding:2px 8px;border-radius:20px;'+tlColor+'">'+tl+'</span>'
      +'</div>'
      +'<div style="display:flex;gap:5px">'
      +'<button class="btn-sm btn-outline" style="font-size:11px;padding:4px 12px" onclick="editSavedGroup('+i+')">✏️ Edit</button>'
      +'<button class="btn-sm btn-danger" style="font-size:11px;padding:4px 10px" onclick="_chipGroups.splice('+i+',1);renderOptionGroups()">🗑️</button>'
      +'</div></div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:5px">'+chips+'</div></div>';
  }).join('');
}
function editSavedGroup(i) {
  const g=_chipGroups[i]; if(!g)return;
  _chipGroups.splice(i,1); renderOptionGroups(); clearCurrentGroup();
  const lbl=document.getElementById('f-opt-label'); if(lbl)lbl.value=g.label;
  const pt=document.getElementById('f-price-type'); if(pt){pt.value=g.priceType||'none';togglePriceCol();}
  (g.options||[]).forEach(function(o){addVariantRow(o,g.variantPrices?(g.variantPrices[o]||0):0);});
  showToast('Edit and click Save Group.');
}
function collectPendingChipGroup(){
  const lbl=document.getElementById('f-opt-label');const label=lbl?lbl.value.trim():'';if(!label)return;
  const rows=document.querySelectorAll('#variantRows > div');if(!rows.length)return;
  const options=[],vp={};const pt=document.getElementById('f-price-type');const priceType=pt?pt.value:'none';
  rows.forEach(function(r){const ni=r.querySelector('.vt-name-input'),ns=r.querySelector('.vt-name-display');const pi=r.querySelector('.vt-price-input'),ps=r.querySelector('.vt-price-display');const name=(ni&&ni.style.display!=='none'?ni.value.trim():ns?ns.textContent.trim():'');const price=(pi&&pi.style.display!=='none'?parseFloat(pi.value)||0:ps?parseFloat(ps.textContent.replace('₹',''))||0:0);if(name){options.push(name);if(priceType!=='none')vp[name]=price;}});
  if(options.length){_chipGroups.push({label,options,priceType,variantPrices:vp});renderOptionGroups();clearCurrentGroup();}
}
function resetChipsEditor(){try{clearCurrentGroup();}catch(e){}}
async function saveProductOptions(productId) {
  if(!productId)return;
  try{
    const delRes=await fetch(_cfg.u+'/rest/v1/product_option_groups?product_id=eq.'+productId,{method:'DELETE',headers:sb.headers()});
    if(!delRes.ok)console.error('Delete groups failed:',await delRes.text());
    if(!_chipGroups.length)return;
    for(let gi=0;gi<_chipGroups.length;gi++){
      const g=_chipGroups[gi];
      const gRes=await fetch(_cfg.u+'/rest/v1/product_option_groups',{method:'POST',headers:{...sb.headers(),'Prefer':'return=representation'},body:JSON.stringify({product_id:productId,label:g.label,price_type:g.priceType||'none',display_order:gi})});
      if(!gRes.ok){console.error('Insert group failed:',await gRes.text());continue;}
      const gData=await gRes.json();const groupId=gData[0]?gData[0].id:null;if(!groupId)continue;
      for(let vi=0;vi<g.options.length;vi++){
        const val=g.options[vi];const price=(g.priceType!=='none'&&g.variantPrices)?(g.variantPrices[val]||0):0;
        const vRes=await fetch(_cfg.u+'/rest/v1/product_option_values',{method:'POST',headers:{...sb.headers(),'Prefer':'return=minimal'},body:JSON.stringify({product_id:productId,group_id:groupId,value:val,price:price,display_order:vi})});
        if(!vRes.ok)console.error('Insert value failed:',val,await vRes.text());
      }
    }
  }catch(e){console.error('saveProductOptions:',e.message);showToast('Variants save failed: '+e.message,'error');}
}
async function loadProductOptions(productId) {
  if(!productId)return[];
  try{
    const groups=await sb.query('product_option_groups','?product_id=eq.'+productId+'&order=display_order.asc');
    if(!groups||!groups.length)return[];
    const values=await sb.query('product_option_values','?product_id=eq.'+productId+'&order=display_order.asc');
    return groups.map(function(g){
      const vals=(values||[]).filter(function(v){return v.group_id===g.id;});
      const options=vals.map(function(v){return v.value;});
      const vp={};vals.forEach(function(v){if(v.price)vp[v.value]=v.price;});
      return{label:g.label,options:options,priceType:g.price_type,variantPrices:vp};
    });
  }catch(e){return[];}
}

/* ── Questions Management ── */
let _questions=[];
function addQuestion(){_questions.push({label:'',placeholder:'',required:false});renderQuestions();setTimeout(function(){var inputs=document.querySelectorAll('#questions-list .q-label-input');if(inputs.length)inputs[inputs.length-1].focus();},50);}
function removeQuestion(idx){_questions.splice(idx,1);renderQuestions();}
function renderQuestions(){
  const el=document.getElementById('questions-list');if(!el)return;
  if(!_questions.length){el.innerHTML='<div style="font-size:12px;color:var(--gray);padding:6px 0">No questions added yet.</div>';return;}
  el.innerHTML=_questions.map((q,i)=>`<div style="background:#f4f1ec;border-radius:12px;padding:.85rem 1rem;border:1px solid var(--border);display:flex;flex-direction:column;gap:.5rem"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px"><span style="font-size:11px;font-weight:600;color:var(--teal);text-transform:uppercase;letter-spacing:.06em">Question ${i+1}</span><button onclick="removeQuestion(${i})" style="background:none;border:none;color:#c0392b;font-size:13px;cursor:pointer;padding:2px 6px">✕ Remove</button></div><input class="form-input q-label-input" style="font-size:13px;margin:0" placeholder="Label e.g. Enter name to print, Share photo link…" value="${q.label}" oninput="_questions[${i}].label=this.value"><input class="form-input" style="font-size:13px;margin:0" placeholder="Placeholder hint for customer (optional)" value="${q.placeholder||''}" oninput="_questions[${i}].placeholder=this.value"><label style="display:flex;align-items:center;gap:.5rem;font-size:12px;cursor:pointer"><input type="checkbox" ${q.required?'checked':''} onchange="_questions[${i}].required=this.checked"> Make this field required</label></div>`).join('');
}
async function saveProductQuestions(productId){
  if(!productId)return;
  try{
    const delRes=await fetch(_cfg.u+'/rest/v1/product_questions?product_id=eq.'+productId,{method:'DELETE',headers:sb.headers()});
    if(!delRes.ok)console.error('Delete questions failed:',await delRes.text());
    const rows=_questions.filter(function(q){return q.label&&q.label.trim();}).map(function(q,i){return{product_id:productId,label:q.label.trim(),placeholder:(q.placeholder||'').trim(),is_required:!!q.required,display_order:i};});
    if(!rows.length)return;
    const res=await fetch(_cfg.u+'/rest/v1/product_questions',{method:'POST',headers:{...sb.headers(),'Prefer':'return=minimal'},body:JSON.stringify(rows)});
    if(!res.ok){const err=await res.text();console.error('saveProductQuestions failed:',err);showToast('Questions save failed: '+err,'error');}
  }catch(e){console.error('saveProductQuestions error:',e.message);showToast('Questions error: '+e.message,'error');}
}
async function loadProductQuestions(productId){
  try{const rows=await sb.query('product_questions','?product_id=eq.'+productId+'&order=display_order.asc');return(rows||[]).map(function(r){return{label:r.label,placeholder:r.placeholder||'',required:!!r.is_required};});}
  catch(e){return[];}
}

/* ── Bulk Image Optimiser ── */
let _optImages=[],_optRunning=false,_optStop=false,_optTotalSaved=0;
async function optScan(){
  document.getElementById('optScanBtn').disabled=true;
  document.getElementById('optStatus').textContent='Scanning…';
  _optImages=[];
  _products.forEach(function(p){(p.photos||[]).forEach(function(url,idx){if(url&&url.startsWith('http')){_optImages.push({productId:p.id,productName:p.name,productCat:p.category||'',photoTotal:(p.photos||[]).length,url:url,urlIdx:idx,status:'pending'});}});});
  document.getElementById('optTotal').textContent=_optImages.length;
  document.getElementById('optDone').textContent=0;document.getElementById('optFailed').textContent=0;document.getElementById('optSaved').textContent='0 KB';
  document.getElementById('optStatus').textContent=_optImages.length+' images found — ready to compress';
  document.getElementById('optRunBtn').style.display='inline-flex';
  document.getElementById('optListWrap').style.display='block';
  document.getElementById('optScanBtn').disabled=false;
  _optTotalSaved=0;optRenderList();
}
function optRowHTML(img,i){
  const icon={pending:'⬜',compressing:'⏳',done:'✅',failed:'❌',skipped:'⏭'}[img.status]||'⬜';
  const info=img.savedBytes!=null?'<span style="font-size:11px;color:#1F4E4A;font-weight:600;margin-left:8px">'+fmtSize(img.originalSize)+' → '+fmtSize(img.compressedSize)+' (saved '+fmtSize(img.savedBytes)+')</span>':(img.status==='failed'?'<span style="font-size:11px;color:#c0392b;margin-left:8px">'+(img.error||'Error')+'</span>':'');
  return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--cream);font-size:12px" id="optrow-'+i+'"><span style="font-size:15px">'+icon+'</span><div style="flex:1;min-width:0"><div style="font-weight:500;color:var(--charcoal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+img.productName+'</div><div style="color:var(--gray);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+img.url.split('/').pop()+(img.newFilename?' → '+img.newFilename:'')+'</div></div>'+info+'</div>';
}
function optRenderList(){const el=document.getElementById('optList');if(!_optImages.length){el.innerHTML='<div style="color:var(--gray);font-size:13px">No images found. Click Scan first.</div>';return;}el.innerHTML=_optImages.map((img,i)=>optRowHTML(img,i)).join('');}
function optUpdateRow(i){const row=document.getElementById('optrow-'+i);if(row)row.outerHTML=optRowHTML(_optImages[i],i);}
async function optRun(){
  if(_optRunning)return;if(!_optImages.length){showToast('Scan first','error');return;}
  _optRunning=true;_optStop=false;_optTotalSaved=0;
  document.getElementById('optRunBtn').style.display='none';document.getElementById('optStopBtn').style.display='inline-flex';document.getElementById('optProgressWrap').style.display='block';
  let done=0,failed=0;
  const toSlug=function(s){return s.toLowerCase().trim().replace(/[^\w\s-]/g,'').replace(/[\s_]+/g,'-').replace(/-+/g,'-').slice(0,55);};
  const buildSeoSlug=function(productName,photoIdx,photoTotal){var n=productName.toLowerCase();var prefix=n.includes('resin')||n.includes('embroidery')||n.includes('quilling')||n.includes('string')?'handmade':n.includes('custom')||n.includes('personalised')||n.includes('personalized')?'custom':'personalised';var suffix=photoTotal>1?'-'+(photoIdx+1):'';return prefix+'-'+toSlug(productName)+'-gift-coimbatore'+suffix+'.jpg';};
  for(let i=0;i<_optImages.length;i++){
    if(_optStop)break;const img=_optImages[i];if(img.status==='done'){done++;continue;}
    img.status='compressing';optUpdateRow(i);
    document.getElementById('optStatus').textContent='Processing '+(i+1)+' / '+_optImages.length+' — '+img.productName;
    try{
      const resp=await fetch(img.url);if(!resp.ok)throw new Error('Fetch failed '+resp.status);
      const blob=await resp.blob();const origFile=new File([blob],'photo.jpg',{type:blob.type||'image/jpeg'});
      const result=await compressImage(origFile,1200,0.82);
      const seoFile=buildSeoSlug(img.productName,img.urlIdx,img.photoTotal);
      const seoPath='products/'+seoFile;img.newFilename=seoFile;
      const oldFile=img.url.split('/').pop();const alreadySEO=oldFile.includes('-gift-coimbatore');
      if(result.compressedSize>=result.originalSize*0.95&&alreadySEO){img.status='skipped';img.savedBytes=0;img.originalSize=result.originalSize;img.compressedSize=result.compressedSize;optUpdateRow(i);done++;continue;}
      const fileToUpload=result.compressedSize<result.originalSize*0.95?result.compressed:origFile;
      const upResp=await fetch(_cfg.u+'/storage/v1/object/product-images/'+seoPath,{method:'POST',headers:{...sb.headers(),'Content-Type':'image/jpeg','x-upsert':'true','Cache-Control':'no-store'},body:fileToUpload});
      if(!upResp.ok)throw new Error('Upload failed '+upResp.status+': '+await upResp.text());
      const newUrl=_cfg.u+'/storage/v1/object/public/product-images/'+seoPath;
      const product=_products.find(function(p){return p.id===img.productId;});
      const newPhotos=(product&&product.photos||[]).slice();newPhotos[img.urlIdx]=newUrl;
      await sb.update('products',img.productId,{photos:newPhotos});
      if(product)product.photos=newPhotos;img.url=newUrl;
      img.status='done';img.originalSize=result.originalSize;img.compressedSize=result.compressedSize<result.originalSize*0.95?result.compressedSize:result.originalSize;img.savedBytes=img.originalSize-img.compressedSize;_optTotalSaved+=img.savedBytes;done++;
    }catch(e){img.status='failed';img.error=e.message;failed++;}
    optUpdateRow(i);
    document.getElementById('optDone').textContent=done;document.getElementById('optFailed').textContent=failed;document.getElementById('optSaved').textContent=fmtSize(_optTotalSaved);
    document.getElementById('optProgressBar').style.width=((i+1)/_optImages.length*100)+'%';
    await new Promise(function(r){setTimeout(r,100);});
  }
  _optRunning=false;document.getElementById('optStopBtn').style.display='none';document.getElementById('optRunBtn').style.display='inline-flex';
  const msg=_optStop?'Stopped. '+done+' done, '+failed+' failed.':'✅ All done! '+done+' processed · '+fmtSize(_optTotalSaved)+' saved.';
  document.getElementById('optStatus').textContent=msg;
  if(!_optStop)showToast('Done! Saved '+fmtSize(_optTotalSaved)+' across '+done+' images','success');
}
function optStop(){_optStop=true;document.getElementById('optStatus').textContent='Stopping after current image…';}

/* hide loading, check existing session */
document.getElementById('loadingOverlay').classList.add('hidden');
if (!checkExistingSession()) {
  // No saved session, show login
}