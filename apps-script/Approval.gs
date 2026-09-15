// Approval.gs — 待審清單、核准（鎖內以尖峰法重算庫存、特別批准確認）、拒絕、搜尋；狀態轉換白名單 assertTransition_。

/** 狀態機白名單（CONTRACT §4）。 */
var TRANSITIONS_ = {};
TRANSITIONS_[STATUS.PENDING] = [STATUS.APPROVED, STATUS.REJECTED, STATUS.CANCELLED, STATUS.EXPIRED];
TRANSITIONS_[STATUS.APPROVED] = [STATUS.CANCELLED, STATUS.PICKED_UP, STATUS.OVERDUE_PICKUP];
TRANSITIONS_[STATUS.OVERDUE_PICKUP] = [STATUS.PICKED_UP];
TRANSITIONS_[STATUS.PICKED_UP] = [STATUS.PARTIAL_RETURN, STATUS.RETURNED, STATUS.OVERDUE_RETURN];
TRANSITIONS_[STATUS.PARTIAL_RETURN] = [STATUS.PARTIAL_RETURN, STATUS.RETURNED, STATUS.OVERDUE_RETURN];
TRANSITIONS_[STATUS.OVERDUE_RETURN] = [STATUS.PARTIAL_RETURN, STATUS.RETURNED];
TRANSITIONS_[STATUS.REJECTED] = [];
TRANSITIONS_[STATUS.CANCELLED] = [];
TRANSITIONS_[STATUS.RETURNED] = [];
TRANSITIONS_[STATUS.EXPIRED] = [];

/** 是否允許 from → to。 */
function canTransition_(from, to) {
  var allowed = TRANSITIONS_[from];
  return Array.isArray(allowed) && allowed.indexOf(to) >= 0;
}

/** 不允許時拋 INVALID_STATE_TRANSITION。 */
function assertTransition_(from, to) {
  if (!canTransition_(from, to)) {
    throw new ApiError_(ERROR_CODES.INVALID_STATE_TRANSITION, '目前狀態為「' + (from || '未知') + '」，不可轉為「' + to + '」。');
  }
}

/** 依第一個時段日期＋開始時間＋建立時間排序（舊→新）。 */
function sortByDateAsc_(apps) {
  apps.sort(function (a, b) {
    var ka = a.date + ' ' + (a.slots[0] ? a.slots[0].start : '') + ' ' + a.createdAt;
    var kb = b.date + ' ' + (b.slots[0] ? b.slots[0].start : '') + ' ' + b.createdAt;
    return ka.localeCompare(kb);
  });
  return apps;
}

/** 待審批清單，依第一個時段日期舊→新。 */
function getPendingApplications(ctx) {
  var data = loadBookingData_(false);
  var handovers = buildHandoverIndex_();
  var now = Clock_.now();
  var pending = data.idx.apps.filter(function (a) { return a.status === STATUS.PENDING; });
  var apps = pending.map(function (a) {
    return toApplication_(a, data.idx.detailsByApp.get(a.applicationId) || [], handovers.get(a.applicationId) || [], ctx, data, now);
  });
  return { applications: sortByDateAsc_(apps) };
}

/**
 * 核准：鎖內重讀，排除本申請後以尖峰法逐區間檢查庫存。
 * needsSpecialApproval 為 true 時必須帶 confirmSpecial: true，並另寫操作紀錄「特別批准」。
 */
function approveApplication(ctx, payload) {
  var applicationId = requireString(payload.applicationId, 'applicationId', 1, 30);
  var confirmSpecial = payload.confirmSpecial === true;
  var now = Clock_.now();
  var before = null;
  var specialInfo = null;
  withLock_(function () {
    var data = loadBookingData_(true);
    var app = data.idx.appsById.get(applicationId);
    if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
    assertTransition_(app.status, STATUS.APPROVED);
    var details = data.idx.detailsByApp.get(applicationId) || [];
    if (!details.length) throw new ApiError_(ERROR_CODES.VALIDATION_ERROR, '此申請沒有任何時段明細。', { field: 'applicationId' });
    if (app.needsSpecialApproval && !confirmSpecial) {
      throw validationError_('confirmSpecial', '此申請需要特別批准（' + (app.specialApprovalReason || '星期日／封鎖日期') + '），請確認後再核准。');
    }
    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      var label = slotLabelFor_(d, app, data.slotById);
      var start = d.start || app.customStart, end = d.end || app.customEnd;
      assertStockByPeak_(data.idx.intervalsByDate, data.settings, d.date, [{ label: label, start: start, end: end }], d.ipad, d.pencil, applicationId);
    }
    before = { status: app.status };
    var ts = formatTimestamp_(now);
    var updates = {};
    updates[COL.APP.STATUS] = STATUS.APPROVED;
    updates[COL.APP.UPDATED] = ts;
    updates[COL.APP.APPROVER] = ctx.email;
    updates[COL.APP.APPROVED_AT] = ts;
    updateRow_(SHEET_NAMES.APPLICATIONS, app.rowIndex, updates);
    if (app.needsSpecialApproval) specialInfo = { approver: ctx.email, approvedAt: ts, reason: app.specialApprovalReason || '' };
  });
  var application = getApplicationView_(applicationId, ctx);
  logAction_(ctx.email, LOG_ACTIONS.APPROVE, applicationId, before, { status: STATUS.APPROVED, approvedBy: ctx.email }, ctx.roles.join(','), '成功', ctx.requestId, '');
  if (specialInfo) {
    logAction_(ctx.email, LOG_ACTIONS.SPECIAL_APPROVE, applicationId, { needsSpecialApproval: true }, specialInfo, ctx.roles.join(','), '成功', ctx.requestId, '');
  }
  var mailNote = notifyEvent_('APPROVE', application, {});
  if (mailNote) logAction_('system', LOG_ACTIONS.APPROVE, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}

