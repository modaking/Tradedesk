/**
 * app.js — TradeDesk Main Application (v2)
 * ==========================================
 * Fixes in this version:
 *  - Products load correctly into all select dropdowns
 *  - Sales/Inventory/Products pages each have their own toggle (list/add/bulk)
 *  - Role abstraction: viewers can't write, staff can't manage users
 *  - Admin-only pages/actions hidden for non-admins
 *  - Change username + change password for every user
 *  - Edit product modal working
 *  - Edit user modal working
 */

/* ─────────────────────────────────────
   INLINE ALERT HELPERS
   _alert(id, msg, type, ms)  — show a dismissible alert with auto-timeout
   _alertOk(id, msg)          — success variant
   _alertClear(id)            — hide immediately
───────────────────────────────────── */
function _alert(id, msg, type = 'danger', ms = 8000) {
  const el = document.getElementById(id);
  if (!el) return;
  const icons = {
    danger:  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    success: '<polyline points="20 6 9 17 4 12"/>',
    warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  };
  el.className = `alert alert-${type}`;
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;flex-shrink:0;margin-top:1px">${icons[type] || icons.info}</svg>
    <span style="flex:1">${msg}</span>
    <button onclick="this.closest('.alert').style.display='none'" class="alert-dismiss" title="Dismiss">&times;</button>
  `;
  el.style.display = 'flex';
  el.style.opacity = '1';
  clearTimeout(el._t);
  if (ms > 0) {
    el._t = setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; el.style.opacity = ''; el.style.transition = ''; }, 420);
    }, ms);
  }
}
function _alertOk(id, msg, ms = 6000) { _alert(id, msg, 'success', ms); }
function _alertClear(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; clearTimeout(el._t); }
}

/* ─────────────────────────────────────
   STATE
───────────────────────────────────── */
const App = {
  currentPage: 'dashboard',
  currentUser: null,
  darkMode: localStorage.getItem('td_dark') === '1',
  charts: {},
};

const salesState = { page: 1, search: '', status: '' };
const invState   = { page: 1, search: '', status: '' };
const prodState  = { page: 1, search: '', category: '' };
const auditState = { page: 1, search: '', entity_type: '' };

// Debounced search handlers — wired to search inputs in the HTML
const _debouncedSales = UI.debounce(v => { salesState.search = v; loadSales(); }, 280);
const _debouncedInv   = UI.debounce(v => { invState.search   = v; loadInventory(); }, 280);
const _debouncedProd  = UI.debounce(v => { prodState.search  = v; loadProducts(); }, 280);
const _debouncedAudit = UI.debounce(v => { auditState.search = v; loadAuditLog(); }, 280);

/* ─────────────────────────────────────
   BOOT
───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(App.darkMode);
  // Wire login enter key
  const pwEl = document.getElementById('loginPassword');
  if (pwEl) pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  try {
    const me = await API.get('/auth/me');
    if (me.authenticated) { bootApp(me); }
    else { showLogin(); }
  } catch { showLogin(); }
});

function bootApp(me) {
  App.currentUser = me;
  updateSidebarUser(me);
  applyRoleRestrictions(me.role);
  showAppShell();
  navigateTo('dashboard');
  startLowStockNotifier();
}

function updateSidebarUser(me) {
  const initials = me.username.substring(0, 2).toUpperCase();
  const av = document.getElementById('sidebarAvatar');
  if (av) av.textContent = initials;
  setEl('sidebarUsername', esc(me.username));
  setEl('sidebarRole', esc(me.role));
  // Account modal header
  const accAv = document.getElementById('accountAvatar');
  if (accAv) accAv.textContent = initials;
  setEl('accountName', esc(me.username));
  setEl('accountRoleLabel', esc(me.role));
}

function applyRoleRestrictions(role) {
  const isAdmin  = role === 'admin';
  const canWrite = role === 'admin' || role === 'staff';

  // Show/hide admin-only nav items
  const usersNav      = document.getElementById('usersNavItem');
  const auditNav      = document.getElementById('auditNavItem');
  const adminLbl      = document.getElementById('adminNavLabel');
  const reportsNav    = document.getElementById('reportsNavItem');
  const analyticsLbl  = document.getElementById('analyticsNavLabel');
  if (usersNav)     usersNav.style.display     = isAdmin  ? '' : 'none';
  if (auditNav)     auditNav.style.display     = isAdmin  ? '' : 'none';
  if (adminLbl)     adminLbl.style.display     = isAdmin  ? '' : 'none';
  if (reportsNav)   reportsNav.style.display   = isAdmin  ? '' : 'none';
  if (analyticsLbl) analyticsLbl.style.display = isAdmin  ? '' : 'none';

  // Always explicitly set write tab visibility — both show AND hide —
  // so switching from a viewer session to an admin session restores them.
  ['salesAddTab','salesBulkTab','invAdjTab','invBulkTab','prodAddTab','prodBulkTab','poAddTab'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = canWrite ? '' : 'none';
  });

  // For viewers: force every page to list-only mode so no write views are
  // visible even if the DOM was left in a different state, and reset the
  // active tab highlight to the list tab (first toggle-opt in each group).
  if (!canWrite) {
    // Reset each section to its list view
    [
      { page: 'sales', listView: 'sales-list-view', writeViews: ['sales-add-view',  'sales-bulk-view'] },
      { page: 'inv',   listView: 'inv-list-view',   writeViews: ['inv-adjust-view', 'inv-bulk-view']   },
      { page: 'prod',  listView: 'prod-list-view',  writeViews: ['prod-add-view',   'prod-bulk-view']  },
      { page: 'po',    listView: 'po-list-view',    writeViews: ['po-add-view']                        },
    ].forEach(({ listView, writeViews }) => {
      // Ensure list view is visible
      const lv = document.getElementById(listView);
      if (lv) lv.style.display = 'block';
      // Hide all write views
      writeViews.forEach(id => {
        const wv = document.getElementById(id);
        if (wv) wv.style.display = 'none';
      });
    });

    // Reset active class on each toggle-group so the list tab is highlighted
    document.querySelectorAll('.toggle-group').forEach(group => {
      const opts = group.querySelectorAll('.toggle-opt');
      opts.forEach(o => o.classList.remove('active'));
      // First visible toggle-opt is always the list tab
      const firstVisible = Array.from(opts).find(o => o.style.display !== 'none');
      if (firstVisible) firstVisible.classList.add('active');
    });
  }
}

/* ─────────────────────────────────────
   AUTH
───────────────────────────────────── */
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.querySelector('.btn-login');
  _alertClear('loginError');
  if (!username || !password) { _alert('loginError', 'Please enter username and password.'); return; }

  // Visual loading state
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15" style="animation:spin .8s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg> Signing in…'; }

  try {
    const res = await API.post('/auth/login', { username, password });
    bootApp(res);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="15 3 21 3 21 9"/><path d="M10 14L21 3"/><path d="M21 15v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg> Sign In'; }
    const msg = e.error || 'Login failed.';
    _alert('loginError', msg, e.locked ? 'warning' : 'danger', 0);
    if (e.locked) {
      // Disable the button for the lockout duration
      if (btn) {
        btn.disabled = true;
        const mins = e.retry_after_minutes || 15;
        let secs = mins * 60;
        const tick = setInterval(() => {
          secs--;
          if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Locked (${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')})`;
          if (secs <= 0) {
            clearInterval(tick);
            btn.disabled = false;
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="15 3 21 3 21 9"/><path d="M10 14L21 3"/><path d="M21 15v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg> Sign In';
            _alertClear('loginError');
          }
        }, 1000);
      }
    }
  }
}

async function doLogout() {
  await API.post('/auth/logout', {}).catch(() => {});
  App.currentUser = null;
  Object.values(App.charts).forEach(c => c?.destroy());
  App.charts = {};
  UI.toast('Signed out successfully.', 'success');
  setTimeout(showLogin, 600);
}

function _resetLoginBtn() {
  const btn = document.querySelector('.btn-login');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="15 3 21 3 21 9"/><path d="M10 14L21 3"/><path d="M21 15v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg> Sign In';
  }
}

function showLogin() {
  _resetLoginBtn();
  _alertClear('loginError');
  const unEl = document.getElementById('loginUsername');
  const pwEl = document.getElementById('loginPassword');
  if (unEl) unEl.value = '';
  if (pwEl) pwEl.value = '';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  if (unEl) unEl.focus();
}
function showAppShell() { document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display  = 'flex'; }

