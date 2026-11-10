const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let ALL_BOOKS = [];
let CATEGORIES = [];
let activeCategory = 'All';
let searchQuery = '';

let touched = false;
let x = 0;
let maxX = 0;
let target = 0;
let raf = 0;

const stage = $('#stage');
const track = $('#track');
const scrubTrack = $('#scrubTrack');
const hist = $('#hist');
const ticks = $('#ticks');
const win = $('#win');
const card = $('#card');
const spinePreview = $('#spinePreview');
const posLabel = $('#pos');

// Seamless data loading (supports both HTTP server fetch and direct file:// opening)
async function loadBooks() {
  try {
    const res = await fetch('books.json');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Network fetch not available, checking for embedded data:', err);
  }
  if (window.EMBEDDED_BOOKS && Array.isArray(window.EMBEDDED_BOOKS)) {
    return window.EMBEDDED_BOOKS;
  }
  throw new Error('Unable to load book dataset.');
}

loadBooks()
  .then(init)
  .catch(err => {
    console.error('Failed to load books:', err);
    $('#stats').innerHTML = '<div>Error loading books</div>';
  });

function init(data) {
  ALL_BOOKS = data;

  // Extract unique categories preserving order
  const cats = [];
  for (const b of ALL_BOOKS) {
    if (!cats.includes(b.category)) cats.push(b.category);
  }
  CATEGORIES = cats;

  updateStats();
  renderShelves();
  initControls();
  initTheme();
  layout();

  window.addEventListener('resize', layout);

  // Setup interactions
  setupDrag();
  setupScrubber();
  setupKeyboard();

  // Jump smoothly to first category
  setTimeout(() => {
    goCategory(CATEGORIES[0], false);
  }, 60);
}

function updateStats() {
  const totalBooks = ALL_BOOKS.length;
  const totalPages = ALL_BOOKS.reduce((sum, b) => sum + (b.pages || 0), 0);
  const totalCats = CATEGORIES.length;

  $('#stats').innerHTML = `
    <div><b>${totalBooks}</b><span>Books</span></div>
    <div><b>${totalCats}</b><span>Disciplines</span></div>
    <div><b>${Math.round(totalPages / 1000)}k</b><span>Pages</span></div>
  `;
}

function renderShelves() {
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = [];
  for (const b of ALL_BOOKS) {
    if (byCat[b.category]) byCat[b.category].push(b);
  }

  track.innerHTML = CATEGORIES.map(cat => {
    const list = byCat[cat] || [];
    return `
      <section class="cat-section" data-cat="${esc(cat)}">
        <div class="clabel">
          ${esc(cat)}
          <small>${list.length} volume${list.length > 1 ? 's' : ''}</small>
        </div>
        <div class="books">
          ${list.map(renderSpine).join('')}
        </div>
      </section>
    `;
  }).join('');

  track.querySelectorAll('.spine').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      hidePreview();
      showCard(el);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hidePreview();
        showCard(el);
      }
    });
    el.addEventListener('mouseenter', () => {
      showPreview(el);
    });
    el.addEventListener('mouseleave', () => {
      hidePreview();
    });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#card') && !e.target.closest('.spine')) {
      hideCard();
    }
  });

  applyFilters();
}

