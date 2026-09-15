// Migration.gs — setupSystem（建立新試算表或升級現有）、migrateSystem（v2→v3 只追加不刪改）、protectSheets_。

var SHEET_ORDER_ = [
  SHEET_NAMES.APPLICATIONS, SHEET_NAMES.DETAILS, SHEET_NAMES.HANDOVERS, SHEET_NAMES.SLOTS,
  SHEET_NAMES.SETTINGS, SHEET_NAMES.STAFF, SHEET_NAMES.BLOCKS, SHEET_NAMES.LOGS
];

/**
 * 初始化或升級現有試算表（可重複執行）。回傳 {spreadsheetId, created:false, migration}。
 * 只會對 Script Properties 的 SPREADSHEET_ID 所指的試算表執行 migration，
 * 絕不會自行建立新試算表；缺少 SPREADSHEET_ID 時擲回明確錯誤。
 * 需要建立全新試算表請改用 createNewSpreadsheetAndSetup()。
 */
function setupSystem_() {
  resetRequestMemo_();
  var id = getProp_(PROP_KEYS.SPREADSHEET_ID);
  if (!id) {
    throw new Error('尚未設定 Script Property「' + PROP_KEYS.SPREADSHEET_ID + '」。' +
      '請於「專案設定 → 指令碼屬性」填入中央試算表 ID 後再執行 setupSystem()；' +
      '若確定要建立一個全新的空白試算表，請改執行 createNewSpreadsheetAndSetup()。');
  }
  installTriggers_();
  var migration = migrateSystem_();
  protectSheets_();
  return { spreadsheetId: id, created: false, migration: migration };
}

/**
 * 明確建立全新 v3 試算表並完成初始化。只在 SPREADSHEET_ID 尚未設定時允許執行，
 * 避免覆蓋現有設定；成功後寫入 SPREADSHEET_ID。回傳 {spreadsheetId, created:true, migration}。
 */
function createNewSpreadsheetAndSetup_() {
  resetRequestMemo_();
  var existing = getProp_(PROP_KEYS.SPREADSHEET_ID);
  if (existing) {
    throw new Error('Script Property「' + PROP_KEYS.SPREADSHEET_ID + '」已設定為 ' + existing +
      '，為避免覆蓋現有系統，不會建立新試算表。若確定要另建，請先手動清除該屬性。');
  }
  var id = createFreshSpreadsheet_();
  PropertiesService.getScriptProperties().setProperty(PROP_KEYS.SPREADSHEET_ID, id);
  resetRequestMemo_();
  installTriggers_();
  var migration = migrateSystem_();
  protectSheets_();
  logAction_('system', LOG_ACTIONS.SETUP, '', null, { spreadsheetId: id, version: VERSION }, 'system', '成功', '', '建立全新試算表');
  return { spreadsheetId: id, created: true, migration: migration };
}

/** 建立全新 v3 試算表（8 表、標題、預設設定、P01–P09+AFTER、人員設定只放部署者）。回傳 ID。 */
function createFreshSpreadsheet_() {
  var ss = SpreadsheetApp.create('iPad 預約及借還系統');
  var defaultSheet = ss.getSheets()[0];
  for (var i = 0; i < SHEET_ORDER_.length; i++) {
    var name = SHEET_ORDER_[i];
    var sheet = i === 0 ? defaultSheet.setName(name) : ss.insertSheet(name, i);
    writeHeaderRow_(sheet, HEADERS[name]);
  }
  var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  settingsSheet.getRange(2, 1, DEFAULT_SETTINGS.length, 2).setValues(DEFAULT_SETTINGS.map(function (r) { return r.slice(); }));
  var slotsSheet = ss.getSheetByName(SHEET_NAMES.SLOTS);
  slotsSheet.getRange(2, 1, DEFAULT_SLOTS.length, DEFAULT_SLOTS[0].length).setValues(DEFAULT_SLOTS.map(function (r) { return r.slice(); }));
  var deployer = resolveDeployerEmail_();
  if (deployer) {
    ss.getSheetByName(SHEET_NAMES.STAFF).getRange(2, 1, 2, 3).setValues([
      [deployer, '管理員', 'TRUE'],
      [deployer, '設備室經手人', 'TRUE']
    ]);
  }
  return ss.getId();
}

