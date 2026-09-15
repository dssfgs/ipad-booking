/* =========================================================
   Api — 與 Apps Script 後端溝通（合約 §1）
   - POST：Content-Type text/plain;charset=UTF-8、redirect follow、credentials omit
   - ID token 只放在 body
   - AbortController 逾時
   - TOKEN_EXPIRED 靜默續期一次後重送
   - Api.latest(key) 請求序號機制，忽略過期回應
   ========================================================= */
(function () {
  'use strict';

  var CONFIG = window.APP_CONFIG || {};
  var DEFAULT_TIMEOUT = 20000;

  /** 所有 API 錯誤統一為 ApiError{code,message,requestId,details} */
  function ApiError(code, message, requestId, details) {
    this.name = 'ApiError';
    this.code = code || 'INTERNAL_ERROR';
    this.message = message || '發生未預期的錯誤，請稍後再試。';
    this.requestId = requestId || null;
    this.details = details || null;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ApiError);
    }
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /** 產生 UUID v4（用於 clientRequestId） */
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function isMockMode() {
    return (window.APP_CONFIG || {}).AUTH_MODE === 'mock';
  }

  function apiUrl() {
    return (window.APP_CONFIG || {}).API_URL || '';
  }

  function timeoutMs() {
    var t = Number((window.APP_CONFIG || {}).REQUEST_TIMEOUT_MS);
    return isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT;
  }

  /** 取得目前 token（mock 模式下沒有 token 時送 'mock'） */
  function currentToken() {
    var token = (window.Auth && typeof window.Auth.getToken === 'function') ? window.Auth.getToken() : null;
    if (isMockMode()) return token || 'mock';
    return token || '';
  }

  /** 解析回應 envelope；任何不合格式都轉為 ApiError */
  function parseEnvelope(text) {
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ApiError('INTERNAL_ERROR', '伺服器回應格式不正確，請稍後再試。', null);
    }
    if (!json || typeof json !== 'object' || typeof json.ok !== 'boolean') {
      throw new ApiError('INTERNAL_ERROR', '伺服器回應格式不正確，請稍後再試。', json && json.requestId);
    }
    return json;
  }

  /** 以 fetch 執行一次 POST（不含續期邏輯） */
  function rawPost(action, payload, token, clientRequestId) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, timeoutMs());
    }
    var body = JSON.stringify({
      action: action,
      idToken: token,
      payload: payload || {},
      clientRequestId: clientRequestId
    });
    return fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: body,
      redirect: 'follow',
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      return parseEnvelope(text);
    }).catch(function (err) {
      if (err instanceof ApiError) throw err;
      if (err && err.name === 'AbortError') {
        throw new ApiError('TIMEOUT', '連線逾時，請檢查網絡後再試。', null);
      }
      throw new ApiError('NETWORK_ERROR', '無法連接伺服器，請檢查網絡後再試。', null);
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Api.post(action, payload) → Promise<data>
   * 成功時回傳 envelope.data；失敗時拒絕並帶 ApiError。
   * TOKEN_EXPIRED：呼叫 Auth.refreshToken() 一次後重送同一 clientRequestId。
   */
  function post(action, payload) {
    var clientRequestId = uuid();
    var token = currentToken();

    function handle(envelope, retried) {
      if (envelope.ok) return envelope.data;
      var err = envelope.error || {};
      if (err.code === 'TOKEN_EXPIRED' && !retried && window.Auth && typeof window.Auth.refreshToken === 'function') {
        return window.Auth.refreshToken().then(function (newToken) {
          if (!newToken) {
            throw new ApiError('TOKEN_EXPIRED', err.message || '登入已過期，請重新登入。', envelope.requestId);
          }
          return rawPost(action, payload, newToken, clientRequestId).then(function (env2) {
            return handle(env2, true);
          });
        }, function () {
          throw new ApiError('TOKEN_EXPIRED', err.message || '登入已過期，請重新登入。', envelope.requestId);
        });
      }
      throw new ApiError(err.code, err.message, envelope.requestId, err.details || null);
    }

    return rawPost(action, payload, token, clientRequestId).then(function (envelope) {
      return handle(envelope, false);
    });
  }

  /** GET <API_URL>?action=health（唯一允許的 GET） */
  function getHealth() {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs()) : null;
    var url = apiUrl() + (apiUrl().indexOf('?') >= 0 ? '&' : '?') + 'action=health';
    return fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    }).then(function (res) { return res.text(); })
      .then(function (text) {
        var env = parseEnvelope(text);
        if (!env.ok) {
          var e = env.error || {};
          throw new ApiError(e.code, e.message, env.requestId, e.details || null);
        }
        return env.data;
      })
      .catch(function (err) {
        if (err instanceof ApiError) throw err;
        if (err && err.name === 'AbortError') throw new ApiError('TIMEOUT', '連線逾時，請檢查網絡後再試。', null);
        throw new ApiError('NETWORK_ERROR', '無法連接伺服器，請檢查網絡後再試。', null);
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /**
   * 請求序號機制：
   *   var ticket = Api.latest('week');
   *   Api.post(...).then(function (data) { if (!ticket.isLatest()) return; ... });
   * 同一 key 較新的請求發出後，舊 ticket 的 isLatest() 回傳 false。
   */
  var sequences = {};
  function latest(key) {
    var k = String(key || 'default');
    sequences[k] = (sequences[k] || 0) + 1;
    var mine = sequences[k];
    return {
      key: k,
      seq: mine,
      isLatest: function () { return sequences[k] === mine; },
      /** 手動作廢（例如使用者離開頁面） */
      invalidate: function () { sequences[k] = (sequences[k] || 0) + 1; }
    };
  }

  window.Api = {
    ApiError: ApiError,
    post: post,
    getHealth: getHealth,
    latest: latest,
    uuid: uuid,
    isMockMode: isMockMode
  };
})();