/** 拒絕：原因必填 1–200 字。 */
function rejectApplication(ctx, payload) {
  var applicationId = requireString(payload.applicationId, 'applicationId', 1, 30);
  var reason = requireString(payload.reason, 'reason', 1, 200);
  var now = Clock_.now();
  var before = null;
  withLock_(function () {
    var data = loadBookingData_(true);
    var app = data.idx.appsById.get(applicationId);
    if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
    assertTransition_(app.status, STATUS.REJECTED);
    before = { status: app.status };
    var ts = formatTimestamp_(now);
    var updates = {};
    updates[COL.APP.STATUS] = STATUS.REJECTED;
    updates[COL.APP.UPDATED] = ts;
    updates[COL.APP.APPROVER] = ctx.email;
    updates[COL.APP.APPROVED_AT] = ts;
    updates[COL.APP.REASON] = sanitizeCell_(reason);
    updateRow_(SHEET_NAMES.APPLICATIONS, app.rowIndex, updates);
  });
  var application = getApplicationView_(applicationId, ctx);
  logAction_(ctx.email, LOG_ACTIONS.REJECT, applicationId, before, { status: STATUS.REJECTED, reason: reason }, ctx.roles.join(','), '成功', ctx.requestId, '');
  var mailNote = notifyEvent_('REJECT', application, { reason: reason });
  if (mailNote) logAction_('system', LOG_ACTIONS.REJECT, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}

/**
 * 搜尋申請（admin／handler，CONTRACT §9.6）：
 * query 模糊比對編號、姓名、班別、活動名稱；from/to 以第一個時段日期篩選；bookingType／status 精確比對。
 * 最多 200 筆，日期新→舊。
 */
function searchApplications(ctx, payload) {
  var query = requireString(payload.query, 'query', 0, 100).toLowerCase();
  var from = payload.from ? requireDate(payload.from, 'from') : '';
  var to = payload.to ? requireDate(payload.to, 'to') : '';
  var bookingType = requireString(payload.bookingType, 'bookingType', 0, 20);
  if (bookingType && bookingType !== BOOKING_TYPE_NORMAL && bookingType !== BOOKING_TYPE_SPECIAL) {
    throw validationError_('bookingType', '預約類型只可為「' + BOOKING_TYPE_NORMAL + '」或「' + BOOKING_TYPE_SPECIAL + '」。');
  }
  var status = requireString(payload.status, 'status', 0, 20);
  if (status) {
    var known = false;
    for (var key in STATUS) if (STATUS[key] === status) { known = true; break; }
    if (!known) throw validationError_('status', '未知的狀態「' + status + '」。');
  }
  var data = loadBookingData_(false);
  var handovers = buildHandoverIndex_();
  var now = Clock_.now();
  var matched = [];
  for (var i = 0; i < data.idx.apps.length; i++) {
    var a = data.idx.apps[i];
    var details = data.idx.detailsByApp.get(a.applicationId) || [];
    var date = details.length ? details[0].date : '';
    if (from && date < from) continue;
    if (to && date > to) continue;
    var type = a.bookingType || (isSpecialApp_(a, details) ? BOOKING_TYPE_SPECIAL : BOOKING_TYPE_NORMAL);
    if (bookingType && type !== bookingType) continue;
    if (status && a.status !== status) continue;
    if (query) {
      var hay = (a.applicationId + ' ' + a.teacherName + ' ' + a.className + ' ' + a.activityName).toLowerCase();
      if (hay.indexOf(query) < 0) continue;
    }
    matched.push({ app: a, details: details, date: date });
  }
  matched.sort(function (x, y) {
    var kx = x.date + ' ' + (x.details[0] ? x.details[0].start : '') + ' ' + x.app.createdAt;
    var ky = y.date + ' ' + (y.details[0] ? y.details[0].start : '') + ' ' + y.app.createdAt;
    return ky.localeCompare(kx);
  });
  var out = [];
  for (var k = 0; k < matched.length && k < 200; k++) {
    out.push(toApplication_(matched[k].app, matched[k].details, handovers.get(matched[k].app.applicationId) || [], ctx, data, now));
  }
  return { applications: out };
}