function getColophon(b) {
  const cat = b.category || '';
  if (cat.includes('Sociology')) {
    return `<svg viewBox="0 0 24 24"><path d="M4 4h16v2H4zm2 3h2v11H6zm5 0h2v11h-2zm5 0h2v11h-2zM4 19h16v2H4z"/></svg>`;
  }
  if (cat.includes('Psychology')) {
    return `<svg viewBox="0 0 24 24"><circle cx="8.5" cy="10" r="2.5"/><circle cx="15.5" cy="10" r="2.5"/><path d="M12 13l-1.5 2.5h3L12 13zm-8-3c0 4.4 3.6 8 8 8s8-3.6 8-8c0-3-1.6-5.6-4-7l-1 2c1.7 1 3 2.8 3 5 0 3.3-2.7 6-6 6s-6-2.7-6-6c0-2.2 1.3-4 3-5l-1-2C5.6 4.4 4 7 4 10z"/></svg>`;
  }
  if (cat.includes('Anthropology')) {
    return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="12" cy="12" rx="4.5" ry="9" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }
  if (cat.includes('History')) {
    return `<svg viewBox="0 0 24 24"><path d="M2 5v14c0 .55.45 1 1 1 3 0 6.5 1 9 3 2.5-2 6-3 9-3 .55 0 1-.45 1-1V5c0-.55-.45-1-1-1-3 0-6.5 1-9 3-2.5-2-6-3-9-3-.55 0-1 .45-1 1zm9 13.5c-2.3-.9-5.1-1.5-7-1.5V6.5c1.9 0 4.7.6 7 1.5v10.5zm2 0V8c2.3-.9 5.1-1.5 7-1.5v10.5c-1.9 0-4.7.6-7 1.5z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="9" x2="12" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;
}

function renderSpine(b) {
  const isMatch = checkMatch(b);
  const dimmedClass = isMatch ? '' : ' dimmed';
  // Proportional thickness from actual page count (Ben Tossell bookshelf style)
  const spineW = Math.max(22, Math.min(54, Math.round(18 + (b.pages / 28))));
  const spineH = b.spine_h || 330;
  const style = `width:calc(${spineW}px * var(--k, 1));height:calc(${spineH}px * var(--k, 1));background-color:${b.color};color:${b.ink};`;
  const a11y = `role="button" tabindex="0" aria-label="${esc(b.short)} by ${esc(b.author)}"`;

  return `
    <div class="spine${dimmedClass}" ${a11y} data-id="${b.id}" style="${style}">
      <div class="spine-headband"></div>
      <div class="spine-texture"></div>
      <div class="spine-joints"></div>
      <div class="spine-lighting"></div>
      <div class="spine-top-accent" style="background:${b.accent || b.ink}"></div>
      <span class="spine-author">${esc(b.author)}</span>
      <span class="spine-title">${esc(b.short)}</span>
      <div class="spine-colophon" aria-hidden="true">${getColophon(b)}</div>
    </div>
  `;
}

function showPreview(el) {
  if (card.classList.contains('on') && el.classList.contains('sel')) return;
  const b = ALL_BOOKS.find(x => x.id === el.dataset.id);
  if (!b) return;

  spinePreview.innerHTML = `
    <div class="preview-cover-wrap">
      <img src="${b.cover}" alt="${esc(b.short)}" class="preview-cover" 
           onerror="this.onerror=null;this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;background:${b.color};color:${b.ink};font-size:9px;padding:4px;display:flex;align-items:center;text-align:center;\\'>${esc(b.short)}</div>'" />
    </div>
    <div class="preview-info">
      <div class="preview-title">${esc(b.short)}</div>
      <div class="preview-author">${esc(b.author)}</div>
      <div class="preview-meta">${b.year} · ${b.pages} pages</div>
    </div>
  `;

  spinePreview.classList.add('on');

  const r = el.getBoundingClientRect();
  const pw = spinePreview.offsetWidth || 250;
  const ph = spinePreview.offsetHeight || 86;

  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(12, Math.min(window.innerWidth - pw - 12, left));

  let top = r.top - ph - 14;
  if (top < 8) {
    top = r.bottom + 14;
  }

  spinePreview.style.left = left + 'px';
  spinePreview.style.top = top + 'px';
}

function hidePreview() {
  spinePreview.classList.remove('on');
}

function checkMatch(b) {
  const matchesCat = (activeCategory === 'All' || b.category === activeCategory);
  if (!matchesCat) return false;
  if (!searchQuery) return true;

  const q = searchQuery.toLowerCase();
  return b.title.toLowerCase().includes(q) ||
         b.author.toLowerCase().includes(q) ||
         b.category.toLowerCase().includes(q) ||
         (b.alternative_insight && b.alternative_insight.toLowerCase().includes(q)) ||
         (b.curator && b.curator.toLowerCase().includes(q));
}

function applyFilters() {
  let matchedCount = 0;
  track.querySelectorAll('.spine').forEach(el => {
    const b = ALL_BOOKS.find(x => x.id === el.dataset.id);
    if (!b) return;
    const match = checkMatch(b);
    if (match) {
      el.classList.remove('dimmed');
      matchedCount++;
    } else {
      el.classList.add('dimmed');
    }
  });

  renderHistogram();
}

function renderHistogram() {
  const counts = CATEGORIES.map(cat => {
    return ALL_BOOKS.filter(b => b.category === cat && checkMatch(b)).length;
  });
  const max = Math.max(...counts, 1);

  hist.innerHTML = CATEGORIES.map((cat, i) => {
    const h = (counts[i] / max) * 100;
    return `<div data-cat="${esc(cat)}" title="${esc(cat)}: ${counts[i]} books" style="height:${Math.max(8, h)}%"></div>`;
  }).join('');

  drawTicks();
}

function layout() {
  const sw0 = track.scrollWidth;
  const frac = sw0 ? (x + stage.clientWidth / 2) / sw0 : null;
  const h = stage.clientHeight;

  const shelfY = Math.max(90, Math.min(150, h * 0.18));
  const bookMaxH = Math.min(h - shelfY - 50, 480);
  const k = Math.max(0.65, Math.min(1.15, bookMaxH / 370));

  document.documentElement.style.setProperty('--k', k);
  document.documentElement.style.setProperty('--shelfY', shelfY + 'px');

  requestAnimationFrame(() => {
    maxX = Math.max(0, track.scrollWidth - stage.clientWidth);
    if (!touched) {
      goCategory(CATEGORIES[0], false);
    } else {
      setX(frac == null ? x : frac * track.scrollWidth - stage.clientWidth / 2, true);
    }
    drawTicks();
  });
}

function setX(v, instant) {
  target = Math.max(0, Math.min(maxX, v));
  if (instant) {
    x = target;
    applyTransform();
  } else if (!raf) {
    raf = requestAnimationFrame(tick);
  }
}

function tick() {
  x += (target - x) * 0.2;
  if (Math.abs(target - x) < 0.5) x = target;
  applyTransform();
  raf = (x !== target) ? requestAnimationFrame(tick) : 0;
}

function applyTransform() {
  track.style.transform = `translate3d(${-x}px,0,0)`;
  const W = track.scrollWidth;
  const vw = stage.clientWidth;
  const tw = scrubTrack.clientWidth;

  if (W > 0 && tw > 0) {
    win.style.left = (x / W * tw) + 'px';
    win.style.width = Math.max(16, vw / W * tw) + 'px';
  }

  const cur = currentCategory();
  posLabel.textContent = cur ? `Viewing: ${cur}` : '';
}

function categoryLeft(cat) {
  const el = track.querySelector(`.cat-section[data-cat="${cat}"]`);
  return el ? el.offsetLeft : 0;
}

function currentCategory() {
  const mid = x + stage.clientWidth / 2;
  let cur = CATEGORIES[0];
  for (const cat of CATEGORIES) {
    if (categoryLeft(cat) <= mid) cur = cat;
  }
  return cur;
}

function goCategory(cat, smooth = true) {
  const left = categoryLeft(cat) - stage.clientWidth * 0.08;
  setX(left, !smooth);
}

function drawTicks() {
  const W = track.scrollWidth;
  const tw = scrubTrack.clientWidth;
  if (!W || !tw) return;

  ticks.innerHTML = CATEGORIES.map(cat => {
    const el = track.querySelector(`.cat-section[data-cat="${cat}"]`);
    if (!el) return '';
    const px = (el.offsetLeft + el.offsetWidth / 2) / W * tw;
    return `<span style="left:${px}px">${esc(cat)}</span>`;
  }).join('');

  const hs = hist.children;
  CATEGORIES.forEach((cat, i) => {
    const el = track.querySelector(`.cat-section[data-cat="${cat}"]`);
    if (el && hs[i]) {
      hs[i].style.flex = `0 0 ${Math.max(4, el.offsetWidth / W * tw - 3)}px`;
    }
  });
}

// Drag physics with inertia
function setupDrag() {
  let down = null;
  let vel = 0;
  let lastX = 0;
  let lastT = 0;
  let moved = false;

  stage.addEventListener('pointerdown', e => {
    touched = true;
    down = { px: e.clientX, x: target, id: e.pointerId };
    vel = 0;
    lastX = e.clientX;
    lastT = performance.now();
    moved = false;
    hidePreview();
  });

  stage.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.px;
    if (!moved) {
      if (Math.abs(dx) < 6) return;
      moved = true;
      stage.setPointerCapture(down.id);
      stage.classList.add('drag');
    }
    const now = performance.now();
    vel = (e.clientX - lastX) / Math.max(1, now - lastT);
    lastX = e.clientX;
    lastT = now;
    setX(down.x - dx, true);
    hideCard();
  });

  const endDrag = () => {
    if (!down) return;
    down = null;
    stage.classList.remove('drag');
    if (moved) {
      setX(target - vel * 260);
    }
  };

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('click', e => {
    if (moved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  stage.addEventListener('wheel', e => {
    touched = true;
    e.preventDefault();
    hidePreview();
    const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ? e.deltaX : e.deltaY;
    setX(target + delta);
    hideCard();
  }, { passive: false });
}

// Scrubber setup
function setupScrubber() {
  let scrubbing = false;

  const scrubTo = e => {
    const r = scrubTrack.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setX(f * track.scrollWidth - stage.clientWidth / 2, scrubbing);
  };

  scrubTrack.addEventListener('pointerdown', e => {
    touched = true;
    scrubbing = true;
    scrubTrack.setPointerCapture(e.pointerId);
    scrubTo(e);
    hideCard();
  });

  scrubTrack.addEventListener('pointermove', e => {
    if (scrubbing) scrubTo(e);
  });

  scrubTrack.addEventListener('pointerup', () => scrubbing = false);
}

// Keyboard controls
function setupKeyboard() {
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    touched = true;

    const cur = currentCategory();
    const idx = CATEGORIES.indexOf(cur);

    if (e.key === 'ArrowRight') {
      goCategory(CATEGORIES[Math.min(CATEGORIES.length - 1, idx + 1)]);
    } else if (e.key === 'ArrowLeft') {
      goCategory(CATEGORIES[Math.max(0, idx - 1)]);
    } else if (e.key === 'Escape') {
      hideCard();
    }
  });
}

// Card details modal
function showCard(el) {
  hidePreview();
  const b = ALL_BOOKS.find(x => x.id === el.dataset.id);
  if (!b) return;

  track.querySelectorAll('.spine.sel').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');

  const linksHtml = [];
  if (b.links.amazon) linksHtml.push(`<a href="${b.links.amazon}" target="_blank" rel="noopener">Amazon ↗</a>`);
  if (b.links.goodreads) linksHtml.push(`<a href="${b.links.goodreads}" target="_blank" rel="noopener">Goodreads ↗</a>`);
  if (b.links.openlibrary) linksHtml.push(`<a href="${b.links.openlibrary}" target="_blank" rel="noopener">Open Library ↗</a>`);

  card.innerHTML = `
    <button class="card-close-btn" aria-label="Close card" onclick="hideCard()">✕</button>
    <div class="card-cover-wrap">
      <img src="${b.cover}" alt="${esc(b.title)}" class="card-cover" 
           onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'cover-fallback\\' style=\\'background:${b.color};color:${b.ink}\\'><div><div class=\\'cover-fallback-title\\'>${esc(b.short)}</div></div><div class=\\'cover-fallback-author\\'>${esc(b.author)}</div></div>'" />
    </div>
    <div class="card-body">
      <div class="card-meta-top">
        <span class="card-cat-badge">${esc(b.category)}</span>
        <span class="card-year">${b.year}</span>
        <span class="card-pages">· ${b.pages} pages</span>
      </div>
      <h3>${esc(b.title)}</h3>
      <div class="author">by ${esc(b.author)}</div>
      
      <div class="card-insight-box">
        <div class="card-insight-label">The Alternative Angle</div>
        <div class="card-insight-text">${esc(b.alternative_insight)}</div>
      </div>

      ${b.curator_note ? `
        <div class="card-curator-note">
          "${esc(b.curator_note)}"
          <span class="card-curator-source">— Recommended by ${esc(b.curator)}</span>
        </div>
      ` : ''}

      <div class="card-footer">
        <div class="card-links">
          ${linksHtml.join('')}
        </div>
      </div>
    </div>
  `;

  card.classList.add('on');

  const r = el.getBoundingClientRect();
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const pad = 14;

  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(pad, Math.min(window.innerWidth - cw - pad, left));

  let top = r.top - ch - 22;
  if (top < pad) {
    top = Math.min(window.innerHeight - ch - pad, r.bottom + 20);
  }

  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

function hideCard() {
  card.classList.remove('on');
  hidePreview();
  track.querySelectorAll('.spine.sel').forEach(s => s.classList.remove('sel'));
}

// Controls & Filter Buttons
function initControls() {
  const filterWrap = $('#filterGroup');
  const catOptions = ['All', ...CATEGORIES];

  filterWrap.innerHTML = catOptions.map(cat => {
    const active = (cat === activeCategory) ? ' active' : '';
    return `<button class="filter-btn${active}" data-cat="${esc(cat)}">${esc(cat)}</button>`;
  }).join('');

  filterWrap.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filterWrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    activeCategory = btn.dataset.cat;
    applyFilters();

    if (activeCategory !== 'All') {
      goCategory(activeCategory);
    }
  });

  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    applyFilters();
  });
}

// Theme Toggle
function initTheme() {
  const toggleBtn = $('#themeToggle');
  const saved = localStorage.getItem('bookshelf-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const current = saved || (prefersDark ? 'dark' : 'light');

  setTheme(current);

  toggleBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('bookshelf-theme', theme);
  const btn = $('#themeToggle');
  btn.innerHTML = (theme === 'dark') ? '☀️' : '🌙';
  btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
}
