// Data.gs — 試算表存取層：request 級 memo（每表最多一次 getValues）、Map 索引、CacheService、正規化、防公式注入、寫入工具。

var CACHE_TTL_SECONDS_ = 600;
var CACHE_KEYS_ = { SETTINGS: 'settings', SLOTS: 'slots', STAFF: 'staff', BLOCKS: 'blocks' };

// 測試用：覆寫試算表 ID（不存在時使用 Script Property）
var SPREADSHEET_ID_OVERRIDE_ = null;

// request 級記憶：{ spreadsheet, sheets: {name: Sheet}, values: {name: any[][]} }
var RequestMemo_ = { spreadsheet: null, sheets: {}, values: {} };

function resetRequestMemo_() {
  RequestMemo_ = { spreadsheet: null, sheets: {}, values: {} };
}

function getSpreadsheetId_() {
  if (SPREADSHEET_ID_OVERRIDE_) return SPREADSHEET_ID_OVERRIDE_;
  return getProp_(PROP_KEYS.SPREADSHEET_ID);
}

function getSpreadsheet_() {
  if (RequestMemo_.spreadsheet) return RequestMemo_.spreadsheet;
  var id = getSpreadsheetId_();
  if (!id) throw new ApiError_(ERROR_CODES.INTERNAL_ERROR, '系統尚未設定 SPREADSHEET_ID。');
  RequestMemo_.spreadsheet = SpreadsheetApp.openById(id);
  return RequestMemo_.spreadsheet;
}

/** 取得工作表物件（memo）。不存在時拋 INTERNAL_ERROR。 */
function getSheet_(name) {
  if (RequestMemo_.sheets[name]) return RequestMemo_.sheets[name];
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new ApiError_(ERROR_CODES.INTERNAL_ERROR, '找不到工作表「' + name + '」，請先執行 setupSystem。');
  RequestMemo_.sheets[name] = sheet;
  return sheet;
}

/** 讀取整張工作表（含標題列）。同一 request 內重複呼叫直接回傳 memo。 */
function readSheet_(name) {
  if (RequestMemo_.values[name]) return RequestMemo_.values[name];
  return readSheetFresh_(name);
}

/** 強制重新讀取（鎖內使用），並更新 memo。 */
function readSheetFresh_(name) {
  var sheet = getSheet_(name);
  var values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  if (values.length === 0) values = [HEADERS[name].slice()];
  RequestMemo_.values[name] = values;
  return values;
}

/** 使 memo 失效（寫入後）。 */
function invalidateSheetMemo_(name) {
  delete RequestMemo_.values[name];
}

// ---------- 正規化 ----------

/** Date 或字串 → YYYY-MM-DD；無法解析回傳 ''。 */
function normalizeDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, getTimezone_(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + pad2_(parseInt(m[2], 10)) + '-' + pad2_(parseInt(m[3], 10));
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, getTimezone_(), 'yyyy-MM-dd');
  return '';
}

/** Date、`9:10`、`08:00:00` → HH:mm；無法解析回傳 ''。 */
function normalizeTime_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, getTimezone_(), 'HH:mm');
  }
  if (typeof v === 'number') {
    // 試算表時間序列值（一日的比例）
    var totalMinutes = Math.round((v % 1) * 24 * 60);
    return pad2_(Math.floor(totalMinutes / 60) % 24) + ':' + pad2_(totalMinutes % 60);
  }
  var s = String(v).trim();
  var m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return '';
  var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return '';
  return pad2_(h) + ':' + pad2_(mi);
}

/** Date → YYYY-MM-DD HH:mm:ss（Asia/Hong_Kong）。 */
function formatTimestamp_(date) {
  return Utilities.formatDate(date, getTimezone_(), 'yyyy-MM-dd HH:mm:ss');
}

/** Date 或字串時間戳 → YYYY-MM-DD HH:mm:ss 字串；空值回傳 ''。 */
function normalizeTimestamp_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : formatTimestamp_(v);
  var s = String(v).trim();
  var m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) return m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]) + ' ' + pad2_(+m[4]) + ':' + m[5] + ':' + (m[6] || '00');
  return s;
}