/* ─────────────────────────────────────
   ACCOUNT SETTINGS (all users)
───────────────────────────────────── */
function openAccountModal() {
  // Reset all fields and alerts
  ['changeUsernameError','changeUsernameSuccess','changePwError','changePwSuccess'].forEach(id => _alertClear(id));
  ['newUsername','usernameCurrentPw','currentPassword','newPassword','confirmPassword'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // Always open on the Username tab
  const firstTab = document.querySelector('.acct-tab');
  if (firstTab) switchAccountTab(firstTab);
  // Refresh notification status panel
  refreshNotifStatus();
  // Load saved settings
  const interval = localStorage.getItem('td_notif_interval') || '5';
  const sel = document.getElementById('notifIntervalSel');
  if (sel) sel.value = interval;
  const lowStockToggle = document.getElementById('notifLowStockToggle');
  if (lowStockToggle) lowStockToggle.checked = localStorage.getItem('td_notif_lowstock') !== 'false';
  Modal.open('accountModal');
}

function switchAccountTab(el) {
  document.querySelectorAll('.acct-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.acct-panel').forEach(p => p.style.display = 'none');
  el.classList.add('active');
  const panel = document.getElementById(el.dataset.tab);
  if (panel) panel.style.display = 'block';
  if (el.dataset.tab === 'acct-notifications') refreshNotifStatus();
}

/* ─────────────────────────────────────
   NOTIFICATION SETTINGS
───────────────────────────────────── */
/* ─────────────────────────────────────
   NOTIFICATION SETTINGS
   Permission watcher — polls every second while settings panel or banner
   is visible; auto-updates UI the moment the user grants/changes permission.
───────────────────────────────────── */
let _permWatchTimer = null;
let _lastKnownPerm  = null;

function _startPermWatch() {
  if (_permWatchTimer) return;
  _lastKnownPerm = Notification.permission;
  _permWatchTimer = setInterval(() => {
    const cur = Notification.permission;
    if (cur !== _lastKnownPerm) {
      _lastKnownPerm = cur;
      // Update settings panel if open
      refreshNotifStatus();
      // Auto-close banner if now granted
      if (cur === 'granted') {
        document.getElementById('notifPrompt')?.remove();
        UI.toast('Desktop notifications enabled!', 'success');
        _checkLowStock();
        restartLowStockNotifier();
      }
    }
  }, 1000);
}

function _stopPermWatch() {
  if (_permWatchTimer) { clearInterval(_permWatchTimer); _permWatchTimer = null; }
}

function _getBrowserInstructions() {
  const ua = navigator.userAgent;
  const isChrome  = /Chrome/.test(ua)  && !/Edg/.test(ua) && !/OPR/.test(ua);
  const isEdge    = /Edg\//.test(ua);
  const isFirefox = /Firefox/.test(ua);
  const isSafari  = /Safari/.test(ua)  && !/Chrome/.test(ua);
  const isOpera   = /OPR/.test(ua);

  if (isChrome || isEdge) {
    const browser = isEdge ? 'Edge' : 'Chrome';
    return {
      steps: [
        `Click the <strong>lock icon 🔒</strong> in the address bar`,
        `Select <strong>Site settings</strong>`,
        `Find <strong>Notifications</strong> and change to <strong>Allow</strong>`,
        `Reload this page — the status above will update automatically`,
      ],
      note: `Or paste <code>chrome://settings/content/notifications</code> in your address bar, find this site and set it to Allow.`,
    };
  }
  if (isFirefox) {
    return {
      steps: [
        `Click the <strong>lock icon 🔒</strong> in the address bar`,
        `Click the <strong>right arrow →</strong> next to "Connection secure"`,
        `Click <strong>More information</strong>`,
        `Go to the <strong>Permissions</strong> tab`,
        `Find <strong>Receive notifications</strong>, uncheck "Use Default", set to <strong>Allow</strong>`,
      ],
      note: null,
    };
  }
  if (isSafari) {
    return {
      steps: [
        `Open <strong>Safari → Settings → Websites</strong>`,
        `Click <strong>Notifications</strong> in the left panel`,
        `Find this site and set to <strong>Allow</strong>`,
      ],
      note: null,
    };
  }
  // Generic fallback
  return {
    steps: [
      `Click the <strong>lock icon</strong> or site info icon in your address bar`,
      `Find <strong>Notifications</strong> permissions`,
      `Change it to <strong>Allow</strong>`,
      `Reload the page`,
    ],
    note: null,
  };
}

function refreshNotifStatus() {
  const icon  = document.getElementById('notifStatusIcon');
  const label = document.getElementById('notifStatusLabel');
  const sub   = document.getElementById('notifStatusSub');
  const btn   = document.getElementById('notifActionBtn');
  const extra = document.getElementById('notifBlockedInstructions');
  if (!label) return;

  const supported = 'Notification' in window;

  if (!supported) {
    if (icon) { icon.style.background = 'rgba(100,116,139,.15)'; icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'; }
    label.textContent = 'Not supported';
    if (sub)   sub.textContent   = 'Your browser does not support desktop notifications.';
    if (btn)   btn.style.display = 'none';
    if (extra) extra.style.display = 'none';
    _stopPermWatch();
    return;
  }

  const perm = Notification.permission;

  if (perm === 'granted') {
    if (icon) { icon.style.background = 'rgba(22,163,74,.15)'; icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>'; }
    label.textContent = 'Notifications enabled';
    if (sub)   sub.textContent   = 'Desktop alerts are active. Low stock items will appear as system notifications.';
    if (btn)   btn.style.display = 'none';
    if (extra) extra.style.display = 'none';
    _stopPermWatch();

  } else if (perm === 'denied') {
    if (icon) { icon.style.background = 'rgba(220,38,38,.12)'; icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'; }
    label.textContent = 'Notifications blocked by browser';
    if (sub) sub.textContent = 'Notifications were denied. Follow the steps below to allow them, then come back here — the status will update automatically.';
    if (btn) { btn.style.display = ''; btn.textContent = 'Open Site Settings'; btn.onclick = _openSiteSettings; }

    // Build step-by-step instructions
    const info = _getBrowserInstructions();
    if (extra) {
      extra.style.display = 'block';
      extra.innerHTML = `
        <div style="font-size:.75rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">How to unblock</div>
        <ol style="padding-left:18px;display:flex;flex-direction:column;gap:6px">
          ${info.steps.map(s => `<li style="font-size:.78rem;color:var(--text-2);line-height:1.5">${s}</li>`).join('')}
        </ol>
        ${info.note ? `<p style="font-size:.73rem;color:var(--text-3);margin-top:10px;line-height:1.5">${info.note}</p>` : ''}
        <p style="font-size:.73rem;color:var(--text-3);margin-top:8px">Once allowed, this panel updates automatically — no need to reload.</p>
      `;
    }
    // Start watching for the permission to change (user comes back from browser settings)
    _startPermWatch();

  } else {
    if (icon) { icon.style.background = 'rgba(217,119,6,.12)'; icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'; }
    label.textContent = 'Notifications not yet enabled';
    if (sub)   sub.textContent   = 'Click Enable to allow TradeDesk to send low stock alerts.';
    if (btn)   { btn.style.display = ''; btn.textContent = 'Enable'; btn.onclick = requestNotifPermission; }
    if (extra) extra.style.display = 'none';
    _stopPermWatch();
  }
}

function _openSiteSettings() {
  // Open a small popup guiding the user — we can't programmatically open chrome:// URLs
  // but window.open with an about: URL focused on the address bar is the closest we can get.
  // Best UX: focus the address bar so user sees the lock icon.
  window.focus();
  UI.toast('Click the 🔒 lock icon in your address bar → Site settings → Notifications → Allow', 'info', 8000);
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  const result = await Notification.requestPermission();
  refreshNotifStatus();
  if (result === 'granted') {
    UI.toast('Desktop notifications enabled!', 'success');
    document.getElementById('notifPrompt')?.remove();
    restartLowStockNotifier();
    _checkLowStock();
  } else if (result === 'denied') {
    // Permission permanently denied — start watching so UI auto-updates
    // if user goes to browser settings and changes it
    _startPermWatch();
  }
}

function saveNotifSettings() {
  const interval = document.getElementById('notifIntervalSel')?.value || '5';
  const lowStock = document.getElementById('notifLowStockToggle')?.checked !== false;
  localStorage.setItem('td_notif_interval', interval);
  localStorage.setItem('td_notif_lowstock', String(lowStock));
  // Restart the poller with the new interval
  restartLowStockNotifier();
  UI.toast('Notification settings saved.', 'success');
}

function restartLowStockNotifier() {
  if (_notifierTimer) { clearInterval(_notifierTimer); _notifierTimer = null; }
  _notifiedSkus.clear();
  const mins = parseInt(localStorage.getItem('td_notif_interval') || '5');
  _checkLowStock();
  _notifierTimer = setInterval(_checkLowStock, mins * 60 * 1000);
}

function testNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    UI.toast('Enable notifications first, then try again.', 'error');
    return;
  }
  const n = new Notification('TradeDesk — Test Notification', {
    body: 'Notifications are working correctly. Low stock alerts will appear here.',
    icon: '/static/favicon.ico',
    tag:  'tradedesk-test',
  });
  setTimeout(() => n.close(), 5000);
  UI.toast('Test notification sent!', 'success');
}


async function submitChangeUsername() {
  _alertClear('changeUsernameError'); _alertClear('changeUsernameSuccess');
  const newUsername = document.getElementById('newUsername').value.trim();
  const currentPw   = document.getElementById('usernameCurrentPw').value;
  if (!newUsername) { _alert('changeUsernameError', 'Please enter a new username.'); return; }
  if (!currentPw)   { _alert('changeUsernameError', 'Please enter your current password to confirm.'); return; }
  try {
    await API.post('/auth/change-username', { new_username: newUsername, current_password: currentPw });
    _alertOk('changeUsernameSuccess', 'Username updated! You will be logged out to re-authenticate.', 0);
    setTimeout(() => doLogout(), 2000);
  } catch (e) { _alert('changeUsernameError', e.error || 'Failed to update username.'); }
}

async function submitChangePassword() {
  _alertClear('changePwError'); _alertClear('changePwSuccess');
  const oldPw  = document.getElementById('currentPassword').value;
  const newPw  = document.getElementById('newPassword').value;
  const confPw = document.getElementById('confirmPassword').value;
  if (!oldPw || !newPw || !confPw) { _alert('changePwError', 'All password fields are required.'); return; }
  if (newPw.length < 8)            { _alert('changePwError', 'New password must be at least 8 characters.'); return; }
  if (newPw !== confPw)            { _alert('changePwError', 'New passwords do not match.'); return; }
  try {
    await API.post('/auth/change-password', { old_password: oldPw, new_password: newPw });
    _alertOk('changePwSuccess', 'Password updated successfully!');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (e) { _alert('changePwError', e.error || 'Failed to update password.'); }
}

/* ─────────────────────────────────────
   DARK MODE
───────────────────────────────────── */
function toggleTheme() {
  App.darkMode = !App.darkMode;
  localStorage.setItem('td_dark', App.darkMode ? '1' : '0');
  applyTheme(App.darkMode);
  Object.values(App.charts).forEach(c => { if (c) { applyChartTheme(c); c.update(); } });
}

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const lbl = document.getElementById('themeLabel');
  const ico = document.getElementById('themeIcon');
  if (lbl) lbl.textContent = dark ? 'Light Mode' : 'Dark Mode';
  if (ico) ico.innerHTML = dark
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

function applyChartTheme(chart) {
  const dark = App.darkMode;
  const gc = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const tc = dark ? '#94a3b8' : '#64748b';
  if (chart.options?.scales) {
    ['x','y'].forEach(ax => {
      if (chart.options.scales[ax]) {
        chart.options.scales[ax].grid = { color: gc };
        chart.options.scales[ax].ticks = { ...chart.options.scales[ax].ticks, color: tc };
      }
    });
  }
  if (chart.options?.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = tc;
}

/* ─────────────────────────────────────
   NAVIGATION
───────────────────────────────────── */
const PAGE_META = {
  dashboard: { title: 'Dashboard',       subtitle: 'Overview of your sales activity and inventory.' },
  sales:     { title: 'Sales',           subtitle: 'Manage sales transactions.' },
  purchases: { title: 'Purchases',       subtitle: 'Manage purchase orders and receive stock.' },
  inventory: { title: 'Inventory',       subtitle: 'Monitor and adjust stock levels.' },
  products:  { title: 'Products',        subtitle: 'Manage your product catalogue.' },
  reports:   { title: 'Reports',         subtitle: 'Charts and performance analytics.' },
  users:     { title: 'User Management', subtitle: 'Manage users and role permissions.' },
  auditlog:  { title: 'Audit Log',       subtitle: 'All write actions across the system.' },
};

async function navigateTo(pageId, navEl) {
  // Only admins can access reports
  if (pageId === 'reports' && App.currentUser?.role !== 'admin') {
    UI.toast('Reports are only accessible to admins.', 'error');
    return;
  }
  App.currentPage = pageId;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + pageId);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  else {
    const m = document.querySelector(`.nav-item[data-page="${pageId}"]`);
    if (m) m.classList.add('active');
  }

  const meta = PAGE_META[pageId] || {};
  setEl('pageTitle',    esc(meta.title || pageId));
  setEl('pageSubtitle', esc(meta.subtitle || ''));

  try {
    switch (pageId) {
      case 'dashboard': await loadDashboard(); break;
      case 'sales':     await loadSales(); break;
      case 'purchases': await loadPurchases(); break;
      case 'inventory': await loadInventory(); break;
      case 'products':  await loadProducts(); break;
      case 'reports':   await loadReports(); break;
      case 'users':     await loadUsers(); break;
      case 'auditlog':  await loadAuditLog(); break;
    }
  } catch (e) {
    UI.toast((e && e.error) || 'Failed to load page.', 'error');
  }
}

/* ─────────────────────────────────────
   PAGE-LEVEL MODE SWITCHING
   Generic: switchMode(page, mode, el)
   page = 'sales' | 'inv' | 'prod'
   mode = 'list' | 'add' | 'bulk' | 'adjust'
───────────────────────────────────── */
const MODE_VIEWS = {
  sales: { list: 'sales-list-view', add: 'sales-add-view', bulk: 'sales-bulk-view' },
  inv:   { list: 'inv-list-view', adjust: 'inv-adjust-view', bulk: 'inv-bulk-view' },
  prod:  { list: 'prod-list-view', add: 'prod-add-view', bulk: 'prod-bulk-view' },
  po:    { list: 'po-list-view', add: 'po-add-view' },
};

function switchMode(page, mode, clickedEl) {
  // Viewers are read-only — silently block any attempt to enter a write mode
  const canWrite = App.currentUser?.role !== 'viewer';
  if (!canWrite && mode !== 'list') return;

  const map = MODE_VIEWS[page];
  if (!map) return;

  // Hide all views for this page
  Object.values(map).forEach(id => {
    const v = document.getElementById(id);
    if (v) v.style.display = 'none';
  });
  // Show target
  const target = document.getElementById(map[mode]);
  if (target) target.style.display = 'block';

  // Update toggle active state
  const bar = clickedEl.closest('.toggle-group');
  if (bar) {
    bar.querySelectorAll('.toggle-opt').forEach(o => o.classList.remove('active'));
    clickedEl.classList.add('active');
  }

  // When switching to add/adjust, populate product dropdowns
  if (mode === 'add' && page === 'sales') {
    // Lock date to today every time the form opens
    const dateInput = document.getElementById('saleDateInput');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    populateSaleProductSelect();
  }
  if (mode === 'adjust' && page === 'inv') populateAdjProductSelect();
  if (mode === 'add' && page === 'po') populatePOProductSelect();
}

/* ─────────────────────────────────────
   PRODUCT DROPDOWN POPULATION
   This is the key bug fix — products
   are loaded fresh every time the
   add-sale or adjust-stock view opens.
───────────────────────────────────── */
async function populateSaleProductSelect() {
  const sel = document.getElementById('saleProductSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading products…</option>';
  try {
    const data = await API.get('/products/', { active_only: 1, per_page: 500 });
    if (!data.records.length) {
      sel.innerHTML = '<option value="">No products found — add products first</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Select a product —</option>' +
      data.records.map(p =>
        `<option value="${p.id}">${esc(p.name)} — ${esc(p.sku)} (KES ${Number(p.sell_price).toFixed(2)})</option>`
      ).join('');
  } catch {
    sel.innerHTML = '<option value="">Failed to load products</option>';
  }
}

async function populateAdjProductSelect() {
  const sel = document.getElementById('adjProductSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading products…</option>';
  try {
    const data = await API.get('/products/', { active_only: 1, per_page: 500 });
    sel.innerHTML = '<option value="">— Select a product —</option>' +
      data.records.map(p =>
        `<option value="${p.id}">${esc(p.name)} — ${esc(p.sku)} (Stock: ${p.stock_quantity ?? 0})</option>`
      ).join('');
  } catch {
    sel.innerHTML = '<option value="">Failed to load products</option>';
  }
}

/* ─────────────────────────────────────
   DASHBOARD
───────────────────────────────────── */
async function loadDashboard() {
  const [summary, dailyData] = await Promise.all([
    API.get('/dashboard/summary'),
    API.get('/reports/daily-sales', { days: 14 }),
  ]);

  setEl('kpiRevenue',   UI.formatCurrency(summary.revenue_this_month));
  setEl('kpiOrders',    String(summary.orders_this_month));
  setEl('kpiLowStock',  String(summary.low_stock_count));
  setEl('kpiCustomers', String(summary.unique_customers));

  const salesList = document.getElementById('recentSalesList');
  if (salesList) {
    salesList.innerHTML = !summary.recent_sales.length
      ? '<div class="empty-state">No transactions yet.</div>'
      : summary.recent_sales.map(s => `
          <div class="item-row">
            <div class="item-left">
              <div class="item-dot" style="background:${s.status==='completed'?'var(--success)':s.status==='pending'?'var(--warning)':'var(--danger)'}"></div>
              <div><div class="item-name">${esc(s.product_name)}</div><div class="item-meta">${esc(s.reference)} · ${UI.formatDate(s.sale_date)}</div></div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="item-amount">${UI.formatCurrency(s.total_amount)}</div>
              ${UI.badge(s.status)}
            </div>
          </div>`).join('');
  }

  const evList = document.getElementById('recentEventsList');
  if (evList) {
    evList.innerHTML = !summary.recent_imports.length
      ? '<div class="empty-state">No recent imports.</div>'
      : summary.recent_imports.map(i => `
          <div class="item-row">
            <div class="item-left">
              <span class="badge ${i.failed_rows>0?'badge-warning':'badge-success'}">${i.failed_rows>0?svgWarn():svgCheck()}</span>
              <div><div class="item-name">Import: ${esc(i.filename)}</div>
              <div class="item-meta">${i.success_rows} imported, ${i.failed_rows} failed · ${UI.formatDate(i.imported_at)}</div></div>
            </div>
          </div>`).join('');
  }

  renderLineChart('salesTrendChart', { labels: dailyData.map(d=>d.label), values: dailyData.map(d=>d.value), label: 'Revenue (KES)' });
  const stockData = await API.get('/reports/stock-levels');
  renderBarChart('stockLevelsChart', { labels: stockData.map(d=>d.label), values: stockData.map(d=>d.value), label: 'Units' });
}

/* ─────────────────────────────────────
   SALES
───────────────────────────────────── */
async function loadSales(resetPage = true) {
  if (resetPage) salesState.page = 1;
  const data = await API.get('/sales/', { page: salesState.page, per_page: 25, search: salesState.search, status: salesState.status });
  setEl('salesTotalLabel', `${data.total.toLocaleString()} total records`);
  const tbody = document.getElementById('salesTbody');
  if (!tbody) return;
  const canWrite = App.currentUser?.role !== 'viewer';
  const isAdmin  = App.currentUser?.role === 'admin';

  const masterCb = document.getElementById('salesTbodySelectAll');
  if (masterCb) masterCb.style.display = isAdmin ? 'inline-block' : 'none';
  clearBulkSelection('salesTbody');

  if (!data.records.length) {
    tbody.innerHTML = `<tr><td colspan="${isAdmin ? 11 : 10}" class="empty-state">No sales records found.</td></tr>`;
  } else {
    tbody.innerHTML = data.records.map(s => `
      <tr>
        <td style="padding-left:12px">${isAdmin ? `<input type="checkbox" class="row-cb" data-id="${s.id}" onchange="toggleBulkCheckbox('salesTbody',${s.id},this.checked)">` : ''}</td>
        <td class="td-mono">${esc(s.reference)}</td>
        <td>${esc(s.product_name)}</td>
        <td>${esc(s.customer_name || '—')}</td>
        <td data-value="${s.quantity}">${s.quantity}</td>
        <td class="td-mono" data-value="${s.unit_price}">${UI.formatCurrency(s.unit_price)}</td>
        <td class="td-mono fw-bold" data-value="${s.total_amount}">${UI.formatCurrency(s.total_amount)}</td>
        <td data-value="${s.sale_date}">${UI.formatDate(s.sale_date)}</td>
        <td>${esc(s.payment_method || '—')}</td>
        <td>${UI.badge(s.status)}</td>
        <td>
          <div class="action-btns">
            ${canWrite ? `<button class="action-btn" title="Edit" onclick="editSale(${s.id})">${iconEdit()}</button>` : ''}
            ${isAdmin ? `<button class="action-btn danger" title="Delete" onclick="deleteSale(${s.id},'${esc(s.reference)}')">${iconDelete()}</button>` : ''}
          </div>
        </td>
      </tr>`).join('');
  }
  renderPagination('salesPagination', data.total, 25, salesState.page, p => { salesState.page=p; loadSales(false); });
  initTableSort('salesTbody');
}

async function submitAddSale(e) {
  e.preventDefault();
  _alertClear('salesAddError'); _alertClear('salesAddSuccess');

  const f = e.target;
  const body = {
    product_id:    parseInt(f.product_id.value),
    quantity:      parseInt(f.quantity.value),
    unit_price:    parseFloat(f.unit_price.value),
    sale_date:     f.sale_date.value,
    customer_name: f.customer_name.value,
    payment_method: f.payment_method.value,
    salesperson:   f.salesperson.value,
    status:        f.status.value,
  };

  if (!body.product_id) { _alert('salesAddError', 'Please select a product.'); return; }

  // Enforce today-only date
  const today = new Date().toISOString().slice(0, 10);
  if (body.sale_date !== today) {
    _alert('salesAddError', 'Sales can only be recorded for today. Use Bulk Import to add records for other dates.');
    return;
  }

  try {
    const res = await API.post('/sales/', body);
    _alertOk('salesAddSuccess', `Sale <strong>${res.reference}</strong> created successfully!`);
    f.reset();
    // Re-lock date to today after reset
    const dateInput = document.getElementById('saleDateInput');
    if (dateInput) dateInput.value = today;
    await populateSaleProductSelect();
  } catch (err) {
    _alert('salesAddError', (err && err.error) || 'Failed to save sale.');
  }
}

async function editSale(id) {
  try {
    const s = await API.get(`/sales/${id}`);
    const f = document.getElementById('editSaleForm');
    f['edit_sale_id'].value   = s.id;
    f['edit_sale_date'].value = s.sale_date;
    f['edit_status'].value    = s.status;
    f['edit_customer'].value  = s.customer_name || '';
    f['edit_payment'].value   = s.payment_method || 'Cash';
    _alertClear('editSaleError');
    Modal.open('editSaleModal');
  } catch (e) { UI.toast((e && e.error) || 'Failed to load sale.', 'error'); }
}

async function submitEditSale(e) {
  e.preventDefault();
  const f  = e.target;
  const id = f['edit_sale_id'].value;
  _alertClear('editSaleError');
  try {
    await API.put(`/sales/${id}`, {
      customer_name:  f['edit_customer'].value,
      payment_method: f['edit_payment'].value,
      status:         f['edit_status'].value,
      sale_date:      f['edit_sale_date'].value,
    });
    UI.toast('Sale updated.');
    Modal.close('editSaleModal');
    await loadSales(false);
  } catch (err) { _alert('editSaleError', (err && err.error) || 'Failed to update.'); }
}

async function deleteSale(id, ref) {
  UI.confirm(`Delete sale ${ref}?`, 'This cannot be undone.', 'Delete', async () => {
    try { await API.del(`/sales/${id}`); UI.toast('Sale deleted.'); await loadSales(false); }
    catch (e) { UI.toast((e && e.error) || 'Failed to delete.', 'error'); }
  }, 'danger');
}

/* ─────────────────────────────────────
   INVENTORY
───────────────────────────────────── */
async function loadInventory(resetPage = true) {
  if (resetPage) invState.page = 1;
  const data = await API.get('/inventory/', { page: invState.page, per_page: 25, search: invState.search, status: invState.status });

  const s = data.stats || {};
  setEl('invTotalValue',  UI.formatCurrency(s.total_value));
  setEl('invTotalSKUs',   String(s.total_products || 0));
  setEl('invLowStock',    String(s.low_stock || 0));
  setEl('invOutOfStock',  String(s.out_of_stock || 0));

  const tbody = document.getElementById('invTbody');
  if (!tbody) return;
  const canWrite = App.currentUser?.role !== 'viewer';
  if (!data.records.length) {
    tbody.innerHTML = `<tr><td colspan="${canWrite ? 10 : 9}" class="empty-state">No inventory records found.</td></tr>`;
  } else {
    tbody.innerHTML = data.records.map(r => `
      <tr>
        <td class="td-mono">${esc(r.sku)}</td>
        <td>${esc(r.name)}</td>
        <td><span class="badge badge-muted">${esc(r.category)}</span></td>
        <td class="fw-bold" data-value="${r.quantity}">${r.quantity}</td>
        <td class="td-muted" data-value="${r.reorder_point}">${r.reorder_point}</td>
        <td>${UI.stockBar(r.quantity, r.reorder_point)}</td>
        <td class="td-mono" data-value="${r.cost_price}">${UI.formatCurrency(r.cost_price)}</td>
        <td class="td-mono" data-value="${r.total_value}">${UI.formatCurrency(r.total_value)}</td>
        <td>${UI.badge(r.stock_status)}</td>
        ${canWrite ? `<td><div class="action-btns"><button class="action-btn" title="Edit" onclick="editInventory(${r.id})">${iconEdit()}</button></div></td>` : ''}
      </tr>`).join('');
  }
  renderPagination('invPagination', data.total, 25, invState.page, p => { invState.page=p; loadInventory(false); });
  initTableSort('invTbody');
}

async function submitAdjustStock(e) {
  e.preventDefault();
  _alertClear('invAdjError'); _alertClear('invAdjSuccess');
  const f = e.target;
  try {
    const res = await API.post('/inventory/adjust', {
      product_id: parseInt(f.adj_product_id.value),
      delta:      parseInt(f.adj_delta.value),
      note:       f.adj_note.value,
    });
    _alertOk('invAdjSuccess', `Stock updated. New quantity: <strong>${res.new_quantity}</strong>`);
    f.reset();
    await loadInventory(false);
  } catch (err) { _alert('invAdjError', (err && err.error) || 'Failed to adjust stock.'); }
}

/* ─────────────────────────────────────
   PRODUCTS
───────────────────────────────────── */
async function loadProducts(resetPage = true) {
  if (resetPage) prodState.page = 1;
  const data = await API.get('/products/', { page: prodState.page, per_page: 25, search: prodState.search, category: prodState.category });

  const catSel = document.getElementById('productCategoryFilter');
  if (catSel && data.categories) {
    const curVal = catSel.value;
    catSel.innerHTML = '<option value="">All Categories</option>' +
      data.categories.map(c => `<option value="${esc(c)}"${c===curVal?' selected':''}>${esc(c)}</option>`).join('');
  }

  const tbody = document.getElementById('productsTbody');
  if (!tbody) return;
  if (!data.records.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No products found.</td></tr>';
  } else {
    const canWrite = App.currentUser?.role !== 'viewer';
    const isAdmin  = App.currentUser?.role === 'admin';
    tbody.innerHTML = data.records.map(p => {
      const marginVal = p.cost_price > 0 ? (((p.sell_price - p.cost_price) / p.sell_price) * 100) : null;
      const margin = marginVal !== null ? marginVal.toFixed(1) + '%' : '—';
      const marginBadgeClass = marginVal !== null && marginVal < 10 ? 'badge-warning' : 'badge-success';
      return `<tr>
        <td class="td-mono">${esc(p.sku)}</td>
        <td class="fw-bold">${esc(p.name)}</td>
        <td><span class="badge badge-muted">${esc(p.category)}</span></td>
        <td class="td-mono" data-value="${p.sell_price}">${UI.formatCurrency(p.sell_price)}</td>
        <td class="td-mono" data-value="${p.cost_price}">${UI.formatCurrency(p.cost_price)}</td>
        <td data-value="${marginVal ?? -1}"><span class="badge ${marginBadgeClass}">${margin}</span></td>
        <td class="fw-bold" data-value="${p.stock_quantity ?? 0}">${p.stock_quantity ?? 0}</td>
        <td>${UI.badge(p.is_active ? 'active' : 'inactive')}</td>
        <td>
          <div class="action-btns">
            ${canWrite ? `<button class="action-btn" title="Edit" onclick="editProduct(${p.id})">${iconEdit()}</button>` : ''}
            ${isAdmin  ? `<button class="action-btn danger" title="Deactivate" onclick="deleteProduct(${p.id},'${esc(p.name)}')">${iconDelete()}</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }
  renderPagination('productsPagination', data.total, 25, prodState.page, p => { prodState.page=p; loadProducts(false); });
  initTableSort('productsTbody');
}

async function submitAddProduct(e) {
  e.preventDefault();
  _alertClear('prodAddError'); _alertClear('prodAddSuccess');
  const f = e.target;
  try {
    const res = await API.post('/products/', {
      name:             f.prod_name.value,
      category:         f.prod_category.value || 'General',
      sell_price:       parseFloat(f.prod_sell_price.value),
      cost_price:       parseFloat(f.prod_cost_price.value || 0),
      reorder_point:    parseInt(f.prod_reorder.value || 10),
      sku:              f.prod_sku.value,
      initial_quantity: parseInt(f.prod_initial_qty.value || 0),
    });
    _alertOk('prodAddSuccess', `Product <strong>${res.sku}</strong> added successfully!`);
    f.reset();
    await loadProducts(false);
  } catch (err) { _alert('prodAddError', (err && err.error) || 'Failed to add product.'); }
}

async function editProduct(id) {
  try {
    const p = await API.get(`/products/${id}`);
    const f = document.getElementById('editProductForm');
    f['edit_prod_id'].value       = p.id;
    f['edit_prod_name'].value     = p.name;
    f['edit_prod_category'].value = p.category;
    f['edit_prod_sell'].value     = p.sell_price;
    f['edit_prod_cost'].value     = p.cost_price;
    f['edit_prod_reorder'].value  = p.reorder_point;
    _alertClear('editProdError');
    Modal.open('editProductModal');
  } catch (e) { UI.toast((e && e.error) || 'Failed to load product.', 'error'); }
}

async function submitEditProduct(e) {
  e.preventDefault();
  const f  = e.target;
  const id = f['edit_prod_id'].value;
  _alertClear('editProdError');
  try {
    await API.put(`/products/${id}`, {
      name:          f['edit_prod_name'].value,
      category:      f['edit_prod_category'].value,
      sell_price:    parseFloat(f['edit_prod_sell'].value),
      cost_price:    parseFloat(f['edit_prod_cost'].value || 0),
      reorder_point: parseInt(f['edit_prod_reorder'].value || 10),
    });
    UI.toast('Product updated.');
    Modal.close('editProductModal');
    await loadProducts(false);
  } catch (err) { _alert('editProdError', (err && err.error) || 'Failed to update.'); }
}

async function deleteProduct(id, name) {
  UI.confirm(`Deactivate "${name}"?`, 'It will be hidden from the catalogue.', 'Deactivate', async () => {
    try { await API.del(`/products/${id}`); UI.toast('Product deactivated.'); await loadProducts(false); }
    catch (e) { UI.toast((e && e.error) || 'Failed.', 'error'); }
  }, 'danger');
}

/* ─────────────────────────────────────
   BULK IMPORT (shared handler)
───────────────────────────────────── */
async function submitBulkImport(importType, fileInputId, resultId, failedTbodyId) {
  const fileInput = document.getElementById(fileInputId);
  if (!fileInput.files.length) { UI.toast('Please select a file first.', 'error'); return; }

  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  fd.append('import_type', importType);
  _alertClear(resultId);

  const fname = fileInput.files[0].name;

  try {
    const res = await API.upload('/import/upload', fd);

    let msg = `<strong>${esc(fname)}</strong> — ${res.total_rows} row${res.total_rows !== 1 ? 's' : ''}. `;
    msg += `<strong>${res.success_rows} imported</strong>`;
    if (res.failed_rows > 0) {
      msg += `, <strong style="color:inherit">${res.failed_rows} failed</strong> — see the table below.`;
    }
    _alertOk(resultId, msg, 0); // ms=0 → stays until manually dismissed

    fileInput.value = '';
    // Reset the file label
    const labelId = fileInputId.replace('File', 'Name');
    const labelEl = document.getElementById(labelId);
    if (labelEl) labelEl.textContent = 'Drop or click to select file';

    const tbody = document.getElementById(failedTbodyId);
    if (tbody) {
      tbody.innerHTML = res.failed_records?.length
        ? res.failed_records.map(r =>
            `<tr>
              <td class="td-mono">${r.row_number}</td>
              <td><span class="badge badge-danger">${esc(r.failure_reason)}</span></td>
              <td class="td-muted" style="font-size:0.72rem;font-family:monospace;word-break:break-all">${esc(r.raw_data)}</td>
            </tr>`
          ).join('')
        : '<tr><td colspan="3" class="empty-state">No failed records</td></tr>';
    }
  } catch (err) {
    _alert(resultId, esc((err && err.error) || 'Upload failed. Please check the file format and try again.'), 'danger', 0);
  }
}

/* ─────────────────────────────────────
   DOWNLOAD HELPER
   In pywebview: fetch bytes → base64 → window.pywebview.api.save_file()
                 which shows a native Save-As dialog and writes the file.
   In browser:   fetch bytes → blob URL → hidden anchor click (normal download).
───────────────────────────────────── */
async function _triggerDownload(url, suggestedName) {
  const resp = await fetch(url, { credentials: 'same-origin' });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }

  const blob = await resp.blob();

  // ── pywebview desktop mode ────────────────────────────────────────────────
  if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
    // Convert blob to base64 so we can pass it to Python
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const result = await window.pywebview.api.save_file(b64, suggestedName);

    if (!result || result.error === 'cancelled') return; // user cancelled — no toast
    if (!result.ok) throw new Error(result.error || 'Save failed.');

    // Show the path that was saved to
    UI.toast(`Saved to: ${result.path}`, 'success');
    return;
  }

  // ── Browser fallback ─────────────────────────────────────────────────────
  // Prefer the server's Content-Disposition filename if available
  const cd    = resp.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename[^;=\n]*=(["']?)([^"'\n]+)\1/);
  const name  = (match && match[2]) || suggestedName;

  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = blobUrl;
  a.download    = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 2000);
  UI.toast('Download started.', 'success');
}

async function downloadTemplate(type) {
  UI.toast(`Preparing ${type} template…`, 'info');
  try {
    await _triggerDownload(
      `/api/import/template/${type}`,
      `tradedesk_${type}_template.xlsx`
    );
  } catch (e) {
    UI.toast((e && e.message) || 'Download failed.', 'error');
  }
}

async function downloadReport(type) {
  const fromDate = document.getElementById('reportFromDate')?.value || '';
  const toDate   = document.getElementById('reportToDate')?.value || '';
  const params   = new URLSearchParams({ type });
  if (fromDate) params.set('from_date', fromDate);
  if (toDate)   params.set('to_date',   toDate);

  const suffix   = (fromDate || toDate)
    ? `_${fromDate || 'start'}_to_${toDate || 'today'}`
    : `_${new Date().toISOString().slice(0,10)}`;

  UI.toast('Preparing report…', 'info');
  try {
    await _triggerDownload(
      `/api/reports/export?${params}`,
      `tradedesk_${type}_report${suffix}.xlsx`
    );
  } catch (e) {
    UI.toast((e && e.message) || 'Report download failed.', 'error');
  }
}

/* ─────────────────────────────────────
   EDIT INVENTORY
───────────────────────────────────── */
async function editInventory(productId) {
  try {
    const item = await API.get(`/inventory/${productId}`);
    const f = document.getElementById('editInvForm');
    f['edit_inv_product_id'].value = productId;
    f['edit_inv_product_name'].value = item.name + ' (' + item.sku + ')';
    f['edit_inv_quantity'].value    = item.quantity;
    f['edit_inv_location'].value    = item.location || 'Main Warehouse';
    _alertClear('editInvError');
    Modal.open('editInvModal');
  } catch (e) { UI.toast((e && e.error) || 'Failed to load inventory record.', 'error'); }
}

async function submitEditInventory(e) {
  e.preventDefault();
  const f  = e.target;
  const id = f['edit_inv_product_id'].value;
  _alertClear('editInvError');
  try {
    await API.put(`/inventory/${id}`, {
      quantity: parseInt(f['edit_inv_quantity'].value),
      location: f['edit_inv_location'].value,
    });
    UI.toast('Inventory updated.');
    Modal.close('editInvModal');
    await loadInventory(false);
  } catch (err) { _alert('editInvError', (err && err.error) || 'Failed to update.'); }
}



/* ─────────────────────────────────────
   REPORTS  (tabbed: Overview | Profit | Products | Customers | Team)
───────────────────────────────────── */
const rptState = { tab: 'overview' };

function switchReportTab(tab, el) {
  rptState.tab = tab;
  document.querySelectorAll('.rpt-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.rpt-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('rpt-' + tab);
  if (panel) panel.style.display = 'block';
  // Defer chart rendering until after the browser has painted the panel visible,
  // so Chart.js can measure canvas dimensions correctly (avoids 0x0 blank charts).
  requestAnimationFrame(() => {
    loadReportTab(tab).then(() => {
      Object.values(App.charts).forEach(c => { if (c) c.resize(); });
    });
  });
}

function rptDateParams() {
  const f = document.getElementById('reportFromDate')?.value || '';
  const t = document.getElementById('reportToDate')?.value || '';
  return { from_date: f || undefined, to_date: t || undefined };
}

async function loadReports() {
  const activeTab = document.querySelector('.rpt-tab.active');
  switchReportTab(rptState.tab, activeTab);
}

async function loadReportTab(tab) {
  try {
    switch (tab) {
      case 'overview':  await loadRptOverview();   break;
      case 'profit':    await loadRptProfit();     break;
      case 'products':  await loadRptProducts();   break;
      case 'customers': await loadRptCustomers();  break;
      case 'team':      await loadRptTeam();       break;
    }
  } catch(e) { UI.toast((e && e.error) || 'Failed to load report.', 'error'); }
}

/* ── Overview tab ── */
async function loadRptOverview() {
  const p = rptDateParams();
  const [summary, monthly, daily, payment] = await Promise.all([
    API.get('/reports/profit-summary', p),
    API.get('/reports/monthly-profit'),
    API.get('/reports/daily-sales', { days: 30 }),
    API.get('/reports/payment-breakdown', p),
  ]);

  // KPI cards
  const chg = summary.revenue_change_pct;
  const chgHtml = chg === null ? '' :
    `<span class="kpi-change ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? svgArrowUp() : svgArrowDown()} ${Math.abs(chg)}% vs prev period</span>`;

  setEl('rptRevenue',    UI.formatCurrency(summary.revenue) + chgHtml);
  setEl('rptCOGS',       UI.formatCurrency(summary.cogs));
  setEl('rptGrossProfit',UI.formatCurrency(summary.gross_profit));
  setEl('rptMarginPct',  (+(summary.margin_pct || 0)).toFixed(1) + '%');
  setEl('rptTxCount',    (+(summary.transactions || 0)).toLocaleString());
  setEl('rptUnitsSold',  (+(summary.units_sold || 0)).toLocaleString());
  setEl('rptUniqCust',   (+(summary.unique_customers || 0)).toLocaleString());

  // Daily trend
  renderLineChart('dailySalesChart', { labels: daily.map(d=>d.label), values: daily.map(d=>d.value), label: 'Revenue (KES)' });

  // Monthly revenue vs profit stacked
  renderRevenueVsProfit('monthlyProfitChart', monthly);

  // Payment breakdown
  renderDoughnutChart('paymentChart', { labels: payment.map(d=>d.label), values: payment.map(d=>d.value) });
}

function renderRevenueVsProfit(id, data) {
  const d = chartDefaults();
  makeChart(id, {
    type: 'bar',
    data: {
      labels: data.map(r => r.label),
      datasets: [
        { label: 'Revenue',      data: data.map(r => r.revenue),      backgroundColor: '#2563ebbb', borderRadius: 4, borderSkipped: false },
        { label: 'COGS',         data: data.map(r => r.cogs),         backgroundColor: '#dc2626bb', borderRadius: 4, borderSkipped: false },
        { label: 'Gross Profit', data: data.map(r => r.gross_profit), backgroundColor: '#16a34abb', borderRadius: 4, borderSkipped: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: d.text, font: { size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: d.text, font: { size: 10 } } },
        y: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 } } }
      }
    }
  });
}

/* ── Profit tab ── */
async function loadRptProfit() {
  const p = rptDateParams();
  const [catProfit, prodProfit] = await Promise.all([
    API.get('/reports/category-profitability', p),
    API.get('/reports/product-profitability', p),
  ]);

  // Category margin chart
  renderMarginChart('catMarginChart', catProfit);

  // Product profitability table
  const tbody = document.getElementById('prodProfitTbody');
  if (tbody) {
    if (!prodProfit.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No sales data found.</td></tr>';
    } else {
      tbody.innerHTML = prodProfit.map(r => {
        const margin = r.margin_pct ?? 0;
        const barW   = Math.min(100, Math.max(0, margin));
        const barCol = margin >= 30 ? 'var(--success)' : margin >= 15 ? 'var(--warning)' : 'var(--danger)';
        return `<tr>
          <td class="fw-bold">${esc(r.label)}</td>
          <td class="td-mono td-muted">${esc(r.sku || '—')}</td>
          <td><span class="badge badge-muted">${esc(r.category)}</span></td>
          <td class="td-mono">${UI.formatCurrency(r.revenue)}</td>
          <td class="td-mono">${UI.formatCurrency(r.cogs)}</td>
          <td class="td-mono fw-bold" style="color:${r.gross_profit>=0?'var(--success)':'var(--danger)'}">${UI.formatCurrency(r.gross_profit)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;height:6px;background:var(--border);border-radius:3px">
                <div style="width:${barW}%;height:100%;background:${barCol};border-radius:3px"></div>
              </div>
              <span style="font-size:.75rem;font-weight:600;color:${barCol};min-width:36px">${margin.toFixed(1)}%</span>
            </div>
          </td>
        </tr>`;
      }).join('');
    }
  }
}

function renderMarginChart(id, data) {
  const d = chartDefaults();
  makeChart(id, {
    type: 'bar',
    data: {
      labels: data.map(r => r.label),
      datasets: [
        { label: 'Revenue',      data: data.map(r => r.revenue),      backgroundColor: '#2563ebbb' },
        { label: 'Gross Profit', data: data.map(r => r.gross_profit), backgroundColor: '#16a34abb' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: d.text, font: { size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: d.text, font: { size: 10 } } },
        y: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 } } }
      }
    }
  });
}

/* ── Products tab ── */
async function loadRptProducts() {
  const p = rptDateParams();
  const [topSell, byCat, invVal] = await Promise.all([
    API.get('/reports/top-selling'),
    API.get('/reports/sales-by-category', p),
    API.get('/reports/inventory-value'),
  ]);
  renderHBarChart('topProductsChart2', { labels: topSell.map(d=>d.label), values: topSell.map(d=>d.value), label: 'Units Sold' });
  renderDoughnutChart('categoryRevenueChart', { labels: byCat.map(d=>d.label), values: byCat.map(d=>d.value) });
  renderDoughnutChart('invValueChart2', { labels: invVal.map(d=>d.label), values: invVal.map(d=>d.value) });
}

/* ── Customers tab ── */
async function loadRptCustomers() {
  const p = rptDateParams();
  const data = await API.get('/reports/customer-insights', p);

  // Repeat vs new doughnut
  renderDoughnutChart('customerTypeChart', {
    labels: ['Repeat Customers', 'One-time Customers'],
    values: [data.repeat_customers, data.one_time_customers],
  });

  // Top customers table
  const tbody = document.getElementById('topCustomersTbody');
  if (tbody) {
    if (!data.top_customers.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No customer data found.</td></tr>';
    } else {
      const maxRev = data.top_customers[0]?.revenue || 1;
      tbody.innerHTML = data.top_customers.map((c, i) => `<tr>
        <td style="font-size:.8rem;color:var(--text-3);width:28px">${i+1}</td>
        <td class="fw-bold">${esc(c.label)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:5px;background:var(--border);border-radius:3px">
              <div style="width:${Math.round(c.revenue/maxRev*100)}%;height:100%;background:var(--accent);border-radius:3px"></div>
            </div>
            <span class="td-mono">${UI.formatCurrency(c.revenue)}</span>
          </div>
        </td>
        <td class="td-mono td-muted">${UI.formatCurrency(c.avg_order_value)}</td>
        <td class="td-muted" style="font-size:.75rem">${c.transactions} order${c.transactions!==1?'s':''} · Last: ${UI.formatDate(c.last_purchase)}</td>
      </tr>`).join('');
    }
  }
}

/* ── Team tab ── */
async function loadRptTeam() {
  const p = rptDateParams();
  const data = await API.get('/reports/salesperson-performance', p);

  if (!data.length) {
    setEl('teamTableBody', '<tr><td colspan="6" class="empty-state">No salesperson data. Add salesperson names to sales records to see performance here.</td></tr>');
    return;
  }

  renderHBarChart('salespersonChart', { labels: data.map(d=>d.label), values: data.map(d=>d.revenue), label: 'Revenue (KES)' });

  const maxRev = data[0]?.revenue || 1;
  setEl('teamTableBody', data.map((r, i) => `<tr>
    <td style="font-size:.8rem;color:var(--text-3);width:28px">${i+1}</td>
    <td class="fw-bold">${esc(r.label)}</td>
    <td class="td-mono">${r.transactions}</td>
    <td class="td-mono">${r.units_sold}</td>
    <td>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:5px;background:var(--border);border-radius:3px">
          <div style="width:${Math.round(r.revenue/maxRev*100)}%;height:100%;background:var(--accent);border-radius:3px"></div>
        </div>
        <span class="td-mono">${UI.formatCurrency(r.revenue)}</span>
      </div>
    </td>
    <td class="td-mono fw-bold" style="color:var(--success)">${UI.formatCurrency(r.gross_profit)}</td>
  </tr>`).join(''));
}

/* ─────────────────────────────────────
   USERS (admin only)
───────────────────────────────────── */
async function loadUsers() {
  const isAdmin = App.currentUser?.role === 'admin';
  const denied  = document.getElementById('usersAccessDenied');
  const content = document.getElementById('usersContent');

  if (!isAdmin) {
    if (denied)  denied.style.display  = 'flex';
    if (content) content.style.display = 'none';
    return;
  }
  if (denied)  denied.style.display  = 'none';
  if (content) content.style.display = 'block';

  const rows = await API.get('/users/');
  const tbody = document.getElementById('usersTbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="user-avatar" style="width:30px;height:30px;font-size:0.68rem;flex-shrink:0">${u.username.substring(0,2).toUpperCase()}</div>
          <span class="fw-bold">${esc(u.username)}</span>
        </div>
      </td>
      <td class="td-muted">${esc(u.email)}</td>
      <td>${UI.badge(u.role)}</td>
      <td class="td-muted">${UI.formatDate(u.last_login) || 'Never'}</td>
      <td>${UI.badge(u.is_active ? 'active' : 'inactive')}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn" title="Edit" onclick="editUser(${u.id},'${esc(u.email)}','${esc(u.role)}',${u.is_active})">${iconEdit()}</button>
          ${u.id !== App.currentUser?.user_id
            ? `<button class="action-btn danger" title="Deactivate" onclick="deleteUser(${u.id},'${esc(u.username)}')">${iconDelete()}</button>`
            : '<span class="td-muted" style="font-size:0.72rem;padding:0 6px">(you)</span>'}
        </div>
      </td>
    </tr>`).join('');
}

async function submitAddUser(e) {
  e.preventDefault();
  const f = e.target;
  _alertClear('addUserError');
  try {
    await API.post('/users/', {
      username: f.user_username.value,
      email:    f.user_email.value,
      password: f.user_password.value,
      role:     f.user_role.value,
    });
    UI.toast('User created!');
    Modal.close('addUserModal');
    f.reset();
    await loadUsers();
  } catch (err) { _alert('addUserError', (err && err.error) || 'Failed to create user.'); }
}

function editUser(id, email, role, isActive) {
  const f = document.getElementById('editUserForm');
  f['edit_user_id'].value     = id;
  f['edit_user_email'].value  = email;
  f['edit_user_role'].value   = role;
  f['edit_user_active'].value = isActive ? '1' : '0';
  _alertClear('editUserError');
  Modal.open('editUserModal');
}

async function submitEditUser(e) {
  e.preventDefault();
  const f  = e.target;
  const id = f['edit_user_id'].value;
  _alertClear('editUserError');
  try {
    await API.put(`/users/${id}`, {
      email:     f['edit_user_email'].value,
      role:      f['edit_user_role'].value,
      is_active: f['edit_user_active'].value === '1',
    });
    UI.toast('User updated.');
    Modal.close('editUserModal');
    await loadUsers();
  } catch (err) { _alert('editUserError', (err && err.error) || 'Failed to update.'); }
}

async function deleteUser(id, name) {
  UI.confirm(`Deactivate user "${name}"?`, 'They will lose access immediately.', 'Deactivate', async () => {
    try { await API.del(`/users/${id}`); UI.toast('User deactivated.'); await loadUsers(); }
    catch (e) { UI.toast((e && e.error) || 'Failed.', 'error'); }
  }, 'danger');
}

/* ─────────────────────────────────────
   LOW-STOCK DESKTOP NOTIFICATIONS
───────────────────────────────────── */
let _notifierTimer = null;
let _notifiedSkus  = new Set(); // avoid re-notifying until stock recovers

function startLowStockNotifier() {
  if (!('Notification' in window)) {
    _checkLowStock();
    _notifierTimer = setInterval(_checkLowStock, 5 * 60 * 1000);
    return;
  }

  if (Notification.permission === 'granted') {
    _checkLowStock();
  } else if (Notification.permission !== 'denied') {
    _showNotificationPrompt();
    _checkLowStock();
  } else {
    _checkLowStock();
  }

  const mins = parseInt(localStorage.getItem('td_notif_interval') || '5');
  _notifierTimer = setInterval(_checkLowStock, mins * 60 * 1000);
}

function _showNotificationPrompt() {
  const existing = document.getElementById('notifPrompt');
  if (existing) return;

  const perm = Notification.permission;
  // Don't show the banner if already granted or if we've dismissed it this session
  if (perm === 'granted' || sessionStorage.getItem('td_notif_dismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'notifPrompt';
  banner.style.cssText = 'background:var(--surface-2);border-bottom:1px solid var(--border);padding:9px 26px;display:flex;align-items:center;gap:12px;font-size:.78rem;color:var(--text-2);flex-shrink:0;transition:opacity .3s';

  const isDenied   = perm === 'denied';
  const actionText = isDenied ? 'How to fix →' : 'Enable';
  const msgText    = isDenied
    ? 'Notifications are blocked. Allow them in browser site settings to get low stock alerts.'
    : 'Enable desktop notifications to get low stock alerts even when this tab is in the background.';

  banner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="${isDenied ? 'var(--danger)' : 'var(--warning)'}" stroke-width="2" width="15" height="15" style="flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    <span style="flex:1">${msgText}</span>
    <button id="notifBannerAction" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:5px 14px;font-size:.76rem;font-weight:600;cursor:pointer;white-space:nowrap">${actionText}</button>
    <button id="notifBannerDismiss" style="background:none;border:none;cursor:pointer;padding:4px 6px;color:var(--text-3);font-size:1.1rem;line-height:1" title="Dismiss">&times;</button>
  `;

  const topbar = document.querySelector('.topbar');
  if (topbar && topbar.parentNode) {
    topbar.parentNode.insertBefore(banner, topbar.nextSibling);
  }

  function closeBanner() {
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 320);
    sessionStorage.setItem('td_notif_dismissed', '1');
  }

  document.getElementById('notifBannerDismiss').addEventListener('click', closeBanner);

  document.getElementById('notifBannerAction').addEventListener('click', async () => {
    if (isDenied) {
      // Open account modal on notifications tab
      openAccountModal();
      setTimeout(() => {
        const notifTab = document.querySelector('.acct-tab[data-tab="acct-notifications"]');
        if (notifTab) switchAccountTab(notifTab);
      }, 50);
    } else {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        closeBanner();
        UI.toast('Desktop notifications enabled!', 'success');
        restartLowStockNotifier();
        _checkLowStock();
      } else if (result === 'denied') {
        // Replace button with "How to fix" and start watching
        banner.querySelector('#notifBannerAction').textContent = 'How to fix →';
        banner.querySelector('svg').setAttribute('stroke', 'var(--danger)');
        banner.querySelector('span').textContent = 'Notifications are blocked. Allow them in browser site settings to get low stock alerts.';
        _startPermWatch();
      }
    }
  });

  // Watch for permission change — auto-close banner when granted
  _startPermWatch();
}

async function _checkLowStock() {
  // Respect the user's low-stock alert toggle
  if (localStorage.getItem('td_notif_lowstock') === 'false') return;
  try {
    const items = await API.get('/inventory/low-stock');
    if (!items.length) { _notifiedSkus.clear(); return; }

    const newItems = items.filter(i => !_notifiedSkus.has(i.sku));
    if (!newItems.length) return;

    newItems.forEach(i => _notifiedSkus.add(i.sku));

    const title = `⚠ Low Stock — ${newItems.length} item${newItems.length > 1 ? 's' : ''}`;
    const body  = newItems.slice(0, 5).map(i =>
      `${i.name}: ${i.quantity} left (reorder at ${i.reorder_point})`
    ).join('\n') + (newItems.length > 5 ? `\n…and ${newItems.length - 5} more` : '');

    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, {
        body,
        icon: '/static/favicon.ico',
        tag: 'tradedesk-lowstock',   // replaces previous notification instead of stacking
        requireInteraction: false,
      });
      n.onclick = () => {
        window.focus();
        invState.status = 'low_stock';
        navigateTo('inventory', document.querySelector('[data-page="inventory"]'));
        n.close();
      };
    } else {
      // Fallback: show as an error toast for each item (max 3)
      newItems.slice(0, 3).forEach(i =>
        UI.toast(`⚠ Low stock: ${i.name} — ${i.quantity} left`, 'error', 7000)
      );
      if (newItems.length > 3) UI.toast(`…and ${newItems.length - 3} more low stock items`, 'info', 7000);
    }
  } catch { /* silently ignore network errors */ }
}

