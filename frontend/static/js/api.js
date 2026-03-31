/**
 * api.js — TradeDesk Frontend API Client
 * =========================================
 * Thin wrapper around fetch() that:
 *  - Always sends credentials (cookies for session)
 *  - Handles JSON parsing and error extraction consistently
 *  - Provides shorthand methods: get, post, put, del
 */

const API = (() => {
  const BASE = '/api';

  /**
   * Core fetch wrapper.
   * @param {string} path       — relative path e.g. '/sales/'
   * @param {object} options    — fetch options
   * @returns {Promise<object>} — parsed JSON or throws { error: string }
   */
  async function request(path, options = {}) {
    const defaults = {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };

    // If caller explicitly passes headers:{} (e.g. multipart upload), let the
    // browser set Content-Type automatically (needed for FormData boundary).
    // Otherwise merge in the default Content-Type.
    const callerHeaders = options.headers;
    const mergedHeaders = (callerHeaders && Object.keys(callerHeaders).length === 0)
      ? {}  // No Content-Type — browser sets it with multipart boundary
      : { ...defaults.headers, ...(callerHeaders || {}) };

    const merged = { ...defaults, ...options, headers: mergedHeaders };

    let resp;
    try {
      resp = await fetch(BASE + path, merged);
    } catch (networkErr) {
      throw { error: 'Network error — is the server running?' };
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      data = {};
    }

    if (!resp.ok) {
      const msg = data.error || data.errors?.join(', ') || `HTTP ${resp.status}`;
      throw { error: msg, status: resp.status, data };
    }
    return data;
  }

  // Build query string from params object
  function qs(params = {}) {
    const p = new URLSearchParams(params);
    const str = p.toString();
    return str ? '?' + str : '';
  }

  return {
    get:  (path, params)  => request(path + qs(params)),
    post: (path, body)    => request(path, { method: 'POST', body: JSON.stringify(body) }),
    put:  (path, body)    => request(path, { method: 'PUT',  body: JSON.stringify(body) }),
    del:  (path)          => request(path, { method: 'DELETE' }),

    /** Upload a file via multipart form data */
    upload(path, formData) {
      return request(path, {
        method: 'POST',
        body: formData,
        headers: {},  // Let browser set Content-Type with boundary
      });
    },
  };
})();


/**
 * UI helpers
 */