/** 時間戳字串（HK）→ epoch 毫秒；無法解析回傳 NaN。 */
function timestampToEpoch_(ts) {
  var s = normalizeTimestamp_(ts);
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  return zonedToEpoch_(m[1] + '-' + m[2] + '-' + m[3], m[4] + ':' + m[5], parseInt(m[6], 10));
}

/** 'YYYY-MM-DD' + 'HH:mm'（時區 = 系統時區）→ epoch 毫秒。 */
function zonedToEpoch_(dateStr, timeStr, seconds) {
  var d = dateStr.split('-'), t = (timeStr || '00:00').split(':');
  var guess = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1], seconds || 0);
  var tz = getTimezone_();
  var asLocal = Utilities.formatDate(new Date(guess), tz, 'yyyy-MM-dd HH:mm:ss');
  var p = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(asLocal);
  var localAsUtc = Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]);
  var offset = localAsUtc - guess;
  return guess - offset;
}

/** 今天（系統時區）YYYY-MM-DD。 */
function todayString_(now) {
  return Utilities.formatDate(now || Clock_.now(), getTimezone_(), 'yyyy-MM-dd');
}

/** YYYY-MM-DD 加 n 天。 */
function addDays_(dateStr, n) {
  var d = dateStr.split('-');
  var dt = new Date(Date.UTC(+d[0], +d[1] - 1, +d[2] + n));
  return dt.getUTCFullYear() + '-' + pad2_(dt.getUTCMonth() + 1) + '-' + pad2_(dt.getUTCDate());
}

/** YYYY-MM-DD → 'MON'..'SUN'。 */
function weekdayOf_(dateStr) {
  var d = dateStr.split('-');
  return WEEKDAYS[new Date(Date.UTC(+d[0], +d[1] - 1, +d[2])).getUTCDay()];
}

/** 'HH:mm' → 分鐘數。 */
function timeToMinutes_(hhmm) {
  var t = normalizeTime_(hhmm);
  if (!t) return NaN;
  var p = t.split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

/** 解析適用星期：MON-SAT、MON-FRI、MON,WED,FRI、SAT（大小寫不拘）→ ['MON',...]。 */
function parseDays_(v) {
  var s = String(v || '').trim().toUpperCase();
  var order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  if (!s) return order.slice(0, 6); // 空白視為 MON-SAT
  var out = [];
  var parts = s.split(/[,\s、;]+/);
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var range = /^([A-Z]{3})\s*[-–~]\s*([A-Z]{3})$/.exec(part);
    if (range) {
      var a = order.indexOf(range[1]), b = order.indexOf(range[2]);
      if (a < 0 || b < 0) continue;
      if (a <= b) {
        for (var k = a; k <= b; k++) if (out.indexOf(order[k]) < 0) out.push(order[k]);
      } else {
        for (var k2 = a; k2 < order.length; k2++) if (out.indexOf(order[k2]) < 0) out.push(order[k2]);
        for (var k3 = 0; k3 <= b; k3++) if (out.indexOf(order[k3]) < 0) out.push(order[k3]);
      }
    } else if (order.indexOf(part) >= 0) {
      if (out.indexOf(part) < 0) out.push(part);
    }
  }
  return out;
}

/** 啟用狀態欄：TRUE/true/是/1 → true。 */
function isTruthyFlag_(v) {
  if (v === true) return true;
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '是' || s === '1';
}

/** 是／否欄位：是、TRUE、true、1 → true。 */
function isYes_(v) {
  if (v === true) return true;
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '是' || s === 'true' || s === '1' || s === 'yes';
}

/** 申請是否為特別活動（依預約類型或明細 ACT 代號）。 */
function isSpecialApp_(app, details) {
  if (app && app.bookingType === BOOKING_TYPE_SPECIAL) return true;
  if (details && details.length && details[0].slotId === ACT_SLOT_ID) return true;
  return false;
}

