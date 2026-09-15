// Code.gs — 全域常數、Web App 入口（doGet / doPost）及可在編輯器直接執行的全域函式。

var VERSION = '3.0.0';
var SCHEMA_VERSION = 3;

var SHEET_NAMES = {
  APPLICATIONS: '申請主表',
  DETAILS: '時段明細',
  HANDOVERS: '交收紀錄',
  SLOTS: '時段設定',
  SETTINGS: '系統設定',
  STAFF: '人員設定',
  BLOCKS: '封鎖日期',
  LOGS: '操作紀錄'
};

var STATUS = {
  PENDING: '待審批',
  APPROVED: '已核准',
  REJECTED: '已拒絕',
  CANCELLED: '已取消',
  PICKED_UP: '已領取',
  PARTIAL_RETURN: '未完全歸還',
  RETURNED: '已歸還',
  OVERDUE_PICKUP: '逾時未領取',
  OVERDUE_RETURN: '逾時未歸還',
  EXPIRED: '已過期'
};

var APPROVED_LIKE_STATUSES = [
  STATUS.APPROVED, STATUS.PICKED_UP, STATUS.PARTIAL_RETURN, STATUS.OVERDUE_PICKUP, STATUS.OVERDUE_RETURN
];
var PENDING_STATUSES = [STATUS.PENDING];
var TERMINAL_STATUSES = [STATUS.REJECTED, STATUS.CANCELLED, STATUS.RETURNED, STATUS.EXPIRED];

var ROLES = { TEACHER: 'teacher', ADMIN: 'admin', HANDLER: 'handler' };

// 人員設定「角色」欄字串 → API 角色代碼
var ROLE_LABELS = {
  '管理員': ROLES.ADMIN,
  '審批員': ROLES.ADMIN,
  '設備室經手人': ROLES.HANDLER,
  '借還處理員': ROLES.HANDLER,
  '處理員': ROLES.HANDLER
};

var ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_AUDIENCE: 'INVALID_AUDIENCE',
  INVALID_ISSUER: 'INVALID_ISSUER',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  FORBIDDEN_DOMAIN: 'FORBIDDEN_DOMAIN',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT_INSUFFICIENT_STOCK: 'CONFLICT_INSUFFICIENT_STOCK',
  SLOT_BLOCKED: 'SLOT_BLOCKED',
  SLOT_PAST: 'SLOT_PAST',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  LOCK_TIMEOUT: 'LOCK_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// 各工作表欄位索引（0 起算），與 CONTRACT §3 一致
var COL = {
  APP: {
    ID: 0, EMAIL: 1, NAME: 2, CLASS: 3, STUDENTS: 4, SUBJECT: 5, REMARK: 6, STATUS: 7,
    CREATED: 8, UPDATED: 9, APPROVER: 10, APPROVED_AT: 11, TYPE: 12, ACTIVITY: 13,
    CUSTOM_START: 14, CUSTOM_END: 15, KEEP_AFTER: 16, NOTIFY_48H: 17, SPECIAL: 18,
    SPECIAL_REASON: 19, REASON: 20, IPAD_OUT: 21, PENCIL_OUT: 22, ABNORMAL: 23, FLAGS: 24
  },
  DETAIL: { APP_ID: 0, DATE: 1, SLOT: 2, START: 3, END: 4, IPAD: 5, PENCIL: 6 },
  HANDOVER: { ID: 0, APP_ID: 1, TYPE: 2, TIME: 3, IPAD: 4, PENCIL: 5, HANDLER: 6, NOTE: 7 },
  SLOT: { ID: 0, START: 1, END: 2, LABEL: 3, DAYS: 4, ORDER: 5, ENABLED: 6 },
  SETTING: { KEY: 0, VALUE: 1 },
  STAFF: { EMAIL: 0, ROLE: 1, ENABLED: 2 },
  BLOCK: { DATE: 0, SLOTS: 1, REASON: 2, BY: 3, AT: 4 },
  LOG: { TIME: 0, ACTOR: 1, ACTION: 2, APP_ID: 3, BEFORE: 4, AFTER: 5, ROLES: 6, RESULT: 7, REQUEST_ID: 8, NOTE: 9 }
};

