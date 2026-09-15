/* =========================================================
   Auth — Google Identity Services 登入
   - token 只存於記憶體與 sessionStorage（key：ipad_id_token）
   - JWT payload 只解析作顯示（email／exp），不作授權用途
   - 過期前 60 秒視為已過期
   - refreshToken()：以 prompt() 靜默續期一次
   - mock 模式（APP_CONFIG.AUTH_MODE === 'mock'）：顯示三個測試身分按鈕
   ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'ipad_id_token';
  var EXPIRY_SKEW_MS = 60 * 1000;
  var GIS_WAIT_MS = 12000;
  var REFRESH_WAIT_MS = 9000;

  var memoryToken = null;
  var initialized = false;
  var gisReady = false;
  var handlers = { onCredential: null, onSignOut: null, onStatus: null };
  var pendingRefresh = null;

  function config() { return window.APP_CONFIG || {}; }
  function isMock() { return config().AUTH_MODE === 'mock'; }

  /* ---------- JWT 解析（只作顯示） ---------- */
  function base64UrlDecode(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try {
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return null;
    }
  }

  function parseJwt(token) {
    if (!token || typeof token !== 'string') return null;
    if (token.indexOf('mock') === 0) {
      var role = token.split(':')[1] || 'teacher';
      return { email: 'demo-' + role + '@' + (config().ALLOWED_DOMAIN || 'example.edu'), exp: Math.floor(Date.now() / 1000) + 3600, hd: config().ALLOWED_DOMAIN, mock: true };
    }
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var json = base64UrlDecode(parts[1]);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function isExpired(token) {
    var t = token || memoryToken;
    if (!t) return true;
    var payload = parseJwt(t);
    if (!payload || !payload.exp) return true;
    return payload.exp * 1000 - EXPIRY_SKEW_MS <= Date.now();
  }

  /* ---------- token 儲存 ---------- */
  function setToken(token) {
    memoryToken = token || null;
    try {
      if (token) sessionStorage.setItem(STORAGE_KEY, token);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* sessionStorage 不可用（私隱模式等）時只保留記憶體 */
    }
  }

  function getToken() {
    if (memoryToken) return memoryToken;
    try {
      var stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) memoryToken = stored;
    } catch (e) {
      /* ignore */
    }
    return memoryToken;
  }

  function clear() {
    memoryToken = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  /** 顯示用資訊：email、exp、displayName（不作授權） */
  function getInfo() {
    var token = getToken();
    var p = parseJwt(token);
    if (!p) return null;
    return {
      email: (p.email || '').toLowerCase(),
      exp: p.exp || null,
      name: p.name || '',
      hd: p.hd || '',
      mock: !!p.mock
    };
  }

  function status(text) {
    if (typeof handlers.onStatus === 'function') handlers.onStatus(text || '');
  }

  /* ---------- Google Identity Services ---------- */
  function handleCredentialResponse(response) {
    var credential = response && response.credential;
    if (!credential) {
      if (pendingRefresh) {
        var pr = pendingRefresh; pendingRefresh = null;
        clearTimeout(pr.timer);
        pr.resolve(null);
      }
      return;
    }
    setToken(credential);
    if (pendingRefresh) {
      var p = pendingRefresh; pendingRefresh = null;
      clearTimeout(p.timer);
      p.resolve(credential);
      return;
    }
    if (typeof handlers.onCredential === 'function') handlers.onCredential(credential);
  }

  function waitForGis() {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      (function check() {
        if (window.google && window.google.accounts && window.google.accounts.id) return resolve(window.google.accounts.id);
        if (Date.now() - started > GIS_WAIT_MS) return reject(new Error('GIS_NOT_LOADED'));
        setTimeout(check, 120);
      })();
    });
  }

  function initGis() {
    return waitForGis().then(function (gid) {
      if (!gisReady) {
        gid.initialize({
          client_id: config().GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          hd: config().ALLOWED_DOMAIN,
          auto_select: true,
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: false,
          itp_support: true
        });
        gisReady = true;
      }
      return gid;
    });
  }

  function renderButton() {
    var host = document.getElementById('g_id_signin');
    if (!host) return Promise.resolve();
    return initGis().then(function (gid) {
      host.innerHTML = '';
      var width = Math.min(Math.max(host.parentElement ? host.parentElement.clientWidth : 320, 200), 400);
      gid.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        locale: 'zh-HK',
        width: width
      });
      status('');
    }).catch(function () {
      status('無法載入 Google 登入元件，請檢查網絡或瀏覽器設定後重新載入。');
    });
  }

  /**
   * 靜默續期：呼叫 prompt()；成功則 resolve 新 token，否則 resolve(null)。
   * 只會執行一次流程；同時多個呼叫共用同一 Promise。
   */
  function refreshToken() {
    if (isMock()) {
      var t = getToken() || 'mock:teacher';
      setToken(t);
      return Promise.resolve(t);
    }
    if (pendingRefresh) return pendingRefresh.promise;
    var record = {};
    record.promise = new Promise(function (resolve) {
      record.resolve = resolve;
      record.timer = setTimeout(function () {
        if (pendingRefresh === record) {
          pendingRefresh = null;
          resolve(null);
        }
      }, REFRESH_WAIT_MS);
    });
    pendingRefresh = record;
    initGis().then(function (gid) {
      gid.prompt(function (notification) {
        if (!notification || pendingRefresh !== record) return;
        var skipped = false;
        try {
          if (typeof notification.isNotDisplayed === 'function' && notification.isNotDisplayed()) skipped = true;
          if (typeof notification.isSkippedMoment === 'function' && notification.isSkippedMoment()) skipped = true;
          if (typeof notification.isDismissedMoment === 'function' && notification.isDismissedMoment()) {
            var reason = typeof notification.getDismissedReason === 'function' ? notification.getDismissedReason() : '';
            if (reason !== 'credential_returned') skipped = true;
          }
        } catch (e) {
          skipped = false;
        }
        if (skipped) {
          pendingRefresh = null;
          clearTimeout(record.timer);
          record.resolve(null);
        }
      });
    }).catch(function () {
      if (pendingRefresh === record) {
        pendingRefresh = null;
        clearTimeout(record.timer);
        record.resolve(null);
      }
    });
    return record.promise;
  }

  /** 登出：停用自動選取並清除 token */
  function signOut() {
    clear();
    if (!isMock() && window.google && window.google.accounts && window.google.accounts.id) {
      try { window.google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
      try { window.google.accounts.id.cancel(); } catch (e) { /* ignore */ }
    }
    if (typeof handlers.onSignOut === 'function') handlers.onSignOut();
  }

  /* ---------- mock 模式 ---------- */
  function setupMockButtons() {
    var box = document.getElementById('mock-signin');
    var gsi = document.getElementById('g_id_signin');
    if (gsi) gsi.hidden = true;
    if (!box) return;
    box.hidden = false;
    var buttons = box.querySelectorAll('[data-mock-role]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var role = btn.getAttribute('data-mock-role') || 'teacher';
        var token = 'mock:' + role;
        setToken(token);
        if (typeof handlers.onCredential === 'function') handlers.onCredential(token);
      });
    });
  }

  /**
   * Auth.init({ onCredential(token), onSignOut(), onStatus(text) })
   * 於登入畫面顯示時呼叫；重複呼叫只會重新繪製按鈕。
   */
  function init(opts) {
    opts = opts || {};
    if (typeof opts.onCredential === 'function') handlers.onCredential = opts.onCredential;
    if (typeof opts.onSignOut === 'function') handlers.onSignOut = opts.onSignOut;
    if (typeof opts.onStatus === 'function') handlers.onStatus = opts.onStatus;
    if (isMock()) {
      if (!initialized) setupMockButtons();
      initialized = true;
      return Promise.resolve();
    }
    initialized = true;
    status('正在載入 Google 登入…');
    return renderButton();
  }

  window.Auth = {
    init: init,
    renderButton: renderButton,
    getToken: getToken,
    setToken: setToken,
    clear: clear,
    isExpired: isExpired,
    parseJwt: parseJwt,
    getInfo: getInfo,
    refreshToken: refreshToken,
    signOut: signOut,
    isMock: isMock,
    STORAGE_KEY: STORAGE_KEY
  };
})();