function toInt_(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback === undefined ? 0 : fallback;
  var n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  return isFinite(n) ? Math.floor(n) : (fallback === undefined ? 0 : fallback);
}

// ---------- 防公式注入 ----------

/** 自由文字以 = + - @ 開頭時前置 '。非字串原值回傳。 */
function sanitizeCell_(v) {
  if (typeof v !== 'string') return v;
  if (/^\s*[=+\-@]/.test(v)) return "'" + v; // 含前置空白／tab 的公式亦防護
  return v;
}

/** 讀出自由文字時去除前置 '。 */
function unsanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  if (s.charAt(0) === "'" && /^'\s*[=+\-@]/.test(s)) return s.slice(1);
  return s;
}

// ---------- CacheService 快取層（settings / slots / staff / blocks） ----------

function cacheGetJson_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, obj) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(obj), CACHE_TTL_SECONDS_);
  } catch (err) {
    console.error('快取寫入失敗 ' + key + ': ' + err);
  }
}

function cacheRemove_(keys) {
  try {
    CacheService.getScriptCache().removeAll(keys);
  } catch (err) {
    console.error('快取移除失敗: ' + err);
  }
}

/** 系統時區：以 request memo 內的 settings 為準，未載入時用預設，避免遞迴讀表。 */
var TimezoneMemo_ = { value: '' };
function getTimezone_() {
  return TimezoneMemo_.value || DEFAULT_TIMEZONE;
}

/** 讀取系統設定 → Settings 物件（含 allowedDomain、remindHours）。 */
function getSettings_() {
  var cached = cacheGetJson_(CACHE_KEYS_.SETTINGS);
  if (cached) {
    TimezoneMemo_.value = cached.timezone || DEFAULT_TIMEZONE;
    return cached;
  }
  var rows = readSheet_(SHEET_NAMES.SETTINGS);
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][COL.SETTING.KEY] || '').trim();
    if (key) map[key] = rows[i][COL.SETTING.VALUE];
  }
  var splitList = function (v) {
    return String(v || '').split(/[,，]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  };
  var settings = {
    ipadTotal: toInt_(map[SETTING_KEYS.IPAD_TOTAL], 90),
    pencilTotal: toInt_(map[SETTING_KEYS.PENCIL_TOTAL], 90),
    advanceDays: toInt_(map[SETTING_KEYS.ADVANCE_DAYS], 30),
    cutoffHours: Number(map[SETTING_KEYS.CUTOFF_HOURS] === undefined || map[SETTING_KEYS.CUTOFF_HOURS] === '' ? 0 : map[SETTING_KEYS.CUTOFF_HOURS]) || 0,
    remindHours: toInt_(map[SETTING_KEYS.REMIND_HOURS], 24),
    classOptions: splitList(map[SETTING_KEYS.CLASS_OPTIONS]),
    subjectOptions: splitList(map[SETTING_KEYS.SUBJECT_OPTIONS]),
    timezone: String(map[SETTING_KEYS.TIMEZONE] || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
    schoolYear: String(map[SETTING_KEYS.SCHOOL_YEAR] || '').trim(),
    schemaVersion: toInt_(map[SETTING_KEYS.SCHEMA_VERSION], 2),
    overduePickupMinutes: toInt_(map[SETTING_KEYS.OVERDUE_PICKUP_MIN], 30),
    overdueReturnMinutes: toInt_(map[SETTING_KEYS.OVERDUE_RETURN_MIN], 30),
    afterHoursTime: normalizeTime_(map[SETTING_KEYS.SPECIAL_AFTER_HOURS]) || '17:15',
    specialEarliestStart: normalizeTime_(map[SETTING_KEYS.SPECIAL_EARLIEST_START]) || '07:00',
    specialLatestEnd: normalizeTime_(map[SETTING_KEYS.SPECIAL_LATEST_END]) || '22:00',
    allowedDomain: String(map[SETTING_KEYS.ALLOWED_DOMAIN] || '').trim().toLowerCase()
  };
  TimezoneMemo_.value = settings.timezone;
  cachePutJson_(CACHE_KEYS_.SETTINGS, settings);
  return settings;
}

/** 合約 Settings 形狀（去除內部欄位）。 */
function toPublicSettings_(s) {
  return {
    ipadTotal: s.ipadTotal, pencilTotal: s.pencilTotal, advanceDays: s.advanceDays, cutoffHours: s.cutoffHours,
    classOptions: s.classOptions.slice(), subjectOptions: s.subjectOptions.slice(), timezone: s.timezone,
    schoolYear: s.schoolYear, schemaVersion: s.schemaVersion,
    overduePickupMinutes: s.overduePickupMinutes, overdueReturnMinutes: s.overdueReturnMinutes,
    afterHoursTime: s.afterHoursTime, specialEarliestStart: s.specialEarliestStart, specialLatestEnd: s.specialLatestEnd
  };
}

/** 所有時段（含停用），每筆 {slotId, start, end, label, days, order, enabled}。 */
function getAllSlots_() {
  var cached = cacheGetJson_(CACHE_KEYS_.SLOTS);
  if (cached) return cached;
  var rows = readSheet_(SHEET_NAMES.SLOTS);
  var slots = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var id = String(r[COL.SLOT.ID] || '').trim();
    if (!id) continue;
    slots.push({
      slotId: id,
      start: normalizeTime_(r[COL.SLOT.START]),
      end: normalizeTime_(r[COL.SLOT.END]),
      label: unsanitizeCell_(r[COL.SLOT.LABEL]) || id,
      days: parseDays_(r[COL.SLOT.DAYS]),
      order: toInt_(r[COL.SLOT.ORDER], i),
      enabled: isTruthyFlag_(r[COL.SLOT.ENABLED])
    });
  }
  slots.sort(function (a, b) { return a.order - b.order; });
  cachePutJson_(CACHE_KEYS_.SLOTS, slots);
  return slots;
}

