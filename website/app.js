// app.js — ColorBridge website
//
// No server, no real database. Two accounts are hardcoded below and the
// signed-in session lives in this browser's localStorage under SESSION_KEY.
//
// That key is the ONE thing the Chrome extension also knows about: its
// content script "accountSync.js" (which only runs on this site — see
// extension/manifest.json) reads this same key and copies the tier into
// chrome.storage.local, so a "pro" sign-in here removes the extension's
// 10-per-day limit. Everything else about accounts is cosmetic and lives
// only in this tab.

const SESSION_KEY = 'colorbridge_session';

// The two demo accounts. This is intentionally NOT a security boundary —
// it's a local demo, so the "password check" is plain equality in the browser.
const DEMO_ACCOUNTS = {
  'free@colorbridge.app': { password: 'free1234', name: 'Alex Free', tier: 'free' },
  'pro@colorbridge.app': { password: 'pro1234', name: 'Jordan Pro', tier: 'pro' }
};

const els = {
  signinBtn: document.getElementById('signinBtn'),
  heroSigninBtn: document.getElementById('heroSigninBtn'),
  accountPill: document.getElementById('accountPill'),
  avatarLetter: document.getElementById('avatarLetter'),
  accountName: document.getElementById('accountName'),
  accountTierBadge: document.getElementById('accountTierBadge'),
  dropdown: document.getElementById('accountDropdown'),
  dropdownEmail: document.getElementById('dropdownEmail'),
  dropdownPlan: document.getElementById('dropdownPlan'),
  upgradeBox: document.getElementById('upgradeBox'),
  upgradeBtn: document.getElementById('upgradeBtn'),
  proNote: document.getElementById('proNote'),
  signoutBtn: document.getElementById('signoutBtn'),
  dialog: document.getElementById('signinDialog'),
  closeSigninBtn: document.getElementById('closeSigninBtn'),
  form: document.getElementById('signinForm'),
  emailInput: document.getElementById('emailInput'),
  passwordInput: document.getElementById('passwordInput'),
  loginError: document.getElementById('loginError')
};

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  render();
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  render();
}

function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function render() {
  const session = getSession();
  const signedIn = Boolean(session);

  els.signinBtn.hidden = signedIn;
  els.heroSigninBtn.hidden = signedIn;
  els.accountPill.hidden = !signedIn;
  els.dropdown.classList.remove('open');
  els.accountPill.setAttribute('aria-expanded', 'false');

  if (!signedIn) return;

  els.avatarLetter.textContent = initialOf(session.name);
  els.accountName.textContent = session.name;
  els.accountTierBadge.textContent = session.tier;
  els.accountTierBadge.className = `tier-badge ${session.tier}`;

  els.dropdownEmail.textContent = session.email;
  els.dropdownPlan.textContent = session.tier === 'pro' ? 'Pro' : 'Free';

  const isPro = session.tier === 'pro';
  els.upgradeBox.hidden = isPro;
  els.proNote.hidden = !isPro;
}

function openDialog() {
  els.loginError.classList.remove('show');
  els.form.reset();
  els.dialog.showModal();
}

// ---- events ----

els.signinBtn.addEventListener('click', openDialog);
els.heroSigninBtn.addEventListener('click', openDialog);
els.closeSigninBtn.addEventListener('click', () => els.dialog.close());

els.dialog.addEventListener('click', (event) => {
  // Click on the backdrop (the <dialog> element itself, outside .modal-inner) closes it.
  if (event.target === els.dialog) els.dialog.close();
});

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = els.emailInput.value.trim().toLowerCase();
  const password = els.passwordInput.value;
  const account = DEMO_ACCOUNTS[email];

  if (!account || account.password !== password) {
    els.loginError.classList.add('show');
    return;
  }

  setSession({ email, name: account.name, tier: account.tier });
  els.dialog.close();
});

document.querySelectorAll('.demo-account-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.demo === 'pro' ? 'pro@colorbridge.app' : 'free@colorbridge.app';
    els.emailInput.value = which;
    els.passwordInput.value = DEMO_ACCOUNTS[which].password;
  });
});

els.accountPill.addEventListener('click', () => {
  const isOpen = els.dropdown.classList.toggle('open');
  els.accountPill.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', (event) => {
  if (!els.dropdown.classList.contains('open')) return;
  if (els.dropdown.contains(event.target) || els.accountPill.contains(event.target)) return;
  els.dropdown.classList.remove('open');
  els.accountPill.setAttribute('aria-expanded', 'false');
});

els.signoutBtn.addEventListener('click', () => {
  clearSession();
});

// Not wired to a real payment flow yet — just reloads the homepage.
// (Was `window.location.href = '/'`, which 404'd on GitHub Pages: a project
// page like /ColorBridge/ isn't served at the domain root, only at its own
// path. Reloading the current page works the same on localhost and on Pages,
// with no path to get wrong.)
els.upgradeBtn.addEventListener('click', () => {
  window.location.reload();
});

render();
