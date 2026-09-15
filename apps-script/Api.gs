// Api.gs — action 白名單 router、回應 envelope、統一錯誤處理與 payload 驗證工具。

/** 業務層可預期的錯誤；code 必為 ERROR_CODES 之一。 */
function ApiError_(code, message, details) {
  this.name = 'ApiError_';
  this.code = ERROR_CODES[code] ? code : ERROR_CODES.INTERNAL_ERROR;
  this.message = message || defaultErrorMessage_(this.code);
  this.details = details || null;
}
ApiError_.prototype = Object.create(Error.prototype);
ApiError_.prototype.constructor = ApiError_;

function defaultErrorMessage_(code) {
  var messages = {
    AUTH_REQUIRED: '請先登入。',
    INVALID_TOKEN: '登入憑證無效，請重新登入。',
    TOKEN_EXPIRED: '登入憑證已過期，請重新登入。',
    INVALID_AUDIENCE: '登入設定錯誤（aud 不符）。',
    INVALID_ISSUER: '登入憑證來源不正確。',
    EMAIL_NOT_VERIFIED: '此帳戶的電郵尚未驗證。',
    FORBIDDEN_DOMAIN: '只限學校網域帳戶使用。',
    FORBIDDEN_ROLE: '你沒有執行此操作的權限。',
    UNKNOWN_ACTION: '不支援的操作。',
    METHOD_NOT_ALLOWED: '此操作不允許以 GET 呼叫。',
    VALIDATION_ERROR: '輸入資料不合法。',
    CONFLICT_INSUFFICIENT_STOCK: '庫存不足，請調整數量或改選其他時段。',
    SLOT_BLOCKED: '所選日期或時段已被封鎖。',
    SLOT_PAST: '所選時段已過或已超過截止時間。',
    NOT_FOUND: '找不到指定的申請。',
    INVALID_STATE_TRANSITION: '目前狀態不允許此操作。',
    LOCK_TIMEOUT: '系統忙碌，請稍後再試。',
    INTERNAL_ERROR: '系統發生未預期錯誤，請稍後再試。'
  };
  return messages[code] || messages.INTERNAL_ERROR;
}

/**
 * action 白名單（物件對照表）。handler 一律以 (ctx, payload) 呼叫。
 * roles: null 表示只需通過驗證；陣列表示需具備其中至少一個角色。
 */
var ACTIONS_ = {
  health: { method: 'GET', auth: false, roles: null, handler: function () { return healthAction_(); } },
  whoami: { method: 'POST', auth: true, roles: null, handler: function (ctx, payload) { return whoamiAction_(ctx, payload); } },
  bootstrap: { method: 'POST', auth: true, roles: null, handler: function (ctx, payload) { return bootstrap(ctx, payload); } },
  getWeekData: { method: 'POST', auth: true, roles: null, handler: function (ctx, payload) { return getWeekData(ctx, payload); } },
  getMyApplications: { method: 'POST', auth: true, roles: null, handler: function (ctx, payload) { return getMyApplications(ctx, payload); } },
  submitApplication: { method: 'POST', auth: true, roles: [ROLES.TEACHER], handler: function (ctx, payload) { return submitApplication(ctx, payload); } },
  submitSpecialActivity: { method: 'POST', auth: true, roles: [ROLES.TEACHER], handler: function (ctx, payload) { return submitSpecialActivity(ctx, payload); } },
  cancelMyApplication: { method: 'POST', auth: true, roles: [ROLES.TEACHER], handler: function (ctx, payload) { return cancelMyApplication(ctx, payload); } },
  searchApplications: { method: 'POST', auth: true, roles: [ROLES.ADMIN, ROLES.HANDLER], handler: function (ctx, payload) { return searchApplications(ctx, payload); } },
  getPendingApplications: { method: 'POST', auth: true, roles: [ROLES.ADMIN], handler: function (ctx, payload) { return getPendingApplications(ctx, payload); } },
  approveApplication: { method: 'POST', auth: true, roles: [ROLES.ADMIN], handler: function (ctx, payload) { return approveApplication(ctx, payload); } },
  rejectApplication: { method: 'POST', auth: true, roles: [ROLES.ADMIN], handler: function (ctx, payload) { return rejectApplication(ctx, payload); } },
  getApprovedForHandover: { method: 'POST', auth: true, roles: [ROLES.HANDLER], handler: function (ctx, payload) { return getApprovedForHandover(ctx, payload); } },
  recordPickup: { method: 'POST', auth: true, roles: [ROLES.HANDLER], handler: function (ctx, payload) { return recordPickup(ctx, payload); } },
  recordReturn: { method: 'POST', auth: true, roles: [ROLES.HANDLER], handler: function (ctx, payload) { return recordReturn(ctx, payload); } }
};

