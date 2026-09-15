// Booking.gs — 週表（7 天＋特別活動格）、bootstrap、我的申請、提交一般課堂／特別活動（LockService 最短臨界區）、取消申請。

var LOCK_WAIT_MS_ = 10000;

/** 一次載入週表／申請所需資料；fresh=true 時強制重讀主表與明細（鎖內）。 */
function loadBookingData_(fresh) {
  var settings = getSettings_();
  var allSlots = getAllSlots_();
  var slots = getEnabledSlots_();
  var blocks = getBlocks_();
  var appRows = fresh ? readSheetFresh_(SHEET_NAMES.APPLICATIONS) : readSheet_(SHEET_NAMES.APPLICATIONS);
  var detailRows = fresh ? readSheetFresh_(SHEET_NAMES.DETAILS) : readSheet_(SHEET_NAMES.DETAILS);
  var idx = buildIndexes_(appRows, detailRows, slots, blocks);
  var slotById = new Map();
  for (var i = 0; i < slots.length; i++) slotById.set(slots[i].slotId, slots[i]);
  var allSlotById = new Map();
  for (var k = 0; k < allSlots.length; k++) allSlotById.set(allSlots[k].slotId, allSlots[k]);
  return {
    settings: settings, slots: slots, slotById: slotById, allSlotById: allSlotById, blocks: blocks,
    appRows: appRows, detailRows: detailRows, idx: idx
  };
}

/** 交收紀錄索引 Map(applicationId → Handover[])。 */
function buildHandoverIndex_() {
  var rows = readSheet_(SHEET_NAMES.HANDOVERS);
  var map = new Map();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var appId = String(r[COL.HANDOVER.APP_ID] || '').trim();
    if (!appId) continue;
    if (!map.has(appId)) map.set(appId, []);
    map.get(appId).push({
      recordId: String(r[COL.HANDOVER.ID] || ''),
      type: String(r[COL.HANDOVER.TYPE] || ''),
      time: normalizeTimestamp_(r[COL.HANDOVER.TIME]),
      ipad: toInt_(r[COL.HANDOVER.IPAD], 0),
      pencil: toInt_(r[COL.HANDOVER.PENCIL], 0),
      handler: String(r[COL.HANDOVER.HANDLER] || ''),
      note: unsanitizeCell_(r[COL.HANDOVER.NOTE])
    });
  }
  map.forEach(function (list) { list.sort(function (a, b) { return a.time.localeCompare(b.time); }); });
  return map;
}

/** 以 ScriptLock 執行 fn；取鎖失敗 → LOCK_TIMEOUT。臨界區只包含 fn 本身。 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS_);
  } catch (err) {
    throw new ApiError_(ERROR_CODES.LOCK_TIMEOUT);
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 星期一為週首（星期日屬於同一週的最後一天）。 */
function weekStartOf_(dateStr) {
  var wd = weekdayOf_(dateStr);
  var offset = wd === 'SUN' ? 6 : WEEKDAYS.indexOf(wd) - 1; // MON=0 … SUN=6
  return addDays_(dateStr, -offset);
}

/** 第一個時段開始 epoch（毫秒）；明細缺時間時以主表自訂開始時間補。 */
function firstStartEpoch_(details, app) {
  if (!details || !details.length) return NaN;
  var d = details[0];
  var start = d.start || (app && app.customStart) || '00:00';
  return zonedToEpoch_(d.date, start, 0);
}

/** 最後一個時段結束 epoch（毫秒）；明細缺時間時以主表自訂結束時間補。 */
function lastEndEpoch_(details, app) {
  if (!details || !details.length) return NaN;
  var latest = -Infinity;
  for (var i = 0; i < details.length; i++) {
    var end = details[i].end || (app && app.customEnd) || '23:59';
    var e = zonedToEpoch_(details[i].date, end, 0);
    if (e > latest) latest = e;
  }
  return latest;
}

/** 時段標籤（ACT 用活動名稱或「特別活動」）。 */
function slotLabelFor_(detail, app, slotById) {
  var slot = slotById.get(detail.slotId);
  if (slot) return slot.label;
  if (app && app.activityName) return app.activityName;
  return detail.slotId === ACT_SLOT_ID ? BOOKING_TYPE_SPECIAL : detail.slotId;
}

