/* =========================================================
   App — 狀態管理、路由、啟動流程、週表視圖、共用 UI（toast／對話框／防連點）
   與錯誤對照表（合約 §1.5）
   ========================================================= */
(function () {
  'use strict';

  var CONFIG = window.APP_CONFIG || {};
  var BUSY_HARD_RELEASE_MS = 25000;
  var ROUTES = { week: true, mine: true, approve: true, handover: true };
  var ROUTE_ROLE = { approve: 'admin', handover: 'handler' };
  var ROLE_ZH = { teacher: '教師', admin: '審批員', handler: '經手人' };

  var state = {
    user: null,
    settings: null,
    slots: [],
    today: null,
    currentWeekStart: null,
    selectedDate: null,
    weekCache: new Map(),   // weekStart → { week, fetchedAt }
    view: null,
    forceWeekOnMobile: false,
    booted: false,
    lastWeekTicket: null
  };

  var mobileMq = window.matchMedia('(max-width: 767px)');
  var esc = function (s) { return window.Calendar.esc(s); };
  function el(id) { return document.getElementById(id); }

  /* ================= 日期工具 ================= */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(str, n) {
    var d = window.Calendar.parseDate(str);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  function weekStartOf(str) {
    var d = window.Calendar.parseDate(str);
    if (!d) return str;
    var offset = (d.getDay() + 6) % 7; // 週一為 0
    d.setDate(d.getDate() - offset);
    return toDateStr(d);
  }
  function todayStr() {
    return state.today || toDateStr(new Date());
  }

  /* ================= 共用 UI ================= */
  var ui = {};

  /** Toast：type = info | success | error | warn；opts = { duration, action: {label, onClick}, requestId } */
  ui.toast = function (message, type, opts) {
    opts = opts || {};
    var region = el('toast-region');
    if (!region) return;
    var t = document.createElement('div');
    t.className = 'toast' + (type && type !== 'info' ? ' toast--' + type : '');
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var html = '<span class="toast__text">' + esc(message);
    if (opts.requestId) html += '<span class="toast__meta">請求編號：' + esc(opts.requestId) + '</span>';
    html += '</span>';
    if (opts.action && opts.action.label) html += '<button type="button" class="toast__action">' + esc(opts.action.label) + '</button>';
    html += '<button type="button" class="toast__close" aria-label="關閉通知"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>';
    t.innerHTML = html;
    var duration = opts.duration || (type === 'error' ? 9000 : type === 'warn' ? 7000 : 5000);
    var timer = setTimeout(remove, duration);
    function remove() {
      clearTimeout(timer);
      if (!t.parentNode) return;
      t.classList.add('is-leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
    }
    t.querySelector('.toast__close').addEventListener('click', remove);
    var actionBtn = t.querySelector('.toast__action');
    if (actionBtn) actionBtn.addEventListener('click', function () { remove(); if (typeof opts.action.onClick === 'function') opts.action.onClick(); });
    t.addEventListener('mouseenter', function () { clearTimeout(timer); });
    t.addEventListener('mouseleave', function () { clearTimeout(timer); timer = setTimeout(remove, 2500); });
    region.appendChild(t);
    while (region.children.length > 4) region.removeChild(region.firstChild);
    return t;
  };

  /**
   * 按鈕防連點：disabled ＋「處理中…」，並於 25 秒後硬性解除。
   * busy(btn, fn) → Promise（fn 回傳的 Promise 結果）
   */
  ui.busy = function (btn, fn) {
    if (!btn) return Promise.resolve().then(fn);
    if (btn.getAttribute('data-busy') === '1') return Promise.resolve();
    var label = btn.textContent;
    var released = false;
    btn.setAttribute('data-busy', '1');
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '處理中…';
    var hard = setTimeout(release, BUSY_HARD_RELEASE_MS);
    function release() {
      if (released) return;
      released = true;
      clearTimeout(hard);
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      btn.removeAttribute('data-busy');
      btn.textContent = label;
    }
    var p;
    try {
      p = Promise.resolve(fn());
    } catch (e) {
      release();
      return Promise.reject(e);
    }
    return p.then(function (v) { release(); return v; }, function (e) { release(); throw e; });
  };

  /* 對話框：焦點管理、Esc 關閉（原生）、背景點擊關閉、關閉後焦點回到開啟者 */
  var dialogOpeners = new WeakMap();
  ui.openDialog = function (dlg, opener) {
    if (!dlg) return;
    dialogOpeners.set(dlg, opener || document.activeElement);
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    var first = dlg.querySelector('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not([data-close]):not(:disabled)');
    if (first && !dlg.contains(document.activeElement)) first.focus();
  };
  ui.closeDialog = function (dlg) {
    if (!dlg) return;
    if (dlg.open) dlg.close();
  };
  function bindDialogs() {
    document.querySelectorAll('dialog.dialog').forEach(function (dlg) {
      dlg.addEventListener('close', function () {
        var opener = dialogOpeners.get(dlg);
        dialogOpeners.delete(dlg);
        if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
        else el('main').focus();
      });
      dlg.addEventListener('click', function (ev) {
        if (ev.target === dlg) ui.closeDialog(dlg);
      });
      dlg.querySelectorAll('[data-close]').forEach(function (btn) {
        btn.addEventListener('click', function () { ui.closeDialog(dlg); });
      });
    });
  }

  /** 通用確認對話框 → Promise<{ok:boolean, reason:string}> */
  var confirmResolver = null;
  ui.confirm = function (opts) {
    opts = opts || {};
    var dlg = el('dlg-confirm');
    el('confirm-title').textContent = opts.title || '確認';
    el('confirm-body').textContent = opts.body || '';
    var listEl = el('confirm-list');
    var items = Array.isArray(opts.items) ? opts.items.filter(Boolean) : [];
    listEl.hidden = !items.length;
    listEl.innerHTML = items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    var okBtn = el('confirm-ok');
    okBtn.textContent = opts.okText || '確定';
    okBtn.className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');
    var reasonField = el('confirm-reason-field');
    reasonField.hidden = !opts.withReason;
    el('confirm-reason').value = '';
    if (confirmResolver) confirmResolver({ ok: false, reason: '' });
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      ui.openDialog(dlg, opts.opener || null);
      okBtn.focus();
    });
  };
  function bindConfirm() {
    var dlg = el('dlg-confirm');
    el('confirm-ok').addEventListener('click', function () {
      var r = confirmResolver; confirmResolver = null;
      var reason = el('confirm-reason').value.trim().slice(0, 200);
      ui.closeDialog(dlg);
      if (r) r({ ok: true, reason: reason });
    });
    dlg.addEventListener('close', function () {
      var r = confirmResolver; confirmResolver = null;
      if (r) r({ ok: false, reason: '' });
    });
  }

  /* 清單狀態 */
  ui.renderSkeletonCards = function (container, n) {
    var html = '';
    for (var i = 0; i < (n || 3); i++) {
      html += '<div class="card skeleton-card" aria-hidden="true">' +
        '<span class="skeleton skeleton-line skeleton-line--w40"></span>' +
        '<span class="skeleton skeleton-line skeleton-line--w80"></span>' +
        '<span class="skeleton skeleton-line skeleton-line--w60"></span>' +
        '<span class="skeleton skeleton-block"></span></div>';
    }
    html += '<p class="visually-hidden" role="status">正在載入…</p>';
    container.innerHTML = html;
  };
  ui.renderEmpty = function (container, opts) {
    opts = opts || {};
    var html = '<div class="state-box">' +
      '<svg class="state-box__icon" viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true"><rect x="8" y="10" width="32" height="30" rx="4" stroke="currentColor" stroke-width="2"/><path d="M8 18h32M16 6v8M32 6v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 30h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<span class="state-box__title">' + esc(opts.title || '沒有資料') + '</span>' +
      (opts.text ? '<p>' + esc(opts.text) + '</p>' : '') +
      (opts.actionText ? '<button type="button" class="btn btn--secondary state-box__action">' + esc(opts.actionText) + '</button>' : '') +
      '</div>';
    container.innerHTML = html;
    var btn = container.querySelector('.state-box__action');
    if (btn && typeof opts.onAction === 'function') btn.addEventListener('click', opts.onAction);
  };
  ui.renderError = function (container, err, retry) {
    var html = '<div class="state-box state-box--error" role="alert">' +
      '<svg class="state-box__icon" viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2"/><path d="M24 14v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="24" cy="32.5" r="1.8" fill="currentColor"/></svg>' +
      '<span class="state-box__title">載入失敗</span>' +
      '<p>' + esc((err && err.message) || '發生未預期的錯誤，請稍後再試。') + '</p>' +
      (err && err.requestId ? '<span class="state-box__code">請求編號：' + esc(err.requestId) + '</span>' : '') +
      (typeof retry === 'function' ? '<button type="button" class="btn btn--primary state-box__retry">重試</button>' : '') +
      '</div>';
    container.innerHTML = html;
    var btn = container.querySelector('.state-box__retry');
    if (btn) btn.addEventListener('click', function () { retry(); });
  };

  /* ================= 錯誤對照表（合約 §1.5） ================= */
  var GENERIC = '系統發生錯誤，請稍後再試。';
  /**
   * handleError(err, opts) → boolean：true 表示呼叫者仍可自行顯示（例如清單錯誤狀態）；
   * false 表示已導向登入或已完全處理。
   * opts: { silent, form(field,msg), inline(msg), reloadWeek, reloadList(), retry() }
   */
  function handleError(err, opts) {
    opts = opts || {};
    var code = (err && err.code) || 'INTERNAL_ERROR';
    var message = (err && err.message) || GENERIC;
    var requestId = err && err.requestId;
    var toastErr = function (msg, extra) { if (!opts.silent) ui.toast(msg, 'error', extra || {}); };
    var showInline = function (msg) {
      if (typeof opts.inline === 'function') opts.inline(msg);
      else toastErr(msg);
    };
    if (!(err instanceof window.Api.ApiError)) {
      if (window.console && console.error) console.error(err);
    }
    switch (code) {
      case 'AUTH_REQUIRED':
        showLogin('請先登入。');
        return false;
      case 'INVALID_TOKEN':
      case 'INVALID_ISSUER':
        window.Auth.clear();
        showLogin('登入狀態無效，請重新登入。');
        return false;
      case 'TOKEN_EXPIRED':
        window.Auth.clear();
        showLogin('登入已過期，請重新登入。');
        return false;
      case 'INVALID_AUDIENCE':
        window.Auth.clear();
        showLogin('登入設定錯誤，請聯絡系統管理員。');
        return false;
      case 'EMAIL_NOT_VERIFIED':
        window.Auth.clear();
        showLogin(message || '此 Google 帳戶的電郵尚未驗證，未能使用本系統。');
        return false;
      case 'FORBIDDEN_DOMAIN':
        window.Auth.signOut();
        showLogin('只限 ' + (CONFIG.ALLOWED_DOMAIN || 'blcwc.edu.hk') + ' 帳戶使用本系統。');
        return false;
      case 'FORBIDDEN_ROLE':
        toastErr(message || '你沒有執行此操作的權限。');
        return true;
      case 'VALIDATION_ERROR':
        if (typeof opts.form === 'function') {
          opts.form(err.details && err.details.field, message);
        } else {
          toastErr(message);
        }
        return true;
      case 'CONFLICT_INSUFFICIENT_STOCK':
      case 'SLOT_BLOCKED':
        showInline(message);
        if (opts.reloadWeek !== false) loadWeek(state.currentWeekStart, { force: true, background: true });
        return true;
      case 'SLOT_PAST':
        showInline(message);
        return true;
      case 'NOT_FOUND':
      case 'INVALID_STATE_TRANSITION':
        showInline(message);
        if (typeof opts.reloadList === 'function') opts.reloadList();
        return true;
      case 'LOCK_TIMEOUT':
        toastErr('系統忙碌，請稍後再試。', opts.retry ? { action: { label: '重試', onClick: opts.retry } } : {});
        return true;
      case 'TIMEOUT':
      case 'NETWORK_ERROR':
        toastErr(message, opts.retry ? { action: { label: '重試', onClick: opts.retry } } : {});
        return true;
      case 'UNKNOWN_ACTION':
      case 'METHOD_NOT_ALLOWED':
      case 'INTERNAL_ERROR':
      default:
        toastErr(GENERIC, { requestId: requestId });
        return true;
    }
  }

  /* ================= 畫面切換 ================= */
  function showOnly(id) {
    ['view-login', 'view-setup', 'view-main'].forEach(function (v) { el(v).hidden = v !== id; });
    var authed = id === 'view-main';
    el('user-box').hidden = !authed;
    el('site-nav').hidden = !authed;
  }

  function showLogin(message) {
    state.user = null;
    state.booted = false;
    showOnly('view-login');
    el('login-message').textContent = message || '';
    window.Auth.init({
      onCredential: onCredential,
      onSignOut: onSignedOut,
      onStatus: function (text) { el('login-status').textContent = text || ''; }
    });
  }

  function onSignedOut() {
    state.user = null;
    state.settings = null;
    state.weekCache.clear();
    state.booted = false;
    showLogin('你已登出。');
  }

  function checkConfig() {
    var missing = [];
    var mock = window.Api.isMockMode();
    if (!CONFIG.API_URL || /REPLACE_WITH/.test(CONFIG.API_URL)) missing.push('API_URL（後端 Apps Script 網址）');
    if (!mock && (!CONFIG.GOOGLE_CLIENT_ID || /REPLACE_WITH/.test(CONFIG.GOOGLE_CLIENT_ID))) missing.push('GOOGLE_CLIENT_ID（Google OAuth 用戶端編號）');
    if (missing.length) {
      el('setup-missing').innerHTML = missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('');
      showOnly('view-setup');
      return false;
    }
    return true;
  }

  /* ================= 啟動流程 ================= */
  function onCredential() {
    el('login-message').textContent = '';
    el('login-status').textContent = '正在載入…';
    bootstrap();
  }

  function bootstrap() {
    var ticket = window.Api.latest('bootstrap');
    var date = state.currentWeekStart || undefined;
    var payload = date ? { date: date } : {};
    return window.Api.post('bootstrap', payload).then(function (data) {
      if (!ticket.isLatest()) return;
      applyBootstrap(data);
    }).catch(function (err) {
      if (!ticket.isLatest()) return;
      el('login-status').textContent = '';
      if (handleError(err, { silent: true })) {
        el('login-message').textContent = (err && err.message) || GENERIC;
        showOnly('view-login');
        ui.toast((err && err.message) || GENERIC, 'error', { action: { label: '重試', onClick: bootstrap }, requestId: err && err.requestId });
      }
    });
  }

  function applyBootstrap(data) {
    state.user = data.user;
    state.settings = data.settings;
    state.slots = data.slots || [];
    state.today = data.today;
    if (!state.currentWeekStart) state.currentWeekStart = weekStartOf(data.today);
    if (!state.selectedDate) state.selectedDate = state.today;
    if (data.week && data.week.weekStart) {
      state.weekCache.set(data.week.weekStart, { week: data.week, fetchedAt: Date.now() });
    }
    state.booted = true;
    renderUser();
    showOnly('view-main');
    el('login-status').textContent = '';
    if (state.settings && state.settings.schoolYear) el('footer-year').textContent = state.settings.schoolYear + ' 學年';
    window.Admin.initHandoverControls();
    route();
  }

  function renderUser() {
    var u = state.user || {};
    var emailEl = el('user-email');
    emailEl.textContent = u.email || '';
    emailEl.title = u.email || '';
    var roles = (u.roles || []).filter(function (r) { return r !== 'teacher'; }).map(function (r) { return ROLE_ZH[r] || r; });
    el('user-roles').textContent = roles.length ? roles.join('／') : (ROLE_ZH.teacher);
    var searchSection = el('search-section');
    if (searchSection) searchSection.hidden = !(hasRole('admin') || hasRole('handler'));
    document.querySelectorAll('#site-nav [data-role]').forEach(function (li) {
      li.hidden = !hasRole(li.getAttribute('data-role'));
    });
  }

  function hasRole(role) {
    return !!(state.user && Array.isArray(state.user.roles) && state.user.roles.indexOf(role) >= 0);
  }

  /* ================= 路由 ================= */
  function currentRoute() {
    var h = (location.hash || '#week').replace(/^#/, '').split('?')[0];
    return ROUTES[h] ? h : 'week';
  }

  function route(fromHashChange) {
    if (!state.booted) return;
    var r = currentRoute();
    if (ROUTE_ROLE[r] && !hasRole(ROUTE_ROLE[r])) {
      ui.toast('你沒有權限使用「' + (r === 'approve' ? '審批中心' : '領取／歸還') + '」。', 'warn');
      location.hash = '#week';
      return;
    }
    state.view = r;
    document.querySelectorAll('.view[data-view]').forEach(function (sec) {
      sec.hidden = sec.getAttribute('data-view') !== r;
    });
    document.querySelectorAll('.site-nav__link').forEach(function (a) {
      if (a.getAttribute('data-route') === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (r === 'week') renderWeekView();
    else if (r === 'mine') window.Forms.loadMine();
    else if (r === 'approve') window.Admin.loadApprove();
    else if (r === 'handover') window.Admin.loadHandover();
    if (fromHashChange) {
      var title = el(r + '-title');
      if (title) title.focus({ preventScroll: false });
    }
  }

  /* ================= 週表 ================= */
  function isMobileDayMode() {
    return mobileMq.matches && !state.forceWeekOnMobile;
  }

  function cacheTtl() {
    var t = Number(CONFIG.WEEK_CACHE_TTL_MS);
    return isFinite(t) && t >= 0 ? t : 60000;
  }

  function invalidateWeeks() {
    state.weekCache.forEach(function (entry) { entry.fetchedAt = 0; });
  }

  function weekRangeText(weekStart) {
    var start = window.Calendar.formatDateLong(weekStart);
    var endStr = addDays(weekStart, 6);
    var endD = window.Calendar.parseDate(endStr);
    var startD = window.Calendar.parseDate(weekStart);
    var end = (startD.getFullYear() === endD.getFullYear() ? '' : endD.getFullYear() + '年') + (endD.getMonth() + 1) + '月' + endD.getDate() + '日';
    var isThis = weekStart === weekStartOf(todayStr());
    return start + ' 至 ' + end + '（星期一至日）' + (isThis ? ' · 本週' : '');
  }

  function renderWeekView() {
    el('week-range').textContent = weekRangeText(state.currentWeekStart);
    el('btn-this-week').disabled = state.currentWeekStart === weekStartOf(todayStr());
    var toggle = el('btn-toggle-layout');
    toggle.setAttribute('aria-pressed', state.forceWeekOnMobile ? 'true' : 'false');
    toggle.textContent = state.forceWeekOnMobile ? '切換單日檢視' : '切換完整週表';
    el('day-select').parentElement.hidden = state.forceWeekOnMobile;
    loadWeek(state.currentWeekStart, {});
  }

  function loadWeek(weekStart, opts) {
    opts = opts || {};
    var container = el('week-container');
    if (!container || !state.booted) return Promise.resolve();
    var cached = state.weekCache.get(weekStart);
    var fresh = cached && (Date.now() - cached.fetchedAt) < cacheTtl();
    if (cached && fresh && !opts.force) {
      renderWeek(cached.week);
      return Promise.resolve(cached.week);
    }
    var ticket = window.Api.latest('week');
    state.lastWeekTicket = ticket;
    container.setAttribute('aria-busy', 'true');
    if (cached && (opts.background || !opts.force)) {
      renderWeek(cached.week);
    } else {
      window.Calendar.renderSkeleton(container, isMobileDayMode() ? 'day' : 'week');
    }
    return window.Api.post('getWeekData', { date: weekStart }).then(function (data) {
      if (!ticket.isLatest()) return null;
      container.setAttribute('aria-busy', 'false');
      var week = data && data.week;
      if (!week || !week.weekStart) throw new window.Api.ApiError('INTERNAL_ERROR', '伺服器回應格式不正確，請稍後再試。');
      state.weekCache.set(week.weekStart, { week: week, fetchedAt: Date.now() });
      if (week.weekStart === state.currentWeekStart && state.view === 'week') renderWeek(week);
      return week;
    }).catch(function (err) {
      if (!ticket.isLatest()) return null;
      container.setAttribute('aria-busy', 'false');
      if (!handleError(err, { silent: true })) return null;
      if (cached) {
        renderWeek(cached.week);
        ui.toast('無法更新時間表：' + ((err && err.message) || GENERIC), 'error', { action: { label: '重試', onClick: function () { loadWeek(weekStart, { force: true }); } } });
      } else {
        ui.renderError(container, err, function () { loadWeek(weekStart, { force: true }); });
      }
      return null;
    });
  }

  function ensureSelectedDate(week) {
    var dates = (week.days || []).map(function (d) { return d.date; });
    if (dates.indexOf(state.selectedDate) >= 0) return;
    if (dates.indexOf(todayStr()) >= 0) state.selectedDate = todayStr();
    else state.selectedDate = dates[0] || week.weekStart;
  }

  function fillDaySelect(week) {
    var sel = el('day-select');
    sel.innerHTML = (week.days || []).map(function (d) {
      return '<option value="' + esc(d.date) + '"' + (d.date === state.selectedDate ? ' selected' : '') + '>' +
        '星期' + window.Calendar.weekdayZh(d.weekday) + '　' + esc(window.Calendar.formatDateShort(d.date)) + (d.isToday ? '（今天）' : '') + '</option>';
    }).join('');
  }

  function renderWeek(week) {
    var container = el('week-container');
    var ctx = { week: week, slots: state.slots, settings: state.settings, user: state.user, onCellClick: onCellClick };
    if (isMobileDayMode()) {
      ensureSelectedDate(week);
      fillDaySelect(week);
      ctx.date = state.selectedDate;
      window.Calendar.renderDay(container, ctx);
    } else {
      window.Calendar.renderWeek(container, ctx);
    }
  }

  function onCellClick(info) {
    var cached = state.weekCache.get(state.currentWeekStart);
    if (info.kind === 'special') {
      if (info.special && !info.special.bookable) {
        ui.toast(info.day && info.day.isPast ? '此日期已過，不可新增特別活動。' : '此日期尚未開放預約（只可預約 ' + (state.settings.advanceDays || 30) + ' 天內）。', 'warn');
        return;
      }
      window.Forms.openApplication({
        type: '特別活動',
        date: info.date,
        slotId: null,
        special: info.special,
        week: cached ? cached.week : null,
        slots: state.slots,
        settings: state.settings,
        user: state.user,
        today: state.today,
        opener: info.button,
        onSubmitted: function () {
          loadWeek(state.currentWeekStart, { force: true, background: true });
        }
      });
      return;
    }
    if (!info.cell || !info.cell.bookable) {
      var reason = '此時段不可預約。';
      if (info.cell) {
        var map = { past: '此時段已過，不可預約。', blocked: '此時段已被封鎖' + (info.cell.blockedReason ? '：' + info.cell.blockedReason : '。'), cutoff: '此時段已超過申請截止時間。', beyondAdvance: '此日期尚未開放預約（只可預約 ' + (state.settings.advanceDays || 30) + ' 天內）。', notApplicable: '此時段不適用於該日。' };
        reason = map[info.cell.unbookableReason] || reason;
      }
      ui.toast(reason, 'warn');
      return;
    }
    window.Forms.openApplication({
      type: '一般課堂',
      date: info.date,
      slotId: info.slotId,
      special: cached ? window.Calendar.getSpecialCell(cached.week, info.date, info.day) : null,
      week: cached ? cached.week : null,
      slots: state.slots,
      settings: state.settings,
      user: state.user,
      today: state.today,
      opener: info.button,
      onSubmitted: function () {
        loadWeek(state.currentWeekStart, { force: true, background: true });
      }
    });
  }

  function goWeek(weekStart) {
    state.currentWeekStart = weekStart;
    state.selectedDate = weekStart === weekStartOf(todayStr()) ? todayStr() : weekStart;
    renderWeekView();
  }

  function bindWeekControls() {
    el('btn-prev-week').addEventListener('click', function () { goWeek(addDays(state.currentWeekStart, -7)); });
    el('btn-next-week').addEventListener('click', function () { goWeek(addDays(state.currentWeekStart, 7)); });
    el('btn-this-week').addEventListener('click', function () { goWeek(weekStartOf(todayStr())); });
    el('btn-refresh-week').addEventListener('click', function () { loadWeek(state.currentWeekStart, { force: true }); });
    el('day-select').addEventListener('change', function (ev) {
      state.selectedDate = ev.target.value;
      var cached = state.weekCache.get(state.currentWeekStart);
      if (cached) renderWeek(cached.week);
      else loadWeek(state.currentWeekStart, {});
    });
    el('btn-toggle-layout').addEventListener('click', function () {
      state.forceWeekOnMobile = !state.forceWeekOnMobile;
      renderWeekView();
    });
    var onMq = function () { if (state.view === 'week' && state.booted) renderWeekView(); };
    if (typeof mobileMq.addEventListener === 'function') mobileMq.addEventListener('change', onMq);
    else if (typeof mobileMq.addListener === 'function') mobileMq.addListener(onMq);
  }

  /* ================= 背景刷新 ================= */
  function bindVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !state.booted) return;
      if (window.Auth.isExpired() && !window.Auth.isMock()) {
        window.Auth.refreshToken().then(function (t) {
          if (!t) { window.Auth.clear(); showLogin('登入已過期，請重新登入。'); }
        });
      }
      if (state.view === 'week') {
        var cached = state.weekCache.get(state.currentWeekStart);
        if (!cached || (Date.now() - cached.fetchedAt) >= cacheTtl()) loadWeek(state.currentWeekStart, { force: true, background: true });
      } else if (state.view === 'mine') window.Forms.loadMine();
      else if (state.view === 'approve') window.Admin.loadApprove();
      else if (state.view === 'handover') window.Admin.loadHandover();
    });
  }

  /* ================= 初始化 ================= */
  function applyBranding() {
    if (CONFIG.APP_TITLE) {
      el('brand-title').textContent = CONFIG.APP_TITLE;
      el('login-title').textContent = CONFIG.APP_TITLE;
      document.title = CONFIG.APP_TITLE + '｜' + (CONFIG.SCHOOL_NAME || '');
    }
    if (CONFIG.SCHOOL_NAME) {
      el('brand-school').textContent = CONFIG.SCHOOL_NAME;
      el('login-school').textContent = CONFIG.SCHOOL_NAME;
      el('footer-school').textContent = CONFIG.SCHOOL_NAME;
    }
    if (CONFIG.ALLOWED_DOMAIN) el('login-domain').textContent = CONFIG.ALLOWED_DOMAIN;
    el('footer-year').textContent = new Date().getFullYear() + ' 年';
  }

  function init() {
    applyBranding();
    bindDialogs();
    bindConfirm();
    bindWeekControls();
    bindVisibility();
    el('btn-signout').addEventListener('click', function () {
      window.Auth.signOut();
    });
    el('btn-refresh-mine').addEventListener('click', function () { window.Forms.loadMine(); });
    window.Forms.initMineControls();
    window.addEventListener('hashchange', function () { route(true); });

    if (!checkConfig()) return;

    var token = window.Auth.getToken();
    if (token && !window.Auth.isExpired(token)) {
      showOnly('view-login');
      el('login-status').textContent = '正在載入…';
      bootstrap();
    } else if (token && !window.Auth.isMock()) {
      showLogin('');
      el('login-status').textContent = '正在續期登入…';
      window.Auth.refreshToken().then(function (t) {
        if (t) bootstrap();
        else { window.Auth.clear(); showLogin('登入已過期，請重新登入。'); }
      });
    } else {
      showLogin('');
    }
  }

  window.App = {
    ui: ui,
    handleError: handleError,
    loadWeek: function (weekStart, opts) { return loadWeek(weekStart || state.currentWeekStart, opts || {}); },
    invalidateWeeks: invalidateWeeks,
    todayStr: todayStr,
    weekStartOf: weekStartOf,
    addDays: addDays,
    getState: function () { return state; },
    showLogin: showLogin
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
