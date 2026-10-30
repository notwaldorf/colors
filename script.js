(() => {
  const $ = s => document.querySelector(s);
  const photo = $('#photo'), pctx = photo.getContext('2d', { willReadFrequently: true });
  const loupe = $('#loupe'), lctx = loupe.getContext('2d');
  let wheel = 'ryb', sample = 5, current = null, history = [];

  /* ---------- color math ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > .5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hslToRgb([h, s, l]) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }

  // Map between the light (RGB) hue circle and the painter's (RYB) hue circle,
  // so complements come out the way painters expect: red↔green, yellow↔violet, blue↔orange.
  const HUE_MAP = [ // [rgbHue, rybHue]
    [0, 0], [35, 60], [60, 120], [120, 180], [180, 210], [240, 240], [285, 300], [360, 360]
  ];
  function interp(h, from, to) {
    h = ((h % 360) + 360) % 360;
    for (let i = 0; i < HUE_MAP.length - 1; i++) {
      const a = HUE_MAP[i], b = HUE_MAP[i + 1];
      if (h >= a[from] && h <= b[from]) {
        const t = (h - a[from]) / (b[from] - a[from] || 1);
        return a[to] + t * (b[to] - a[to]);
      }
    }
    return h;
  }
  const rgbHueToRyb = h => interp(h, 0, 1);
  const rybHueToRgb = h => interp(h, 1, 0);

  function rotate(rgb, deg) {
    const [h, s, l] = rgbToHsl(rgb);
    let nh;
    if (wheel === 'ryb') nh = rybHueToRgb((rgbHueToRyb(h) + deg + 360) % 360);
    else nh = (h + deg + 360) % 360;
    return hslToRgb([nh, s, l]);
  }
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  // Perceived value (lightness) in 0–100, as a painter would judge it.
  function value([r, g, b]) {
    const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    const Y = .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
    return Y > .008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  }

  /* ---------- loading photos ---------- */
  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1800, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      photo.width = Math.round(img.naturalWidth * scale);
      photo.height = Math.round(img.naturalHeight * scale);
      pctx.drawImage(img, 0, 0, photo.width, photo.height);
      URL.revokeObjectURL(url);
      $('#empty').classList.add('hidden');
      photo.classList.remove('hidden');
    };
    img.onerror = () => toast('Could not read that image');
    img.src = url;
  }
  $('#cam').addEventListener('change', e => loadFile(e.target.files[0]));
  $('#lib').addEventListener('change', e => loadFile(e.target.files[0]));
  const stage = $('#stage');
  stage.addEventListener('dragover', e => e.preventDefault());
  stage.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

  /* ---------- dropper + loupe ---------- */
  function canvasPoint(e) {
    const r = photo.getBoundingClientRect();
    return {
      x: clamp(Math.floor((e.clientX - r.left) * photo.width / r.width), 0, photo.width - 1),
      y: clamp(Math.floor((e.clientY - r.top) * photo.height / r.height), 0, photo.height - 1)
    };
  }
  function sampleAt(x, y) {
    const half = Math.floor(sample / 2);
    const x0 = clamp(x - half, 0, photo.width - 1), y0 = clamp(y - half, 0, photo.height - 1);
    const w = Math.min(sample, photo.width - x0), h = Math.min(sample, photo.height - y0);
    const d = pctx.getImageData(x0, y0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return [r / n, g / n, b / n];
  }
  function drawLoupe(e, p) {
    const zoom = 10, S = loupe.width, src = S / zoom;
    lctx.imageSmoothingEnabled = false;
    lctx.fillStyle = '#000'; lctx.fillRect(0, 0, S, S);
    lctx.drawImage(photo, p.x - src / 2 + .5, p.y - src / 2 + .5, src, src, 0, 0, S, S);
    // sample box
    const box = sample * zoom;
    lctx.strokeStyle = '#fff'; lctx.lineWidth = 2;
    lctx.strokeRect(S / 2 - box / 2, S / 2 - box / 2, box, box);
    lctx.strokeStyle = 'rgba(0,0,0,.6)'; lctx.lineWidth = 1;
    lctx.strokeRect(S / 2 - box / 2 - 1.5, S / 2 - box / 2 - 1.5, box + 3, box + 3);
    // position above the finger/cursor
    const off = e.pointerType === 'touch' ? 110 : 80;
    let lx = e.clientX - S / 2, ly = e.clientY - S / 2 - off;
    if (ly < 4) ly = e.clientY + off - S / 2;
    loupe.style.left = clamp(lx, 4, innerWidth - S - 4) + 'px';
    loupe.style.top = ly + 'px';
    loupe.style.display = 'block';
  }
  let dragging = false;
  function handle(e, commit) {
    const p = canvasPoint(e);
    drawLoupe(e, p);
    const c = sampleAt(p.x, p.y);
    setColor(c, commit);
  }
  photo.addEventListener('pointerdown', e => { dragging = true; photo.setPointerCapture(e.pointerId); handle(e, false); });
  photo.addEventListener('pointermove', e => { if (dragging || e.pointerType === 'mouse') { if (dragging) handle(e, false); else drawLoupe(e, canvasPoint(e)); } });
  photo.addEventListener('pointerup', e => { if (dragging) { handle(e, true); dragging = false; } loupe.style.display = e.pointerType === 'mouse' ? 'block' : 'none'; });
  photo.addEventListener('pointerleave', () => { if (!dragging) loupe.style.display = 'none'; });
  photo.addEventListener('pointercancel', () => { dragging = false; loupe.style.display = 'none'; });

  /* ---------- rendering ---------- */
  function setColor(rgb, commit) {
    current = rgb.map(Math.round);
    renderPicked();
    renderSets();
    if (commit) addHistory(current);
  }
  function addHistory(rgb) {
    const h = hex(rgb);
    history = [h, ...history.filter(x => x !== h)].slice(0, 16);
    const el = $('#history'); el.innerHTML = '';
    history.forEach(hx => {
      const b = document.createElement('button');
      b.style.background = hx; b.title = hx;
      b.onclick = () => setColor(fromHex(hx), false);
      el.appendChild(b);
    });
  }
  const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  function renderPicked() {
    const c = current, v = value(c);
    document.body.style.background = hex(c);
    document.documentElement.style.setProperty('--on-bg', v > 60 ? '#2b2620' : '#fffdf8');
  }

  function swatch(rgb, isBase, tag) {
    const b = document.createElement('button');
    b.className = 'sw' + (isBase ? ' base' : '') + (tag === 'dominant' ? ' dom' : '');
    const hx = hex(rgb);
    b.innerHTML = `<div class="chip" style="background:${hx}"></div>${tag ? `<span class="tag">${tag}</span>` : ''}${hx}`;
    b.title = isBase ? 'Your color' : 'Tap to copy · double-tap to use as base';
    b.addEventListener('click', () => copy(hx));
    b.addEventListener('dblclick', () => setColor(rgb, true));
    return b;
  }
  function section(title, note, colors, baseIdx = 0, ramp = false, tags = []) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<h3>${title} <small>${note}</small></h3>`;
    const row = document.createElement('div');
    row.className = 'row' + (ramp ? ' ramp' : '');
    colors.forEach((c, i) => row.appendChild(swatch(c, i === baseIdx, tags[i])));
    wrap.appendChild(row);
    return wrap;
  }
  function renderSets() {
    const c = current, sets = $('#sets');
    sets.innerHTML = '';
    const white = [255, 255, 255], black = [0, 0, 0];
    const gray = Array(3).fill(value(c) / 100 * 255);
    sets.append(
      section('Complementary', 'opposite on the wheel', [c, rotate(c, 180)]),
      section('Split complementary', 'softer contrast', [c, rotate(c, 150), rotate(c, 210)]),
      section('Analogous', 'neighbors, calm & unified', [rotate(c, -30), c, rotate(c, 30)], 1),
      section('Triadic', 'evenly spaced, lively', [c, rotate(c, 120), rotate(c, 240)]),
      section('Tetradic (square)', 'one leads, the rest accent', [c, rotate(c, 90), rotate(c, 180), rotate(c, 270)], 0, false, ['dominant', 'accent', 'accent', 'accent']),
      section('Muted complement', 'neutralizing mix with its complement', [0, .15, .3, .45].map(t => mix(c, rotate(c, 180), t)), 0, true),
      section('Tints', 'mixed with white', [0, .2, .4, .6, .8].map(t => mix(c, white, t)), 0, true),
      section('Shades', 'mixed with black', [0, .2, .4, .6, .8].map(t => mix(c, black, t)), 0, true),
      section('Tones', 'mixed with gray of equal value', [0, .2, .4, .6, .8].map(t => mix(c, gray, t)), 0, true)
    );
  }

  /* ---------- toggles ---------- */
  function segment(id, cb) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      cb(b.dataset.v);
    });
  }
  segment('#wheelSeg', v => { wheel = v; if (current) renderSets(); });
  segment('#sizeSeg', v => { sample = +v; });

  /* ---------- utils ---------- */
  let tt;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1400);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied ' + text); }
    catch { toast(text); }
  }

  // Start with a sample color so the harmonies aren't empty (page background stays neutral until you pick).
  current = [181, 83, 47]; renderSets();
})();