/** 封鎖時段代號中與 [start,end) 重疊者的原因；全日封鎖直接回傳原因。無則 ''。 */
function blockReasonForInterval_(blocks, allSlotById, date, start, end) {
  var block = blocks[date];
  if (!block) return '';
  if (block.allDay) return block.reason || '封鎖日';
  var s = timeToMinutes_(start), e = timeToMinutes_(end);
  for (var i = 0; i < block.slotIds.length; i++) {
    var slot = allSlotById.get(block.slotIds[i]);
    if (!slot) continue;
    var ss = timeToMinutes_(slot.start), se = timeToMinutes_(slot.end);
    if (isFinite(s) && isFinite(e) && s < se && e > ss) return block.reason || '封鎖時段';
  }
  return '';
}

/** 內部申請物件 → 合約 Application。data 為 loadBookingData_ 結果。 */
function toApplication_(app, details, handovers, ctx, data, now) {
  var isOwner = !!ctx && ctx.email === app.teacherEmail;
  var isStaff = !!ctx && (ctx.roles.indexOf(ROLES.ADMIN) >= 0 || ctx.roles.indexOf(ROLES.HANDLER) >= 0);
  var lines = (details || []).map(function (d) {
    return { date: d.date, slotId: d.slotId, label: slotLabelFor_(d, app, data.slotById), start: d.start, end: d.end, ipad: d.ipad, pencil: d.pencil };
  });
  var first = lines[0] || null;
  var firstStart = firstStartEpoch_(details, app);
  var canCancel = isOwner &&
    (app.status === STATUS.PENDING || app.status === STATUS.APPROVED) &&
    isFinite(firstStart) && firstStart > now.getTime();
  var special = isSpecialApp_(app, details);
  var blockedReason = '';
  if (special && first) {
    blockedReason = blockReasonForInterval_(data.blocks, data.allSlotById, first.date, first.start || app.customStart, first.end || app.customEnd);
  }
  return {
    applicationId: app.applicationId,
    teacherEmail: (isOwner || isStaff) ? app.teacherEmail : '',
    teacherName: app.teacherName,
    className: app.className,
    students: app.students,
    subject: app.subject,
    remark: app.remark,
    status: app.status,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    approvedBy: app.approvedBy,
    approvedAt: app.approvedAt,
    bookingType: app.bookingType || (special ? BOOKING_TYPE_SPECIAL : BOOKING_TYPE_NORMAL),
    activityName: app.activityName,
    customStart: app.customStart,
    customEnd: app.customEnd,
    reason: app.reason,
    ipadOutstanding: app.ipadOutstanding,
    pencilOutstanding: app.pencilOutstanding,
    abnormalNote: app.abnormalNote,
    date: first ? first.date : '',
    ipad: first ? first.ipad : 0,
    pencil: first ? first.pencil : 0,
    afterHoursConfirm: !!app.afterHoursConfirm,
    needsSpecialApproval: !!app.needsSpecialApproval,
    specialApprovalReason: app.specialApprovalReason || '',
    isSunday: !!first && weekdayOf_(first.date) === 'SUN',
    blockedReason: blockedReason,
    slots: lines,
    handovers: (handovers || []).slice(),
    canCancel: canCancel
  };
}

/** 取單一申請的完整 Application（讀取 memo 內最新資料）。 */
function getApplicationView_(applicationId, ctx) {
  var data = loadBookingData_(false);
  var app = data.idx.appsById.get(applicationId);
  if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
  var handovers = buildHandoverIndex_().get(applicationId) || [];
  return toApplication_(app, data.idx.detailsByApp.get(applicationId) || [], handovers, ctx, data, Clock_.now());
}

/**
 * 建立合約 Week：7 天（MON–SUN）、一般課堂格只為 MON–SAT 產生、每天一個 SpecialCell。
 * 所有統計皆來自 data.idx；迴圈內不接觸 SpreadsheetApp。
 */