/** 只回傳啟用時段（合約 Slot 形狀，依 order 排序）。 */
function getEnabledSlots_() {
  return getAllSlots_().filter(function (s) { return s.enabled; }).map(function (s) {
    return { slotId: s.slotId, start: s.start, end: s.end, label: s.label, days: s.days.slice(), order: s.order };
  });
}

/** 人員設定 → { email: [roles] }（只含啟用列）。 */
function getStaff_() {
  var cached = cacheGetJson_(CACHE_KEYS_.STAFF);
  if (cached) return cached;
  var rows = readSheet_(SHEET_NAMES.STAFF);
  var staff = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var email = String(r[COL.STAFF.EMAIL] || '').trim().toLowerCase();
    if (!email || !isTruthyFlag_(r[COL.STAFF.ENABLED])) continue;
    var role = ROLE_LABELS[String(r[COL.STAFF.ROLE] || '').trim()];
    if (!role) continue;
    if (!staff[email]) staff[email] = [];
    if (staff[email].indexOf(role) < 0) staff[email].push(role);
  }
  cachePutJson_(CACHE_KEYS_.STAFF, staff);
  return staff;
}

/** 啟用且具指定角色的電郵清單。 */
function getEmailsByRole_(role) {
  var staff = getStaff_();
  var out = [];
  for (var email in staff) {
    if (Object.prototype.hasOwnProperty.call(staff, email) && staff[email].indexOf(role) >= 0) out.push(email);
  }
  return out.sort();
}