/* ─────────────────────────────────────
   PURCHASES
───────────────────────────────────── */
const poState = { page: 1, status: '' };

async function populatePOProductSelect() {
  const sel = document.getElementById('poProductSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">Loading products…</option>';
  try {
    const data = await API.get('/products/', { active_only: 1, per_page: 500 });
    sel.innerHTML = '<option value="">— Select a product —</option>' +
      data.records.map(p =>
        `<option value="${p.id}">${esc(p.name)} — ${esc(p.sku)}</option>`
      ).join('');
  } catch { sel.innerHTML = '<option value="">Failed to load products</option>'; }
}

async function loadPurchases(resetPage = true) {
  if (resetPage) poState.page = 1;
  const data = await API.get('/purchases/', { page: poState.page, per_page: 25, status: poState.status });
  setEl('poTotalLabel', `${data.total.toLocaleString()} total orders`);
  const tbody = document.getElementById('poTbody');
  if (!tbody) return;
  const canWrite = App.currentUser?.role !== 'viewer';
  const isAdmin  = App.currentUser?.role === 'admin';
  if (!data.records.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No purchase orders found.</td></tr>';
  } else {
    tbody.innerHTML = data.records.map(po => {
      const total = (po.quantity * po.unit_cost).toFixed(2);
      const actions = [];
      if (canWrite && po.status === 'pending') {
        actions.push(`<button class="action-btn" title="Mark Received" onclick="openReceivePO(${po.id},'${esc(po.reference)}','${esc(po.product_name)}',${po.quantity})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
        </button>`);
      }
      if (isAdmin && po.status === 'pending') {
        actions.push(`<button class="action-btn danger" title="Cancel" onclick="cancelPurchase(${po.id},'${esc(po.reference)}')">${iconDelete()}</button>`);
      }
      return `<tr>
        <td class="td-mono">${esc(po.reference)}</td>
        <td>${esc(po.product_name)}</td>
        <td class="td-muted">${esc(po.supplier || '—')}</td>
        <td class="fw-bold">${po.quantity}</td>
        <td class="td-mono">${UI.formatCurrency(po.unit_cost)}</td>
        <td class="td-mono fw-bold">${UI.formatCurrency(total)}</td>
        <td>${UI.formatDate(po.order_date)}</td>
        <td>${po.received_date ? UI.formatDate(po.received_date) : '<span class="td-muted">—</span>'}</td>
        <td>${UI.badge(po.status)}</td>
        <td><div class="action-btns">${actions.join('')}</div></td>
      </tr>`;
    }).join('');
  }
  renderPagination('poPagination', data.total, 25, poState.page, p => { poState.page=p; loadPurchases(false); });
  initTableSort('poTbody');
}

async function submitAddPurchase(e) {
  e.preventDefault();
  _alertClear('poAddError'); _alertClear('poAddSuccess');
  const f = e.target;
  try {
    const res = await API.post('/purchases/', {
      product_id: parseInt(f.po_product_id.value),
      quantity:   parseInt(f.po_quantity.value),
      unit_cost:  parseFloat(f.po_unit_cost.value),
      supplier:   f.po_supplier.value,
      order_date: f.po_order_date.value,
    });
    _alertOk('poAddSuccess', `Purchase order <strong>${res.reference}</strong> created.`);
    f.reset();
    await populatePOProductSelect();
  } catch (err) { _alert('poAddError', (err && err.error) || 'Failed to create order.'); }
}

function openReceivePO(id, ref, productName, qty) {
  const f = document.getElementById('receivePOForm');
  f['receive_po_id'].value = id;
  f['receive_date'].value  = '';
  _alertClear('receivePOError');
  document.querySelector('#receivePOModal .modal-title').textContent = `Receive: ${ref}`;
  const infoEl = document.getElementById('receivePOInfo');
  if (infoEl) infoEl.textContent = `${productName} — ${qty} unit${qty !== 1 ? 's' : ''}`;
  Modal.open('receivePOModal');
}

async function submitReceivePO(e) {
  e.preventDefault();
  const f  = e.target;
  const id = f['receive_po_id'].value;
  _alertClear('receivePOError');
  try {
    await API.put(`/purchases/${id}/receive`, { received_date: f['receive_date'].value || undefined });
    UI.toast('Purchase order marked as received. Stock updated.');
    Modal.close('receivePOModal');
    await loadPurchases(false);
  } catch (err) { _alert('receivePOError', (err && err.error) || 'Failed to receive order.'); }
}

async function cancelPurchase(id, ref) {
  UI.confirm(`Cancel purchase order ${ref}?`, 'Stock will not be updated.', 'Cancel Order', async () => {
    try { await API.del(`/purchases/${id}`); UI.toast('Order cancelled.'); await loadPurchases(false); }
    catch (e) { UI.toast((e && e.error) || 'Failed to cancel.', 'error'); }
  }, 'danger');
}

/* ─────────────────────────────────────
   AUDIT LOG
───────────────────────────────────── */
// _debouncedAudit is defined at the top with the other debounced search handlers

const ACTION_COLORS = {
  CREATE: 'badge-success', DELETE: 'badge-danger', UPDATE: 'badge-info',
};

async function loadAuditLog(resetPage = true) {
  if (resetPage) auditState.page = 1;
  const data = await API.get('/audit-log/', {
    page: auditState.page, per_page: 50,
    search: auditState.search, entity_type: auditState.entity_type,
  });
  setEl('auditTotalLabel', `${data.total.toLocaleString()} total entries`);
  const tbody = document.getElementById('auditTbody');
  if (!tbody) return;
  if (!data.records.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No audit entries found.</td></tr>';
  } else {
    tbody.innerHTML = data.records.map(r => {
      const actionClass = ACTION_COLORS[r.action] || 'badge-muted';
      return `<tr>
        <td class="td-mono" style="font-size:.75rem;white-space:nowrap">${r.created_at ? r.created_at.replace('T',' ').substring(0,19) : '—'}</td>
        <td class="fw-bold">${esc(r.username || '—')}</td>
        <td><span class="badge ${actionClass}">${esc(r.action)}</span></td>
        <td><span class="badge badge-muted">${esc(r.entity_type)}</span></td>
        <td class="td-mono td-muted">${r.entity_id ?? '—'}</td>
        <td class="td-muted" style="font-size:.78rem;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.detail)}">${esc(r.detail || '—')}</td>
        <td class="td-mono td-muted" style="font-size:.75rem">${esc(r.ip_address || '—')}</td>
      </tr>`;
    }).join('');
  }
  renderPagination('auditPagination', data.total, 50, auditState.page, p => { auditState.page=p; loadAuditLog(false); });
}

/* ─────────────────────────────────────
   CHARTS
───────────────────────────────────── */
const PALETTE = ['#16a34a','#2563eb','#d97706','#dc2626','#7c3aed','#0891b2','#ea580c','#65a30d'];

function chartDefaults() {
  const dark = App.darkMode;
  return { grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', text: dark ? '#94a3b8' : '#64748b' };
}

function makeChart(id, config) {
  const ex = App.charts[id]; if (ex) ex.destroy();
  const c  = document.getElementById(id); if (!c) return null;
  const ch = new Chart(c, config); App.charts[id] = ch; return ch;
}

function renderLineChart(id, { labels, values, label }) {
  const d = chartDefaults();
  makeChart(id, { type: 'line', data: { labels, datasets: [{ label, data: values, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.09)', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#16a34a', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 } } }, y: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 }, callback: v => 'K'+(v/1000).toFixed(0) } } } } });
}