function buildWeek_(dateStr, ctx, data, now) {
  var today = todayString_(now);
  var nowMs = now.getTime();
  var settings = data.settings;
  var weekStart = weekStartOf_(dateStr);
  var weekEnd = addDays_(weekStart, 6);
  var advanceLimit = addDays_(today, settings.advanceDays);
  var cutoffMs = (Number(settings.cutoffHours) || 0) * 3600 * 1000;
  var days = [];
  var cells = {};
  var special = {};
  var activeStatuses = APPROVED_LIKE_STATUSES.concat(PENDING_STATUSES);

  for (var di = 0; di < 7; di++) {
    var date = addDays_(weekStart, di);
    var weekday = weekdayOf_(date);
    var block = data.blocks[date] || null;
    var blockedAllDay = !!(block && block.allDay);
    var isSunday = weekday === 'SUN';
    days.push({
      date: date, weekday: weekday, isToday: date === today, isPast: date < today,
      blockedAllDay: blockedAllDay, blockedReason: blockedAllDay ? (block.reason || '封鎖日') : null
    });

    if (!isSunday) {
      for (var si = 0; si < data.slots.length; si++) {
        var slot = data.slots[si];
        var key = date + '|' + slot.slotId;
        var st = data.idx.cellStats.get(key) || { ipadApproved: 0, ipadPending: 0, pencilApproved: 0, pencilPending: 0, bookings: [] };
        var reason = null;
        var slotBlocked = !!(block && (block.allDay || block.slotIds.indexOf(slot.slotId.toUpperCase()) >= 0));
        if (slot.days.indexOf(weekday) < 0) {
          reason = 'notApplicable';
        } else {
          var startMs = zonedToEpoch_(date, slot.start, 0);
          if (startMs <= nowMs) reason = 'past';
          else if (cutoffMs > 0 && startMs <= nowMs + cutoffMs) reason = 'cutoff';
          else if (slotBlocked) reason = 'blocked';
          else if (date > advanceLimit) reason = 'beyondAdvance';
        }
        var summaries = [];
        for (var b = 0; b < st.bookings.length && b < 3; b++) {
          var bk = st.bookings[b];
          summaries.push({
            applicationId: bk.app.applicationId, teacherName: bk.app.teacherName, className: bk.app.className,
            subject: bk.app.subject, ipad: bk.ipad, pencil: bk.pencil, status: bk.app.status,
            isMine: !!ctx && bk.app.teacherEmail === ctx.email
          });
        }
        cells[key] = {
          date: date, slotId: slot.slotId,
          ipadApproved: st.ipadApproved, ipadPending: st.ipadPending,
          ipadRemaining: Math.max(0, settings.ipadTotal - st.ipadApproved - st.ipadPending),
          pencilApproved: st.pencilApproved, pencilPending: st.pencilPending,
          pencilRemaining: Math.max(0, settings.pencilTotal - st.pencilApproved - st.pencilPending),
          bookable: reason === null, unbookableReason: reason,
          blockedReason: slotBlocked ? (block.reason || '封鎖時段') : null,
          bookings: summaries, bookingCount: st.bookings.length
        };
      }
    }

    // 特別活動格
    var entries = (data.idx.specialByDate.get(date) || []).filter(function (e) { return activeStatuses.indexOf(e.app.status) >= 0; });
    entries.sort(function (x, y) { return (x.detail.start || '').localeCompare(y.detail.start || ''); });
    var activities = [];
    if (date >= today) {
      for (var a = 0; a < entries.length && a < 3; a++) {
        var en = entries[a];
        activities.push({
          applicationId: en.app.applicationId, activityName: en.app.activityName,
          start: en.detail.start || en.app.customStart, end: en.detail.end || en.app.customEnd,
          teacherName: en.app.teacherName, className: en.app.className,
          ipad: en.detail.ipad, pencil: en.detail.pencil, status: en.app.status,
          needsSpecialApproval: !!en.app.needsSpecialApproval, afterHoursConfirm: !!en.app.afterHoursConfirm,
          isMine: !!ctx && en.app.teacherEmail === ctx.email
        });
      }
    }
    var warnings = [];
    if (isSunday) warnings.push('sunday');
    if (block) warnings.push('blocked');
    special[date] = {
      date: date, activities: activities, activityCount: entries.length,
      bookable: date >= today && date <= advanceLimit,
      isSunday: isSunday,
      blockedReason: block ? (block.reason || (block.allDay ? '封鎖日' : '封鎖時段')) : null,
      warnings: warnings
    };
  }
  return { weekStart: weekStart, weekEnd: weekEnd, days: days, cells: cells, special: special };
}

// ---------- actions ----------

function getWeekData(ctx, payload) {
  var date = requireDate(payload.date, 'date');
  var data = loadBookingData_(false);
  return { week: buildWeek_(date, ctx, data, Clock_.now()) };
}