/**
 * 解析部署者電郵作為新試算表的預設管理員：先取 Script Property ADMIN_EMAIL_FALLBACK，
 * 其次 Session.getEffectiveUser()（需 userinfo.email scope；無權限時回傳空字串，不中斷）。
 */
function resolveDeployerEmail_() {
  var fallback = getProp_(PROP_KEYS.ADMIN_EMAIL_FALLBACK).trim().toLowerCase();
  if (fallback) return fallback;
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) {
    console.warn('無法取得部署者電郵（' + err + '），人員設定將留空，請手動填寫管理員。');
    return '';
  }
}

/** 寫入標題列並凍結第 1 列。 */
function writeHeaderRow_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  sheet.setFrozenRows(1);
}

/** 確保 8 個工作表存在；缺少者以完整 v3 標題建立。回傳新建名稱清單。 */
function ensureSheetsExist_() {
  var ss = getSpreadsheet_();
  var createdNames = [];
  for (var i = 0; i < SHEET_ORDER_.length; i++) {
    var name = SHEET_ORDER_[i];
    if (!ss.getSheetByName(name)) {
      var sheet = ss.insertSheet(name);
      writeHeaderRow_(sheet, HEADERS[name]);
      createdNames.push(name);
    }
  }
  resetRequestMemo_();
  return createdNames;
}

/** 只在標題不存在時於最後一欄之後追加；回傳追加的欄名。永不刪除、重命名或搬動。 */
function appendMissingHeaders_(sheetName) {
  var sheet = getSheet_(sheetName);
  var expected = HEADERS[sheetName];
  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); }) : [];
  // 去除尾端空白標題
  while (existing.length && !existing[existing.length - 1]) existing.pop();
  var missing = [];
  for (var i = 0; i < expected.length; i++) if (existing.indexOf(expected[i]) < 0) missing.push(expected[i]);
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  invalidateSheetMemo_(sheetName);
  return missing;
}

/** 新增缺少的系統設定列（只追加）。回傳新增的項目名稱。 */
function appendMissingSettings_(overrides) {
  var rows = readSheetFresh_(SHEET_NAMES.SETTINGS);
  var existingKeys = {};
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][COL.SETTING.KEY] || '').trim();
    if (key) existingKeys[key] = i + 1;
  }
  var toAdd = [];
  for (var k = 0; k < DEFAULT_SETTINGS.length; k++) {
    var name = DEFAULT_SETTINGS[k][0];
    if (!existingKeys[name]) {
      var value = overrides && Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : DEFAULT_SETTINGS[k][1];
      toAdd.push([name, value]);
    }
  }
  if (toAdd.length) {
    var sheet = getSheet_(SHEET_NAMES.SETTINGS);
    var startRow = rows.length + 1;
    sheet.getRange(startRow, 1, toAdd.length, 2).setValues(toAdd);
    invalidateSheetMemo_(SHEET_NAMES.SETTINGS);
  }
  return toAdd.map(function (r) { return r[0]; });
}

/** 設定指定項目的數值（存在則覆寫該列數值欄，不存在則追加）。 */
function setSettingValue_(key, value) {
  var rows = readSheetFresh_(SHEET_NAMES.SETTINGS);
  var sheet = getSheet_(SHEET_NAMES.SETTINGS);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.SETTING.KEY] || '').trim() === key) {
      sheet.getRange(i + 1, 1, 1, 2).setValues([[key, value]]);
      invalidateSheetMemo_(SHEET_NAMES.SETTINGS);
      return;
    }
  }
  sheet.getRange(rows.length + 1, 1, 1, 2).setValues([[key, value]]);
  invalidateSheetMemo_(SHEET_NAMES.SETTINGS);
}