// 各工作表 v3 完整標題列
var HEADERS = {};
HEADERS[SHEET_NAMES.APPLICATIONS] = [
  '預約編號', '教師電郵', '教師姓名', '班別', '學生人數', '科目', '備註', '狀態', '建立時間', '最後更新時間',
  '審批人', '審批時間', '預約類型', '活動名稱', '自訂開始時間', '自訂結束時間', '17:15後保管確認',
  '48小時內通知Molly確認', '需特別批准', '特別批准原因', '拒絕／取消原因', '未還 iPad 數量',
  '未還 Pencil 數量', '異常備註', '通知旗標'
];
HEADERS[SHEET_NAMES.DETAILS] = ['預約編號', '日期', '時段代號', '開始時間', '結束時間', 'iPad 數量', 'Apple Pencil 數量'];
HEADERS[SHEET_NAMES.HANDOVERS] = ['紀錄編號', '預約編號', '類型', '時間', 'iPad 數量', 'Apple Pencil 數量', '經手人', '異常備註'];
HEADERS[SHEET_NAMES.SLOTS] = ['時段代號', '開始時間', '結束時間', '標籤', '適用星期', '顯示次序', '啟用狀態'];
HEADERS[SHEET_NAMES.SETTINGS] = ['項目', '數值'];
HEADERS[SHEET_NAMES.STAFF] = ['電郵', '角色', '啟用狀態'];
HEADERS[SHEET_NAMES.BLOCKS] = ['日期', '時段代號或全日', '原因', '設定者', '設定時間'];
HEADERS[SHEET_NAMES.LOGS] = ['時間', '操作者', '動作', '預約編號', '原資料', '新資料', '角色', '結果', '請求編號', '備註'];

// 系統設定項目名稱
var SETTING_KEYS = {
  IPAD_TOTAL: 'iPad 總數',
  PENCIL_TOTAL: 'Apple Pencil 總數',
  ALLOWED_DOMAIN: '獲准網域',
  ADVANCE_DAYS: '提前日數',
  CUTOFF_HOURS: '截止時數',
  REMIND_HOURS: '提醒時數',
  TIMEZONE: '時區',
  SCHOOL_YEAR: '學年',
  CLASS_OPTIONS: '班別選項',
  SUBJECT_OPTIONS: '科目選項',
  SCHEMA_VERSION: 'schemaVersion',
  OVERDUE_PICKUP_MIN: '逾時未領取分鐘',
  OVERDUE_RETURN_MIN: '逾時未歸還分鐘',
  SYSTEM_VERSION: '系統版本',
  SPECIAL_AFTER_HOURS: '特別活動最遲時間',
  SPECIAL_EARLIEST_START: '特別活動最早開始',
  SPECIAL_LATEST_END: '特別活動最遲結束'
};

// 預設系統設定（setupSystem 建新表及 migration 補列時使用）
var DEFAULT_SETTINGS = [
  [SETTING_KEYS.IPAD_TOTAL, 90],
  [SETTING_KEYS.PENCIL_TOTAL, 90],
  [SETTING_KEYS.ALLOWED_DOMAIN, 'blcwc.edu.hk'],
  [SETTING_KEYS.ADVANCE_DAYS, 30],
  [SETTING_KEYS.CUTOFF_HOURS, 0],
  [SETTING_KEYS.REMIND_HOURS, 24],
  [SETTING_KEYS.TIMEZONE, 'Asia/Hong_Kong'],
  [SETTING_KEYS.SCHOOL_YEAR, '2026-2027'],
  [SETTING_KEYS.CLASS_OPTIONS, '1A,1B,1C,1D,2A,2B,2C,2D,3A,3B,3C,3D,4A,4B,4C,4D,5A,5B,5C,5D,6A,6B,6C,6D'],
  [SETTING_KEYS.SUBJECT_OPTIONS, '中國語文,英國語文,數學,公民與社會發展,通識,物理,化學,生物,地理,歷史,中國歷史,經濟,企業會計與財務概論,資訊及通訊科技,視覺藝術,音樂,體育,佛學,科學,設計與科技,其他'],
  [SETTING_KEYS.SCHEMA_VERSION, SCHEMA_VERSION],
  [SETTING_KEYS.OVERDUE_PICKUP_MIN, 30],
  [SETTING_KEYS.OVERDUE_RETURN_MIN, 30],
  [SETTING_KEYS.SYSTEM_VERSION, VERSION],
  [SETTING_KEYS.SPECIAL_AFTER_HOURS, '17:15'],
  [SETTING_KEYS.SPECIAL_EARLIEST_START, '07:00'],
  [SETTING_KEYS.SPECIAL_LATEST_END, '22:00']
];