/** 產生 requestId：req_ + 8 位隨機字元。 */
function newRequestId_() {
  var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'req_' + s;
}

function successEnvelope_(data, requestId) {
  return { ok: true, data: data === undefined ? null : data, error: null, requestId: requestId, serverTime: Clock_.now().toISOString() };
}

function errorEnvelope_(code, message, details, requestId) {
  var safeDetails = (code === ERROR_CODES.VALIDATION_ERROR && details && details.field) ? { field: String(details.field) } : null;
  return {
    ok: false, data: null,
    error: { code: code, message: message || defaultErrorMessage_(code), details: safeDetails },
    requestId: requestId, serverTime: Clock_.now().toISOString()
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 解析 doGet / doPost 的 e 參數為 {action, idToken, payload, clientRequestId}。 */
function parseRequest_(method, e) {
  var req = { action: '', idToken: '', payload: {}, clientRequestId: '' };
  if (method === 'GET') {
    var params = (e && e.parameter) || {};
    req.action = params.action ? String(params.action) : '';
    return req;
  }
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!raw) throw new ApiError_(ERROR_CODES.VALIDATION_ERROR, '請求內容為空。', { field: 'body' });
  var body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    throw new ApiError_(ERROR_CODES.VALIDATION_ERROR, '請求內容不是合法的 JSON。', { field: 'body' });
  }
  if (!body || typeof body !== 'object') throw new ApiError_(ERROR_CODES.VALIDATION_ERROR, '請求內容格式錯誤。', { field: 'body' });
  req.action = typeof body.action === 'string' ? body.action : '';
  req.idToken = typeof body.idToken === 'string' ? body.idToken : '';
  req.payload = (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)) ? body.payload : {};
  req.clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.slice(0, 64) : '';
  return req;
}

/** 統一入口：解析 → 路由 → 驗證身分／角色 → 執行 → envelope。 */
function handleRequest_(method, e) {
  var requestId = newRequestId_();
  resetRequestMemo_();
  var result;
  try {
    result = dispatch_(method, e, requestId);
    return jsonOutput_(successEnvelope_(result, requestId));
  } catch (err) {
    return jsonOutput_(toErrorEnvelope_(err, requestId));
  }
}

/** 將任何例外轉為安全 envelope；非 ApiError_ 的詳細內容只寫入 Stackdriver。 */
function toErrorEnvelope_(err, requestId) {
  if (err && err.name === 'ApiError_') {
    if (err.code === ERROR_CODES.INTERNAL_ERROR) console.error('[' + requestId + '] INTERNAL_ERROR: ' + err.message);
    return errorEnvelope_(err.code, err.message, err.details, requestId);
  }
  var detail = err && err.stack ? err.stack : String(err);
  console.error('[' + requestId + '] 未預期錯誤: ' + detail);
  return errorEnvelope_(ERROR_CODES.INTERNAL_ERROR, defaultErrorMessage_(ERROR_CODES.INTERNAL_ERROR), null, requestId);
}

