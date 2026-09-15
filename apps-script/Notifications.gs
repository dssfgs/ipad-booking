// Notifications.gs — 電郵範本（繁體中文）、收件人解析、MailApp 寄送（失敗不影響主流程，回傳備註供操作紀錄）。

// 測試注入：設為陣列時所有電郵只推入此陣列而不真正寄出。
var MAIL_SINK_ = null;

/** 事件定義：subject 事件字串與收件人規則。 */
var NOTIFY_EVENTS_ = {
  SUBMIT: { title: '提交申請', toApplicant: true, toAdmins: true, toHandlers: false },
  APPROVE: { title: '核准申請', toApplicant: true, toAdmins: false, toHandlers: false },
  REJECT: { title: '拒絕申請', toApplicant: true, toAdmins: false, toHandlers: false },
  CANCEL: { title: '取消申請', toApplicant: true, toAdmins: true, toHandlers: false },
  PICKUP: { title: '已領取', toApplicant: true, toAdmins: false, toHandlers: false },
  PARTIAL_RETURN: { title: '部分歸還', toApplicant: true, toAdmins: false, toHandlers: false },
  FULL_RETURN: { title: '完全歸還', toApplicant: true, toAdmins: false, toHandlers: false },
  REMIND_PENDING: { title: '待審提醒', toApplicant: false, toAdmins: true, toHandlers: false },
  OVERDUE_PICKUP: { title: '逾時未領取', toApplicant: true, toAdmins: false, toHandlers: true },
  OVERDUE_RETURN: { title: '逾時未歸還', toApplicant: true, toAdmins: false, toHandlers: true },
  EXPIRED: { title: '自動過期', toApplicant: true, toAdmins: false, toHandlers: false }
};

/** 啟用 admin 電郵；無則 ADMIN_EMAIL_FALLBACK。 */
function resolveAdminRecipients_() {
  var admins = getEmailsByRole_(ROLES.ADMIN);
  if (admins.length) return admins;
  var fallback = getProp_(PROP_KEYS.ADMIN_EMAIL_FALLBACK).trim().toLowerCase();
  return fallback ? [fallback] : [];
}

/** 啟用 handler 電郵；無則退回 admin 解析結果。 */
function resolveHandlerRecipients_() {
  var handlers = getEmailsByRole_(ROLES.HANDLER);
  return handlers.length ? handlers : resolveAdminRecipients_();
}

function escapeHtml_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 主旨：【iPad 預約】<事件> <預約編號> <日期> <班別>；需特別批准時加前綴【需特別批准】。 */
function buildSubject_(eventTitle, application) {
  var prefix = application.needsSpecialApproval ? '【需特別批准】' : '';
  return prefix + '【iPad 預約】' + eventTitle + ' ' + application.applicationId + ' ' + (application.date || '') + ' ' + (application.className || '');
}

/** 內文欄位清單（純文字與 HTML 共用）。 */
function buildMailLines_(eventTitle, application, extra) {
  var slotText = (application.slots || []).map(function (s) {
    return s.label + '（' + s.start + '–' + s.end + '）';
  }).join('、') || '—';
  var isSpecial = application.bookingType === BOOKING_TYPE_SPECIAL;
  var lines = [
    ['事件', eventTitle],
    ['預約編號', application.applicationId],
    ['預約類型', application.bookingType || BOOKING_TYPE_NORMAL],
    ['教師', application.teacherName + (application.teacherEmail ? '（' + application.teacherEmail + '）' : '')],
    ['日期', application.date || '—']
  ];
  if (isSpecial) {
    lines.push(['活動名稱', application.activityName || '—']);
    lines.push(['實際時間', (application.customStart || (application.slots[0] && application.slots[0].start) || '') + '–' + (application.customEnd || (application.slots[0] && application.slots[0].end) || '')]);
  } else {
    lines.push(['時段', slotText]);
  }
  lines.push(
    ['班別', application.className || '—'],
    ['科目', application.subject || '—'],
    ['iPad 數量', String(application.ipad)],
    ['Apple Pencil 數量', String(application.pencil)],
    ['狀態', application.status]
  );
  if (application.needsSpecialApproval) lines.push(['需特別批准', application.specialApprovalReason || '是']);
  if (application.afterHoursConfirm) lines.push(['保管確認', AFTER_HOURS_CONFIRM_TEXT]);
  if (extra && extra.ipad !== undefined) lines.push(['本次 iPad', String(extra.ipad)]);
  if (extra && extra.pencil !== undefined) lines.push(['本次 Apple Pencil', String(extra.pencil)]);
  if (application.ipadOutstanding || application.pencilOutstanding) {
    lines.push(['未還數量', 'iPad ' + application.ipadOutstanding + ' 部、Apple Pencil ' + application.pencilOutstanding + ' 支']);
  }
  var reason = (extra && extra.reason) || application.reason;
  if (reason) lines.push(['原因', reason]);
  if (extra && extra.note) lines.push(['備註', extra.note]);
  if (extra && extra.message) lines.push(['說明', extra.message]);
  return lines;
}

