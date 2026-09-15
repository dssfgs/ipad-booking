/* =========================================================
   Calendar — 共用時間表繪製
   - 由 slots 依合約 §3.4 規則插入不可預約分隔列（≥ 10 分鐘空隙）
   - 每格顯示：時段、起訖、iPad／Pencil 已核准／待審／尚餘、最多 3 筆預約摘要、另有 N 筆
   - 狀態色：尚餘 ≥ 30% 充足、> 0 緊張、0 借滿、含 isMine 加藍框、不可預約灰
   - 格子為 <button>，aria-label 含完整資訊
   - 週表模式與手機單日模式
   - 7 欄（星期一至日）；星期日一般時段列顯示灰格；底部「特別活動」列（合約 §9.5）
   ========================================================= */
(function () {
  'use strict';

  var WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  var WEEKDAY_ZH = { MON: '一', TUE: '二', WED: '三', THU: '四', FRI: '五', SAT: '六', SUN: '日' };
  var GAP_MIN = 10;
  var KNOWN_GAPS = {
    '10:20-10:35': '小息',
    '11:45-12:00': '小息',
    '13:10-14:25': '午膳'
  };
  var REASON_TEXT = {
    past: '已過',
    blocked: '已封鎖',
    cutoff: '已截止',
    beyondAdvance: '未開放',
    notApplicable: '不適用'
  };
  var STATUS_TEXT = { ok: '充足', low: '緊張', full: '借滿', off: '不可預約' };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    if (!m) return NaN;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }

  function formatDateShort(str) {
    var d = parseDate(str);
    if (!d) return str || '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function formatDateLong(str) {
    var d = parseDate(str);
    if (!d) return str || '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function weekdayOf(str) {
    var d = parseDate(str);
    if (!d) return '';
    var idx = (d.getDay() + 6) % 7;
    return WEEKDAYS[idx];
  }

  function weekdayZh(code) {
    return WEEKDAY_ZH[code] || '';
  }

  function dateWithWeekday(str) {
    return formatDateShort(str) + '（' + weekdayZh(weekdayOf(str)) + '）';
  }

  /* ---------- 分隔列計算 ---------- */
  function dividerLabel(prevEnd, nextStart) {
    var key = prevEnd + '-' + nextStart;
    if (KNOWN_GAPS[key]) return KNOWN_GAPS[key];
    var startMin = toMinutes(nextStart);
    var gap = startMin - toMinutes(prevEnd);
    var prevEndMin = toMinutes(prevEnd);
    if (gap >= 45 && prevEndMin >= 12 * 60 && prevEndMin <= 14 * 60 + 30) return '午膳';
    if (gap <= 20) return '小息';
    return '休息';
  }

  /**
   * 依 order 排序時段並於 ≥ 10 分鐘空隙插入分隔列。
   * weekday 選填：只保留適用該星期的時段（單日模式）。
   */
  function buildRows(slots, weekday) {
    var list = (slots || []).slice().filter(function (s) {
      if (!s || !s.slotId) return false;
      if (weekday && Array.isArray(s.days) && s.days.length) return s.days.indexOf(weekday) >= 0;
      return true;
    }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var slot = list[i];
      if (i > 0) {
        var prev = list[i - 1];
        var gap = toMinutes(slot.start) - toMinutes(prev.end);
        if (isFinite(gap) && gap >= GAP_MIN) {
          rows.push({ type: 'divider', start: prev.end, end: slot.start, label: dividerLabel(prev.end, slot.start) });
        }
      }
      rows.push({ type: 'slot', slot: slot });
    }
    return rows;
  }

  /* ---------- 狀態 ---------- */
  function statusOf(cell, settings) {
    if (!cell || !cell.bookable) return 'off';
    var total = Math.max(1, Number(settings && settings.ipadTotal) || 1);
    var rem = Number(cell.ipadRemaining) || 0;
    if (rem <= 0) return 'full';
    if (rem / total >= 0.3) return 'ok';
    return 'low';
  }

  function hasMine(cell) {
    return !!(cell && Array.isArray(cell.bookings) && cell.bookings.some(function (b) { return b && b.isMine; }));
  }

  function emptyCell(date, slotId, reason) {
    return {
      date: date, slotId: slotId,
      ipadApproved: 0, ipadPending: 0, ipadRemaining: 0,
      pencilApproved: 0, pencilPending: 0, pencilRemaining: 0,
      bookable: false, unbookableReason: reason || 'notApplicable', blockedReason: null,
      bookings: [], bookingCount: 0
    };
  }

  function reasonText(cell, day) {
    if (!cell) return '';
    if (cell.bookable) return '';
    if (cell.unbookableReason === 'blocked') {
      var r = cell.blockedReason || (day && day.blockedReason) || '';
      return r ? '已封鎖：' + r : '已封鎖';
    }
    return REASON_TEXT[cell.unbookableReason] || '不可預約';
  }

  /* ---------- 格子 ---------- */
  function bookingLine(b) {
    var text = [b.teacherName, b.className, b.subject].filter(Boolean).join(' ');
    var qty = 'iPad ' + (Number(b.ipad) || 0) + (Number(b.pencil) > 0 ? ' · 筆 ' + Number(b.pencil) : '');
    var pending = b.status === '待審批';
    return '<span class="cell__booking' + (b.isMine ? ' is-mine' : '') + (pending ? ' is-pending' : '') + '" title="' + esc(text + '，' + qty + (pending ? '（待審）' : '')) + '">' +
      '<span class="cell__booking-text">' + esc(text) + '</span>' +
      '<span class="cell__booking-qty">' + esc(qty) + '</span>' +
      '</span>';
  }

  function cellAriaLabel(cell, day, slot, status, mine) {
    var parts = [];
    parts.push(dateWithWeekday(cell.date) + ' ' + slot.label + ' ' + slot.start + '至' + slot.end);
    parts.push('狀態：' + STATUS_TEXT[status] + (status === 'off' ? '（' + reasonText(cell, day) + '）' : ''));
    parts.push('iPad 已核准 ' + cell.ipadApproved + '、待審 ' + cell.ipadPending + '、尚餘 ' + cell.ipadRemaining);
    parts.push('Pencil 已核准 ' + cell.pencilApproved + '、待審 ' + cell.pencilPending + '、尚餘 ' + cell.pencilRemaining);
    parts.push((cell.bookingCount || 0) + ' 筆預約' + (mine ? '，含我的預約' : ''));
    if (cell.bookable) parts.push('按 Enter 提交申請');
    return parts.join('；');
  }

  function renderCellButton(cell, day, slot, settings) {
    var status = statusOf(cell, settings);
    var mine = hasMine(cell);
    var classes = ['cell', 'cell--' + status];
    if (mine) classes.push('cell--mine');
    var bookings = Array.isArray(cell.bookings) ? cell.bookings.slice(0, 3) : [];
    var more = Math.max(0, (Number(cell.bookingCount) || bookings.length) - bookings.length);

    var html = '';
    html += '<button type="button" class="' + classes.join(' ') + '" data-date="' + esc(cell.date) + '" data-slot="' + esc(slot.slotId) + '"' +
      (cell.bookable ? '' : ' aria-disabled="true"') +
      ' aria-label="' + esc(cellAriaLabel(cell, day, slot, status, mine)) + '">';
    html += '<span class="cell__head"><span class="cell__status">' + STATUS_TEXT[status] + '</span>' +
      (mine ? '<span class="cell__mine-tag">我的預約</span>' : '') + '</span>';
    html += '<span class="cell__stock" aria-hidden="true">' +
      '<span class="h"></span><span class="h">核准</span><span class="h">待審</span><span class="h">尚餘</span>' +
      '<span class="k">iPad</span><span class="v">' + esc(cell.ipadApproved) + '</span><span class="v">' + esc(cell.ipadPending) + '</span><span class="v v--rem">' + esc(cell.ipadRemaining) + '</span>' +
      '<span class="k">Pencil</span><span class="v">' + esc(cell.pencilApproved) + '</span><span class="v">' + esc(cell.pencilPending) + '</span><span class="v v--rem">' + esc(cell.pencilRemaining) + '</span>' +
      '</span>';
    if (bookings.length) {
      html += '<span class="cell__bookings" aria-hidden="true">';
      html += bookings.map(bookingLine).join('');
      if (more > 0) html += '<span class="cell__more">另有 ' + more + ' 筆</span>';
      html += '</span>';
    } else if (cell.bookable) {
      html += '<span class="cell__empty" aria-hidden="true">尚無預約</span>';
    }
    if (!cell.bookable) {
      html += '<span class="cell__reason" aria-hidden="true">' + esc(reasonText(cell, day)) + '</span>';
    }
    html += '</button>';
    return html;
  }


  /* ---------- 特別活動格（合約 §9.5） ---------- */
  var WARN_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.9" fill="currentColor"/></svg>';

  function emptySpecialCell(date, day) {
    var wd = day ? day.weekday : weekdayOf(date);
    return {
      date: date, activities: [], activityCount: 0,
      bookable: !(day && day.isPast),
      isSunday: wd === 'SUN',
      blockedReason: (day && day.blockedAllDay) ? (day.blockedReason || '封鎖日期') : null,
      warnings: [].concat(wd === 'SUN' ? ['sunday'] : [], (day && day.blockedAllDay) ? ['blocked'] : [])
    };
  }

  function getSpecialCell(week, date, day) {
    var sc = week && week.special ? week.special[date] : null;
    if (sc) {
      if (!Array.isArray(sc.warnings)) sc.warnings = [].concat(sc.isSunday ? ['sunday'] : [], sc.blockedReason ? ['blocked'] : []);
      if (!Array.isArray(sc.activities)) sc.activities = [];
      return sc;
    }
    return emptySpecialCell(date, day);
  }

  function specialWarningTexts(sc) {
    var out = [];
    (sc.warnings || []).forEach(function (w) {
      if (w === 'sunday') out.push('星期日');
      else if (w === 'blocked') out.push('封鎖日期' + (sc.blockedReason ? '：' + sc.blockedReason : ''));
    });
    return out;
  }

  function specialItemHtml(a) {
    var pending = a.status === '待審批';
    var badges = '';
    if (a.needsSpecialApproval) badges += '<span class="tag tag--warn">需特別批准</span>';
    if (a.afterHoursConfirm) badges += '<span class="tag tag--after">17:15 後自行保管</span>';
    var title = a.activityName + ' ' + a.start + '–' + a.end + '，' + [a.teacherName, a.className].filter(Boolean).join(' ') +
      '，iPad ' + (Number(a.ipad) || 0) + (Number(a.pencil) > 0 ? '、筆 ' + Number(a.pencil) : '') + '，' + (a.status || '');
    return '<span class="scell__item' + (a.isMine ? ' is-mine' : '') + (pending ? ' is-pending' : '') + '" title="' + esc(title) + '">' +
      '<span class="scell__name">' + esc(a.activityName) + ' <span class="scell__time">' + esc(a.start) + '–' + esc(a.end) + '</span>' + (pending ? '<span class="scell__time">（待審）</span>' : '') + '</span>' +
      (badges ? '<span class="scell__badges">' + badges + '</span>' : '') +
      '</span>';
  }

  function specialAriaLabel(sc, day) {
    var parts = [dateWithWeekday(sc.date) + ' 特別活動'];
    var count = Number(sc.activityCount) || sc.activities.length;
    parts.push(count + ' 項活動' + (sc.activities.some(function (a) { return a.isMine; }) ? '，含我的活動' : ''));
    sc.activities.slice(0, 3).forEach(function (a) {
      parts.push(a.activityName + ' ' + a.start + '至' + a.end + (a.needsSpecialApproval ? '（需特別批准）' : '') + (a.afterHoursConfirm ? '（17:15 後自行保管）' : ''));
    });
    var warns = specialWarningTexts(sc);
    if (sc.bookable && warns.length) parts.push('此日期需要管理員特別批准：' + warns.join('；'));
    if (sc.bookable) parts.push('按 Enter 新增特別活動');
    else parts.push(day && day.isPast ? '日期已過' : '不可新增');
    return parts.join('；');
  }

  function renderSpecialCell(sc, day) {
    var warns = specialWarningTexts(sc);
    var mine = sc.activities.some(function (a) { return a.isMine; });
    var classes = ['scell'];
    if (sc.bookable && warns.length) classes.push('scell--warn');
    if (mine) classes.push('scell--mine');
    var shown = sc.activities.slice(0, 3);
    var count = Number(sc.activityCount) || shown.length;
    var more = Math.max(0, count - shown.length);

    var html = '<button type="button" class="' + classes.join(' ') + '" data-kind="special" data-date="' + esc(sc.date) + '"' +
      (sc.bookable ? '' : ' disabled') + ' aria-label="' + esc(specialAriaLabel(sc, day)) + '">';
    if (shown.length) {
      html += '<span class="scell__list" aria-hidden="true">' + shown.map(specialItemHtml).join('') + '</span>';
      if (more > 0) html += '<span class="scell__more" aria-hidden="true">另有 ' + more + ' 筆</span>';
    } else if (!sc.bookable && count > 0) {
      html += '<span class="scell__count" aria-hidden="true">' + count + ' 項活動（見借用紀錄）</span>';
    } else if (!sc.bookable) {
      html += '<span class="scell__empty" aria-hidden="true">' + (day && day.isPast ? '已過' : '不可新增') + '</span>';
    } else {
      html += '<span class="scell__empty" aria-hidden="true">尚無活動</span>';
    }
    if (sc.bookable && warns.length) {
      html += '<span class="scell__warn" aria-hidden="true">' + WARN_ICON + '<span>需特別批准：' + esc(warns.join('；')) + '</span></span>';
    }
    if (sc.bookable) html += '<span class="scell__add" aria-hidden="true">＋ 新增特別活動</span>';
    html += '</button>';
    return html;
  }

  function sundayCellHtml() {
    return '<div class="cell--sunday" role="note">星期日不設一般課堂預約</div>';
  }

  function dayHeadHtml(day) {
    var wd = weekdayZh(day.weekday || weekdayOf(day.date));
    var html = '<span class="day-head"><span>星期' + wd + '</span>' +
      '<span class="day-head__date">' + esc(formatDateShort(day.date)) + '</span>';
    if (day.isToday) html += '<span class="day-head__today">今天</span>';
    if (day.blockedAllDay) html += '<span class="day-head__blocked">全日封鎖' + (day.blockedReason ? '：' + esc(day.blockedReason) : '') + '</span>';
    html += '</span>';
    return html;
  }

  function getCell(week, date, slot, day) {
    var key = date + '|' + slot.slotId;
    var cell = week && week.cells ? week.cells[key] : null;
    if (cell) return cell;
    var wd = day ? day.weekday : weekdayOf(date);
    var applicable = !Array.isArray(slot.days) || !slot.days.length || slot.days.indexOf(wd) >= 0;
    return emptyCell(date, slot.slotId, applicable ? (day && day.isPast ? 'past' : 'notApplicable') : 'notApplicable');
  }

  /* ---------- 週表 ---------- */
  function renderWeek(container, ctx) {
    var week = ctx.week;
    var slots = ctx.slots || [];
    var settings = ctx.settings || {};
    var days = (week && week.days) ? week.days.slice(0, 7) : [];
    var rows = buildRows(slots);

    var html = '<div class="week-scroll"><table class="week-grid" aria-label="' + esc(formatDateLong(week.weekStart) + ' 至 ' + formatDateLong(week.weekEnd) + ' 共用時間表') + '">';
    html += '<colgroup><col class="col-slot">' + days.map(function () { return '<col>'; }).join('') + '</colgroup>';
    html += '<thead><tr><th scope="col" class="col-slot">時段</th>';
    days.forEach(function (day) {
      html += '<th scope="col"' + (day.isToday ? ' class="is-today"' : '') + '>' + dayHeadHtml(day) + '</th>';
    });
    html += '</tr></thead><tbody>';

    rows.forEach(function (row) {
      if (row.type === 'divider') {
        html += '<tr class="row-divider"><th scope="row">' + esc(row.label) + '<span class="slot-time">' + esc(row.start) + '–' + esc(row.end) + '</span></th>';
        html += '<td colspan="' + days.length + '">' + esc(row.label) + '（不可預約）</td></tr>';
        return;
      }
      var slot = row.slot;
      html += '<tr><th scope="row">' + esc(slot.label) + '<span class="slot-time">' + esc(slot.start) + '–' + esc(slot.end) + '</span></th>';
      days.forEach(function (day) {
        var wd = day.weekday || weekdayOf(day.date);
        if (wd === 'SUN') {
          html += '<td class="td-sunday">' + sundayCellHtml() + '</td>';
          return;
        }
        var cell = getCell(week, day.date, slot, day);
        html += '<td>' + renderCellButton(cell, day, slot, settings) + '</td>';
      });
      html += '</tr>';
    });
    html += '<tr class="row-special"><th scope="row">特別活動<span class="slot-time">自訂時間</span></th>';
    days.forEach(function (day) {
      html += '<td>' + renderSpecialCell(getSpecialCell(week, day.date, day), day) + '</td>';
    });
    html += '</tr>';
    html += '</tbody></table></div>';
    container.innerHTML = html;
    bindCellClicks(container, ctx);
  }

  /* ---------- 單日模式（手機） ---------- */
  function renderDay(container, ctx) {
    var week = ctx.week;
    var settings = ctx.settings || {};
    var date = ctx.date;
    var day = (week.days || []).filter(function (d) { return d.date === date; })[0] || { date: date, weekday: weekdayOf(date), isToday: false, isPast: false, blockedAllDay: false, blockedReason: null };
    var rows = buildRows(ctx.slots || [], day.weekday);

    var html = '<div class="day-list">';
    html += '<div class="day-list__head"><span>' + esc(formatDateLong(day.date)) + '（星期' + weekdayZh(day.weekday) + '）' + (day.isToday ? ' · 今天' : '') + '</span>';
    if (day.blockedAllDay) html += '<span class="day-list__head-sub">全日封鎖' + (day.blockedReason ? '：' + esc(day.blockedReason) : '') + '</span>';
    html += '</div>';

    var isSunday = day.weekday === 'SUN';
    if (isSunday) {
      html += '<div class="day-row day-row--sunday"><div class="day-row__label">一般課堂</div><div class="day-row__body">星期日不設一般課堂預約</div></div>';
      rows = [];
    } else if (!rows.length) {
      html += '<div class="state-box"><span class="state-box__title">此日沒有可用時段</span><p>所選日期沒有啟用的時段。</p></div>';
    }
    rows.forEach(function (row) {
      if (row.type === 'divider') {
        html += '<div class="day-row day-row--divider"><div class="day-row__label">' + esc(row.label) + '<span class="slot-time">' + esc(row.start) + '–' + esc(row.end) + '</span></div>' +
          '<div class="day-row__body">' + esc(row.label) + '（不可預約）</div></div>';
        return;
      }
      var slot = row.slot;
      var cell = getCell(week, day.date, slot, day);
      html += '<div class="day-row"><div class="day-row__label">' + esc(slot.label) + '<span class="slot-time">' + esc(slot.start) + '–' + esc(slot.end) + '</span></div>' +
        '<div class="day-row__body">' + renderCellButton(cell, day, slot, settings) + '</div></div>';
    });
    html += '<div class="day-row day-row--special"><div class="day-row__label">特別活動<span class="slot-time">自訂時間</span></div>' +
      '<div class="day-row__body">' + renderSpecialCell(getSpecialCell(week, day.date, day), day) + '</div></div>';
    html += '</div>';
    container.innerHTML = html;
    bindCellClicks(container, ctx);
  }

  function bindCellClicks(container, ctx) {
    if (typeof ctx.onCellClick !== 'function') return;
    container.querySelectorAll('button.scell').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var date = btn.getAttribute('data-date');
        var day = (ctx.week.days || []).filter(function (d) { return d.date === date; })[0] || null;
        ctx.onCellClick({ kind: 'special', date: date, slotId: null, cell: null, slot: null, day: day, special: getSpecialCell(ctx.week, date, day), button: btn });
      });
    });
    container.querySelectorAll('button.cell').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var date = btn.getAttribute('data-date');
        var slotId = btn.getAttribute('data-slot');
        var cell = ctx.week && ctx.week.cells ? ctx.week.cells[date + '|' + slotId] : null;
        var slot = (ctx.slots || []).filter(function (s) { return s.slotId === slotId; })[0] || null;
        var day = (ctx.week.days || []).filter(function (d) { return d.date === date; })[0] || null;
        ctx.onCellClick({ kind: 'regular', date: date, slotId: slotId, cell: cell, slot: slot, day: day, button: btn });
      });
    });
  }

  /* ---------- 骨架 ---------- */
  function renderSkeleton(container, mode) {
    var html = '';
    if (mode === 'day') {
      html += '<div class="week-skeleton week-skeleton--day" aria-hidden="true">';
      for (var r = 0; r < 6; r++) html += '<span class="skeleton"></span><span class="skeleton"></span>';
      html += '</div>';
    } else {
      html += '<div class="week-skeleton" aria-hidden="true">';
      for (var c = 0; c < 8; c++) html += '<span class="skeleton skeleton--head"></span>';
      for (var i = 0; i < 4; i++) for (var j = 0; j < 8; j++) html += '<span class="skeleton"></span>';
      html += '</div>';
    }
    html += '<p class="visually-hidden" role="status">正在載入時間表…</p>';
    container.innerHTML = html;
  }

  window.Calendar = {
    WEEKDAYS: WEEKDAYS,
    buildRows: buildRows,
    statusOf: statusOf,
    hasMine: hasMine,
    renderWeek: renderWeek,
    renderDay: renderDay,
    renderSkeleton: renderSkeleton,
    getSpecialCell: getSpecialCell,
    specialWarningTexts: specialWarningTexts,
    formatDateShort: formatDateShort,
    formatDateLong: formatDateLong,
    dateWithWeekday: dateWithWeekday,
    weekdayOf: weekdayOf,
    weekdayZh: weekdayZh,
    toMinutes: toMinutes,
    parseDate: parseDate,
    esc: esc,
    STATUS_TEXT: STATUS_TEXT
  };
})();