/** 封鎖日期 → { 'YYYY-MM-DD': {allDay, slotIds, reason} }。 */
function getBlocks_() {
  var cached = cacheGetJson_(CACHE_KEYS_.BLOCKS);
  if (cached) return cached;
  var rows = readSheet_(SHEET_NAMES.BLOCKS);
  var blocks = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var date = normalizeDate_(r[COL.BLOCK.DATE]);
    if (!date) continue;
    var spec = String(r[COL.BLOCK.SLOTS] || '').trim();
    var reason = unsanitizeCell_(r[COL.BLOCK.REASON]);
    var entry = blocks[date] || { allDay: false, slotIds: [], reason: '' };
    if (!spec || spec === '全日' || spec.toUpperCase() === 'ALL') {
      entry.allDay = true;
      entry.reason = reason || entry.reason;
    } else {
      var ids = spec.split(/[,，\s]+/);
      for (var k = 0; k < ids.length; k++) {
        var id = ids[k].trim().toUpperCase();
        if (id && entry.slotIds.indexOf(id) < 0) entry.slotIds.push(id);
      }
      if (!entry.reason) entry.reason = reason;
    }
    blocks[date] = entry;
  }
  cachePutJson_(CACHE_KEYS_.BLOCKS, blocks);
  return blocks;
}

/** 寫入相關工作表後精確清除快取。 */
function invalidateCacheForSheet_(sheetName) {
  var keys = [];
  if (sheetName === SHEET_NAMES.SETTINGS) keys.push(CACHE_KEYS_.SETTINGS);
  if (sheetName === SHEET_NAMES.SLOTS) keys.push(CACHE_KEYS_.SLOTS);
  if (sheetName === SHEET_NAMES.STAFF) keys.push(CACHE_KEYS_.STAFF);
  if (sheetName === SHEET_NAMES.BLOCKS) keys.push(CACHE_KEYS_.BLOCKS);
  if (keys.length) cacheRemove_(keys);
}

// ---------- 索引 ----------

/** 明細列 → 物件。 */
function detailFromRow_(row, rowIndex) {
  return {
    applicationId: String(row[COL.DETAIL.APP_ID] || '').trim(),
    date: normalizeDate_(row[COL.DETAIL.DATE]),
    slotId: String(row[COL.DETAIL.SLOT] || '').trim(),
    start: normalizeTime_(row[COL.DETAIL.START]),
    end: normalizeTime_(row[COL.DETAIL.END]),
    ipad: toInt_(row[COL.DETAIL.IPAD], 0),
    pencil: toInt_(row[COL.DETAIL.PENCIL], 0),
    rowIndex: rowIndex
  };
}

/** 主表列 → 內部申請物件（含 rowIndex，1 起算的工作表列號）。 */
function appFromRow_(row, rowIndex) {
  var flags = {};
  var rawFlags = row[COL.APP.FLAGS];
  if (rawFlags) {
    try { flags = JSON.parse(String(rawFlags)); if (!flags || typeof flags !== 'object') flags = {}; } catch (err) { flags = {}; }
  }
  return {
    applicationId: String(row[COL.APP.ID] || '').trim(),
    teacherEmail: String(row[COL.APP.EMAIL] || '').trim().toLowerCase(),
    teacherName: unsanitizeCell_(row[COL.APP.NAME]),
    className: unsanitizeCell_(row[COL.APP.CLASS]),
    students: toInt_(row[COL.APP.STUDENTS], 0),
    subject: unsanitizeCell_(row[COL.APP.SUBJECT]),
    remark: unsanitizeCell_(row[COL.APP.REMARK]),
    status: String(row[COL.APP.STATUS] || '').trim(),
    createdAt: normalizeTimestamp_(row[COL.APP.CREATED]),
    updatedAt: normalizeTimestamp_(row[COL.APP.UPDATED]),
    approvedBy: String(row[COL.APP.APPROVER] || '').trim(),
    approvedAt: normalizeTimestamp_(row[COL.APP.APPROVED_AT]),
    bookingType: String(row[COL.APP.TYPE] || '').trim(),
    activityName: unsanitizeCell_(row[COL.APP.ACTIVITY]),
    customStart: normalizeTime_(row[COL.APP.CUSTOM_START]),
    customEnd: normalizeTime_(row[COL.APP.CUSTOM_END]),
    afterHoursConfirm: isYes_(row[COL.APP.KEEP_AFTER]),
    needsSpecialApproval: isYes_(row[COL.APP.SPECIAL]),
    specialApprovalReason: unsanitizeCell_(row[COL.APP.SPECIAL_REASON]),
    reason: unsanitizeCell_(row[COL.APP.REASON]),
    ipadOutstanding: toInt_(row[COL.APP.IPAD_OUT], 0),
    pencilOutstanding: toInt_(row[COL.APP.PENCIL_OUT], 0),
    abnormalNote: unsanitizeCell_(row[COL.APP.ABNORMAL]),
    flags: flags,
    rowIndex: rowIndex
  };
}