// 預設時段（P01–P09 + AFTER）
var DEFAULT_SLOTS = [
  ['P01', '08:35', '09:10', '第 1 節', 'MON-SAT', 1, 'TRUE'],
  ['P02', '09:10', '09:45', '第 2 節', 'MON-SAT', 2, 'TRUE'],
  ['P03', '09:45', '10:20', '第 3 節', 'MON-SAT', 3, 'TRUE'],
  ['P04', '10:35', '11:10', '第 4 節', 'MON-SAT', 4, 'TRUE'],
  ['P05', '11:10', '11:45', '第 5 節', 'MON-SAT', 5, 'TRUE'],
  ['P06', '12:00', '12:35', '第 6 節', 'MON-SAT', 6, 'TRUE'],
  ['P07', '12:35', '13:10', '第 7 節', 'MON-SAT', 7, 'TRUE'],
  ['P08', '14:25', '15:00', '第 8 節', 'MON-SAT', 8, 'TRUE'],
  ['P09', '15:00', '15:35', '第 9 節', 'MON-SAT', 9, 'TRUE'],
  ['AFTER', '15:35', '17:15', '放學時段', 'MON-SAT', 10, 'TRUE']
];

var LOG_ACTIONS = {
  SUBMIT: '提交申請',
  SUBMIT_SPECIAL: '提交特別活動',
  SPECIAL_APPROVE: '特別批准',
  CANCEL: '取消申請',
  APPROVE: '核准申請',
  REJECT: '拒絕申請',
  PICKUP: '登記領取',
  PARTIAL_RETURN: '部分歸還',
  FULL_RETURN: '完全歸還',
  AUTO_EXPIRE: '自動過期',
  OVERDUE_PICKUP: '逾時未領取',
  OVERDUE_RETURN: '逾時未歸還',
  REMIND_PENDING: '待審提醒',
  MIGRATION: '執行 migration',
  SETUP: '系統初始化',
  ACCESS_DENIED: '拒絕存取'
};

var HANDOVER_TYPES = { PICKUP: '領取', PARTIAL: '部分歸還', FULL: '完全歸還' };
var BOOKING_TYPE_NORMAL = '一般課堂';
var BOOKING_TYPE_SPECIAL = '特別活動';
var ACT_SLOT_ID = 'ACT';
var YES = '是';
var NO = '否';
// 保管確認文字（前端表單、審批卡片、電郵三處一字不改）
var AFTER_HOURS_CONFIRM_TEXT = '本人明白須自行保管 iPad 及 Apple Pencil，並於下一個上課天交到圖書館給 Molly。';
var WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
var DEFAULT_TIMEZONE = 'Asia/Hong_Kong';

// Script Properties 鍵名（CONTRACT §8）
var PROP_KEYS = {
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  OAUTH_CLIENT_ID: 'OAUTH_CLIENT_ID',
  ALLOWED_HD: 'ALLOWED_HD',
  FRONTEND_URL: 'FRONTEND_URL',
  ADMIN_EMAIL_FALLBACK: 'ADMIN_EMAIL_FALLBACK'
};

// 可注入的時鐘（測試用）；正式環境一律回傳 new Date()
var Clock_ = {
  override: null,
  now: function () { return this.override ? new Date(this.override.getTime()) : new Date(); }
};

/** Web App GET 入口：只允許 action=health。 */
function doGet(e) {
  return handleRequest_('GET', e);
}

/** Web App POST 入口：所有需要身分的讀取及寫入。 */
function doPost(e) {
  return handleRequest_('POST', e);
}

/** 於編輯器執行：對 SPREADSHEET_ID 所指的現有試算表做初始化或升級（可重複執行；不會建立新試算表）。 */
function setupSystem() {
  return setupSystem_();
}

/** 於編輯器執行：明確建立全新空白試算表並初始化（只在 SPREADSHEET_ID 未設定時允許）。 */
function createNewSpreadsheetAndSetup() {
  return createNewSpreadsheetAndSetup_();
}

/** 時間觸發器每 15 分鐘執行：自動過期／逾時／待審提醒。 */
function processScheduledTasks() {
  return processScheduledTasks_();
}

/** 於編輯器執行：只跑 migration。 */
function migrateSystem() {
  return migrateSystem_();
}

// 測試注入：非 null 時先查此物件，避免測試更動正式 Script Properties
var PROP_OVERRIDE_ = null;

/** 讀取 Script Property；缺少時回傳空字串。 */
function getProp_(key) {
  if (PROP_OVERRIDE_ && Object.prototype.hasOwnProperty.call(PROP_OVERRIDE_, key)) {
    var o = PROP_OVERRIDE_[key];
    return o === null || o === undefined ? '' : String(o);
  }
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === undefined ? '' : String(v);
}