/** 讀取目前 schemaVersion（缺少視為 2）。 */
function readSchemaVersion_() {
  var rows = readSheetFresh_(SHEET_NAMES.SETTINGS);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.SETTING.KEY] || '').trim() === SETTING_KEYS.SCHEMA_VERSION) {
      var n = parseInt(String(rows[i][COL.SETTING.VALUE]), 10);
      return isFinite(n) ? n : 2;
    }
  }
  return 2;
}

/**
 * migration：逐版本升級。回傳 {fromVersion, toVersion, backupId, addedHeaders, addedSettings, createdSheets}。
 */
function migrateSystem_() {
  resetRequestMemo_();
  var id = getSpreadsheetId_();
  if (!id) throw new ApiError_(ERROR_CODES.INTERNAL_ERROR, '尚未設定 SPREADSHEET_ID，請先執行 setupSystem。');
  var result = { fromVersion: 0, toVersion: SCHEMA_VERSION, backupId: '', addedHeaders: {}, addedSettings: [], createdSheets: [] };
  result.createdSheets = ensureSheetsExist_();
  var version = readSchemaVersion_();
  result.fromVersion = version;

  if (version < 3) {
    result.backupId = backupSpreadsheet_(id);
    for (var i = 0; i < SHEET_ORDER_.length; i++) {
      var added = appendMissingHeaders_(SHEET_ORDER_[i]);
      if (added.length) result.addedHeaders[SHEET_ORDER_[i]] = added;
    }
    result.addedSettings = appendMissingSettings_({});
    setSettingValue_(SETTING_KEYS.SCHEMA_VERSION, 3);
    setSettingValue_(SETTING_KEYS.SYSTEM_VERSION, VERSION);
    version = 3;
    cacheRemove_([CACHE_KEYS_.SETTINGS, CACHE_KEYS_.SLOTS, CACHE_KEYS_.STAFF, CACHE_KEYS_.BLOCKS]);
    logAction_('system', LOG_ACTIONS.MIGRATION, '', { schemaVersion: result.fromVersion }, {
      schemaVersion: 3, backupId: result.backupId, addedHeaders: result.addedHeaders, addedSettings: result.addedSettings
    }, 'system', '成功', '', 'v' + result.fromVersion + ' → v3');
  } else {
    // 已是最新版本：仍確保標題與設定完整（冪等，不寫 migration 紀錄）
    for (var k = 0; k < SHEET_ORDER_.length; k++) {
      var addedNow = appendMissingHeaders_(SHEET_ORDER_[k]);
      if (addedNow.length) result.addedHeaders[SHEET_ORDER_[k]] = addedNow;
    }
    result.addedSettings = appendMissingSettings_({});
    setSettingValue_(SETTING_KEYS.SYSTEM_VERSION, VERSION);
    cacheRemove_([CACHE_KEYS_.SETTINGS, CACHE_KEYS_.SLOTS, CACHE_KEYS_.STAFF, CACHE_KEYS_.BLOCKS]);
  }
  result.toVersion = version;
  resetRequestMemo_();
  return result;
}

/** 以 DriveApp makeCopy 備份；回傳備份檔 ID（失敗時拋錯以中止 migration）。 */
function backupSpreadsheet_(id) {
  var stamp = Utilities.formatDate(Clock_.now(), getTimezone_(), 'yyyyMMdd-HHmmss');
  var copy = DriveApp.getFileById(id).makeCopy('ipad-backup-' + stamp);
  return copy.getId();
}

/** 為 8 個工作表加上警告式保護（提醒直接編輯者經系統操作），可重複執行。 */
function protectSheets_() {
  var ss = getSpreadsheet_();
  for (var i = 0; i < SHEET_ORDER_.length; i++) {
    var sheet = ss.getSheetByName(SHEET_ORDER_[i]);
    if (!sheet) continue;
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var k = 0; k < existing.length; k++) {
      if (existing[k].canEdit()) existing[k].remove();
    }
    var protection = sheet.protect();
    protection.setDescription('iPad 預約系統資料：請透過系統操作，避免直接修改。');
    protection.setWarningOnly(true);
  }
}
