// Handover.gs — 交收清單、登記領取（設定未還數量）、登記歸還（可多次；歸零→已歸還）。

var RETURNABLE_STATUSES_ = [STATUS.PICKED_UP, STATUS.PARTIAL_RETURN, STATUS.OVERDUE_RETURN];
var PICKUP_STATUSES_ = [STATUS.APPROVED, STATUS.OVERDUE_PICKUP];

/**
 * 指定日期（預設今天）有時段且狀態 ∈ approvedLike 的申請，
 * 另加所有 未完全歸還／逾時未歸還 的申請（不論日期）。
 */
function getApprovedForHandover(ctx, payload) {
  var now = Clock_.now();
  var today = todayString_(now);
  var date = payload && payload.date !== undefined && payload.date !== null && payload.date !== '' ? requireDate(payload.date, 'date') : today;
  var data = loadBookingData_(false);
  var handovers = buildHandoverIndex_();
  var list = [];
  for (var i = 0; i < data.idx.apps.length; i++) {
    var a = data.idx.apps[i];
    var details = data.idx.detailsByApp.get(a.applicationId) || [];
    var include = false;
    if (a.status === STATUS.PARTIAL_RETURN || a.status === STATUS.OVERDUE_RETURN) {
      include = true;
    } else if (APPROVED_LIKE_STATUSES.indexOf(a.status) >= 0) {
      for (var k = 0; k < details.length; k++) if (details[k].date === date) { include = true; break; }
    }
    if (include) list.push(toApplication_(a, details, handovers.get(a.applicationId) || [], ctx, data, now));
  }
  list.sort(function (x, y) {
    var kx = x.date + ' ' + (x.slots[0] ? x.slots[0].start : '') + ' ' + x.applicationId;
    var ky = y.date + ' ' + (y.slots[0] ? y.slots[0].start : '') + ' ' + y.applicationId;
    return kx.localeCompare(ky);
  });
  return { applications: list };
}