function bootstrap(ctx, payload) {
  var now = Clock_.now();
  var today = todayString_(now);
  var date = payload && payload.date !== undefined && payload.date !== null && payload.date !== '' ? requireDate(payload.date, 'date') : today;
  var data = loadBookingData_(false);
  return {
    user: toUser_(ctx),
    settings: toPublicSettings_(data.settings),
    slots: data.slots.map(function (s) { return { slotId: s.slotId, start: s.start, end: s.end, label: s.label, days: s.days.slice(), order: s.order }; }),
    week: buildWeek_(date, ctx, data, now),
    today: today,
    serverNow: formatTimestamp_(now)
  };
}

function getMyApplications(ctx) {
  var data = loadBookingData_(false);
  var handovers = buildHandoverIndex_();
  var now = Clock_.now();
  var mine = data.idx.apps.filter(function (a) { return a.teacherEmail === ctx.email; });
  mine.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  return {
    applications: mine.map(function (a) {
      return toApplication_(a, data.idx.detailsByApp.get(a.applicationId) || [], handovers.get(a.applicationId) || [], ctx, data, now);
    })
  };
}

/** 檢查所選時段在該日期是否被封鎖；回傳原因字串或 null。 */
function blockedReasonFor_(blocks, date, slotIds) {
  var block = blocks[date];
  if (!block) return null;
  if (block.allDay) return block.reason || '封鎖日';
  for (var i = 0; i < slotIds.length; i++) {
    if (block.slotIds.indexOf(slotIds[i].toUpperCase()) >= 0) return block.reason || '封鎖時段';
  }
  return null;
}

/**
 * 區間尖峰法庫存檢查（CONTRACT §9.4）；不足時拋 CONFLICT_INSUFFICIENT_STOCK。
 * intervals 為 [{label, start, end}]；一般課堂每時段一項，特別活動一項。
 */
function assertStockByPeak_(intervalsByDate, settings, date, intervals, ipad, pencil, excludeApplicationId) {
  for (var i = 0; i < intervals.length; i++) {
    var iv = intervals[i];
    var peak = peakUsage_(intervalsByDate, date, iv.start, iv.end, excludeApplicationId);
    var ipadLeft = settings.ipadTotal - peak.ipad;
    if (ipad > ipadLeft) {
      throw new ApiError_(ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK,
        date + ' ' + iv.label + ' iPad 只剩 ' + Math.max(0, ipadLeft) + ' 部，未能提供 ' + ipad + ' 部，請調整數量或改選其他時段。',
        { field: 'ipad', remaining: Math.max(0, ipadLeft), requested: ipad, date: date, label: iv.label });
    }
    var pencilLeft = settings.pencilTotal - peak.pencil;
    if (pencil > pencilLeft) {
      throw new ApiError_(ERROR_CODES.CONFLICT_INSUFFICIENT_STOCK,
        date + ' ' + iv.label + ' Apple Pencil 只剩 ' + Math.max(0, pencilLeft) + ' 支，未能提供 ' + pencil + ' 支，請調整數量或改選其他時段。',
        { field: 'pencil', remaining: Math.max(0, pencilLeft), requested: pencil, date: date, label: iv.label });
    }
  }
}

/** 主表新列（共用欄位順序）。 */
function newApplicationRow_(id, ctx, fields, ts) {
  return [
    id, ctx.email, sanitizeCell_(fields.teacherName), sanitizeCell_(fields.className), fields.students,
    sanitizeCell_(fields.subject), sanitizeCell_(fields.remark), STATUS.PENDING, ts, ts, '', '',
    fields.bookingType, sanitizeCell_(fields.activityName || ''), fields.customStart || '', fields.customEnd || '',
    fields.afterHoursConfirm ? YES : NO, NO, fields.needsSpecialApproval ? YES : NO, sanitizeCell_(fields.specialApprovalReason || ''),
    '', 0, 0, '', '{}'
  ];
}

