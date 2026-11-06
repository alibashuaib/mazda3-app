/* ============================================================
   Garage — sign-in gate. The whole app waits behind one centered sign-in
   until the owner is signed in: shown on a signed-out boot, after sign-out
   and after the session expires. Plain script; main.js calls showSignInGate()
   and openApp().
   ============================================================ */
'use strict';

/* Shows the app again and lands on the dashboard. */
function openApp() {
  $('#signinGate').hidden = true;
  $('#app').hidden = false;
  syncAdminTab();
  go('dashboard');
}

function showSignInGate() {
  const gate = $('#signinGate');
  gate.innerHTML = '';
  const card = el('div', 'card signin-card');
  const h = el('h2'); h.textContent = t('Sign in');
  const p = el('p', 'muted'); p.textContent = t('Sign in to use the app.');
  const err = el('p', 'muted'); err.hidden = true;
  const b = el('button', 'btn primary block', html`${t('Sign in')}`);
  b.type = 'button';
  onAsyncClick(b, async () => {
    err.hidden = true;
    try {
      await account.signIn($('#signinEmail').value.trim(), $('#signinPassword').value);
    } catch (e) {
      err.textContent = t('Sign-in failed. Check your email and password.');
      err.hidden = false;
      return;
    }
    catalogAdmin.startAdminSession();   // a fresh sign-in restarts the admin timer
    await catalogAdmin.isAdmin().catch(() => {});
    openApp();
  });
  card.append(
    h, p,
    field('Email', html`<input id="signinEmail" type="email" autocomplete="username">`),
    field('Password', html`<input id="signinPassword" type="password" autocomplete="current-password">`),
    err, b);
  gate.appendChild(card);
  gate.hidden = false;
  $('#app').hidden = true;
  const email = $('#signinEmail'); if (email) email.focus();
}