/**
 * 建立索引。輸入為已讀好的二維陣列（含標題列）與時段清單。
 * @return {{appsById: Map, detailsByApp: Map, apps: Object[], cellStats: Map, blocks: Object}}
 */
function buildIndexes_(appRows, detailRows, slots, blocks) {
  var appsById = new Map();
  var apps = [];
  for (var i = 1; i < appRows.length; i++) {
    var a = appFromRow_(appRows[i], i + 1);
    if (!a.applicationId) continue;
    appsById.set(a.applicationId, a);
    apps.push(a);
  }
  var detailsByApp = new Map();
  for (var j = 1; j < detailRows.length; j++) {
    var d = detailFromRow_(detailRows[j], j + 1);
    if (!d.applicationId) continue;
    if (!detailsByApp.has(d.applicationId)) detailsByApp.set(d.applicationId, []);
    detailsByApp.get(d.applicationId).push(d);
  }
  detailsByApp.forEach(function (list) {
    list.sort(function (x, y) { return (x.date + ' ' + x.start).localeCompare(y.date + ' ' + y.start); });
  });
  var cellStats = computeCellStats_(apps, detailsByApp, slots, null);
  var intervalsByDate = buildIntervals_(apps, detailsByApp);
  var specialByDate = new Map();
  for (var s = 0; s < apps.length; s++) {
    var sp = apps[s];
    var spDetails = detailsByApp.get(sp.applicationId) || [];
    if (!isSpecialApp_(sp, spDetails)) continue;
    var spDate = spDetails.length ? spDetails[0].date : '';
    if (!spDate) continue;
    if (!specialByDate.has(spDate)) specialByDate.set(spDate, []);
    specialByDate.get(spDate).push({ app: sp, detail: spDetails[0] });
  }
  return {
    appsById: appsById, detailsByApp: detailsByApp, apps: apps, cellStats: cellStats,
    intervalsByDate: intervalsByDate, specialByDate: specialByDate, blocks: blocks || {}
  };
}

/**
 * 使用區間索引 Map(date → [{applicationId, startMin, endMin, ipad, pencil, pending}])。
 * 只含 approvedLike 與 pending 的明細；一般課堂為時段起訖，ACT 為自訂起訖。
 */
function buildIntervals_(apps, detailsByApp) {
  var byDate = new Map();
  for (var i = 0; i < apps.length; i++) {
    var app = apps[i];
    var isApproved = APPROVED_LIKE_STATUSES.indexOf(app.status) >= 0;
    var isPending = PENDING_STATUSES.indexOf(app.status) >= 0;
    if (!isApproved && !isPending) continue;
    var details = detailsByApp.get(app.applicationId) || [];
    for (var k = 0; k < details.length; k++) {
      var d = details[k];
      var startMin = timeToMinutes_(d.start), endMin = timeToMinutes_(d.end);
      if (!d.date || !isFinite(startMin) || !isFinite(endMin) || endMin <= startMin) continue;
      if (!byDate.has(d.date)) byDate.set(d.date, []);
      byDate.get(d.date).push({ applicationId: app.applicationId, startMin: startMin, endMin: endMin, ipad: d.ipad, pencil: d.pencil, pending: isPending });
    }
  }
  return byDate;
}

/**
 * 區間尖峰法（CONTRACT §9.4）：回傳 [start,end) 內同時使用量的最大值 {ipad, pencil}。
 * @param {Map} intervalsByDate buildIntervals_ 結果
 */