/** 提交後共用：紀錄＋通知。 */
function afterSubmit_(ctx, applicationId, logAction, newData) {
  var application = getApplicationView_(applicationId, ctx);
  logAction_(ctx.email, logAction, applicationId, null, newData, ctx.roles.join(','), '成功', ctx.requestId,
    ctx.clientRequestId ? 'clientRequestId=' + ctx.clientRequestId : '');
  var mailNote = notifyEvent_('SUBMIT', application, {});
  if (mailNote) logAction_('system', logAction, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}

/**
 * 解析所選時段：皆存在於啟用時段、皆適用該星期、依 order 排序後在啟用清單中相鄰（連續）。
 * 回傳排序後的 Slot 陣列；不合法時拋 VALIDATION_ERROR(field: slotIds)。
 */
function resolveConsecutiveSlots_(slotIds, enabledSlots, date) {
  var weekday = weekdayOf_(date);
  var chosen = [];
  for (var i = 0; i < slotIds.length; i++) {
    var idxInList = -1;
    for (var k = 0; k < enabledSlots.length; k++) if (enabledSlots[k].slotId === slotIds[i]) { idxInList = k; break; }
    if (idxInList < 0) throw validationError_('slotIds', '時段「' + safeText_(slotIds[i], 20) + '」不存在或未啟用。');
    var slot = enabledSlots[idxInList];
    if (slot.days.indexOf(weekday) < 0) throw validationError_('slotIds', '時段「' + slot.label + '」不適用於 ' + date + '（' + weekday + '）。');
    chosen.push({ slot: slot, index: idxInList });
  }
  chosen.sort(function (a, b) { return a.index - b.index; });
  for (var c = 1; c < chosen.length; c++) {
    if (chosen[c].index !== chosen[c - 1].index + 1) throw validationError_('slotIds', '所選時段必須連續。');
  }
  return chosen.map(function (x) { return x.slot; });
}

/** 提交一般課堂申請（CONTRACT §5.3 驗證順序）。 */
function submitApplication(ctx, payload) {
  var now = Clock_.now();
  var today = todayString_(now);
  var settings = getSettings_();
  var enabledSlots = getEnabledSlots_();
  var blocks = getBlocks_();

  // 1. 日期
  var date = requireDate(payload.date, 'date');
  var advanceLimit = addDays_(today, settings.advanceDays);
  if (date < today) throw validationError_('date', '日期不可早於今天。');
  if (date > advanceLimit) throw validationError_('date', '只可預約今天起 ' + settings.advanceDays + ' 天內（最遲 ' + advanceLimit + '）。');
  var weekday = weekdayOf_(date);
  if (weekday === 'SUN') throw validationError_('date', '星期日不設一般課堂預約，請改用特別活動申請。');

  // 2. 時段
  var slotIds = requireStringArray(payload.slotIds, 'slotIds', enabledSlots.length);
  var slots = resolveConsecutiveSlots_(slotIds, enabledSlots, date);

  // 3. 截止
  var cutoffMs = (Number(settings.cutoffHours) || 0) * 3600 * 1000;
  for (var s = 0; s < slots.length; s++) {
    var startMs = zonedToEpoch_(date, slots[s].start, 0);
    if (startMs <= now.getTime() + cutoffMs) {
      throw new ApiError_(ERROR_CODES.SLOT_PAST, date + ' ' + slots[s].label + ' 已開始或已超過截止時間（時段開始前 ' + settings.cutoffHours + ' 小時），未能申請。');
    }
  }

  // 4. 封鎖
  var blockedReason = blockedReasonFor_(blocks, date, slots.map(function (x) { return x.slotId; }));
  if (blockedReason) throw new ApiError_(ERROR_CODES.SLOT_BLOCKED, date + ' 已被封鎖（' + blockedReason + '），一般課堂未能申請；如有需要請改用特別活動申請。');

  // 5. 文字欄位
  var fields = {
    teacherName: requireString(payload.teacherName, 'teacherName', 1, 50),
    className: requireString(payload.className, 'className', 1, 20),
    subject: requireString(payload.subject, 'subject', 1, 50),
    remark: requireString(payload.remark, 'remark', 0, 500),
    students: requireInt(payload.students, 'students', 1, 60),
    bookingType: BOOKING_TYPE_NORMAL, activityName: '', customStart: '', customEnd: '',
    afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: ''
  };

  // 6. 數量
  var ipad = requireInt(payload.ipad, 'ipad', 1, settings.ipadTotal);
  var pencil = requireInt(payload.pencil, 'pencil', 0, settings.pencilTotal);
  if (pencil > ipad) throw validationError_('pencil', 'Apple Pencil 數量不可多於 iPad 數量。');

  // 7. 臨界區：重讀 → 尖峰法檢查 → 產生編號 → 先明細後主表
  var ts = formatTimestamp_(now);
  var applicationId = withLock_(function () {
    var appRows = readSheetFresh_(SHEET_NAMES.APPLICATIONS);
    var detailRows = readSheetFresh_(SHEET_NAMES.DETAILS);
    var idx = buildIndexes_(appRows, detailRows, enabledSlots, blocks);
    assertStockByPeak_(idx.intervalsByDate, settings, date, slots.map(function (x) { return { label: x.label, start: x.start, end: x.end }; }), ipad, pencil, null);
    var newId = nextApplicationId_(appRows, now);
    for (var d = 0; d < slots.length; d++) {
      appendRow_(SHEET_NAMES.DETAILS, [newId, date, slots[d].slotId, slots[d].start, slots[d].end, ipad, pencil]);
    }
    appendRow_(SHEET_NAMES.APPLICATIONS, newApplicationRow_(newId, ctx, fields, ts));
    return newId;
  });

  // 8. 鎖外：紀錄、通知（後端不快取週資料，無需清除）
  return afterSubmit_(ctx, applicationId, LOG_ACTIONS.SUBMIT,
    { date: date, slotIds: slots.map(function (x) { return x.slotId; }), ipad: ipad, pencil: pencil, className: fields.className });
}

/** 提交特別活動（CONTRACT §9.3 驗證順序）。 */
function submitSpecialActivity(ctx, payload) {
  var now = Clock_.now();
  var today = todayString_(now);
  var settings = getSettings_();
  var enabledSlots = getEnabledSlots_();
  var allSlots = getAllSlots_();
  var allSlotById = new Map();
  for (var a = 0; a < allSlots.length; a++) allSlotById.set(allSlots[a].slotId, allSlots[a]);
  var blocks = getBlocks_();

  // 1. 日期（星期日允許）
  var date = requireDate(payload.date, 'date');
  var advanceLimit = addDays_(today, settings.advanceDays);
  if (date < today) throw validationError_('date', '日期不可早於今天。');
  if (date > advanceLimit) throw validationError_('date', '只可預約今天起 ' + settings.advanceDays + ' 天內（最遲 ' + advanceLimit + '）。');

  // 2. 自訂時間
  var customStart = requireTime(payload.customStart, 'customStart');
  var customEnd = requireTime(payload.customEnd, 'customEnd');
  if (timeToMinutes_(customStart) >= timeToMinutes_(customEnd)) throw validationError_('customEnd', '結束時間必須遲於開始時間。');
  if (timeToMinutes_(customStart) < timeToMinutes_(settings.specialEarliestStart)) throw validationError_('customStart', '開始時間不可早於 ' + settings.specialEarliestStart + '。');
  if (timeToMinutes_(customEnd) > timeToMinutes_(settings.specialLatestEnd)) throw validationError_('customEnd', '結束時間不可遲於 ' + settings.specialLatestEnd + '。');

  // 3. 截止
  var cutoffMs = (Number(settings.cutoffHours) || 0) * 3600 * 1000;
  if (zonedToEpoch_(date, customStart, 0) <= now.getTime() + cutoffMs) {
    throw new ApiError_(ERROR_CODES.SLOT_PAST, date + ' ' + customStart + ' 已開始或已超過截止時間（開始前 ' + settings.cutoffHours + ' 小時），未能申請。');
  }

  // 4. 文字欄位
  var fields = {
    activityName: requireString(payload.activityName, 'activityName', 1, 100),
    teacherName: requireString(payload.teacherName, 'teacherName', 1, 50),
    className: requireString(payload.className, 'className', 1, 50),
    students: requireInt(payload.students, 'students', 1, 200),
    remark: requireString(payload.remark, 'remark', 0, 500),
    subject: BOOKING_TYPE_SPECIAL, bookingType: BOOKING_TYPE_SPECIAL,
    customStart: customStart, customEnd: customEnd,
    afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: ''
  };

  // 5. 數量
  var ipad = requireInt(payload.ipad, 'ipad', 1, settings.ipadTotal);
  var pencil = requireInt(payload.pencil, 'pencil', 0, settings.pencilTotal);
  if (pencil > ipad) throw validationError_('pencil', 'Apple Pencil 數量不可多於 iPad 數量。');

  // 6. 17:15 後保管確認
  if (timeToMinutes_(customEnd) > timeToMinutes_(settings.afterHoursTime)) {
    if (payload.afterHoursConfirm !== true) throw validationError_('afterHoursConfirm', '活動結束時間遲於 ' + settings.afterHoursTime + '，必須確認自行保管：' + AFTER_HOURS_CONFIRM_TEXT);
    if (!fields.remark) throw validationError_('remark', '活動結束時間遲於 ' + settings.afterHoursTime + '，請於備註說明保管安排。');
    fields.afterHoursConfirm = true;
  }

  // 7. 需特別批准（星期日／封鎖重疊）；不回傳 SLOT_BLOCKED
  var reasons = [];
  if (weekdayOf_(date) === 'SUN') reasons.push('星期日');
  var blockReason = blockReasonForInterval_(blocks, allSlotById, date, customStart, customEnd);
  if (blockReason) reasons.push('封鎖日期：' + blockReason);
  if (reasons.length) {
    fields.needsSpecialApproval = true;
    fields.specialApprovalReason = reasons.join('；');
  }

  // 8. 臨界區
  var ts = formatTimestamp_(now);
  var applicationId = withLock_(function () {
    var appRows = readSheetFresh_(SHEET_NAMES.APPLICATIONS);
    var detailRows = readSheetFresh_(SHEET_NAMES.DETAILS);
    var idx = buildIndexes_(appRows, detailRows, enabledSlots, blocks);
    assertStockByPeak_(idx.intervalsByDate, settings, date, [{ label: fields.activityName + '（' + customStart + '–' + customEnd + '）', start: customStart, end: customEnd }], ipad, pencil, null);
    var newId = nextApplicationId_(appRows, now);
    appendRow_(SHEET_NAMES.DETAILS, [newId, date, ACT_SLOT_ID, customStart, customEnd, ipad, pencil]);
    appendRow_(SHEET_NAMES.APPLICATIONS, newApplicationRow_(newId, ctx, fields, ts));
    return newId;
  });

  // 9. 鎖外
  return afterSubmit_(ctx, applicationId, LOG_ACTIONS.SUBMIT_SPECIAL, {
    date: date, activityName: fields.activityName, customStart: customStart, customEnd: customEnd, ipad: ipad, pencil: pencil,
    afterHoursConfirm: fields.afterHoursConfirm, needsSpecialApproval: fields.needsSpecialApproval, specialApprovalReason: fields.specialApprovalReason
  });
}

/** 取消自己的申請（待審批／已核准；第一個時段開始前）。特別活動規則相同。 */
function cancelMyApplication(ctx, payload) {
  var applicationId = requireString(payload.applicationId, 'applicationId', 1, 30);
  var reason = requireString(payload.reason, 'reason', 0, 200);
  var now = Clock_.now();
  var before = null;
  withLock_(function () {
    var data = loadBookingData_(true);
    var app = data.idx.appsById.get(applicationId);
    if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
    if (app.teacherEmail !== ctx.email) throw new ApiError_(ERROR_CODES.FORBIDDEN_ROLE, '只可取消自己的申請。');
    assertTransition_(app.status, STATUS.CANCELLED);
    var details = data.idx.detailsByApp.get(applicationId) || [];
    var firstStart = firstStartEpoch_(details, app);
    if (isFinite(firstStart) && firstStart <= now.getTime()) throw new ApiError_(ERROR_CODES.SLOT_PAST, '時段已開始，未能取消。');
    before = { status: app.status };
    var updates = {};
    updates[COL.APP.STATUS] = STATUS.CANCELLED;
    updates[COL.APP.UPDATED] = formatTimestamp_(now);
    updates[COL.APP.REASON] = sanitizeCell_(reason);
    updateRow_(SHEET_NAMES.APPLICATIONS, app.rowIndex, updates);
  });
  var application = getApplicationView_(applicationId, ctx);
  logAction_(ctx.email, LOG_ACTIONS.CANCEL, applicationId, before, { status: STATUS.CANCELLED, reason: reason }, ctx.roles.join(','), '成功', ctx.requestId, '');
  var mailNote = notifyEvent_('CANCEL', application, { reason: reason });
  if (mailNote) logAction_('system', LOG_ACTIONS.CANCEL, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}
