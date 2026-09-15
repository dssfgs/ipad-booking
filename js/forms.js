/* =========================================================
   Forms — 申請表對話框與「我的申請」
   - 申請表：預約類型切換（一般課堂／特別活動）
     · 一般課堂：日期唯讀、連續時段多選、即時尚餘顯示、完整驗證 → submitApplication
     · 特別活動（合約 §9）：活動名稱、日期（可改）、自訂起訖時間、負責教師、班別／組別、
       人數、iPad／Pencil、備註、17:15 後保管確認 → submitSpecialActivity
   - 我的申請：卡片清單（關鍵字／日期範圍／類型篩選）、取消（二次確認）
   - 借用紀錄搜尋（admin／handler）：searchApplications
   - 提供共用的申請卡片繪製（Admin 亦使用）
   ========================================================= */
(function () {
  'use strict';

  var NAME_KEY = 'ipad_teacher_name';
  var TYPE_REGULAR = '一般課堂';
  var TYPE_SPECIAL = '特別活動';
  var AFTER_HOURS_SENTENCE = '本人明白須自行保管 iPad 及 Apple Pencil，並於下一個上課天交到圖書館給 Molly。';
  var DEFAULT_AFTER_HOURS = '17:15';
  var DEFAULT_EARLIEST = '07:00';
  var DEFAULT_LATEST = '22:00';
  var STATUS_BADGE = {
    '待審批': 'pending',
    '已核准': 'approved',
    '已拒絕': 'rejected',
    '已取消': 'cancelled',
    '已領取': 'picked',
    '未完全歸還': 'partial',
    '已歸還': 'returned',
    '逾時未領取': 'overdue',
    '逾時未歸還': 'overdue',
    '已過期': 'expired'
  };
  var WARN_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.9" fill="currentColor"/></svg>';

  var esc = function (s) { return window.Calendar.esc(s); };
  var toMin = function (t) { return window.Calendar.toMinutes(t); };

  function el(id) { return document.getElementById(id); }

  function isSpecial(app) { return !!app && app.bookingType === TYPE_SPECIAL; }

  function settingsTime(settings, key, fallback) {
    var v = settings && settings[key];
    return (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) ? v : fallback;
  }

  function normTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    return ('0' + m[1]).slice(-2) + ':' + m[2];
  }

  /* ========== 共用：狀態徽章與卡片 ========== */
  function statusBadge(status) {
    var kind = STATUS_BADGE[status] || 'cancelled';
    return '<span class="badge badge--' + kind + '">' + esc(status || '未知') + '</span>';
  }

  function typeBadge(app) {
    return isSpecial(app)
      ? '<span class="badge badge--special">特別活動</span>'
      : '<span class="badge badge--regular">一般課堂</span>';
  }

  /** 需特別批准原因清單（星期日／封鎖） */
  function specialReasons(app) {
    var out = [];
    if (!app) return out;
    if (app.specialApprovalReason) {
      String(app.specialApprovalReason).split(/[;；]/).forEach(function (r) { r = r.trim(); if (r) out.push(r); });
    }
    if (!out.length) {
      if (app.isSunday) out.push('星期日');
      if (app.blockedReason) out.push('封鎖日期：' + app.blockedReason);
    }
    return out;
  }

  function slotRangeText(app) {
    if (isSpecial(app)) {
      return window.Calendar.dateWithWeekday(app.date) + ' ' + esc0(app.customStart) + '–' + esc0(app.customEnd);
    }
    var slots = Array.isArray(app.slots) ? app.slots.slice() : [];
    if (!slots.length) return '—';
    var byDate = {};
    slots.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
    return Object.keys(byDate).sort().map(function (date) {
      var list = byDate[date].sort(function (a, b) { return toMin(a.start) - toMin(b.start); });
      var first = list[0], last = list[list.length - 1];
      var label = list.length === 1 ? first.label : first.label + ' 至 ' + last.label;
      return window.Calendar.dateWithWeekday(date) + ' ' + label + '（' + first.start + '–' + last.end + '）';
    }).join('；');
  }
  function esc0(v) { return v == null ? '' : String(v); }

  function slotChips(app) {
    if (isSpecial(app)) {
      return '<span class="chip">ACT <span class="chip__time">' + esc(app.customStart) + '–' + esc(app.customEnd) + '</span></span>';
    }
    var slots = Array.isArray(app.slots) ? app.slots : [];
    return slots.map(function (s) {
      return '<span class="chip">' + esc(s.label) + ' <span class="chip__time">' + esc(s.start) + '–' + esc(s.end) + '</span></span>';
    }).join('');
  }

  function handoverList(app) {
    var list = Array.isArray(app.handovers) ? app.handovers : [];
    if (!list.length) return '';
    var html = '<ul class="card__handovers" aria-label="交收紀錄">';
    list.forEach(function (h) {
      html += '<li><span class="ho-type">' + esc(h.type) + '</span><span>' + esc(h.time) + '</span><span>iPad ' + esc(h.ipad) + ' · Pencil ' + esc(h.pencil) + '</span>' +
        (h.note ? '<span>備註：' + esc(h.note) + '</span>' : '') + '</li>';
    });
    html += '</ul>';
    return html;
  }

  /** 特別活動：需特別批准警告區塊 */
  function specialWarningBlock(app) {
    if (!app || !app.needsSpecialApproval) return '';
    var reasons = specialReasons(app);
    var dbl = reasons.length > 1;
    var html = '<div class="warn-block' + (dbl ? ' warn-block--double' : '') + '" role="note"><strong>' + WARN_ICON + (dbl ? '需特別批准（雙重警告）' : '需特別批准') + '</strong>';
    if (reasons.length) html += '<ul>' + reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    html += '</div>';
    return html;
  }

  /** 特別活動：17:15 後保管確認 */
  function afterHoursBlock(app) {
    if (!app || !app.afterHoursConfirm) return '';
    return '<div class="confirm-block" role="note"><span class="confirm-block__label">教師已確認保管責任</span>' + esc(AFTER_HOURS_SENTENCE) + '</div>';
  }

  /**
   * 申請卡片。
   * opts: { actions: htmlString, showTeacher: bool, showHandovers: bool, showOutstanding: bool }
   */
  function applicationCard(app, opts) {
    opts = opts || {};
    var special = isSpecial(app);
    var titleId = 'card-' + app.applicationId + '-title';
    var html = '<article class="card' + (special ? ' card--special' : '') + '" data-id="' + esc(app.applicationId) + '" aria-labelledby="' + esc(titleId) + '">';
    html += '<div class="card__head"><div><div class="card__id">' + esc(app.applicationId) + ' ' + typeBadge(app) + '</div>';
    if (special) {
      html += '<h2 class="card__title" id="' + esc(titleId) + '">' + esc(app.activityName || '特別活動') + '</h2>' +
        '<p class="card__activity">' + esc(window.Calendar.dateWithWeekday(app.date)) + ' <strong>' + esc(app.customStart) + '–' + esc(app.customEnd) + '</strong></p>';
    } else {
      html += '<h2 class="card__title" id="' + esc(titleId) + '">' + esc(slotRangeText(app)) + '</h2>';
    }
    html += '</div>' + statusBadge(app.status) + '</div>';

    if (special && (app.needsSpecialApproval || app.afterHoursConfirm)) {
      html += '<div class="card__special">' + specialWarningBlock(app) + afterHoursBlock(app) + '</div>';
    }

    html += '<dl class="card__meta">';
    if (opts.showTeacher) {
      html += '<dt>' + (special ? '負責教師' : '教師') + '</dt><dd>' + esc(app.teacherName) + (app.teacherEmail ? ' <span class="card__email">（' + esc(app.teacherEmail) + '）</span>' : '') + '</dd>';
    }
    if (special) {
      html += '<dt>班別／組別</dt><dd>' + esc(app.className) + '</dd>';
    } else {
      html += '<dt>班別／科目</dt><dd>' + esc(app.className) + ' · ' + esc(app.subject) + '</dd>';
    }
    html += '<dt>學生人數</dt><dd>' + esc(app.students) + ' 人</dd>';
    html += '<dt>數量</dt><dd><span class="chip chip--qty">iPad ' + esc(app.ipad) + '</span> <span class="chip chip--qty">Pencil ' + esc(app.pencil) + '</span></dd>';
    if (app.remark) html += '<dt>' + (special ? '活動備註' : '備註') + '</dt><dd class="card__remark">' + esc(app.remark) + '</dd>';
    if (app.reason) html += '<dt>' + (app.status === '已拒絕' ? '拒絕原因' : '原因') + '</dt><dd>' + esc(app.reason) + '</dd>';
    if (app.abnormalNote) html += '<dt>異常備註</dt><dd>' + esc(app.abnormalNote) + '</dd>';
    html += '<dt>提交時間</dt><dd>' + esc(app.createdAt) + '</dd>';
    if (app.approvedBy) html += '<dt>審批</dt><dd>' + esc(app.approvedBy) + (app.approvedAt ? '（' + esc(app.approvedAt) + '）' : '') + '</dd>';
    html += '</dl>';
    html += '<div class="card__slots" aria-label="時段">' + slotChips(app) + '</div>';
    if (opts.showOutstanding) {
      var ipadOut = Number(app.ipadOutstanding) || 0;
      var pencilOut = Number(app.pencilOutstanding) || 0;
      html += '<div class="outstanding" aria-label="未歸還數量">' +
        '<div class="outstanding__item"><span class="outstanding__label">申請 iPad／Pencil</span><span class="outstanding__value">' + esc(app.ipad) + ' ／ ' + esc(app.pencil) + '</span></div>' +
        '<div class="outstanding__item"><span class="outstanding__label">未還 iPad</span><span class="outstanding__value' + (ipadOut > 0 ? ' is-due' : '') + '">' + ipadOut + '</span></div>' +
        '<div class="outstanding__item"><span class="outstanding__label">未還 Pencil</span><span class="outstanding__value' + (pencilOut > 0 ? ' is-due' : '') + '">' + pencilOut + '</span></div>' +
        '</div>';
    }
    if (opts.showHandovers !== false) html += handoverList(app);
    if (opts.actions) html += '<div class="card__actions">' + opts.actions + '</div>';
    html += '</article>';
    return html;
  }

  /* ========== 申請表：共用狀態 ========== */
  var applyState = null;
  var applyBound = false;

  function setError(errId, inputId, message) {
    var errEl = el(errId);
    var input = el(inputId);
    if (errEl) errEl.textContent = message || '';
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  /* --- 一般課堂欄位 --- */
  function setFieldError(field, message) { setError('err-' + field, 'apply-' + field, message); }
  /* --- 特別活動欄位 --- */
  function setSpError(field, message) {
    var inputId = { customStart: 'sp-start', customEnd: 'sp-end' }[field] || ('sp-' + field);
    setError('err-sp-' + field, inputId, message);
  }

  function clearApplyErrors() {
    ['slotIds', 'teacherName', 'className', 'students', 'subject', 'ipad', 'pencil', 'remark'].forEach(function (f) { setFieldError(f, ''); });
    ['activityName', 'date', 'customStart', 'customEnd', 'teacherName', 'className', 'students', 'ipad', 'pencil', 'remark', 'afterHoursConfirm'].forEach(function (f) { setSpError(f, ''); });
    el('apply-form-error').textContent = '';
  }

  function currentType() {
    return el('type-special').checked ? TYPE_SPECIAL : TYPE_REGULAR;
  }

  function setType(type) {
    var special = type === TYPE_SPECIAL;
    el('type-special').checked = special;
    el('type-regular').checked = !special;
    el('apply-regular-fields').hidden = special;
    el('apply-special-fields').hidden = !special;
    el('apply-title').textContent = special ? '提交特別活動申請' : '提交預約申請';
    el('apply-submit').textContent = special ? '提交特別活動申請' : '提交申請';
    el('apply-form-error').textContent = '';
    if (special) {
      // 同步教師姓名
      if (!el('sp-teacherName').value && el('apply-teacherName').value) el('sp-teacherName').value = el('apply-teacherName').value;
      updateSpecialNotices();
      updateSpecialStock();
    } else if (!el('apply-teacherName').value && el('sp-teacherName').value) {
      el('apply-teacherName').value = el('sp-teacherName').value;
    }
  }

  /* ========== 一般課堂 ========== */
  function selectedSlotIds() {
    return Array.prototype.map.call(el('apply-slot-list').querySelectorAll('input[type="checkbox"]:checked'), function (c) { return c.value; });
  }

  /** 所選時段（依當日可用時段的序位）是否連續 */
  function isConsecutive(slotIds) {
    if (!applyState) return false;
    var indices = slotIds.map(function (id) {
      return applyState.orderedSlots.findIndex(function (s) { return s.slotId === id; });
    }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return a - b; });
    if (indices.length !== slotIds.length) return false;
    for (var i = 1; i < indices.length; i++) {
      if (indices[i] - indices[i - 1] !== 1) return false;
    }
    return true;
  }

  function minRemaining(slotIds) {
    var ipad = Infinity, pencil = Infinity;
    slotIds.forEach(function (id) {
      var c = applyState.cellsBySlot[id];
      if (!c) return;
      ipad = Math.min(ipad, Number(c.ipadRemaining) || 0);
      pencil = Math.min(pencil, Number(c.pencilRemaining) || 0);
    });
    if (!isFinite(ipad)) ipad = 0;
    if (!isFinite(pencil)) pencil = 0;
    return { ipad: ipad, pencil: pencil };
  }

  function updateStockSummary() {
    if (!applyState) return;
    var ids = selectedSlotIds();
    var summary = el('apply-stock-summary');
    var ipadInput = el('apply-ipad');
    var pencilInput = el('apply-pencil');
    var settings = applyState.settings || {};

    if (!ids.length) {
      summary.className = 'stock-summary';
      summary.innerHTML = '請先選擇時段。';
      ipadInput.max = settings.ipadTotal || '';
      pencilInput.max = settings.pencilTotal || '';
      el('hint-ipad').textContent = '';
      el('hint-pencil').textContent = '';
      return;
    }
    if (!isConsecutive(ids)) setFieldError('slotIds', '所選時段必須連續，請重新選擇。');
    else setFieldError('slotIds', '');

    var rem = minRemaining(ids);
    var labels = ids.map(function (id) {
      var s = applyState.orderedSlots.filter(function (x) { return x.slotId === id; })[0];
      return s ? s.label : id;
    });
    summary.className = 'stock-summary' + ((rem.ipad === 0 || rem.ipad < 10) ? ' is-warn' : '');
    summary.innerHTML = '已選 ' + ids.length + ' 節（' + esc(labels.join('、')) + '）：所選時段最少尚餘 <strong>iPad ' + rem.ipad + ' 部</strong>、<strong>Apple Pencil ' + rem.pencil + ' 支</strong>。';

    ipadInput.max = Math.max(1, rem.ipad);
    el('hint-ipad').textContent = rem.ipad > 0 ? '可申請 1 至 ' + rem.ipad + ' 部' : '所選時段 iPad 已借滿，請改選其他時段';
    var ipadVal = parseInt(ipadInput.value, 10);
    var pencilMax = Math.max(0, Math.min(isFinite(ipadVal) ? ipadVal : rem.ipad, rem.pencil));
    pencilInput.max = pencilMax;
    el('hint-pencil').textContent = '不可多於 iPad 數量，最多 ' + pencilMax + ' 支';
  }

  function buildSlotList() {
    var list = el('apply-slot-list');
    var html = '';
    var any = false;
    applyState.orderedSlots.forEach(function (slot) {
      var cell = applyState.cellsBySlot[slot.slotId];
      var bookable = !!(cell && cell.bookable);
      if (!bookable) return;
      any = true;
      var full = (Number(cell.ipadRemaining) || 0) <= 0;
      var id = 'slot-opt-' + slot.slotId;
      html += '<label class="slot-option' + (full ? ' is-full' : '') + '" for="' + id + '">' +
        '<input type="checkbox" id="' + id + '" name="slotIds" value="' + esc(slot.slotId) + '"' + (full ? ' disabled' : '') + (slot.slotId === applyState.initialSlotId && !full ? ' checked' : '') + '>' +
        '<span class="slot-option__text"><span class="slot-option__label">' + esc(slot.label) + '</span>' +
        '<span class="slot-option__time">' + esc(slot.start) + '–' + esc(slot.end) + '</span>' +
        '<span class="slot-option__stock">' + (full ? '已借滿' : '尚餘 iPad ' + esc(cell.ipadRemaining) + ' · 筆 ' + esc(cell.pencilRemaining)) + '</span></span>' +
        '</label>';
    });
    if (!any) html = '<p class="field__hint">此日期沒有可預約的時段。</p>';
    list.innerHTML = html;
  }

  function fillDatalist(id, options) {
    var dl = el(id);
    if (!dl) return;
    dl.innerHTML = (options || []).map(function (o) { return '<option value="' + esc(o) + '"></option>'; }).join('');
  }

  function validateRegular() {
    var ok = true;
    var firstBad = null;
    function bad(field, msg) {
      ok = false;
      setFieldError(field, msg);
      if (!firstBad) firstBad = field;
    }
    var slotIds = selectedSlotIds();
    if (!slotIds.length) bad('slotIds', '請至少選擇一個時段。');
    else if (!isConsecutive(slotIds)) bad('slotIds', '所選時段必須連續，請重新選擇。');

    var teacherName = el('apply-teacherName').value.trim();
    if (teacherName.length < 1 || teacherName.length > 50) bad('teacherName', '請輸入教師姓名（1 至 50 字）。');
    var className = el('apply-className').value.trim();
    if (className.length < 1 || className.length > 20) bad('className', '請輸入班別（1 至 20 字）。');
    var studentsRaw = el('apply-students').value.trim();
    var students = Number(studentsRaw);
    if (!/^\d+$/.test(studentsRaw) || students < 1 || students > 60) bad('students', '學生人數須為 1 至 60 的整數。');
    var subject = el('apply-subject').value.trim();
    if (subject.length < 1 || subject.length > 50) bad('subject', '請輸入科目（1 至 50 字）。');

    var rem = slotIds.length ? minRemaining(slotIds) : { ipad: applyState.settings.ipadTotal, pencil: applyState.settings.pencilTotal };
    var ipadRaw = el('apply-ipad').value.trim();
    var ipad = Number(ipadRaw);
    var ipadCap = Math.min(Number(applyState.settings.ipadTotal) || 0, rem.ipad);
    if (!/^\d+$/.test(ipadRaw) || ipad < 1) bad('ipad', 'iPad 數量須為至少 1 的整數。');
    else if (ipad > ipadCap) bad('ipad', '所選時段最多只可申請 ' + ipadCap + ' 部 iPad。');

    var pencilRaw = el('apply-pencil').value.trim() || '0';
    var pencil = Number(pencilRaw);
    if (!/^\d+$/.test(pencilRaw) || pencil < 0) bad('pencil', 'Pencil 數量須為 0 或以上的整數。');
    else if (pencil > ipad) bad('pencil', 'Pencil 數量不可多於 iPad 數量。');
    else if (pencil > rem.pencil) bad('pencil', '所選時段最多只可申請 ' + rem.pencil + ' 支 Pencil。');

    var remark = el('apply-remark').value;
    if (remark.length > 500) bad('remark', '備註不可超過 500 字。');

    if (!ok && firstBad) {
      var target = firstBad === 'slotIds' ? el('apply-slot-list').querySelector('input:not(:disabled)') : el('apply-' + firstBad);
      if (target) target.focus();
      return null;
    }
    return {
      date: applyState.date,
      slotIds: slotIds,
      teacherName: teacherName,
      className: className,
      students: students,
      subject: subject,
      ipad: ipad,
      pencil: pencil,
      remark: remark
    };
  }

  /* ========== 特別活動 ========== */
  function specialDateInfo(date) {
    var week = applyState.week;
    var day = week && Array.isArray(week.days) ? week.days.filter(function (d) { return d.date === date; })[0] : null;
    var sc = null;
    if (week && week.special && week.special[date]) sc = window.Calendar.getSpecialCell(week, date, day);
    else if (day) sc = window.Calendar.getSpecialCell(week, date, day);
    else if (applyState.special && applyState.special.date === date) sc = applyState.special;
    var isSunday = window.Calendar.weekdayOf(date) === 'SUN';
    var blockedReason = sc && sc.blockedReason ? sc.blockedReason : (day && day.blockedAllDay ? (day.blockedReason || '封鎖日期') : null);
    var known = !!(sc || day);
    return { day: day, special: sc, isSunday: isSunday, blockedReason: blockedReason, known: known };
  }

  function updateSpecialNotices() {
    if (!applyState) return;
    var date = el('sp-date').value;
    var box = el('sp-notice-special');
    var list = el('sp-notice-reasons');
    var title = el('sp-notice-special-title');
    if (!date) { box.hidden = true; return; }
    var info = specialDateInfo(date);
    var reasons = [];
    if (info.isSunday) reasons.push('星期日');
    if (info.blockedReason) reasons.push('封鎖日期：' + info.blockedReason);
    box.hidden = !reasons.length;
    box.classList.toggle('is-double', reasons.length > 1);
    title.innerHTML = WARN_ICON + (reasons.length > 1 ? '此日期需要管理員特別批准（雙重警告）' : '此日期需要管理員特別批准');
    list.innerHTML = reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    if (!info.known && !info.isSunday) {
      list.innerHTML = '';
    }
    el('sp-date-hint').textContent = info.known ? '' : '此日期不在目前載入的週表內，封鎖狀態以後端審批時為準。';
  }

  function updateAfterHours() {
    if (!applyState) return;
    var end = normTime(el('sp-end').value);
    var after = settingsTime(applyState.settings, 'afterHoursTime', DEFAULT_AFTER_HOURS);
    var need = !!end && toMin(end) > toMin(after);
    el('sp-afterhours-block').hidden = !need;
    el('sp-afterhours-time').textContent = after;
    el('sp-remark-req').hidden = !need;
    el('sp-remark').required = need;
    el('sp-afterHoursConfirm').required = need;
    if (!need) {
      setSpError('afterHoursConfirm', '');
    }
  }

  /** 所選時間範圍內（與現有時段重疊）之最少尚餘，供即時顯示 */
  function specialRemaining(date, start, end) {
    var week = applyState.week;
    var s = toMin(start), e = toMin(end);
    if (!week || !week.cells || !isFinite(s) || !isFinite(e) || e <= s) return null;
    var ipad = Infinity, pencil = Infinity, hit = false;
    (applyState.slots || []).forEach(function (slot) {
      var cell = week.cells[date + '|' + slot.slotId];
      if (!cell) return;
      var cs = toMin(slot.start), ce = toMin(slot.end);
      if (cs < e && ce > s) {
        hit = true;
        ipad = Math.min(ipad, Number(cell.ipadRemaining) || 0);
        pencil = Math.min(pencil, Number(cell.pencilRemaining) || 0);
      }
    });
    if (!hit) return null;
    return { ipad: ipad, pencil: pencil };
  }

  function updateSpecialStock() {
    if (!applyState) return;
    var settings = applyState.settings || {};
    var date = el('sp-date').value;
    var start = normTime(el('sp-start').value);
    var end = normTime(el('sp-end').value);
    var summary = el('sp-stock-summary');
    var ipadInput = el('sp-ipad');
    var pencilInput = el('sp-pencil');
    var total = Number(settings.ipadTotal) || 0;
    var pencilTotal = Number(settings.pencilTotal) || 0;

    var rem = (date && start && end) ? specialRemaining(date, start, end) : null;
    var ipadCap = rem ? rem.ipad : total;
    var pencilCap = rem ? rem.pencil : pencilTotal;
    if (!date || !start || !end) {
      summary.className = 'stock-summary';
      summary.innerHTML = '請先填寫活動日期及時間，以顯示該時間範圍的尚餘數量。全校共有 iPad ' + total + ' 部、Apple Pencil ' + pencilTotal + ' 支。';
    } else if (rem) {
      summary.className = 'stock-summary' + ((rem.ipad === 0 || rem.ipad < 10) ? ' is-warn' : '');
      summary.innerHTML = esc(start) + '–' + esc(end) + ' 期間最少尚餘 <strong>iPad ' + rem.ipad + ' 部</strong>、<strong>Apple Pencil ' + rem.pencil + ' 支</strong>（依現有預約估算，最終以審批時庫存為準）。';
    } else {
      summary.className = 'stock-summary';
      summary.innerHTML = esc(start) + '–' + esc(end) + ' 不與任何一般時段重疊或不在目前週表內，未能即時估算尚餘；全校共有 iPad ' + total + ' 部、Apple Pencil ' + pencilTotal + ' 支，以審批時庫存為準。';
    }
    ipadInput.max = Math.max(1, ipadCap);
    el('hint-sp-ipad').textContent = ipadCap > 0 ? '可申請 1 至 ' + ipadCap + ' 部' : '估算所選時間 iPad 已借滿，仍可提交但可能因庫存不足被拒';
    var ipadVal = parseInt(ipadInput.value, 10);
    var pencilMax = Math.max(0, Math.min(isFinite(ipadVal) ? ipadVal : ipadCap, pencilCap));
    pencilInput.max = pencilMax;
    el('hint-sp-pencil').textContent = '不可多於 iPad 數量，最多 ' + pencilMax + ' 支';
  }

  function validateSpecial() {
    var ok = true;
    var firstBad = null;
    var settings = applyState.settings || {};
    function bad(field, msg) {
      ok = false;
      setSpError(field, msg);
      if (!firstBad) firstBad = field;
    }
    var activityName = el('sp-activityName').value.trim();
    if (activityName.length < 1 || activityName.length > 100) bad('activityName', '請輸入活動名稱（1 至 100 字）。');

    var date = el('sp-date').value;
    var today = applyState.today || window.App.todayStr();
    var maxDate = window.App.addDays(today, Number(settings.advanceDays) || 30);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !window.Calendar.parseDate(date)) bad('date', '請選擇活動日期。');
    else if (date < today) bad('date', '活動日期不可早於今天。');
    else if (date > maxDate) bad('date', '只可預約 ' + (settings.advanceDays || 30) + ' 天內（最遲 ' + window.Calendar.formatDateLong(maxDate) + '）。');

    var start = normTime(el('sp-start').value);
    var end = normTime(el('sp-end').value);
    var earliest = settingsTime(settings, 'specialEarliestStart', DEFAULT_EARLIEST);
    var latest = settingsTime(settings, 'specialLatestEnd', DEFAULT_LATEST);
    if (!start) bad('customStart', '請輸入開始時間。');
    else if (toMin(start) < toMin(earliest)) bad('customStart', '開始時間不可早於 ' + earliest + '。');
    if (!end) bad('customEnd', '請輸入結束時間。');
    else if (toMin(end) > toMin(latest)) bad('customEnd', '結束時間不可遲於 ' + latest + '。');
    else if (start && toMin(start) >= toMin(end)) bad('customEnd', '結束時間必須遲於開始時間。');
    if (start && end && date === today && ok) {
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes() + (Number(settings.cutoffHours) || 0) * 60;
      if (toMin(start) <= nowMin) bad('customStart', '開始時間已過或已超過申請截止時間。');
    }

    var teacherName = el('sp-teacherName').value.trim();
    if (teacherName.length < 1 || teacherName.length > 50) bad('teacherName', '請輸入負責教師姓名（1 至 50 字）。');
    var className = el('sp-className').value.trim();
    if (className.length < 1 || className.length > 50) bad('className', '請輸入參與班別／組別（1 至 50 字）。');
    var studentsRaw = el('sp-students').value.trim();
    var students = Number(studentsRaw);
    if (!/^\d+$/.test(studentsRaw) || students < 1 || students > 200) bad('students', '學生人數須為 1 至 200 的整數。');

    var total = Number(settings.ipadTotal) || 0;
    var pencilTotal = Number(settings.pencilTotal) || 0;
    var rem = (date && start && end) ? specialRemaining(date, start, end) : null;
    var ipadRaw = el('sp-ipad').value.trim();
    var ipad = Number(ipadRaw);
    if (!/^\d+$/.test(ipadRaw) || ipad < 1) bad('ipad', 'iPad 數量須為至少 1 的整數。');
    else if (ipad > total) bad('ipad', '全校只有 ' + total + ' 部 iPad。');
    else if (rem && ipad > rem.ipad) bad('ipad', '所選時間範圍最多只可申請 ' + rem.ipad + ' 部 iPad。');

    var pencilRaw = el('sp-pencil').value.trim() || '0';
    var pencil = Number(pencilRaw);
    if (!/^\d+$/.test(pencilRaw) || pencil < 0) bad('pencil', 'Pencil 數量須為 0 或以上的整數。');
    else if (pencil > ipad) bad('pencil', 'Pencil 數量不可多於 iPad 數量。');
    else if (pencil > pencilTotal) bad('pencil', '全校只有 ' + pencilTotal + ' 支 Apple Pencil。');
    else if (rem && pencil > rem.pencil) bad('pencil', '所選時間範圍最多只可申請 ' + rem.pencil + ' 支 Pencil。');

    var remark = el('sp-remark').value;
    if (remark.length > 500) bad('remark', '活動備註不可超過 500 字。');

    var after = settingsTime(settings, 'afterHoursTime', DEFAULT_AFTER_HOURS);
    var needAfter = !!end && toMin(end) > toMin(after);
    var afterHoursConfirm = false;
    if (needAfter) {
      afterHoursConfirm = el('sp-afterHoursConfirm').checked;
      if (!remark.trim()) bad('remark', '活動結束時間遲於 ' + after + '，必須填寫活動備註（例如保管安排）。');
      if (!afterHoursConfirm) bad('afterHoursConfirm', '請勾選保管確認。');
    }

    if (!ok && firstBad) {
      var target = el({ customStart: 'sp-start', customEnd: 'sp-end' }[firstBad] || ('sp-' + firstBad));
      if (target) target.focus();
      return null;
    }
    return {
      date: date,
      activityName: activityName,
      customStart: start,
      customEnd: end,
      teacherName: teacherName,
      className: className,
      students: students,
      ipad: ipad,
      pencil: pencil,
      remark: remark,
      afterHoursConfirm: afterHoursConfirm
    };
  }

  /* ========== 綁定與提交 ========== */
  function bindApplyOnce() {
    if (applyBound) return;
    applyBound = true;
    var form = el('form-apply');

    el('type-regular').addEventListener('change', function () { if (this.checked) setType(TYPE_REGULAR); });
    el('type-special').addEventListener('change', function () { if (this.checked) setType(TYPE_SPECIAL); });

    // 一般課堂
    el('apply-slot-list').addEventListener('change', updateStockSummary);
    el('apply-ipad').addEventListener('input', function () {
      updateStockSummary();
      setFieldError('ipad', '');
    });
    el('apply-pencil').addEventListener('input', function () { setFieldError('pencil', ''); });
    el('apply-remark').addEventListener('input', function () {
      el('apply-remark-count').textContent = String(el('apply-remark').value.length);
    });
    ['teacherName', 'className', 'students', 'subject'].forEach(function (f) {
      el('apply-' + f).addEventListener('input', function () { setFieldError(f, ''); });
    });

    // 特別活動
    el('sp-date').addEventListener('change', function () {
      setSpError('date', '');
      updateSpecialNotices();
      updateSpecialStock();
    });
    el('sp-start').addEventListener('input', function () {
      setSpError('customStart', '');
      updateSpecialStock();
    });
    el('sp-end').addEventListener('input', function () {
      setSpError('customEnd', '');
      updateAfterHours();
      updateSpecialStock();
    });
    el('sp-ipad').addEventListener('input', function () {
      setSpError('ipad', '');
      updateSpecialStock();
    });
    el('sp-pencil').addEventListener('input', function () { setSpError('pencil', ''); });
    el('sp-remark').addEventListener('input', function () {
      el('sp-remark-count').textContent = String(el('sp-remark').value.length);
      setSpError('remark', '');
    });
    el('sp-afterHoursConfirm').addEventListener('change', function () { setSpError('afterHoursConfirm', ''); });
    ['activityName', 'teacherName', 'className', 'students'].forEach(function (f) {
      el('sp-' + f).addEventListener('input', function () { setSpError(f, ''); });
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitApply();
    });
  }

  function submitApply() {
    clearApplyErrors();
    var special = currentType() === TYPE_SPECIAL;
    var payload = special ? validateSpecial() : validateRegular();
    if (!payload) return;
    var btn = el('apply-submit');
    var action = special ? 'submitSpecialActivity' : 'submitApplication';
    window.App.ui.busy(btn, function () {
      return window.Api.post(action, payload).then(function (data) {
        try { localStorage.setItem(NAME_KEY, payload.teacherName); } catch (e) { /* ignore */ }
        var app = data && data.application;
        var idText = app && app.applicationId ? '（' + app.applicationId + '）' : '';
        var msg = special
          ? '已提交特別活動申請' + idText + '，需經管理員審批' + (app && app.needsSpecialApproval ? '（需特別批准）' : '') + '。'
          : '已提交申請' + idText + '，等待審批。';
        window.App.ui.toast(msg, 'success');
        var cb = applyState && applyState.onSubmitted;
        window.App.ui.closeDialog(el('dlg-apply'));
        if (typeof cb === 'function') cb(app);
      }).catch(function (err) {
        window.App.handleError(err, {
          form: function (field, message) {
            if (special) {
              if (field && el('err-sp-' + field)) setSpError(field, message);
              else el('apply-form-error').textContent = message;
            } else {
              if (field && el('err-' + field)) setFieldError(field, message);
              else el('apply-form-error').textContent = message;
            }
          },
          inline: function (message) { el('apply-form-error').textContent = message; },
          reloadWeek: true
        });
      });
    });
  }

  /**
   * 開啟申請表。
   * ctx: { type?: '一般課堂'|'特別活動', date, slotId, special?: SpecialCell, week, slots, settings, user, today, opener, onSubmitted(application) }
   */
  function openApplication(ctx) {
    bindApplyOnce();
    var weekday = window.Calendar.weekdayOf(ctx.date);
    var ordered = window.Calendar.buildRows(ctx.slots, weekday).filter(function (r) { return r.type === 'slot'; }).map(function (r) { return r.slot; });
    var cellsBySlot = {};
    ordered.forEach(function (s) {
      cellsBySlot[s.slotId] = ctx.week && ctx.week.cells ? ctx.week.cells[ctx.date + '|' + s.slotId] : null;
    });
    var settings = ctx.settings || {};
    applyState = {
      date: ctx.date,
      weekday: weekday,
      initialSlotId: ctx.slotId,
      special: ctx.special || null,
      week: ctx.week,
      slots: ctx.slots,
      settings: settings,
      today: ctx.today,
      orderedSlots: ordered,
      cellsBySlot: cellsBySlot,
      onSubmitted: ctx.onSubmitted
    };

    var isSunday = weekday === 'SUN';
    var day = ctx.week && Array.isArray(ctx.week.days) ? ctx.week.days.filter(function (d) { return d.date === ctx.date; })[0] : null;
    var regularAllowed = !isSunday && !(day && day.blockedAllDay) && ordered.some(function (s) { var c = cellsBySlot[s.slotId]; return c && c.bookable; });
    var type = ctx.type === TYPE_SPECIAL || !regularAllowed ? TYPE_SPECIAL : TYPE_REGULAR;
    el('type-regular').disabled = !regularAllowed;
    el('apply-type-hint').textContent = regularAllowed
      ? '一般課堂只可選時段設定內的節數；特別活動可自訂時間並一律需要管理員審批。'
      : (isSunday ? '星期日不設一般課堂預約，只可提交特別活動。' : (day && day.blockedAllDay ? '此日期已封鎖，只可提交特別活動（需管理員特別批准）。' : '此日期沒有可預約的一般時段，只可提交特別活動。'));

    // 一般課堂欄位
    el('apply-date').value = ctx.date;
    el('apply-date-display').textContent = window.Calendar.formatDateLong(ctx.date) + '（星期' + window.Calendar.weekdayZh(weekday) + '）';
    fillDatalist('class-options', settings.classOptions);
    fillDatalist('subject-options', settings.subjectOptions);

    var saved = '';
    try { saved = localStorage.getItem(NAME_KEY) || ''; } catch (e) { saved = ''; }
    var defaultName = saved || (ctx.user && ctx.user.displayName) || '';
    el('apply-teacherName').value = defaultName;
    el('apply-className').value = '';
    el('apply-students').value = '';
    el('apply-subject').value = '';
    el('apply-ipad').value = '';
    el('apply-pencil').value = '0';
    el('apply-remark').value = '';
    el('apply-remark-count').textContent = '0';

    // 特別活動欄位
    var today = ctx.today || window.App.todayStr();
    var maxDate = window.App.addDays(today, Number(settings.advanceDays) || 30);
    el('sp-activityName').value = '';
    el('sp-date').value = ctx.date;
    el('sp-date').min = today;
    el('sp-date').max = maxDate;
    el('sp-start').value = '';
    el('sp-end').value = '';
    el('sp-start').min = settingsTime(settings, 'specialEarliestStart', DEFAULT_EARLIEST);
    el('sp-end').max = settingsTime(settings, 'specialLatestEnd', DEFAULT_LATEST);
    el('sp-time-hint').textContent = '可自訂 ' + el('sp-start').min + ' 至 ' + el('sp-end').max + '；結束時間遲於 ' + settingsTime(settings, 'afterHoursTime', DEFAULT_AFTER_HOURS) + ' 須確認自行保管。';
    el('sp-teacherName').value = defaultName;
    el('sp-className').value = '';
    el('sp-students').value = '';
    el('sp-ipad').value = '';
    el('sp-pencil').value = '0';
    el('sp-remark').value = '';
    el('sp-remark-count').textContent = '0';
    el('sp-afterHoursConfirm').checked = false;

    clearApplyErrors();
    buildSlotList();
    updateStockSummary();
    updateAfterHours();
    setType(type);

    var dlg = el('dlg-apply');
    window.App.ui.openDialog(dlg, ctx.opener || null);
    var firstInput;
    if (type === TYPE_SPECIAL) firstInput = el('sp-activityName');
    else firstInput = el('apply-slot-list').querySelector('input:checked') || el('apply-slot-list').querySelector('input:not(:disabled)') || el('apply-teacherName');
    if (firstInput) firstInput.focus();
  }

  /* ========== 我的申請 ========== */
  var mineApps = [];
  var mineBound = false;

  function matchesFilter(app, f) {
    if (f.type && app.bookingType !== f.type) return false;
    if (f.from && app.date < f.from) return false;
    if (f.to && app.date > f.to) return false;
    if (f.q) {
      var hay = [app.applicationId, app.teacherName, app.className, app.subject, app.activityName, app.remark, app.status].map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }

  function readMineFilter() {
    return {
      q: (el('mine-q').value || '').trim(),
      from: el('mine-from').value || '',
      to: el('mine-to').value || '',
      type: el('mine-type').value || ''
    };
  }

  function filterActive(f) { return !!(f.q || f.from || f.to || f.type); }

  function renderMine() {
    var list = el('mine-list');
    var f = readMineFilter();
    var apps = mineApps.filter(function (a) { return matchesFilter(a, f); });
    var result = el('mine-result');
    if (!mineApps.length) {
      result.textContent = '';
      window.App.ui.renderEmpty(list, {
        title: '尚未有任何申請',
        text: '到「共用時間表」點選可預約的時段或「特別活動」格即可提交申請。',
        actionText: '前往共用時間表',
        onAction: function () { location.hash = '#week'; }
      });
      return;
    }
    result.textContent = filterActive(f) ? '篩選結果：' + apps.length + ' 筆（共 ' + mineApps.length + ' 筆）' : '共 ' + mineApps.length + ' 筆申請';
    if (!apps.length) {
      window.App.ui.renderEmpty(list, {
        title: '沒有符合篩選條件的紀錄',
        text: '請調整關鍵字、日期範圍或預約類型。',
        actionText: '清除篩選',
        onAction: clearMineFilter
      });
      return;
    }
    list.innerHTML = apps.map(function (app) {
      var actions = '';
      if (app.canCancel) {
        actions = '<button type="button" class="btn btn--danger-outline btn--sm" data-action="cancel" data-id="' + esc(app.applicationId) + '">取消申請</button>';
      }
      return applicationCard(app, { actions: actions, showTeacher: false, showHandovers: true });
    }).join('');
    list.querySelectorAll('[data-action="cancel"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var app = apps.filter(function (a) { return a.applicationId === id; })[0];
        if (!app) return;
        confirmCancel(app, btn);
      });
    });
  }

  function clearMineFilter() {
    el('mine-q').value = '';
    el('mine-from').value = '';
    el('mine-to').value = '';
    el('mine-type').value = '';
    renderMine();
    el('mine-q').focus();
  }

  function confirmCancel(app, btn) {
    var desc = isSpecial(app)
      ? '（' + app.activityName + '，' + slotRangeText(app) + '，iPad ' + app.ipad + ' 部）'
      : '（' + slotRangeText(app) + '，' + app.className + ' ' + app.subject + '，iPad ' + app.ipad + ' 部）';
    window.App.ui.confirm({
      title: '取消申請',
      body: '確定取消 ' + app.applicationId + desc + '？取消後不能復原。',
      okText: '確定取消',
      danger: true,
      withReason: true,
      opener: btn
    }).then(function (result) {
      if (!result || !result.ok) return;
      window.App.ui.busy(btn, function () {
        var payload = { applicationId: app.applicationId };
        if (result.reason) payload.reason = result.reason;
        return window.Api.post('cancelMyApplication', payload).then(function () {
          window.App.ui.toast('已取消申請 ' + app.applicationId + '。', 'success');
          window.App.invalidateWeeks();
          loadMine();
        }).catch(function (err) {
          window.App.handleError(err, { reloadList: loadMine });
        });
      });
    });
  }

  function loadMine() {
    var list = el('mine-list');
    if (!list) return Promise.resolve();
    var ticket = window.Api.latest('mine');
    list.setAttribute('aria-busy', 'true');
    el('mine-result').textContent = '';
    window.App.ui.renderSkeletonCards(list, 3);
    return window.Api.post('getMyApplications', {}).then(function (data) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      mineApps = (data && data.applications) || [];
      renderMine();
    }).catch(function (err) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      if (!window.App.handleError(err, { silent: true })) return;
      window.App.ui.renderError(list, err, loadMine);
    });
  }

  /* ========== 借用紀錄搜尋（admin／handler） ========== */
  function readSearchPayload() {
    var payload = {};
    var q = (el('search-q').value || '').trim();
    if (q) payload.query = q;
    if (el('search-from').value) payload.from = el('search-from').value;
    if (el('search-to').value) payload.to = el('search-to').value;
    if (el('search-type').value) payload.bookingType = el('search-type').value;
    if (el('search-status').value) payload.status = el('search-status').value;
    return payload;
  }

  function runSearch() {
    var list = el('search-list');
    var result = el('search-result');
    var payload = readSearchPayload();
    if (payload.from && payload.to && payload.from > payload.to) {
      result.textContent = '「日期由」不可遲於「至」。';
      el('search-from').focus();
      return Promise.resolve();
    }
    var ticket = window.Api.latest('search');
    list.setAttribute('aria-busy', 'true');
    result.textContent = '正在搜尋…';
    window.App.ui.renderSkeletonCards(list, 2);
    return window.App.ui.busy(el('btn-search'), function () {
      return window.Api.post('searchApplications', payload).then(function (data) {
        if (!ticket.isLatest()) return;
        list.setAttribute('aria-busy', 'false');
        var apps = (data && data.applications) || [];
        result.textContent = '搜尋結果：' + apps.length + ' 筆' + (apps.length >= 200 ? '（已達上限 200 筆，請收窄條件）' : '');
        if (!apps.length) {
          window.App.ui.renderEmpty(list, { title: '沒有符合條件的紀錄', text: '請嘗試其他關鍵字、日期範圍、類型或狀態。' });
          return;
        }
        list.innerHTML = apps.map(function (app) {
          return applicationCard(app, { showTeacher: true, showHandovers: true, showOutstanding: false });
        }).join('');
      }).catch(function (err) {
        if (!ticket.isLatest()) return;
        list.setAttribute('aria-busy', 'false');
        result.textContent = '';
        if (!window.App.handleError(err, { silent: true })) return;
        window.App.ui.renderError(list, err, runSearch);
      });
    });
  }

  function initMineControls() {
    if (mineBound) return;
    mineBound = true;
    var timer = null;
    el('mine-q').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(renderMine, 150);
    });
    ['mine-from', 'mine-to', 'mine-type'].forEach(function (id) {
      el(id).addEventListener('change', renderMine);
    });
    el('mine-filters').addEventListener('submit', function (ev) { ev.preventDefault(); renderMine(); });
    el('btn-mine-clear').addEventListener('click', clearMineFilter);

    el('search-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      runSearch();
    });
    el('btn-search-clear').addEventListener('click', function () {
      ['search-q', 'search-from', 'search-to', 'search-type', 'search-status'].forEach(function (id) { el(id).value = ''; });
      el('search-list').innerHTML = '';
      el('search-result').textContent = '';
      el('search-q').focus();
    });
  }

  window.Forms = {
    openApplication: openApplication,
    loadMine: loadMine,
    initMineControls: initMineControls,
    runSearch: runSearch,
    applicationCard: applicationCard,
    statusBadge: statusBadge,
    typeBadge: typeBadge,
    slotRangeText: slotRangeText,
    specialReasons: specialReasons,
    isSpecial: isSpecial,
    AFTER_HOURS_SENTENCE: AFTER_HOURS_SENTENCE,
    NAME_KEY: NAME_KEY
  };
})();
