/* ═══════════════════════════════
   SUPABASE CONFIG (mirrors admin)
═══════════════════════════════ */
const _cfg = Object.freeze({
  u: APP_CONFIG.SUPABASE_URL,
  k: APP_CONFIG.SUPABASE_ANON_KEY
});

async function insertTestimonial(payload) {
  const r = await fetch(_cfg.u + '/rest/v1/testimonials', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': _cfg.k,
      'Authorization': 'Bearer ' + _cfg.k,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(errText);
  }
  return r.json();
}

/* ═══════════════════════
   STAR RATING LOGIC
═══════════════════════ */
let _rating = 5;
const starLabels = ['','1 star — Poor','2 stars — Fair','3 stars — Good','4 stars — Great','5 stars — Excellent!'];

document.querySelectorAll('.star-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _rating = parseInt(btn.dataset.val);
    updateStars(_rating);
  });
  btn.addEventListener('mouseenter', () => updateStars(parseInt(btn.dataset.val), true));
  btn.addEventListener('mouseleave', () => updateStars(_rating));
});

document.getElementById('starsRow').addEventListener('mouseleave', () => updateStars(_rating));

function updateStars(val, hover=false) {
  document.querySelectorAll('.star-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.val) <= val);
  });
  document.getElementById('starLabel').textContent = starLabels[val] || '';
}

/* ═══════════════════════
   CHAR COUNTER
═══════════════════════ */
document.getElementById('f-review').addEventListener('input', function() {
  const len = this.value.length;
  const el = document.getElementById('charCount');
  el.textContent = len + ' / 600';
  el.className = 'char-count' + (len > 550 ? ' warn' : '') + (len >= 600 ? ' over' : '');
});

/* ═══════════════════════
   VALIDATION
═══════════════════════ */
function showError(id, inputId, show) {
  document.getElementById(id).style.display = show ? 'block' : 'none';
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.toggle('input-error', show);
}

function validate() {
  let ok = true;
  const name = document.getElementById('f-name').value.trim();
  const review = document.getElementById('f-review').value.trim();

  showError('err-name', 'f-name', !name);
  if (!name) ok = false;

  showError('err-review', 'f-review', review.length < 20);
  if (review.length < 20) ok = false;

  showError('err-rating', null, !_rating);
  if (!_rating) ok = false;

  return ok;
}

/* ═══════════════════════
   SUBMIT
═══════════════════════ */
async function submitReview() {
  if (!validate()) return;

  const btn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const spinner = document.getElementById('btnSpinner');

  btn.disabled = true;
  btnText.textContent = 'Submitting…';
  spinner.style.display = 'block';

  const payload = {
    customer_name: document.getElementById('f-name').value.trim(),
    location: document.getElementById('f-location').value.trim() || null,
    occasion: document.getElementById('f-occasion').value || null,
    rating: _rating,
    review_text: document.getElementById('f-review').value.trim(),
    is_active: false   // hidden until admin approves
  };

  try {
    await insertTestimonial(payload);
    showSuccess(payload.customer_name);
  } catch(e) {
    btn.disabled = false;
    btnText.textContent = 'Submit My Review';
    spinner.style.display = 'none';
    alert('Something went wrong: ' + (e.message || 'Please try again.'));
  }
}

function showSuccess(name) {
  document.getElementById('formCard').style.display = 'none';
  document.getElementById('trustStrip').style.display = 'none';
  document.querySelector('.page-header').style.display = 'none';

  const firstName = name.split(/[\s,]+/)[0];
  document.getElementById('successName').textContent = firstName;
  const screen = document.getElementById('successScreen');
  screen.style.display = 'flex';
  window.scrollTo({top:0, behavior:'smooth'});
}