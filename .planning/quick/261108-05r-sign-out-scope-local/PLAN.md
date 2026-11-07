# Quick 261108-05r: sign-out scope local

Failed sign-in cleanup and endSession() in src/data/account.js call auth.signOut({ scope: 'local' }) so they end only this device's session. Deliberate signOut() stays global. Test asserts scope; sw cache regenerated.