/** 登記領取：實領 iPad 1–申請量、Pencil 0–申請量且 ≤ iPad；寫交收紀錄；設未還數量。 */
function recordPickup(ctx, payload) {
  var applicationId = requireString(payload.applicationId, 'applicationId', 1, 30);
  var note = requireString(payload.note, 'note', 0, 500);
  var now = Clock_.now();
  var before = null, after = null, recordId = '';
  withLock_(function () {
    var data = loadBookingData_(true);
    var app = data.idx.appsById.get(applicationId);
    if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
    if (PICKUP_STATUSES_.indexOf(app.status) < 0) {
      throw new ApiError_(ERROR_CODES.INVALID_STATE_TRANSITION, '目前狀態為「' + app.status + '」，未能登記領取。');
    }
    assertTransition_(app.status, STATUS.PICKED_UP);
    var details = data.idx.detailsByApp.get(applicationId) || [];
    var requestedIpad = details.length ? details[0].ipad : 0;
    var requestedPencil = details.length ? details[0].pencil : 0;
    if (requestedIpad < 1) throw new ApiError_(ERROR_CODES.VALIDATION_ERROR, '此申請沒有可領取的 iPad 數量。', { field: 'applicationId' });
    var ipad = requireInt(payload.ipad, 'ipad', 1, requestedIpad);
    var pencil = requireInt(payload.pencil, 'pencil', 0, requestedPencil);
    if (pencil > ipad) throw validationError_('pencil', 'Apple Pencil 數量不可多於 iPad 數量。');
    before = { status: app.status, ipadOutstanding: app.ipadOutstanding, pencilOutstanding: app.pencilOutstanding };
    var ts = formatTimestamp_(now);
    recordId = nextHandoverId_();
    appendRow_(SHEET_NAMES.HANDOVERS, [recordId, applicationId, HANDOVER_TYPES.PICKUP, ts, ipad, pencil, ctx.email, sanitizeCell_(note)]);
    var updates = {};
    updates[COL.APP.STATUS] = STATUS.PICKED_UP;
    updates[COL.APP.UPDATED] = ts;
    updates[COL.APP.IPAD_OUT] = ipad;
    updates[COL.APP.PENCIL_OUT] = pencil;
    if (note) updates[COL.APP.ABNORMAL] = sanitizeCell_(appendNote_(app.abnormalNote, ts + ' 領取：' + note));
    updateRow_(SHEET_NAMES.APPLICATIONS, app.rowIndex, updates);
    after = { status: STATUS.PICKED_UP, ipad: ipad, pencil: pencil, recordId: recordId };
  });
  var application = getApplicationView_(applicationId, ctx);
  logAction_(ctx.email, LOG_ACTIONS.PICKUP, applicationId, before, after, ctx.roles.join(','), '成功', ctx.requestId, note);
  var mailNote = notifyEvent_('PICKUP', application, { ipad: after.ipad, pencil: after.pencil, note: note });
  if (mailNote) logAction_('system', LOG_ACTIONS.PICKUP, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}

/** 登記歸還：本次 ≤ 未還；至少一項 > 0；歸零→已歸還，否則未完全歸還。 */
function recordReturn(ctx, payload) {
  var applicationId = requireString(payload.applicationId, 'applicationId', 1, 30);
  var note = requireString(payload.note, 'note', 0, 500);
  var now = Clock_.now();
  var before = null, after = null, eventKey = '';
  withLock_(function () {
    var data = loadBookingData_(true);
    var app = data.idx.appsById.get(applicationId);
    if (!app) throw new ApiError_(ERROR_CODES.NOT_FOUND);
    if (RETURNABLE_STATUSES_.indexOf(app.status) < 0) {
      throw new ApiError_(ERROR_CODES.INVALID_STATE_TRANSITION, '目前狀態為「' + app.status + '」，未能登記歸還。');
    }
    var ipad = requireInt(payload.ipad, 'ipad', 0, app.ipadOutstanding);
    var pencil = requireInt(payload.pencil, 'pencil', 0, app.pencilOutstanding);
    if (ipad === 0 && pencil === 0) throw validationError_('ipad', '本次歸還數量至少一項需大於 0。');
    var newIpadOut = app.ipadOutstanding - ipad;
    var newPencilOut = app.pencilOutstanding - pencil;
    var complete = newIpadOut === 0 && newPencilOut === 0;
    var newStatus = complete ? STATUS.RETURNED : STATUS.PARTIAL_RETURN;
    assertTransition_(app.status, newStatus);
    before = { status: app.status, ipadOutstanding: app.ipadOutstanding, pencilOutstanding: app.pencilOutstanding };
    var ts = formatTimestamp_(now);
    var recordId = nextHandoverId_();
    var type = complete ? HANDOVER_TYPES.FULL : HANDOVER_TYPES.PARTIAL;
    appendRow_(SHEET_NAMES.HANDOVERS, [recordId, applicationId, type, ts, ipad, pencil, ctx.email, sanitizeCell_(note)]);
    var updates = {};
    updates[COL.APP.STATUS] = newStatus;
    updates[COL.APP.UPDATED] = ts;
    updates[COL.APP.IPAD_OUT] = newIpadOut;
    updates[COL.APP.PENCIL_OUT] = newPencilOut;
    if (note) updates[COL.APP.ABNORMAL] = sanitizeCell_(appendNote_(app.abnormalNote, ts + ' ' + type + '：' + note));
    updateRow_(SHEET_NAMES.APPLICATIONS, app.rowIndex, updates);
    after = { status: newStatus, ipad: ipad, pencil: pencil, ipadOutstanding: newIpadOut, pencilOutstanding: newPencilOut, recordId: recordId };
    eventKey = complete ? 'FULL_RETURN' : 'PARTIAL_RETURN';
  });
  var application = getApplicationView_(applicationId, ctx);
  var logAction = eventKey === 'FULL_RETURN' ? LOG_ACTIONS.FULL_RETURN : LOG_ACTIONS.PARTIAL_RETURN;
  logAction_(ctx.email, logAction, applicationId, before, after, ctx.roles.join(','), '成功', ctx.requestId, note);
  var mailNote = notifyEvent_(eventKey, application, { ipad: after.ipad, pencil: after.pencil, note: note });
  if (mailNote) logAction_('system', logAction, applicationId, null, null, 'system', '成功', ctx.requestId, mailNote);
  return { application: application };
}

/** 將新備註接在既有異常備註之後（以換行分隔），總長不超過 500 字。 */
function appendNote_(existing, addition) {
  var combined = existing ? existing + '\n' + addition : addition;
  return combined.length > 500 ? combined.slice(combined.length - 500) : combined;
}