const UI = {
  /** Show a toast notification */
  toast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };
    const dismiss = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    };
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span style="flex:1">${message}</span>
      <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;padding:0;margin-left:6px;opacity:.5;font-size:1rem;color:inherit;line-height:1" title="Dismiss">&times;</button>
    `;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const timer = setTimeout(dismiss, duration);
    el.querySelector('button').addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  },

  /** Display a dismissible inline alert with optional auto-timeout */
  showAlert(elId, message, type = 'danger', timeoutMs = 8000) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `alert alert-${type}`;
    el.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;flex-shrink:0;margin-top:1px">
        ${type === 'success'
          ? '<polyline points="20 6 9 17 4 12"/>'
          : type === 'warning'
          ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      <span style="flex:1">${message}</span>
      <button onclick="this.closest('.alert').style.display='none'" style="background:none;border:none;cursor:pointer;padding:0;margin-left:8px;opacity:.6;line-height:1;font-size:1rem;color:inherit" title="Dismiss">&times;</button>
    `;
    el.style.display = 'flex';
    if (timeoutMs > 0) {
      clearTimeout(el._alertTimer);
      el._alertTimer = setTimeout(() => {
        el.style.transition = 'opacity .4s';
        el.style.opacity = '0';
        setTimeout(() => { el.style.display = 'none'; el.style.opacity = ''; el.style.transition = ''; }, 420);
      }, timeoutMs);
    }
  },

  /** Display inline error in a form */
  showError(formId, message) {
    this.showAlert(formId + 'Error', message, 'danger');
  },

  hideError(formId) {
    const el = document.getElementById(formId + 'Error');
    if (el) el.style.display = 'none';
  },

  /** Debounce helper — returns a function that delays invoking fn until after wait ms */
  debounce(fn, wait = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  },

  /**
   * Styled confirmation dialog — replaces window.confirm()
   * UI.confirm(title, body, confirmLabel, onConfirm, variant?)
   * variant: 'danger' | 'primary'  (default 'primary')
   */
  confirm(title, body, confirmLabel = 'Confirm', onConfirm, variant = 'primary') {
    // Reuse or create the shared confirm modal
    let overlay = document.getElementById('_uiConfirmOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '_uiConfirmOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;backdrop-filter:blur(3px)';
      overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 26px 22px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2)">
          <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px">
            <div id="_uiConfirmIcon" style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0"></div>
            <div>
              <div id="_uiConfirmTitle" style="font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:5px"></div>
              <div id="_uiConfirmBody" style="font-size:.82rem;color:var(--text-2);line-height:1.5"></div>
            </div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="_uiConfirmCancel" class="topbar-btn btn-ghost">Cancel</button>
            <button id="_uiConfirmOk" class="topbar-btn btn-primary">Confirm</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
      document.getElementById('_uiConfirmCancel').addEventListener('click', () => { overlay.style.display = 'none'; });
    }

    const isDanger = variant === 'danger';
    const icon = document.getElementById('_uiConfirmIcon');
    icon.style.background = isDanger ? 'rgba(220,38,38,.1)' : 'rgba(22,163,74,.1)';
    icon.innerHTML = isDanger
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" width="18" height="18"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    document.getElementById('_uiConfirmTitle').textContent = title;
    document.getElementById('_uiConfirmBody').textContent = body;

    const okBtn = document.getElementById('_uiConfirmOk');
    okBtn.textContent = confirmLabel;
    okBtn.className = `topbar-btn ${isDanger ? 'btn-danger' : 'btn-primary'}`;
    // Clone to remove old listener
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', () => {
      overlay.style.display = 'none';
      onConfirm();
    });

    overlay.style.display = 'flex';
    newOk.focus();
  },

  formatCurrency(amount) {
    return 'KES ' + Number(amount || 0).toLocaleString('en-KE', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  },

  /** Format ISO date string */
  formatDate(str) {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('en-KE', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  },

  /** Status badge HTML */
  badge(status) {
    const map = {
      completed: 'badge-success',
      pending:   'badge-warning',
      cancelled: 'badge-danger',
      in_stock:  'badge-success',
      low_stock: 'badge-warning',
      out_of_stock: 'badge-danger',
      admin:  'badge-danger',
      staff:  'badge-info',
      viewer: 'badge-muted',
      active: 'badge-success',
      inactive: 'badge-muted',
    };
    const cls = map[status] || 'badge-muted';
    return `<span class="badge ${cls}">${status.replace('_', ' ')}</span>`;
  },

  /** Generate stock level progress bar HTML */
  stockBar(quantity, reorderPoint) {
    const max = Math.max(reorderPoint * 3, quantity, 1);
    const pct = Math.round((quantity / max) * 100);
    const color = quantity === 0 ? 'var(--danger)' : quantity < reorderPoint ? 'var(--warning)' : 'var(--success)';
    return `
      <div class="stock-bar-wrap">
        <div class="stock-bar"><div class="stock-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="stock-pct">${pct}%</span>
      </div>
    `;
  },
};


/**
 * Modal manager
 */
const Modal = {
  open(id)  { document.getElementById(id)?.classList.add('open'); },
  close(id) {
    document.getElementById(id)?.classList.remove('open');
    // Stop permission watcher when account modal closes to avoid dangling interval
    if (id === 'accountModal' && typeof _stopPermWatch === 'function') _stopPermWatch();
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    if (typeof _stopPermWatch === 'function') _stopPermWatch();
  },
};

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) Modal.closeAll();
});