function buildPlainBody_(lines, frontendUrl) {
  var out = ['iPad 預約及借還系統通知', ''];
  for (var i = 0; i < lines.length; i++) out.push(lines[i][0] + '：' + lines[i][1]);
  out.push('');
  if (frontendUrl) out.push('前往系統：' + frontendUrl);
  out.push('此電郵由系統自動發出，請勿直接回覆。');
  return out.join('\n');
}

function buildHtmlBody_(lines, frontendUrl) {
  var rows = lines.map(function (l) {
    return '<tr><td style="padding:4px 12px 4px 0;color:#555;white-space:nowrap;vertical-align:top">' + escapeHtml_(l[0]) + '</td><td style="padding:4px 0">' + escapeHtml_(l[1]).replace(/\n/g, '<br>') + '</td></tr>';
  }).join('');
  var link = frontendUrl ? '<p><a href="' + escapeHtml_(frontendUrl) + '">前往 iPad 預約及借還系統</a></p>' : '';
  return '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6">' +
    '<h2 style="font-size:16px;margin:0 0 12px">iPad 預約及借還系統通知</h2>' +
    '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">' + rows + '</table>' +
    link + '<p style="color:#888;font-size:12px">此電郵由系統自動發出，請勿直接回覆。</p></div>';
}

/** 實際寄送；MAIL_SINK_ 存在時只收集。失敗回傳錯誤字串，不拋錯。 */
function sendMail_(recipients, subject, htmlBody, body) {
  var unique = [];
  for (var i = 0; i < recipients.length; i++) {
    var r = String(recipients[i] || '').trim().toLowerCase();
    if (r && unique.indexOf(r) < 0) unique.push(r);
  }
  if (!unique.length) return '無收件人';
  var message = { to: unique.join(','), subject: subject, htmlBody: htmlBody, body: body };
  if (Array.isArray(MAIL_SINK_)) {
    MAIL_SINK_.push(message);
    return '';
  }
  try {
    MailApp.sendEmail(message);
    return '';
  } catch (err) {
    console.error('寄送電郵失敗（' + subject + '）: ' + err);
    return '電郵寄送失敗：' + String(err && err.message ? err.message : err).slice(0, 120);
  }
}

/**
 * 依事件寄送通知。application 為合約 Application（須含 teacherEmail）。
 * @return {string} 空字串表示成功；否則為要寫入操作紀錄備註的訊息。
 */
function notifyEvent_(eventKey, application, extra) {
  var def = NOTIFY_EVENTS_[eventKey];
  if (!def) return '未知通知事件 ' + eventKey;
  var recipients = [];
  if (def.toApplicant && application.teacherEmail) recipients.push(application.teacherEmail);
  if (def.toAdmins) recipients = recipients.concat(resolveAdminRecipients_());
  if (def.toHandlers) recipients = recipients.concat(resolveHandlerRecipients_());
  var frontendUrl = getProp_(PROP_KEYS.FRONTEND_URL);
  var lines = buildMailLines_(def.title, application, extra || {});
  var subject = buildSubject_(def.title, application);
  return sendMail_(recipients, subject, buildHtmlBody_(lines, frontendUrl), buildPlainBody_(lines, frontendUrl));
}
