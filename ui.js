/* ============================================================
   Garage — UI plumbing that is worth testing.
   Dual-mode, like storage.js: a plain <script> in the browser and
   require()d by the Node tests. Only holds logic whose failure modes are
   invisible in a render — the async click guard below is a race, not a
   layout, so it needs a test rather than an eyeball.
   ============================================================ */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {

  /* Assign async click handlers through this, never straight to .onclick.

     Phase 2 made save() async, so every handler that mutates state and then
     awaits leaves its button live and clickable across the await: a double-tap
     on Save runs the whole body twice and pushes two records with different
     uid()s. Disabling the button alone does not close the window — a second
     click can already be dispatched — so re-entry is refused with a flag too.

     Re-enabled in `finally`, which matters for the validation paths that bail
     early (`return toast('Litres required')`) and leave the modal open, and
     for a save that throws. */
  function onAsyncClick(btn, fn) {
    let running = false;
    const handler = async ev => {
      if (running) return;
      running = true;
      btn.disabled = true;
      try { return await fn(ev); }
      finally { running = false; btn.disabled = false; }
    };
    btn.onclick = handler;
    return btn;
  }

  return { onAsyncClick };
});