/** 路由核心，回傳 data（不含 envelope）。 */
function dispatch_(method, e, requestId) {
  var req = parseRequest_(method, e);
  var action = req.action;
  // 直接在瀏覽器開啟 Web App URL（GET 且無 action）時視為 health，方便部署後檢查。
  if (method === 'GET' && !action) action = 'health';
  if (!Object.prototype.hasOwnProperty.call(ACTIONS_, action)) {
    throw new ApiError_(ERROR_CODES.UNKNOWN_ACTION, '不支援的操作：' + safeText_(action, 40));
  }
  var def = ACTIONS_[action];
  if (method === 'GET' && def.method !== 'GET') throw new ApiError_(ERROR_CODES.METHOD_NOT_ALLOWED);
  if (method === 'POST' && def.method === 'GET') throw new ApiError_(ERROR_CODES.METHOD_NOT_ALLOWED, '此操作只允許以 GET 呼叫。');

  if (!def.auth) return def.handler(null, req.payload);

  if (!req.idToken) throw new ApiError_(ERROR_CODES.AUTH_REQUIRED);
  var ctx = getUserContext(req.idToken);
  ctx.requestId = requestId;
  ctx.clientRequestId = req.clientRequestId;

  if (def.roles && def.roles.length) {
    var allowed = def.roles.some(function (r) { return ctx.roles.indexOf(r) >= 0; });
    if (!allowed) {
      try {
        logAction_(ctx.email, LOG_ACTIONS.ACCESS_DENIED, '', null, { action: action }, ctx.roles.join(','), '失敗:' + ERROR_CODES.FORBIDDEN_ROLE, requestId, '');
      } catch (logErr) {
        console.error('[' + requestId + '] 寫入拒絕存取紀錄失敗: ' + logErr);
      }
      throw new ApiError_(ERROR_CODES.FORBIDDEN_ROLE);
    }
  }
  return def.handler(ctx, req.payload);
}

/** health（GET）：不含任何預約資料或個人資料，只回報設定完成度以便部署檢查。 */
function healthAction_() {
  var data = { status: 'ok', schemaVersion: SCHEMA_VERSION, version: VERSION, setup: setupStatus_() };
  if (data.setup.hints.length) data.status = 'setup_incomplete';
  try {
    if (!data.setup.spreadsheetConfigured || data.setup.missingSheets.length) return data;
    var settings = getSettings_();
    data.schemaVersion = settings.schemaVersion;
    var allowedHd = getProp_(PROP_KEYS.ALLOWED_HD).toLowerCase();
    var sheetDomain = String(settings.allowedDomain || '').toLowerCase();
    if (allowedHd && sheetDomain && allowedHd !== sheetDomain) {
      data.configWarning = '系統設定「獲准網域」（' + sheetDomain + '）與 Script Property ALLOWED_HD（' + allowedHd + '）不一致，驗證以 ALLOWED_HD 為準。';
    }
  } catch (err) {
    console.error('health 讀取設定失敗: ' + err);
  }
  return data;
}

/**
 * 部署完成度檢查（不含個人資料）：Script Properties 是否齊全、8 個工作表是否存在、時段／人員筆數，
 * 以及對應的中文提示。
 */
function setupStatus_() {
  var status = {
    spreadsheetConfigured: !!getProp_(PROP_KEYS.SPREADSHEET_ID),
    oauthClientConfigured: !!getProp_(PROP_KEYS.OAUTH_CLIENT_ID),
    allowedHdConfigured: !!getProp_(PROP_KEYS.ALLOWED_HD),
    missingSheets: [],
    slotCount: 0,
    staffCount: 0,
    hints: []
  };
  if (!status.spreadsheetConfigured) status.hints.push('Script Property SPREADSHEET_ID 未設定。');
  if (!status.oauthClientConfigured) status.hints.push('Script Property OAUTH_CLIENT_ID 未設定，登入會被拒。');
  if (!status.allowedHdConfigured) status.hints.push('Script Property ALLOWED_HD 未設定。');
  if (!status.spreadsheetConfigured) return status;
  try {
    var ss = getSpreadsheet_();
    for (var i = 0; i < SHEET_ORDER_.length; i++) {
      if (!ss.getSheetByName(SHEET_ORDER_[i])) status.missingSheets.push(SHEET_ORDER_[i]);
    }
    if (status.missingSheets.length) {
      status.hints.push('試算表缺少工作表：' + status.missingSheets.join('、') + '，請在 Apps Script 編輯器執行 setupSystem()。');
      return status;
    }
    status.slotCount = Math.max(0, readSheetFresh_(SHEET_NAMES.SLOTS).length - 1);
    status.staffCount = Math.max(0, readSheetFresh_(SHEET_NAMES.STAFF).length - 1);
    if (!status.slotCount) status.hints.push('「時段設定」沒有任何時段，週表會是空的；請執行 setupSystem() 或手動填入。');
    if (!status.staffCount) status.hints.push('「人員設定」沒有任何管理員／經手人，將無人可審批；請填入電郵與角色。');
  } catch (err) {
    console.error('setupStatus_ 讀取試算表失敗: ' + err);
    status.hints.push('無法開啟 SPREADSHEET_ID 所指的試算表，請確認 ID 正確且部署者有編輯權限。');
  }
  return status;
}