function renderBarChart(id, { labels, values, label }) {
  const d = chartDefaults();
  makeChart(id, { type: 'bar', data: { labels, datasets: [{ label, data: values, backgroundColor: labels.map((_,i) => PALETTE[i % PALETTE.length]+'bb'), borderRadius: 6, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: d.text, font: { size: 10 } } }, y: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 } } } } } });
}

function renderHBarChart(id, { labels, values, label }) {
  const d = chartDefaults();
  makeChart(id, { type: 'bar', data: { labels, datasets: [{ label, data: values, backgroundColor: '#16a34abb', borderRadius: 6, borderSkipped: false }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: d.grid }, ticks: { color: d.text, font: { size: 10 } } }, y: { grid: { display: false }, ticks: { color: d.text, font: { size: 10 } } } } } });
}

function renderDoughnutChart(id, { labels, values }) {
  const d = chartDefaults();
  makeChart(id, { type: 'doughnut', data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: d.text, font: { size: 11 }, boxWidth: 12, padding: 14 } } } } });
}

/* ─────────────────────────────────────
   PAGINATION
───────────────────────────────────── */
function renderPagination(containerId, total, perPage, currentPage, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.ceil(total / perPage);
  const start = (currentPage - 1) * perPage + 1;
  const end   = Math.min(currentPage * perPage, total);
  if (total === 0) { el.innerHTML = '<span>No records</span>'; return; }

  // Build a stable unique key for the jump input so multiple paginators don't collide
  const jumpId = containerId + '_jump';

  let pages = '';
  let prevWasEllipsis = false;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
      prevWasEllipsis = false;
      pages += `<button class="page-btn${p===currentPage?' active':''}" onclick="(${onPageChange.toString()})(${p})">${p}</button>`;
    } else if (!prevWasEllipsis && (p === currentPage - 2 || p < currentPage - 1 || p === currentPage + 2 || p > currentPage + 1)) {
      prevWasEllipsis = true;
      // Clicking the ellipsis opens an inline jump-to-page input
      pages += `<button class="page-btn page-ellipsis" title="Jump to page…" onclick="togglePageJump('${jumpId}', ${totalPages}, ${onPageChange.toString()})">…</button>`;
    }
  }
  el.innerHTML = `<span class="td-muted">Showing ${start}–${end} of ${total}</span>
    <div class="pagination-btns">
      <button class="page-btn" onclick="(${onPageChange.toString()})(${Math.max(1,currentPage-1)})">‹</button>
      ${pages}
      <button class="page-btn" onclick="(${onPageChange.toString()})(${Math.min(totalPages,currentPage+1)})">›</button>
      <span id="${jumpId}" style="display:none;align-items:center;gap:4px">
        <input type="number" min="1" max="${totalPages}" placeholder="pg" class="form-input" style="width:52px;padding:3px 7px;font-size:.77rem;height:28px"
          onkeydown="if(event.key==='Enter'){var v=parseInt(this.value);if(v>=1&&v<=${totalPages})(${onPageChange.toString()})(v);this.closest('span').style.display='none';}
                     if(event.key==='Escape')this.closest('span').style.display='none';">
        <button class="page-btn" onclick="var inp=this.previousElementSibling;var v=parseInt(inp.value);if(v>=1&&v<=${totalPages})(${onPageChange.toString()})(v);inp.closest('span').style.display='none';">Go</button>
      </span>
    </div>`;
}

