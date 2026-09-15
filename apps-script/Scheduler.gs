// Scheduler.gs — 每 15 分鐘排程：自動過期／逾時未領取／逾時未歸還／待審提醒；以通知旗標 JSON 冪等；批次寫回。特別活動以 ACT 明細的自訂起訖判定。

var SCHEDULER_LOCK_WAIT_MS_ = 30000;
var SCHEDULER_HANDLER_NAME_ = 'processScheduledTasks';

/** 系統身分（供 toApplication_ 取得完整 teacherEmail）。 */
function systemContext_() {
  return { email: 'system', roles: [ROLES.ADMIN, ROLES.HANDLER], displayName: 'system', requestId: 'sched_' + Utilities.getUuid().slice(0, 8), clientRequestId: '' };
}

/**
 * 排程主程式。回傳統計 {expired, overduePickup, overdueReturn, reminded, mailsSent}。
 * 冪等：狀態轉換以目前狀態為條件；提醒以 通知旗標 為條件。
 */
function processScheduledTasks_() {
  resetRequestMemo_();
  var summary = { expired: 0, overduePickup: 0, overdueReturn: 0, reminded: 0, mailsSent: 0, mailErrors: 0 };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(SCHEDULER_LOCK_WAIT_MS_);
  } catch (err) {
    console.error('排程取鎖逾時，本次略過。');
    return summary;
  }
  var pendingLogs = [];
  try {
    var now = Clock_.now();
    var nowMs = now.getTime();
    var ts = formatTimestamp_(now);
    var data = loadBookingData_(true);
    var settings = data.settings;
    var ctx = systemContext_();
    var remindMs = settings.remindHours * 3600 * 1000;
    var overduePickupMs = settings.overduePickupMinutes * 60 * 1000;
    var overdueReturnMs = settings.overdueReturnMinutes * 60 * 1000;
    var rowUpdates = {};

    for (var i = 0; i < data.idx.apps.length; i++) {
      var app = data.idx.apps[i];
      if (TERMINAL_STATUSES.indexOf(app.status) >= 0) continue;
      var details = data.idx.detailsByApp.get(app.applicationId) || [];
      if (!details.length) continue;
      var firstStart = firstStartEpoch_(details, app);
      var lastEnd = lastEndEpoch_(details, app);
      var flags = app.flags || {};
      var updates = {};
      var changed = false;
      var newStatus = app.status;

      if (app.status === STATUS.PENDING && isFinite(firstStart) && firstStart <= nowMs) {
        // 自動過期
        assertTransition_(app.status, STATUS.EXPIRED);
        newStatus = STATUS.EXPIRED;
        updates[COL.APP.STATUS] = newStatus;
        updates[COL.APP.UPDATED] = ts;
        updates[COL.APP.REASON] = sanitizeCell_('時段開始前未獲審批，系統自動過期');
        changed = true;
        summary.expired++;
        if (!flags.expired) {
          var expiredView = toApplication_(app, details, [], ctx, data, now);
          expiredView.status = newStatus;
          var e1 = notifyEvent_('EXPIRED', expiredView, { message: '此申請於時段開始前仍未獲審批，系統已自動過期。' });
          flags.expired = true;
          countMail_(summary, e1);
          pendingLogs.push(['system', LOG_ACTIONS.AUTO_EXPIRE, app.applicationId, { status: app.status }, { status: newStatus }, 'system', '成功', ctx.requestId, e1]);
        }
      } else if (app.status === STATUS.PENDING) {
        // 待審提醒（只提醒一次）
        var createdMs = timestampToEpoch_(app.createdAt);
        if (!flags.remind24h && isFinite(createdMs) && createdMs + remindMs <= nowMs) {
          var remindView = toApplication_(app, details, [], ctx, data, now);
          var e2 = notifyEvent_('REMIND_PENDING', remindView, { message: '此申請已待審超過 ' + settings.remindHours + ' 小時，請盡快處理。' });
          flags.remind24h = true;
          changed = true;
          summary.reminded++;
          countMail_(summary, e2);
          pendingLogs.push(['system', LOG_ACTIONS.REMIND_PENDING, app.applicationId, null, { remindHours: settings.remindHours }, 'system', '成功', ctx.requestId, e2]);
        }
      } else if (app.status === STATUS.APPROVED && isFinite(firstStart) && firstStart + overduePickupMs <= nowMs) {
        // 逾時未領取
        assertTransition_(app.status, STATUS.OVERDUE_PICKUP);
        newStatus = STATUS.OVERDUE_PICKUP;
        updates[COL.APP.STATUS] = newStatus;
        updates[COL.APP.UPDATED] = ts;
        changed = true;
        summary.overduePickup++;
        if (!flags.overduePickup) {
          var pickupView = toApplication_(app, details, [], ctx, data, now);
          pickupView.status = newStatus;
          var e3 = notifyEvent_('OVERDUE_PICKUP', pickupView, { message: '時段已開始超過 ' + settings.overduePickupMinutes + ' 分鐘仍未領取。' });
          flags.overduePickup = true;
          countMail_(summary, e3);
          pendingLogs.push(['system', LOG_ACTIONS.OVERDUE_PICKUP, app.applicationId, { status: app.status }, { status: newStatus }, 'system', '成功', ctx.requestId, e3]);
        }
      } else if ((app.status === STATUS.PICKED_UP || app.status === STATUS.PARTIAL_RETURN) &&
        isFinite(lastEnd) && lastEnd + overdueReturnMs <= nowMs && (app.ipadOutstanding > 0 || app.pencilOutstanding > 0)) {
        // 逾時未歸還
        assertTransition_(app.status, STATUS.OVERDUE_RETURN);
        newStatus = STATUS.OVERDUE_RETURN;
        updates[COL.APP.STATUS] = newStatus;
        updates[COL.APP.UPDATED] = ts;
        changed = true;
        summary.overdueReturn++;
        if (!flags.overdueReturn) {
          var returnView = toApplication_(app, details, [], ctx, data, now);
          returnView.status = newStatus;
          var e4 = notifyEvent_('OVERDUE_RETURN', returnView, { message: '時段結束超過 ' + settings.overdueReturnMinutes + ' 分鐘仍有器材未歸還。' });
          flags.overdueReturn = true;
          countMail_(summary, e4);
          pendingLogs.push(['system', LOG_ACTIONS.OVERDUE_RETURN, app.applicationId, { status: app.status }, { status: newStatus }, 'system', '成功', ctx.requestId, e4]);
        }
      }

      if (changed) {
        updates[COL.APP.FLAGS] = JSON.stringify(flags);
        rowUpdates[app.rowIndex] = updates;
      }
    }
    if (Object.keys(rowUpdates).length) updateRows_(SHEET_NAMES.APPLICATIONS, rowUpdates);
  } finally {
    lock.releaseLock();
  }
  // 鎖外寫操作紀錄
  for (var k = 0; k < pendingLogs.length; k++) {
    var l = pendingLogs[k];
    logAction_(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8]);
  }
  return summary;
}

function countMail_(summary, mailNote) {
  if (mailNote) summary.mailErrors++; else summary.mailsSent++;
}

/** 安裝每 15 分鐘觸發器（先移除同名舊觸發器），可重複執行。 */
function installTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === SCHEDULER_HANDLER_NAME_) ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger(SCHEDULER_HANDLER_NAME_).timeBased().everyMinutes(15).create();
}