function peakUsage_(intervalsByDate, date, start, end, excludeApplicationId) {
  var startMin = timeToMinutes_(start), endMin = timeToMinutes_(end);
  var result = { ipad: 0, pencil: 0 };
  if (!isFinite(startMin) || !isFinite(endMin) || endMin <= startMin) return result;
  var all = intervalsByDate.get(date) || [];
  var overlapping = [];
  var boundaries = [startMin, endMin];
  for (var i = 0; i < all.length; i++) {
    var iv = all[i];
    if (excludeApplicationId && iv.applicationId === excludeApplicationId) continue;
    if (iv.startMin < endMin && iv.endMin > startMin) {
      overlapping.push(iv);
      if (iv.startMin > startMin && iv.startMin < endMin) boundaries.push(iv.startMin);
      if (iv.endMin > startMin && iv.endMin < endMin) boundaries.push(iv.endMin);
    }
  }
  if (!overlapping.length) return result;
  boundaries.sort(function (a, b) { return a - b; });
  for (var b = 0; b < boundaries.length - 1; b++) {
    var lo = boundaries[b], hi = boundaries[b + 1];
    if (hi <= lo) continue;
    var ipad = 0, pencil = 0;
    for (var k = 0; k < overlapping.length; k++) {
      if (overlapping[k].startMin < hi && overlapping[k].endMin > lo) { ipad += overlapping[k].ipad; pencil += overlapping[k].pencil; }
    }
    if (ipad > result.ipad) result.ipad = ipad;
    if (pencil > result.pencil) result.pencil = pencil;
  }
  return result;
}

/**
 * 計算每格統計 Map('date|slotId' → stats)。excludeAppId 用於核准時排除本申請的 pending。
 * 非標準時段代號（如 ACT）依時間區間重疊計入所有重疊的標準時段。
 */
function computeCellStats_(apps, detailsByApp, slots, excludeAppId) {
  var slotById = new Map();
  var slotRanges = [];
  for (var s = 0; s < slots.length; s++) {
    slotById.set(slots[s].slotId, slots[s]);
    slotRanges.push({ slotId: slots[s].slotId, startMin: timeToMinutes_(slots[s].start), endMin: timeToMinutes_(slots[s].end) });
  }
  var stats = new Map();
  var ensure = function (key, date, slotId) {
    var st = stats.get(key);
    if (!st) {
      st = { date: date, slotId: slotId, ipadApproved: 0, ipadPending: 0, pencilApproved: 0, pencilPending: 0, bookings: [] };
      stats.set(key, st);
    }
    return st;
  };
  for (var i = 0; i < apps.length; i++) {
    var app = apps[i];
    if (excludeAppId && app.applicationId === excludeAppId) continue;
    var isApproved = APPROVED_LIKE_STATUSES.indexOf(app.status) >= 0;
    var isPending = PENDING_STATUSES.indexOf(app.status) >= 0;
    if (!isApproved && !isPending) continue;
    var details = detailsByApp.get(app.applicationId) || [];
    for (var k = 0; k < details.length; k++) {
      var d = details[k];
      var targetSlotIds = [];
      if (slotById.has(d.slotId)) {
        targetSlotIds.push(d.slotId);
      } else {
        var dStart = timeToMinutes_(d.start), dEnd = timeToMinutes_(d.end);
        if (isFinite(dStart) && isFinite(dEnd)) {
          for (var r = 0; r < slotRanges.length; r++) {
            if (dStart < slotRanges[r].endMin && dEnd > slotRanges[r].startMin) targetSlotIds.push(slotRanges[r].slotId);
          }
        }
      }
      for (var t = 0; t < targetSlotIds.length; t++) {
        var st = ensure(d.date + '|' + targetSlotIds[t], d.date, targetSlotIds[t]);
        if (isApproved) { st.ipadApproved += d.ipad; st.pencilApproved += d.pencil; }
        else { st.ipadPending += d.ipad; st.pencilPending += d.pencil; }
        st.bookings.push({ app: app, ipad: d.ipad, pencil: d.pencil });
      }
    }
  }
  return stats;
}

// ---------- 寫入工具 ----------