function togglePageJump(jumpId, totalPages, cb) {
  const el = document.getElementById(jumpId);
  if (!el) return;
  const visible = el.style.display !== 'none' && el.style.display !== '';
  el.style.display = visible ? 'none' : 'inline-flex';
  if (!visible) {
    const inp = el.querySelector('input');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

/* ─────────────────────────────────────
   UTILITIES
───────────────────────────────────── */
function setEl(id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function iconEdit()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`; }
function iconDelete() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`; }
function svgCheck()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" style="vertical-align:-2px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>`; }
function svgWarn()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="vertical-align:-2px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`; }
function svgArrowUp() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11" style="vertical-align:-1px"><polyline points="18 15 12 9 6 15"/></svg>`; }
function svgArrowDown(){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11" style="vertical-align:-1px"><polyline points="6 9 12 15 18 9"/></svg>`; }

// Chip filter group
document.addEventListener('click', e => {
  const chip = e.target.closest('.chip[data-fg]');
  if (!chip) return;
  const group = chip.dataset.fg;
  document.querySelectorAll(`.chip[data-fg="${group}"]`).forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
});

/* ─────────────────────────────────────
   INLINE SALE TOTAL PREVIEW
   Updates a live "Total: KES X" badge as the user types in the add-sale form.
───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  function wireAddSalePreview() {
    const form = document.getElementById('salesAddForm');
    if (!form) return;
    const qtyInput   = form.querySelector('[name="quantity"]');
    const priceInput = form.querySelector('[name="unit_price"]');
    // Create the preview element once and insert it after the price field
    let preview = document.getElementById('saleTotalPreview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'saleTotalPreview';
      preview.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;font-size:.83rem;margin-top:10px;grid-column:1/-1;transition:background .2s';
      const formGrid = form.querySelector('.form-grid');
      if (formGrid) formGrid.insertAdjacentElement('afterend', preview);
    }
    function update() {
      const qty   = parseFloat(qtyInput?.value)   || 0;
      const price = parseFloat(priceInput?.value) || 0;
      const total = qty * price;
      if (qty > 0 && price > 0) {
        preview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="color:var(--text-3)">Sale total:</span>
          <strong style="color:var(--success);font-size:.9rem">${UI.formatCurrency(total)}</strong>
          <span style="color:var(--text-3);font-size:.75rem">(${qty} × ${UI.formatCurrency(price)})</span>`;
        preview.style.display = 'flex';
      } else {
        preview.style.display = 'none';
      }
    }
    qtyInput?.addEventListener('input', update);
    priceInput?.addEventListener('input', update);
    form.addEventListener('reset', () => { setTimeout(() => { preview.style.display = 'none'; }, 0); });
  }
  // Wire immediately; also re-wire when the sales-add-view becomes visible
  wireAddSalePreview();
  document.querySelectorAll('.toggle-opt').forEach(btn => btn.addEventListener('click', () => {
    setTimeout(wireAddSalePreview, 50);
  }));
});

/* ─────────────────────────────────────
   COLUMN SORTING (client-side, current page)
   Usage: add data-sortable to <th> elements, call initTableSort(tbodyId, headers)
   to make each header clickable and sort the visible rows in-place.
───────────────────────────────────── */
const _sortState = {}; // keyed by tbodyId

function initTableSort(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const table = tbody.closest('table');
  if (!table) return;
  const headers = table.querySelectorAll('th[data-sort]');
  const prev = _sortState[tbodyId] || {};

  headers.forEach(th => {
    const realIndex = Array.from(th.closest('tr').children).indexOf(th);

    // Remove old arrow and add fresh sortable hint
    th.querySelector('.sort-arrow')?.remove();
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';

    if (prev.col === realIndex) {
      // Restore persisted sort indicator
      arrow.textContent = prev.asc ? ' ▲' : ' ▼';
      arrow.style.opacity = '0.8';
    } else {
      // Faint hint that column is sortable
      arrow.textContent = ' ↕';
      arrow.style.opacity = '0.25';
      arrow.style.fontSize = '0.6rem';
    }
    th.appendChild(arrow);

    // Remove and re-add listener to avoid duplicate handlers
    const newTh = th.cloneNode(true);
    th.parentNode.replaceChild(newTh, th);
    newTh.style.cursor = 'pointer';
    newTh.style.userSelect = 'none';
    newTh.addEventListener('click', () => {
      const asc = prev.col === realIndex ? !prev.asc : true;
      _sortState[tbodyId] = { col: realIndex, asc };

      // Update all arrows
      table.querySelectorAll('th[data-sort]').forEach(h => {
        const a = h.querySelector('.sort-arrow');
        if (!a) return;
        const hIdx = Array.from(h.closest('tr').children).indexOf(h);
        if (hIdx === realIndex) {
          a.textContent = asc ? ' ▲' : ' ▼';
          a.style.opacity = '0.8';
          a.style.fontSize = '';
        } else {
          a.textContent = ' ↕';
          a.style.opacity = '0.25';
          a.style.fontSize = '0.6rem';
        }
      });

      // Sort rows
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const aCell = a.children[realIndex];
        const bCell = b.children[realIndex];
        if (!aCell || !bCell) return 0;
        const aText = aCell.dataset.value ?? aCell.textContent.trim();
        const bText = bCell.dataset.value ?? bCell.textContent.trim();
        const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ''));
        const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ''));
        if (!isNaN(aNum) && !isNaN(bNum)) return asc ? aNum - bNum : bNum - aNum;
        return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
}

// Hook sort init into every page load
const _origLoadSales      = typeof loadSales !== 'undefined' ? loadSales : null;
const _origLoadInventory  = typeof loadInventory !== 'undefined' ? loadInventory : null;
const _origLoadProducts   = typeof loadProducts !== 'undefined' ? loadProducts : null;
const _origLoadAuditLog   = typeof loadAuditLog !== 'undefined' ? loadAuditLog : null;

/* ─────────────────────────────────────
   BULK DELETE
   Adds checkboxes + "Delete selected" toolbar to tables when admin.
───────────────────────────────────── */
const _bulkSelection = {}; // map of tableId → Set of ids

function toggleBulkCheckbox(tableId, id, checked) {
  if (!_bulkSelection[tableId]) _bulkSelection[tableId] = new Set();
  if (checked) _bulkSelection[tableId].add(id);
  else _bulkSelection[tableId].delete(id);
  updateBulkToolbar(tableId);
}

function toggleSelectAll(tableId, masterCb) {
  if (!_bulkSelection[tableId]) _bulkSelection[tableId] = new Set();
  const boxes = document.querySelectorAll(`#${tableId} .row-cb`);
  boxes.forEach(cb => {
    cb.checked = masterCb.checked;
    const id = parseInt(cb.dataset.id);
    if (masterCb.checked) _bulkSelection[tableId].add(id);
    else _bulkSelection[tableId].delete(id);
  });
  updateBulkToolbar(tableId);
}

function updateBulkToolbar(tableId) {
  const bar = document.getElementById(tableId + 'BulkBar');
  if (!bar) return;
  const count = _bulkSelection[tableId]?.size || 0;
  if (count > 0) {
    bar.style.display = 'flex';
    const lbl = bar.querySelector('.bulk-count');
    if (lbl) lbl.textContent = `${count} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function clearBulkSelection(tableId) {
  _bulkSelection[tableId] = new Set();
  document.querySelectorAll(`#${tableId} .row-cb`).forEach(cb => cb.checked = false);
  const master = document.getElementById(tableId + 'SelectAll');
  if (master) master.checked = false;
  updateBulkToolbar(tableId);
}

async function executeBulkDelete(tableId, endpoint, loadFn) {
  const ids = Array.from(_bulkSelection[tableId] || []);
  if (!ids.length) return;
  UI.confirm(
    `Permanently delete ${ids.length} record${ids.length !== 1 ? 's' : ''}?`,
    'This cannot be undone.',
    'Delete',
    async () => {
      const results = await Promise.allSettled(ids.map(id => API.del(`/${endpoint}/${id}`)));
      const errors = results.filter(r => r.status === 'rejected').length;
      clearBulkSelection(tableId);
      if (errors > 0) UI.toast(`Deleted ${ids.length - errors} record(s); ${errors} failed.`, 'warning');
      else UI.toast(`${ids.length} record${ids.length !== 1 ? 's' : ''} deleted.`, 'success');
      if (loadFn) await loadFn(false);
    },
    'danger'
  );
}

/* ─────────────────────────────────────
   SESSION TIMEOUT WARNING
   Shows a modal at ~25 min idle; logs out at 30 min.
───────────────────────────────────── */
const SESSION_WARN_MS  = 25 * 60 * 1000; // 25 min
const SESSION_LIMIT_MS = 30 * 60 * 1000; // 30 min
let _sessionWarnTimer  = null;
let _sessionKillTimer  = null;
let _sessionLastActive = Date.now();

function _resetSessionTimers() {
  _sessionLastActive = Date.now();
  clearTimeout(_sessionWarnTimer);
  clearTimeout(_sessionKillTimer);
  if (!App.currentUser) return;
  _sessionWarnTimer = setTimeout(_showSessionWarning, SESSION_WARN_MS);
  _sessionKillTimer = setTimeout(_doSessionKill, SESSION_LIMIT_MS);
  // Dismiss warning if visible
  const modal = document.getElementById('sessionTimeoutModal');
  if (modal && modal.style.display !== 'none') Modal.close('sessionTimeoutModal');
}

function _showSessionWarning() {
  if (!App.currentUser) return;
  const modal = document.getElementById('sessionTimeoutModal');
  if (modal) {
    modal.style.display = 'flex';
    // Countdown label
    let secs = 5 * 60;
    const lbl = document.getElementById('sessionCountdown');
    if (lbl) lbl.textContent = '5:00';
    clearInterval(modal._countdown);
    modal._countdown = setInterval(() => {
      secs--;
      if (lbl) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        lbl.textContent = `${m}:${String(s).padStart(2,'0')}`;
      }
      if (secs <= 0) clearInterval(modal._countdown);
    }, 1000);
  }
}

function extendSession() {
  _resetSessionTimers();
  API.get('/auth/me').catch(() => {});
  UI.toast('Session extended.', 'success');
}

function _doSessionKill() {
  if (!App.currentUser) return;
  UI.toast('Session expired. Please log in again.', 'error');
  doLogout();
}

// Wire activity events
['mousemove','mousedown','keydown','scroll','touchstart'].forEach(evt => {
  document.addEventListener(evt, () => { if (Date.now() - _sessionLastActive > 60000) _resetSessionTimers(); }, { passive: true });
});

// Patch bootApp to start timers
const _origBootApp = bootApp;
window.bootApp = function(me) {
  _origBootApp(me);
  _resetSessionTimers();
};

/* ─────────────────────────────────────
   KEYBOARD SHORTCUTS
   N → open Add Sale (if on sales page)
   Escape → close top-most open modal
   G then S/P/I/R/U/A → navigate to page
───────────────────────────────────── */
let _gPressed = false;
let _gTimer   = null;

document.addEventListener('keydown', e => {
  // Don't fire shortcuts when typing in inputs/textareas/selects
  const tag = (e.target.tagName || '').toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

  // Escape — close top-most modal
  if (e.key === 'Escape') {
    const modals = Array.from(document.querySelectorAll('.modal-overlay'))
      .filter(m => m.style.display !== 'none' && m.style.display !== '');
    if (modals.length > 0) {
      const top = modals[modals.length - 1];
      const closeBtn = top.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
    }
    return;
  }

  if (inInput) return;

  // G + letter navigation shortcuts
  if (_gPressed) {
    clearTimeout(_gTimer);
    _gPressed = false;
    const map = { s: 'sales', p: 'purchases', i: 'inventory', r: 'reports', u: 'users', a: 'auditlog', d: 'dashboard' };
    const target = map[e.key.toLowerCase()];
    if (target) { navigateTo(target); e.preventDefault(); }
    return;
  }

  if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    _gPressed = true;
    _gTimer = setTimeout(() => { _gPressed = false; }, 1000);
    e.preventDefault();
    UI.toast('G + D Dashboard · S Sales · P Purchases · I Inventory · R Reports · U Users · A Audit', 'info', 3000);
    return;
  }

  // N → open Add Sale (only on sales page)
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
    if (App.currentPage === 'sales' && App.currentUser?.role !== 'viewer') {
      const addTab = document.getElementById('salesAddTab');
      if (addTab) addTab.click();
      e.preventDefault();
    }
  }
});

