/* ============================================================
   Garage — receipt/photo capture and viewing.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

// downscale an uploaded image to keep localStorage small; returns a JPEG data URL
function readImageResized(file, cb, max = 900) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', max > 900 ? 0.8 : 0.82));
    };
    img.onerror = () => toast('Could not read that image', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* reusable receipt/photo attachment field (resizes, tap thumbnail to enlarge) */
/* onBig (optional) also receives a 1600px copy, for bill reading; kept by the caller in memory only. */
function photoPicker(current, onChange, label, onBig) {
  let photo = current || '';
  const wrap = el('div', 'photo-picker');
  wrap.classList.add('mb-16');
  wrap.innerHTML = html`
    <div class="photo-preview${photo ? ' zoomable' : ''}" data-prev>${photo ? html`<img src="${photo}">` : '🧾'}</div>
    <div class="photo-actions">
      <button class="btn" type="button" data-pick>${photo ? t('Change receipt') : (label || t('Add receipt photo'))}</button>
      <button class="btn ghost danger-text" type="button" data-rm ${photo ? '' : 'hidden'}>${t('Remove')}</button>
      <input type="file" accept="image/*" data-file hidden>
    </div>`;
  const prev = wrap.querySelector('[data-prev]'), pick = wrap.querySelector('[data-pick]'), rm = wrap.querySelector('[data-rm]'), file = wrap.querySelector('[data-file]');
  pick.onclick = () => file.click();
  prev.onclick = () => { if (photo) openImage(photo); };
  let seq = 0;   // a newer pick or a remove makes older in-flight decodes (900 or 1600) no-ops
  file.onchange = ev => { const f = ev.target.files[0]; if (!f) return; const mine = ++seq; readImageResized(f, url => { if (mine !== seq) return; photo = url; prev.innerHTML = html`<img src="${url}">`; prev.classList.add('zoomable'); pick.textContent = t('Change receipt'); rm.hidden = false; onChange(photo); });
    if (onBig) readImageResized(f, url => { if (mine === seq) onBig(url); }, 1600); };
  rm.onclick = () => { seq++; photo = ''; prev.innerHTML = '🧾'; prev.classList.remove('zoomable'); pick.textContent = label || t('Add receipt photo'); rm.hidden = true; onChange(photo); if (onBig) onBig(''); };
  return wrap;
}
function openImage(url) {
  const host = el('div');
  host.classList.add('photo-lightbox');
  host.innerHTML = html`<img src="${url}">`;
  host.onclick = () => host.remove();
  document.body.appendChild(host);
}