/** 追加一列（自動補齊至標題欄數）。 */
function appendRow_(sheetName, values) {
  var sheet = getSheet_(sheetName);
  var width = Math.max(HEADERS[sheetName].length, sheet.getLastColumn());
  var row = values.slice();
  while (row.length < width) row.push('');
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
  invalidateSheetMemo_(sheetName);
  invalidateCacheForSheet_(sheetName);
  return lastRow + 1;
}

/** 一次 setValues 更新整列；updates 為 {colIndex: value}。回傳更新後的整列。 */
function updateRow_(sheetName, rowIndex, updates) {
  var sheet = getSheet_(sheetName);
  var width = Math.max(HEADERS[sheetName].length, sheet.getLastColumn());
  var current = readSheet_(sheetName)[rowIndex - 1] || [];
  var row = current.slice();
  while (row.length < width) row.push('');
  for (var col in updates) {
    if (Object.prototype.hasOwnProperty.call(updates, col)) row[parseInt(col, 10)] = updates[col];
  }
  sheet.getRange(rowIndex, 1, 1, width).setValues([row]);
  invalidateSheetMemo_(sheetName);
  invalidateCacheForSheet_(sheetName);
  return row;
}

/** 多列一次寫回（連續或不連續列皆逐列 setValues，一列一次，不逐格）。 */
function updateRows_(sheetName, rowUpdates) {
  var sheet = getSheet_(sheetName);
  var width = Math.max(HEADERS[sheetName].length, sheet.getLastColumn());
  var values = readSheet_(sheetName);
  var indexes = Object.keys(rowUpdates).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
  for (var i = 0; i < indexes.length; i++) {
    var rowIndex = indexes[i];
    var row = (values[rowIndex - 1] || []).slice();
    while (row.length < width) row.push('');
    var updates = rowUpdates[rowIndex];
    for (var col in updates) {
      if (Object.prototype.hasOwnProperty.call(updates, col)) row[parseInt(col, 10)] = updates[col];
    }
    sheet.getRange(rowIndex, 1, 1, width).setValues([row]);
  }
  invalidateSheetMemo_(sheetName);
  invalidateCacheForSheet_(sheetName);
}

/** 寫操作紀錄（永不拋錯，失敗只寫 console）。 */
function logAction_(actor, action, applicationId, before, after, roles, result, requestId, note) {
  try {
    appendRow_(SHEET_NAMES.LOGS, [
      formatTimestamp_(Clock_.now()),
      actor || 'system',
      action,
      applicationId || '',
      before === null || before === undefined ? '' : JSON.stringify(before),
      after === null || after === undefined ? '' : JSON.stringify(after),
      roles || 'system',
      result || '成功',
      requestId || '',
      sanitizeCell_(String(note || ''))
    ]);
  } catch (err) {
    console.error('寫入操作紀錄失敗: ' + err);
  }
}

/** 產生預約編號 BK-YYYY-NNNN（同年最大流水 + 1）。必須於鎖內呼叫並傳入最新主表。 */
function nextApplicationId_(appRows, now) {
  var year = Utilities.formatDate(now, getTimezone_(), 'yyyy');
  var prefix = 'BK-' + year + '-';
  var max = 0;
  for (var i = 1; i < appRows.length; i++) {
    var id = String(appRows[i][COL.APP.ID] || '');
    if (id.indexOf(prefix) === 0) {
      var n = parseInt(id.slice(prefix.length), 10);
      if (isFinite(n) && n > max) max = n;
    }
  }
  var next = String(max + 1);
  while (next.length < 4) next = '0' + next;
  return prefix + next;
}

/** 交收紀錄編號 HO-XXXXXXXX（8 位大寫十六進位）。 */
function nextHandoverId_() {
  var hex = '';
  var uuid = Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < uuid.length && hex.length < 8; i++) {
    if (/[0-9a-fA-F]/.test(uuid.charAt(i))) hex += uuid.charAt(i).toUpperCase();
  }
  while (hex.length < 8) hex += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return 'HO-' + hex;
}