/* ─────────────────────────────────────
   CONFIRM-BEFORE-LEAVING (dirty form guard)
   Mark a form as dirty on input; warn if user navigates away.
───────────────────────────────────── */
let _dirtyFormId = null;

function _markDirty(formId) { _dirtyFormId = formId; }
function _clearDirty()      { _dirtyFormId = null; }

// Wire all add/adjust forms to mark dirty on any input change
document.addEventListener('DOMContentLoaded', () => {
  const watchForms = ['salesAddForm', 'invAdjForm', 'prodAddForm', 'poAddForm'];
  watchForms.forEach(id => {
    const form = document.getElementById(id);
    if (!form) return;
    form.addEventListener('input',  () => _markDirty(id), { passive: true });
    form.addEventListener('change', () => _markDirty(id), { passive: true });
    form.addEventListener('reset',  () => _clearDirty(),  { passive: true });
    form.addEventListener('submit', () => _clearDirty(),  { passive: true });
  });
});

// Intercept navigateTo to warn if dirty form is open
const _origNavigateTo = navigateTo;
window.navigateTo = async function(pageId, navEl) {
  if (_dirtyFormId && pageId !== App.currentPage) {
    const formNames = {
      salesAddForm: 'Add Sale', invAdjForm: 'Stock Adjustment',
      prodAddForm: 'Add Product', poAddForm: 'Add Purchase Order',
    };
    const name = formNames[_dirtyFormId] || 'current form';
    UI.confirm(
      `Unsaved changes in "${name}"`,
      'Leave without saving?',
      'Leave',
      () => { _clearDirty(); _origNavigateTo(pageId, navEl); }
    );
    return;
  }
  return _origNavigateTo(pageId, navEl);
};

