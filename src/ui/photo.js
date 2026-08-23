/* ============================================================
   Garage — receipt/photo capture and viewing.
   Plain script, like app.js — not require()d directly by any test, only
   exercised through the boot harness.
   ============================================================ */
'use strict';

// downscale an uploaded image to keep localStorage small; returns a JPEG data URL
function readImageResized(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => toast('Could not read that image', 'warn');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* reusable receipt/photo attachment field (resizes, tap thumbnail to enlarge) */
function photoPicker(current, onChange, label) {
  let photo = current || '';
  const wrap = el('div', 'photo-picker');
  wrap.style.marginBottom = '14px';
  wrap.innerHTML = html`
    <div class="photo-preview" data-prev style="cursor:${photo ? 'zoom-in' : 'default'}">${photo ? html`<img src="${photo}">` : '🧾'}</div>
    <div class="photo-actions">
      <button class="btn" type="button" data-pick>${photo ? t('Change receipt') : (label || t('Add receipt photo'))}</button>
      <button class="btn ghost" type="button" data-rm ${photo ? '' : 'hidden'} style="color:var(--danger)">${t('Remove')}</button>
      <input type="file" accept="image/*" data-file hidden>
    </div>`;
  const prev = wrap.querySelector('[data-prev]'), pick = wrap.querySelector('[data-pick]'), rm = wrap.querySelector('[data-rm]'), file = wrap.querySelector('[data-file]');
  pick.onclick = () => file.click();
  prev.onclick = () => { if (photo) openImage(photo); };
  file.onchange = ev => { const f = ev.target.files[0]; if (!f) return; readImageResized(f, url => { photo = url; prev.innerHTML = html`<img src="${url}">`; prev.style.cursor = 'zoom-in'; pick.textContent = t('Change receipt'); rm.hidden = false; onChange(photo); }); };
  rm.onclick = () => { photo = ''; prev.innerHTML = '🧾'; prev.style.cursor = 'default'; pick.textContent = label || t('Add receipt photo'); rm.hidden = true; onChange(photo); };
  return wrap;
}
function openImage(url) {
  const host = el('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.85);display:grid;place-items:center;padding:20px;cursor:zoom-out';
  host.innerHTML = html`<img src="${url}" style="max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 20px 60px -20px rgba(0,0,0,.8)">`;
  host.onclick = () => host.remove();
  document.body.appendChild(host);
}