function whoamiAction_(ctx) {
  return { user: toUser_(ctx) };
}

/** 將 ctx 轉為合約 User 形狀。 */
function toUser_(ctx) {
  return { email: ctx.email, roles: ctx.roles.slice(), displayName: ctx.displayName || ctx.email.split('@')[0] };
}

function safeText_(v, max) {
  return String(v === undefined || v === null ? '' : v).slice(0, max || 100);
}

// ---------- payload 驗證工具 ----------

function validationError_(field, message) {
  return new ApiError_(ERROR_CODES.VALIDATION_ERROR, message, { field: field });
}

/** 必填字串，長度 min–max（以字元計）。min=0 時允許缺少（回傳 ''）。 */
function requireString(v, field, min, max) {
  if (v === undefined || v === null) {
    if (min === 0) return '';
    throw validationError_(field, '「' + field + '」為必填。');
  }
  if (typeof v !== 'string') throw validationError_(field, '「' + field + '」必須是文字。');
  var s = v.trim();
  if (s.length < min) throw validationError_(field, min > 0 && s.length === 0 ? '「' + field + '」為必填。' : '「' + field + '」至少需要 ' + min + ' 個字。');
  if (s.length > max) throw validationError_(field, '「' + field + '」不可超過 ' + max + ' 個字。');
  return s;
}

/** 必填整數，範圍 min–max；接受數字或純數字字串。 */
function requireInt(v, field, min, max) {
  if (v === undefined || v === null || v === '') throw validationError_(field, '「' + field + '」為必填。');
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? parseInt(v.trim(), 10) : NaN);
  if (!isFinite(n) || Math.floor(n) !== n) throw validationError_(field, '「' + field + '」必須是整數。');
  if (n < min || n > max) throw validationError_(field, '「' + field + '」必須介乎 ' + min + ' 至 ' + max + '。');
  return n;
}

/** 必填 YYYY-MM-DD 且為真實日期。 */
function requireDate(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw validationError_(field, '「' + field + '」格式必須為 YYYY-MM-DD。');
  var y = parseInt(v.slice(0, 4), 10), m = parseInt(v.slice(5, 7), 10), d = parseInt(v.slice(8, 10), 10);
  var dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw validationError_(field, '「' + field + '」不是有效日期。');
  return v;
}

/** 必填 HH:mm（容許 H:mm），回傳正規化 HH:mm。 */
function requireTime(v, field) {
  if (typeof v !== 'string' || !/^\d{1,2}:\d{2}$/.test(v.trim())) throw validationError_(field, '「' + field + '」格式必須為 HH:mm。');
  var parts = v.trim().split(':');
  var h = parseInt(parts[0], 10), mi = parseInt(parts[1], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) throw validationError_(field, '「' + field + '」不是有效時間。');
  return pad2_(h) + ':' + pad2_(mi);
}

/** 必填字串陣列（去除空白、去重），長度 1–max。 */
function requireStringArray(v, field, max) {
  if (!Array.isArray(v) || v.length === 0) throw validationError_(field, '「' + field + '」至少需選擇一項。');
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') throw validationError_(field, '「' + field + '」內容必須是文字。');
    var s = v[i].trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  if (out.length === 0) throw validationError_(field, '「' + field + '」至少需選擇一項。');
  if (out.length > max) throw validationError_(field, '「' + field + '」最多可選 ' + max + ' 項。');
  return out;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}