// Browser unload guard
window.addEventListener('beforeunload', e => {
  if (_dirtyFormId) { e.preventDefault(); e.returnValue = ''; }
});

/* ─────────────────────────────────────
   PASSWORD STRENGTH METER
   Wires to #newPassword in the account modal.
   Scores: length, uppercase, lowercase, digit, symbol.
───────────────────────────────────── */
function initPasswordStrengthMeter(inputId, containerId) {
  const input = document.getElementById(inputId);
  const container = document.getElementById(containerId);
  if (!input || !container) return;

  input.addEventListener('input', () => {
    const pw = input.value;
    if (!pw) { container.style.display = 'none'; return; }
    container.style.display = 'block';

    let score = 0;
    const checks = [
      { ok: pw.length >= 8,    label: '8+ chars' },
      { ok: /[A-Z]/.test(pw),  label: 'Uppercase' },
      { ok: /[a-z]/.test(pw),  label: 'Lowercase' },
      { ok: /[0-9]/.test(pw),  label: 'Number' },
      { ok: /[^A-Za-z0-9]/.test(pw), label: 'Symbol' },
    ];
    score = checks.filter(c => c.ok).length;

    const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#dc2626', '#ea580c', '#d97706', '#16a34a', '#15803d'];
    const widths = ['20%', '40%', '60%', '80%', '100%'];

    container.innerHTML = `
      <div style="display:flex;gap:3px;margin-bottom:5px">
        ${[0,1,2,3,4].map(i => `<div style="flex:1;height:3px;border-radius:2px;background:${i<score?colors[score-1]:'var(--border)'}"></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:.72rem;color:${colors[score-1]||'var(--text-3)'};font-weight:600">${score>0?labels[score-1]:'Very weak'}</span>
        <span style="font-size:.7rem;color:var(--text-3)">${checks.filter(c=>!c.ok).map(c=>c.label).slice(0,2).join(' · ')}</span>
      </div>`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Insert strength meter container after #newPassword
  const pw = document.getElementById('newPassword');
  if (pw) {
    const meter = document.createElement('div');
    meter.id = 'pwStrengthMeter';
    meter.style.cssText = 'display:none;margin-top:6px';
    pw.insertAdjacentElement('afterend', meter);
    initPasswordStrengthMeter('newPassword', 'pwStrengthMeter');
  }
});

/* ─────────────────────────────────────
   BARCODE / SKU SCANNER INPUT
   A floating search field (triggered via keyboard shortcut or button)
   that looks up a product by SKU and navigates to inventory or prefills add-sale.
───────────────────────────────────── */
let _scannerOpen = false;

function openScannerInput() {
  _scannerOpen = true;
  const overlay = document.getElementById('scannerOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    const inp = document.getElementById('scannerInput');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

function closeScannerInput() {
  _scannerOpen = false;
  const overlay = document.getElementById('scannerOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function handleScannerSubmit() {
  const inp  = document.getElementById('scannerInput');
  const sku  = (inp?.value || '').trim().toUpperCase();
  const res  = document.getElementById('scannerResult');
  if (!sku) return;
  if (res) res.innerHTML = '<span style="color:var(--text-3);font-size:.82rem">Searching…</span>';

  try {
    const data = await API.get('/products/', { search: sku, per_page: 10 });
    const match = data.records.find(p => p.sku?.toUpperCase() === sku) || data.records[0];
    if (!match) {
      if (res) res.innerHTML = `<span style="color:var(--danger);font-size:.82rem">No product found for SKU: <strong>${esc(sku)}</strong></span>`;
      return;
    }
    if (res) res.innerHTML = `
      <div style="padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)">
        <div style="font-weight:700;font-size:.88rem">${esc(match.name)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">SKU: ${esc(match.sku)} · Stock: ${match.quantity ?? '—'} units · ${UI.formatCurrency(match.sell_price)}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="topbar-btn btn-primary" style="font-size:.75rem;padding:5px 12px" onclick="closeScannerInput();navigateTo('inventory')">View Inventory</button>
          ${App.currentUser?.role !== 'viewer' ? `<button class="topbar-btn btn-ghost" style="font-size:.75rem;padding:5px 12px" onclick="prefillSaleFromScanner(${match.id},${match.sell_price})">Add Sale</button>` : ''}
        </div>
      </div>`;
  } catch {
    if (res) res.innerHTML = `<span style="color:var(--danger);font-size:.82rem">Error looking up product.</span>`;
  }
}

function prefillSaleFromScanner(productId, price) {
  closeScannerInput();
  navigateTo('sales');
  setTimeout(() => {
    const addTab = document.getElementById('salesAddTab');
    if (addTab) addTab.click();
    setTimeout(() => {
      const sel = document.getElementById('saleProductSelect');
      if (sel) { sel.value = productId; sel.dispatchEvent(new Event('change')); }
      const priceInput = document.querySelector('#salesAddForm [name="unit_price"]');
      if (priceInput) { priceInput.value = price; priceInput.dispatchEvent(new Event('input')); }
    }, 200);
  }, 100);
}

// Keyboard shortcut: / or F2 to open scanner
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';
  if ((e.key === '/' || e.key === 'F2') && !inInput && App.currentUser) {
    e.preventDefault();
    openScannerInput();
  }
  if (e.key === 'Escape' && _scannerOpen) {
    closeScannerInput();
  }
});
