#!/usr/bin/env node
/* =========================================================
   Mock API + 靜態伺服器（零相依，Node ≥ 18）
   - 依 docs/CONTRACT.md 在記憶體實作所有 action（含 §9 特別活動）
   - 庫存：區間尖峰法（§9.4）；週表 Cell 以區間重疊統計
   - 狀態機（§4）＋ 排程轉換（過期／逾時）於每次請求前執行
   - GET /dev-config.js → window.APP_CONFIG（AUTH_MODE:'mock'）
   - 靜態檔案：以 repo 根目錄為站台根；/ 轉向 /dev/mock.html
   用法：node dev/mock-server.js [port]   （預設 8787）
   身分：idToken = 'mock:teacher' | 'mock:admin' | 'mock:handler' | 'mock'
   ========================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8787;
const ROOT = path.resolve(__dirname, '..');
const TZ = 'Asia/Hong_Kong';
const AFTER_HOURS_TEXT = '本人明白須自行保管 iPad 及 Apple Pencil，並於下一個上課天交到圖書館給 Molly。';

const STATUS = {
  PENDING: '待審批', APPROVED: '已核准', REJECTED: '已拒絕', CANCELLED: '已取消',
  PICKED: '已領取', PARTIAL: '未完全歸還', RETURNED: '已歸還',
  OVERDUE_PICKUP: '逾時未領取', OVERDUE_RETURN: '逾時未歸還', EXPIRED: '已過期'
};
const APPROVED_LIKE = new Set([STATUS.APPROVED, STATUS.PICKED, STATUS.PARTIAL, STATUS.OVERDUE_PICKUP, STATUS.OVERDUE_RETURN]);
const PICKUP_FROM = new Set([STATUS.APPROVED, STATUS.OVERDUE_PICKUP]);
const RETURN_FROM = new Set([STATUS.PICKED, STATUS.PARTIAL, STATUS.OVERDUE_RETURN]);
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/* ---------- 時間工具（一律以香港時間計算） ---------- */
function hkParts(d) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const o = {};
  fmt.formatToParts(d).forEach(p => { o[p.type] = p.value; });
  return { y: o.year, m: o.month, d: o.day, H: o.hour === '24' ? '00' : o.hour, M: o.minute, S: o.second };
}
function nowTs() { const p = hkParts(new Date()); return `${p.y}-${p.m}-${p.d} ${p.H}:${p.M}:${p.S}`; }
function todayStr() { const p = hkParts(new Date()); return `${p.y}-${p.m}-${p.d}`; }
function nowHM() { const p = hkParts(new Date()); return `${p.H}:${p.M}`; }
function toMin(hm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN; }
function normTime(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(dateStr) { const d = new Date(dateStr + 'T00:00:00Z'); return WEEKDAYS[(d.getUTCDay() + 6) % 7]; }
function weekStartOf(dateStr) { const idx = WEEKDAYS.indexOf(weekdayOf(dateStr)); return addDays(dateStr, -idx); }
/** 日期＋HH:mm 換算為與現在比較用的分鐘數（相對 today） */
function dateTimeMinutes(dateStr, hm) {
  const dayDiff = Math.round((Date.parse(dateStr + 'T00:00:00Z') - Date.parse(todayStr() + 'T00:00:00Z')) / 86400000);
  return dayDiff * 1440 + toMin(hm);
}
function nowMinutes() { return toMin(nowHM()); }

/* ---------- 資料 ---------- */
const settings = {
  ipadTotal: 60, pencilTotal: 40, advanceDays: 30, cutoffHours: 0,
  classOptions: ['1A', '1B', '1C', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '5A', '5B', '6A', '6B'],
  subjectOptions: ['中文', '英文', '數學', '通識', '科學', '電腦', '視藝', '音樂', '體育', '佛學', '地理', '歷史', '經濟'],
  timezone: TZ, schoolYear: '2026-2027', schemaVersion: 3,
  overduePickupMinutes: 30, overdueReturnMinutes: 30,
  afterHoursTime: '17:15', specialEarliestStart: '07:00', specialLatestEnd: '22:00'
};
const SLOTS = [
  ['P01', '08:35', '09:10', '第 1 節', 1], ['P02', '09:10', '09:45', '第 2 節', 2], ['P03', '09:45', '10:20', '第 3 節', 3],
  ['P04', '10:35', '11:10', '第 4 節', 4], ['P05', '11:10', '11:45', '第 5 節', 5], ['P06', '12:00', '12:35', '第 6 節', 6],
  ['P07', '12:35', '13:10', '第 7 節', 7], ['P08', '14:25', '15:00', '第 8 節', 8], ['P09', '15:00', '15:35', '第 9 節', 9],
  ['AFTER', '15:35', '17:15', '放學時段', 10]
].map(r => ({ slotId: r[0], start: r[1], end: r[2], label: r[3], days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], order: r[4] }));
const slotById = Object.fromEntries(SLOTS.map(s => [s.slotId, s]));

const USERS = {
  teacher: { email: 'demo-teacher@blcwc.edu.hk', roles: ['teacher'], name: '陳老師' },
  admin: { email: 'demo-admin@blcwc.edu.hk', roles: ['teacher', 'admin'], name: '李主任' },
  handler: { email: 'demo-handler@blcwc.edu.hk', roles: ['teacher', 'handler'], name: 'Molly' }
};
const OTHER = [
  { email: 'demo-wong@blcwc.edu.hk', name: '黃老師' },
  { email: 'demo-lau@blcwc.edu.hk', name: '劉老師' },
  { email: 'demo-ho@blcwc.edu.hk', name: '何老師' },
  { email: 'demo-cheung@blcwc.edu.hk', name: '張老師' }
];

/** blocks: { date, slots: 'ALL' | string[], reason } */
const blocks = [];
/** applications: main rows; details: slot lines; handovers */
const applications = [];
const details = [];
const handovers = [];
let seq = 0;

function nextId() {
  const year = todayStr().slice(0, 4);
  seq += 1;
  return `BK-${year}-${String(seq).padStart(4, '0')}`;
}
function hoId() { return 'HO-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
function reqId() { return 'req_' + crypto.randomBytes(4).toString('hex'); }

/* ---------- 錯誤 ---------- */
class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}
const vErr = (field, message) => new ApiError('VALIDATION_ERROR', message, field ? { field } : null);

/* ---------- 封鎖 ---------- */
function blockForDay(date) { return blocks.find(b => b.date === date && b.slots === 'ALL') || null; }
function blockForSlot(date, slotId) {
  return blocks.find(b => b.date === date && (b.slots === 'ALL' || b.slots.includes(slotId))) || null;
}
/** 與 [start,end) 重疊的封鎖原因（全日或時段） */
function blockReasonForInterval(date, start, end) {
  const reasons = [];
  blocks.filter(b => b.date === date).forEach(b => {
    if (b.slots === 'ALL') { reasons.push(b.reason); return; }
    const hit = b.slots.some(id => { const s = slotById[id]; return s && toMin(s.start) < toMin(end) && toMin(s.end) > toMin(start); });
    if (hit) reasons.push(b.reason);
  });
  return Array.from(new Set(reasons)).join('、');
}

/* ---------- 庫存：區間尖峰法 ---------- */
function usageIntervals(date, excludeId) {
  const out = [];
  details.forEach(d => {
    if (d.date !== date || d.applicationId === excludeId) return;
    const app = applications.find(a => a.applicationId === d.applicationId);
    if (!app) return;
    const approved = APPROVED_LIKE.has(app.status);
    const pending = app.status === STATUS.PENDING;
    if (!approved && !pending) return;
    out.push({ start: toMin(d.start), end: toMin(d.end), ipad: d.ipad, pencil: d.pencil, approved, pending });
  });
  return out;
}
function peakUsage(date, start, end, excludeId) {
  const s = toMin(start), e = toMin(end);
  const list = usageIntervals(date, excludeId).filter(i => i.start < e && i.end > s);
  const points = Array.from(new Set([s, e].concat(list.flatMap(i => [i.start, i.end])).filter(p => p >= s && p <= e))).sort((a, b) => a - b);
  let ipad = 0, pencil = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const mid = (points[k] + points[k + 1]) / 2;
    let ip = 0, pc = 0;
    list.forEach(i => { if (i.start <= mid && i.end > mid) { ip += i.ipad; pc += i.pencil; } });
    ipad = Math.max(ipad, ip); pencil = Math.max(pencil, pc);
  }
  return { ipad, pencil };
}
function cellStats(date, slot) {
  const s = toMin(slot.start), e = toMin(slot.end);
  let ia = 0, ip = 0, pa = 0, pp = 0;
  usageIntervals(date, null).forEach(i => {
    if (i.start < e && i.end > s) {
      if (i.approved) { ia += i.ipad; pa += i.pencil; } else { ip += i.ipad; pp += i.pencil; }
    }
  });
  return {
    ipadApproved: ia, ipadPending: ip, ipadRemaining: Math.max(0, settings.ipadTotal - ia - ip),
    pencilApproved: pa, pencilPending: pp, pencilRemaining: Math.max(0, settings.pencilTotal - pa - pp)
  };
}
function checkStock(date, start, end, ipad, pencil, excludeId, label) {
  const peak = peakUsage(date, start, end, excludeId);
  const ipadLeft = settings.ipadTotal - peak.ipad;
  const pencilLeft = settings.pencilTotal - peak.pencil;
  if (ipad > ipadLeft) throw new ApiError('CONFLICT_INSUFFICIENT_STOCK', `${date} ${label} iPad 只剩 ${Math.max(0, ipadLeft)} 部，未能提供 ${ipad} 部，請調整數量或改選其他時段。`);
  if (pencil > pencilLeft) throw new ApiError('CONFLICT_INSUFFICIENT_STOCK', `${date} ${label} Apple Pencil 只剩 ${Math.max(0, pencilLeft)} 支，未能提供 ${pencil} 支，請調整數量或改選其他時段。`);
}

/* ---------- 申請物件輸出 ---------- */
function isSpecial(app) { return app.bookingType === '特別活動'; }
function firstLine(app) {
  return details.filter(d => d.applicationId === app.applicationId).sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start))[0] || null;
}
function lastLine(app) {
  return details.filter(d => d.applicationId === app.applicationId).sort((a, b) => b.date.localeCompare(a.date) || toMin(b.end) - toMin(a.end))[0] || null;
}
function toApplication(app, viewer) {
  const lines = details.filter(d => d.applicationId === app.applicationId).sort((a, b) => toMin(a.start) - toMin(b.start));
  const first = lines[0] || null;
  const isOwner = viewer && viewer.email === app.teacherEmail;
  const privileged = viewer && (viewer.roles.includes('admin') || viewer.roles.includes('handler'));
  const firstStart = first ? dateTimeMinutes(first.date, first.start) : NaN;
  const canCancel = !!isOwner && (app.status === STATUS.PENDING || app.status === STATUS.APPROVED) && isFinite(firstStart) && firstStart > nowMinutes();
  const special = isSpecial(app);
  const blockedReason = special && first ? blockReasonForInterval(first.date, first.start, first.end) : '';
  return {
    applicationId: app.applicationId,
    teacherEmail: (isOwner || privileged) ? app.teacherEmail : '',
    teacherName: app.teacherName, className: app.className, students: app.students, subject: app.subject,
    remark: app.remark, status: app.status, createdAt: app.createdAt, updatedAt: app.updatedAt,
    approvedBy: app.approvedBy || '', approvedAt: app.approvedAt || '',
    bookingType: app.bookingType, activityName: app.activityName || '', customStart: app.customStart || '', customEnd: app.customEnd || '',
    reason: app.reason || '', ipadOutstanding: app.ipadOutstanding, pencilOutstanding: app.pencilOutstanding, abnormalNote: app.abnormalNote || '',
    date: first ? first.date : '', ipad: app.ipad, pencil: app.pencil,
    afterHoursConfirm: !!app.afterHoursConfirm, needsSpecialApproval: !!app.needsSpecialApproval,
    specialApprovalReason: app.specialApprovalReason || '', isSunday: first ? weekdayOf(first.date) === 'SUN' : false, blockedReason,
    slots: lines.map(l => ({ date: l.date, slotId: l.slotId, label: l.slotId === 'ACT' ? '特別活動' : (slotById[l.slotId] || {}).label || l.slotId, start: l.start, end: l.end, ipad: l.ipad, pencil: l.pencil })),
    handovers: handovers.filter(h => h.applicationId === app.applicationId).map(h => ({ recordId: h.recordId, type: h.type, time: h.time, ipad: h.ipad, pencil: h.pencil, handler: h.handler, note: h.note })),
    canCancel
  };
}

/* ---------- 排程轉換 ---------- */
function processScheduled() {
  const now = nowMinutes();
  applications.forEach(app => {
    const first = firstLine(app), last = lastLine(app);
    if (!first) return;
    const startM = dateTimeMinutes(first.date, first.start);
    const endM = dateTimeMinutes(last.date, last.end);
    if (app.status === STATUS.PENDING && startM < now) { app.status = STATUS.EXPIRED; app.updatedAt = nowTs(); }
    else if (app.status === STATUS.APPROVED && startM + settings.overduePickupMinutes < now) { app.status = STATUS.OVERDUE_PICKUP; app.updatedAt = nowTs(); }
    else if ((app.status === STATUS.PICKED || app.status === STATUS.PARTIAL) && endM + settings.overdueReturnMinutes < now && (app.ipadOutstanding > 0 || app.pencilOutstanding > 0)) {
      app.status = STATUS.OVERDUE_RETURN; app.updatedAt = nowTs();
    }
  });
}

/* ---------- 週表 ---------- */
function bookingSummaries(date, slot, viewer) {
  const s = toMin(slot.start), e = toMin(slot.end);
  const list = [];
  details.forEach(d => {
    if (d.date !== date) return;
    if (!(toMin(d.start) < e && toMin(d.end) > s)) return;
    const app = applications.find(a => a.applicationId === d.applicationId);
    if (!app || !(APPROVED_LIKE.has(app.status) || app.status === STATUS.PENDING)) return;
    list.push({ applicationId: app.applicationId, teacherName: app.teacherName, className: app.className, subject: app.subject, ipad: d.ipad, pencil: d.pencil, status: app.status, isMine: app.teacherEmail === viewer.email, _created: app.createdAt });
  });
  list.sort((a, b) => a._created.localeCompare(b._created));
  return list.map(({ _created, ...rest }) => rest);
}
function buildWeek(dateStr, viewer) {
  const today = todayStr();
  const weekStart = weekStartOf(dateStr);
  const weekEnd = addDays(weekStart, 6);
  const maxDate = addDays(today, settings.advanceDays);
  const now = nowMinutes();
  const days = [], cells = {}, special = {};
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const wd = WEEKDAYS[i];
    const dayBlock = blockForDay(date);
    const isPast = date < today;
    const day = { date, weekday: wd, isToday: date === today, isPast, blockedAllDay: !!dayBlock, blockedReason: dayBlock ? dayBlock.reason : null };
    days.push(day);
    if (wd !== 'SUN') {
      SLOTS.forEach(slot => {
        if (!slot.days.includes(wd)) return;
        const stats = cellStats(date, slot);
        let bookable = true, reason = null, blockedReason = null;
        const startM = dateTimeMinutes(date, slot.start);
        const blk = blockForSlot(date, slot.slotId);
        if (isPast || startM <= now + settings.cutoffHours * 60) { bookable = false; reason = isPast ? 'past' : (startM <= now ? 'past' : 'cutoff'); }
        else if (date > maxDate) { bookable = false; reason = 'beyondAdvance'; }
        else if (blk) { bookable = false; reason = 'blocked'; blockedReason = blk.reason; }
        const all = bookingSummaries(date, slot, viewer);
        cells[`${date}|${slot.slotId}`] = Object.assign({ date, slotId: slot.slotId }, stats, {
          bookable, unbookableReason: reason, blockedReason, bookings: all.slice(0, 3), bookingCount: all.length
        });
      });
    }
    // SpecialCell
    const acts = [];
    applications.forEach(app => {
      if (!isSpecial(app)) return;
      const first = firstLine(app);
      if (!first || first.date !== date) return;
      if (!(APPROVED_LIKE.has(app.status) || app.status === STATUS.PENDING)) return;
      acts.push({ applicationId: app.applicationId, activityName: app.activityName, start: app.customStart, end: app.customEnd, teacherName: app.teacherName, className: app.className, ipad: app.ipad, pencil: app.pencil, status: app.status, needsSpecialApproval: !!app.needsSpecialApproval, afterHoursConfirm: !!app.afterHoursConfirm, isMine: app.teacherEmail === viewer.email, _s: toMin(app.customStart) });
    });
    acts.sort((a, b) => a._s - b._s);
    const warnings = [];
    if (wd === 'SUN') warnings.push('sunday');
    if (dayBlock) warnings.push('blocked');
    special[date] = {
      date, activities: isPast ? [] : acts.slice(0, 3).map(({ _s, ...r }) => r), activityCount: acts.length,
      bookable: !isPast && date <= maxDate, isSunday: wd === 'SUN', blockedReason: dayBlock ? dayBlock.reason : null, warnings
    };
  }
  return { weekStart, weekEnd, days, cells, special };
}

/* ---------- 驗證輔助 ---------- */
function reqStr(v, field, min, max, label) {
  if (typeof v !== 'string') throw vErr(field, `請輸入${label}。`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw vErr(field, `${label}須為 ${min} 至 ${max} 字。`);
  return t;
}
function reqInt(v, field, min, max, label) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw vErr(field, `${label}須為 ${min} 至 ${max} 的整數。`);
  return v;
}
function checkDateRange(date) {
  if (!isDateStr(date)) throw vErr('date', '日期格式不正確。');
  const today = todayStr();
  if (date < today) throw vErr('date', '日期不可早於今天。');
  if (date > addDays(today, settings.advanceDays)) throw vErr('date', `只可預約 ${settings.advanceDays} 天內的日期。`);
}
function findApp(id) {
  if (typeof id !== 'string' || !id) throw vErr('applicationId', '缺少預約編號。');
  const app = applications.find(a => a.applicationId === id);
  if (!app) throw new ApiError('NOT_FOUND', `找不到申請 ${id}。`);
  return app;
}
function requireRole(user, role) {
  if (!user.roles.includes(role)) throw new ApiError('FORBIDDEN_ROLE', '你沒有執行此操作的權限。');
}

/* ---------- Actions ---------- */
const actions = {
  whoami(user) { return { user: userOut(user) }; },

  bootstrap(user, payload) {
    const date = isDateStr(payload.date) ? payload.date : todayStr();
    return { user: userOut(user), settings, slots: SLOTS, week: buildWeek(date, user), today: todayStr(), serverNow: nowTs() };
  },

  getWeekData(user, payload) {
    if (!isDateStr(payload.date)) throw vErr('date', '日期格式不正確。');
    return { week: buildWeek(payload.date, user) };
  },

  getMyApplications(user) {
    return { applications: applications.filter(a => a.teacherEmail === user.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(a => toApplication(a, user)) };
  },

  submitApplication(user, p) {
    checkDateRange(p.date);
    const wd = weekdayOf(p.date);
    if (!Array.isArray(p.slotIds) || !p.slotIds.length) throw vErr('slotIds', '請至少選擇一個時段。');
    const slots = p.slotIds.map(id => {
      const s = slotById[id];
      if (!s) throw vErr('slotIds', `時段 ${id} 不存在。`);
      if (!s.days.includes(wd)) throw vErr('slotIds', `時段 ${s.label} 不適用於該日。`);
      return s;
    }).sort((a, b) => a.order - b.order);
    for (let i = 1; i < slots.length; i++) if (slots[i].order - slots[i - 1].order !== 1) throw vErr('slotIds', '所選時段必須連續。');
    const now = nowMinutes();
    slots.forEach(s => { if (dateTimeMinutes(p.date, s.start) <= now + settings.cutoffHours * 60) throw new ApiError('SLOT_PAST', `${p.date} ${s.label} 已過或已超過申請截止時間。`); });
    if (blockForDay(p.date)) throw new ApiError('SLOT_BLOCKED', `${p.date} 全日封鎖：${blockForDay(p.date).reason}。`);
    slots.forEach(s => { const b = blockForSlot(p.date, s.slotId); if (b) throw new ApiError('SLOT_BLOCKED', `${p.date} ${s.label} 已封鎖：${b.reason}。`); });
    const teacherName = reqStr(p.teacherName, 'teacherName', 1, 50, '教師姓名');
    const className = reqStr(p.className, 'className', 1, 20, '班別');
    const subject = reqStr(p.subject, 'subject', 1, 50, '科目');
    const remark = typeof p.remark === 'string' ? p.remark : '';
    if (remark.length > 500) throw vErr('remark', '備註不可超過 500 字。');
    const students = reqInt(p.students, 'students', 1, 60, '學生人數');
    const ipad = reqInt(p.ipad, 'ipad', 1, settings.ipadTotal, 'iPad 數量');
    const pencil = reqInt(p.pencil, 'pencil', 0, settings.pencilTotal, 'Apple Pencil 數量');
    if (pencil > ipad) throw vErr('pencil', 'Pencil 數量不可多於 iPad 數量。');
    slots.forEach(s => checkStock(p.date, s.start, s.end, ipad, pencil, null, s.label));
    const id = nextId();
    const ts = nowTs();
    slots.forEach(s => details.push({ applicationId: id, date: p.date, slotId: s.slotId, start: s.start, end: s.end, ipad, pencil }));
    const app = { applicationId: id, teacherEmail: user.email, teacherName, className, students, subject, remark, status: STATUS.PENDING, createdAt: ts, updatedAt: ts, approvedBy: '', approvedAt: '', bookingType: '一般課堂', activityName: '', customStart: '', customEnd: '', afterHoursConfirm: false, needsSpecialApproval: false, specialApprovalReason: '', reason: '', ipadOutstanding: 0, pencilOutstanding: 0, abnormalNote: '', ipad, pencil };
    applications.push(app);
    return { application: toApplication(app, user) };
  },

  submitSpecialActivity(user, p) {
    checkDateRange(p.date);
    const start = normTime(p.customStart), end = normTime(p.customEnd);
    if (!start) throw vErr('customStart', '開始時間格式不正確。');
    if (!end) throw vErr('customEnd', '結束時間格式不正確。');
    if (toMin(start) >= toMin(end)) throw vErr('customEnd', '結束時間必須遲於開始時間。');
    if (toMin(start) < toMin(settings.specialEarliestStart)) throw vErr('customStart', `開始時間不可早於 ${settings.specialEarliestStart}。`);
    if (toMin(end) > toMin(settings.specialLatestEnd)) throw vErr('customEnd', `結束時間不可遲於 ${settings.specialLatestEnd}。`);
    if (dateTimeMinutes(p.date, start) <= nowMinutes() + settings.cutoffHours * 60) throw new ApiError('SLOT_PAST', `${p.date} ${start} 已過或已超過申請截止時間。`);
    const activityName = reqStr(p.activityName, 'activityName', 1, 100, '活動名稱');
    const teacherName = reqStr(p.teacherName, 'teacherName', 1, 50, '負責教師');
    const className = reqStr(p.className, 'className', 1, 50, '參與班別／組別');
    const students = reqInt(p.students, 'students', 1, 200, '學生人數');
    const remark = typeof p.remark === 'string' ? p.remark : '';
    if (remark.length > 500) throw vErr('remark', '活動備註不可超過 500 字。');
    const ipad = reqInt(p.ipad, 'ipad', 1, settings.ipadTotal, 'iPad 數量');
    const pencil = reqInt(p.pencil, 'pencil', 0, settings.pencilTotal, 'Apple Pencil 數量');
    if (pencil > ipad) throw vErr('pencil', 'Pencil 數量不可多於 iPad 數量。');
    let afterHoursConfirm = false;
    if (toMin(end) > toMin(settings.afterHoursTime)) {
      if (p.afterHoursConfirm !== true) throw vErr('afterHoursConfirm', `活動結束時間遲於 ${settings.afterHoursTime}，必須確認自行保管：${AFTER_HOURS_TEXT}`);
      if (!remark.trim()) throw vErr('remark', `活動結束時間遲於 ${settings.afterHoursTime}，請於備註說明保管安排。`);
      afterHoursConfirm = true;
    }
    const reasons = [];
    if (weekdayOf(p.date) === 'SUN') reasons.push('星期日');
    const br = blockReasonForInterval(p.date, start, end);
    if (br) reasons.push('封鎖日期：' + br);
    checkStock(p.date, start, end, ipad, pencil, null, `${start}–${end}`);
    const id = nextId();
    const ts = nowTs();
    details.push({ applicationId: id, date: p.date, slotId: 'ACT', start, end, ipad, pencil });
    const app = { applicationId: id, teacherEmail: user.email, teacherName, className, students, subject: '特別活動', remark, status: STATUS.PENDING, createdAt: ts, updatedAt: ts, approvedBy: '', approvedAt: '', bookingType: '特別活動', activityName, customStart: start, customEnd: end, afterHoursConfirm, needsSpecialApproval: reasons.length > 0, specialApprovalReason: reasons.join('；'), reason: '', ipadOutstanding: 0, pencilOutstanding: 0, abnormalNote: '', ipad, pencil };
    applications.push(app);
    return { application: toApplication(app, user) };
  },

  cancelMyApplication(user, p) {
    const app = findApp(p.applicationId);
    if (app.teacherEmail !== user.email) throw new ApiError('FORBIDDEN_ROLE', '只可取消自己的申請。');
    if (app.status !== STATUS.PENDING && app.status !== STATUS.APPROVED) throw new ApiError('INVALID_STATE_TRANSITION', `申請目前狀態為「${app.status}」，不能取消。`);
    const first = firstLine(app);
    if (first && dateTimeMinutes(first.date, first.start) <= nowMinutes()) throw new ApiError('INVALID_STATE_TRANSITION', '第一個時段已開始，不能取消。');
    if (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 200)) throw vErr('reason', '原因不可超過 200 字。');
    app.status = STATUS.CANCELLED; app.reason = (p.reason || '').trim(); app.updatedAt = nowTs();
    return { application: toApplication(app, user) };
  },

  getPendingApplications(user) {
    requireRole(user, 'admin');
    const list = applications.filter(a => a.status === STATUS.PENDING).map(a => toApplication(a, user));
    list.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.slots[0].start) - toMin(b.slots[0].start));
    return { applications: list };
  },

  approveApplication(user, p) {
    requireRole(user, 'admin');
    const app = findApp(p.applicationId);
    if (app.status !== STATUS.PENDING) throw new ApiError('INVALID_STATE_TRANSITION', `申請目前狀態為「${app.status}」，不能核准。`);
    if (app.needsSpecialApproval && p.confirmSpecial !== true) throw vErr('confirmSpecial', `此申請需要特別批准（${app.specialApprovalReason}），請於確認對話框再次確認。`);
    const lines = details.filter(d => d.applicationId === app.applicationId);
    lines.forEach(l => checkStock(l.date, l.start, l.end, l.ipad, l.pencil, app.applicationId, l.slotId === 'ACT' ? `${l.start}–${l.end}` : slotById[l.slotId].label));
    app.status = STATUS.APPROVED; app.approvedBy = user.email; app.approvedAt = nowTs(); app.updatedAt = app.approvedAt;
    app.ipadOutstanding = 0; app.pencilOutstanding = 0;
    return { application: toApplication(app, user) };
  },

  rejectApplication(user, p) {
    requireRole(user, 'admin');
    const app = findApp(p.applicationId);
    const reason = reqStr(p.reason, 'reason', 1, 200, '拒絕原因');
    if (app.status !== STATUS.PENDING) throw new ApiError('INVALID_STATE_TRANSITION', `申請目前狀態為「${app.status}」，不能拒絕。`);
    app.status = STATUS.REJECTED; app.reason = reason; app.approvedBy = user.email; app.approvedAt = nowTs(); app.updatedAt = app.approvedAt;
    return { application: toApplication(app, user) };
  },

  getApprovedForHandover(user, p) {
    requireRole(user, 'handler');
    const date = isDateStr(p.date) ? p.date : todayStr();
    const list = applications.filter(a => {
      if (a.status === STATUS.PARTIAL || a.status === STATUS.OVERDUE_RETURN) return true;
      if (!APPROVED_LIKE.has(a.status)) return false;
      return details.some(d => d.applicationId === a.applicationId && d.date === date);
    }).map(a => toApplication(a, user));
    list.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.slots[0].start) - toMin(b.slots[0].start));
    return { applications: list };
  },

  recordPickup(user, p) {
    requireRole(user, 'handler');
    const app = findApp(p.applicationId);
    if (!PICKUP_FROM.has(app.status)) throw new ApiError('INVALID_STATE_TRANSITION', `申請目前狀態為「${app.status}」，不能登記領取。`);
    const ipad = reqInt(p.ipad, 'ipad', 0, app.ipad, 'iPad 領取數量');
    const pencil = reqInt(p.pencil, 'pencil', 0, app.pencil, 'Pencil 領取數量');
    const note = typeof p.note === 'string' ? p.note.trim() : '';
    if (note.length > 500) throw vErr('note', '備註不可超過 500 字。');
    if ((ipad < app.ipad || pencil < app.pencil) && !note) throw vErr('note', '實際領取數量少於申請數量時，請填寫備註說明。');
    if (ipad === 0 && pencil === 0) throw vErr('ipad', '領取數量不可全為 0。');
    const ts = nowTs();
    handovers.push({ recordId: hoId(), applicationId: app.applicationId, type: '領取', time: ts, ipad, pencil, handler: user.email, note });
    app.status = STATUS.PICKED; app.ipadOutstanding = ipad; app.pencilOutstanding = pencil; app.updatedAt = ts;
    if (note) app.abnormalNote = note;
    return { application: toApplication(app, user) };
  },

  recordReturn(user, p) {
    requireRole(user, 'handler');
    const app = findApp(p.applicationId);
    if (!RETURN_FROM.has(app.status)) throw new ApiError('INVALID_STATE_TRANSITION', `申請目前狀態為「${app.status}」，不能登記歸還。`);
    const ipad = reqInt(p.ipad, 'ipad', 0, app.ipadOutstanding, 'iPad 歸還數量');
    const pencil = reqInt(p.pencil, 'pencil', 0, app.pencilOutstanding, 'Pencil 歸還數量');
    const note = typeof p.note === 'string' ? p.note.trim() : '';
    if (note.length > 500) throw vErr('note', '備註不可超過 500 字。');
    if (ipad === 0 && pencil === 0) throw vErr('ipad', '歸還數量不可全為 0。');
    app.ipadOutstanding -= ipad; app.pencilOutstanding -= pencil;
    const complete = app.ipadOutstanding === 0 && app.pencilOutstanding === 0;
    const ts = nowTs();
    handovers.push({ recordId: hoId(), applicationId: app.applicationId, type: complete ? '完全歸還' : '部分歸還', time: ts, ipad, pencil, handler: user.email, note });
    app.status = complete ? STATUS.RETURNED : STATUS.PARTIAL; app.updatedAt = ts;
    if (note) app.abnormalNote = note;
    return { application: toApplication(app, user) };
  },

  searchApplications(user, p) {
    if (!user.roles.includes('admin') && !user.roles.includes('handler')) throw new ApiError('FORBIDDEN_ROLE', '你沒有執行此操作的權限。');
    if (p.from !== undefined && !isDateStr(p.from)) throw vErr('from', '日期格式不正確。');
    if (p.to !== undefined && !isDateStr(p.to)) throw vErr('to', '日期格式不正確。');
    if (p.bookingType !== undefined && !['一般課堂', '特別活動'].includes(p.bookingType)) throw vErr('bookingType', '預約類型不正確。');
    if (p.status !== undefined && !Object.values(STATUS).includes(p.status)) throw vErr('status', '狀態不正確。');
    const q = typeof p.query === 'string' ? p.query.trim().toLowerCase() : '';
    const list = applications.map(a => toApplication(a, user)).filter(a => {
      if (p.from && a.date < p.from) return false;
      if (p.to && a.date > p.to) return false;
      if (p.bookingType && a.bookingType !== p.bookingType) return false;
      if (p.status && a.status !== p.status) return false;
      if (q) {
        const hay = [a.applicationId, a.teacherName, a.className, a.activityName].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return { applications: list.slice(0, 200) };
  }
};

function userOut(user) {
  const mine = applications.filter(a => a.teacherEmail === user.email).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return { email: user.email, roles: user.roles, displayName: mine ? mine.teacherName : user.name || user.email.split('@')[0] };
}

/* ---------- 身分 ---------- */
function resolveUser(token) {
  if (typeof token !== 'string' || !token) throw new ApiError('AUTH_REQUIRED', '請先登入。');
  if (token === 'mock') return USERS.teacher;
  const m = /^mock:(teacher|admin|handler)$/.exec(token);
  if (m) return USERS[m[1]];
  if (token === 'mock:expired') throw new ApiError('TOKEN_EXPIRED', '登入已過期，請重新登入。');
  throw new ApiError('INVALID_TOKEN', '登入憑證無效，請重新登入。');
}

/* ---------- 種子資料 ---------- */
function seedApp(fields, lines) {
  const id = nextId();
  const ts = fields.createdAt || nowTs();
  const app = Object.assign({
    applicationId: id, teacherEmail: '', teacherName: '', className: '', students: 30, subject: '', remark: '',
    status: STATUS.PENDING, createdAt: ts, updatedAt: ts, approvedBy: '', approvedAt: '',
    bookingType: '一般課堂', activityName: '', customStart: '', customEnd: '', afterHoursConfirm: false,
    needsSpecialApproval: false, specialApprovalReason: '', reason: '', ipadOutstanding: 0, pencilOutstanding: 0, abnormalNote: '', ipad: 20, pencil: 0
  }, fields, { applicationId: id });
  if (APPROVED_LIKE.has(app.status) && !app.approvedBy) { app.approvedBy = USERS.admin.email; app.approvedAt = ts; }
  applications.push(app);
  lines.forEach(l => details.push({ applicationId: id, date: l.date, slotId: l.slotId, start: l.start, end: l.end, ipad: app.ipad, pencil: app.pencil }));
  return app;
}
function regular(fields, date, slotIds) {
  return seedApp(fields, slotIds.map(id => ({ date, slotId: id, start: slotById[id].start, end: slotById[id].end })));
}
function special(fields, date, start, end) {
  const reasons = [];
  if (weekdayOf(date) === 'SUN') reasons.push('星期日');
  const br = blockReasonForInterval(date, start, end);
  if (br) reasons.push('封鎖日期：' + br);
  return seedApp(Object.assign({ bookingType: '特別活動', subject: '特別活動', customStart: start, customEnd: end, afterHoursConfirm: toMin(end) > toMin(settings.afterHoursTime), needsSpecialApproval: reasons.length > 0, specialApprovalReason: reasons.join('；') }, fields), [{ date, slotId: 'ACT', start, end }]);
}
function futureDay(offset, avoidSunday) {
  let d = addDays(todayStr(), offset);
  if (avoidSunday && weekdayOf(d) === 'SUN') d = addDays(d, 1);
  return d;
}
function pastDay(offset) {
  let d = addDays(todayStr(), -offset);
  if (weekdayOf(d) === 'SUN') d = addDays(d, -1);
  return d;
}
function nextSunday() {
  let d = addDays(todayStr(), 1);
  while (weekdayOf(d) !== 'SUN') d = addDays(d, 1);
  return d;
}
function seed() {
  const today = todayStr();
  const T = USERS.teacher, H = USERS.handler;
  const d1 = futureDay(1, true), d2 = futureDay(2, true), d3 = futureDay(3, true), d4 = futureDay(4, true);
  const sun = nextSunday();
  const blockedDay = futureDay(8, true);
  const yesterday = addDays(today, -1);
  const ts = (date, hm) => `${date} ${hm}:00`;

  blocks.push({ date: blockedDay, slots: 'ALL', reason: '校慶' });
  blocks.push({ date: d3, slots: ['P01', 'P02'], reason: '早會' });

  // 我的申請（teacher）
  regular({ teacherEmail: T.email, teacherName: T.name, className: '3A', subject: '中文', students: 32, ipad: 30, pencil: 10, remark: '需要 Pages 及 Keynote', status: STATUS.APPROVED, createdAt: ts(addDays(today, -3), '09:12') }, d1, ['P03', 'P04']);
  regular({ teacherEmail: T.email, teacherName: T.name, className: '2B', subject: '科學', students: 28, ipad: 28, pencil: 0, createdAt: ts(addDays(today, -1), '16:40') }, d2, ['P06']);
  regular({ teacherEmail: T.email, teacherName: T.name, className: '4A', subject: '視藝', students: 25, ipad: 25, pencil: 25, status: STATUS.RETURNED, createdAt: ts(addDays(today, -9), '10:05') }, pastDay(2), ['P08', 'P09']);
  regular({ teacherEmail: T.email, teacherName: T.name, className: '1C', subject: '數學', students: 30, ipad: 30, pencil: 0, status: STATUS.REJECTED, reason: '當日全級測驗，設備室暫停借用。', createdAt: ts(addDays(today, -5), '14:22') }, futureDay(6, true), ['P02']);
  const mineSpecial = special({ teacherEmail: T.email, teacherName: T.name, className: '學生會', students: 45, ipad: 40, pencil: 20, remark: '活動後由學生會老師鎖於 3 樓儲物室，翌日上課天交回圖書館。', createdAt: ts(addDays(today, -2), '11:30') }, d2, '14:00', '18:30');
  mineSpecial.activityName = '領袖訓練';

  // 其他教師：填滿格子、產生「另有 N 筆」及緊張／借滿
  regular({ teacherEmail: OTHER[0].email, teacherName: OTHER[0].name, className: '5A', subject: '通識', students: 30, ipad: 12, pencil: 0, status: STATUS.APPROVED, createdAt: ts(addDays(today, -4), '08:50') }, d1, ['P03']);
  regular({ teacherEmail: OTHER[1].email, teacherName: OTHER[1].name, className: '6B', subject: '經濟', students: 20, ipad: 8, pencil: 0, status: STATUS.APPROVED, createdAt: ts(addDays(today, -4), '09:30') }, d1, ['P03']);
  regular({ teacherEmail: OTHER[2].email, teacherName: OTHER[2].name, className: '2A', subject: '電腦', students: 30, ipad: 6, pencil: 6, createdAt: ts(addDays(today, -1), '12:00') }, d1, ['P03']);
  regular({ teacherEmail: OTHER[3].email, teacherName: OTHER[3].name, className: '1A', subject: '英文', students: 30, ipad: 4, pencil: 0, createdAt: ts(today, '08:10') }, d1, ['P03']);
  regular({ teacherEmail: OTHER[0].email, teacherName: OTHER[0].name, className: '5B', subject: '地理', students: 30, ipad: 60, pencil: 0, status: STATUS.APPROVED, createdAt: ts(addDays(today, -6), '15:00') }, d1, ['P07']);
  regular({ teacherEmail: OTHER[1].email, teacherName: OTHER[1].name, className: '3C', subject: '歷史', students: 30, ipad: 30, pencil: 30, status: STATUS.APPROVED, createdAt: ts(addDays(today, -6), '15:20') }, d2, ['P08', 'P09']);
  regular({ teacherEmail: OTHER[2].email, teacherName: OTHER[2].name, className: '4B', subject: '音樂', students: 28, ipad: 28, pencil: 0, createdAt: ts(addDays(today, -1), '17:45') }, d4, ['P04', 'P05']);
  regular({ teacherEmail: OTHER[3].email, teacherName: OTHER[3].name, className: '6A', subject: '佛學', students: 24, ipad: 24, pencil: 12, createdAt: ts(today, '09:05') }, futureDay(9, true), ['P01']);

  // 其他教師的特別活動
  const s2 = special({ teacherEmail: OTHER[0].email, teacherName: OTHER[0].name, className: '校隊', students: 60, ipad: 20, pencil: 0, remark: '', status: STATUS.APPROVED, createdAt: ts(addDays(today, -7), '10:00') }, d4, '08:00', '12:30');
  s2.activityName = '校際科學比賽';
  const s3 = special({ teacherEmail: OTHER[1].email, teacherName: OTHER[1].name, className: '家教會', students: 80, ipad: 30, pencil: 10, remark: '', createdAt: ts(addDays(today, -1), '20:15') }, sun, '09:00', '12:00');
  s3.activityName = '開放日';
  const s4 = special({ teacherEmail: OTHER[2].email, teacherName: OTHER[2].name, className: '戲劇組', students: 35, ipad: 15, pencil: 15, remark: '演出後由戲劇組老師保管，翌日交回圖書館。', createdAt: ts(today, '07:55') }, blockedDay, '13:00', '19:00');
  s4.activityName = '校慶表演';
  const s5 = special({ teacherEmail: OTHER[3].email, teacherName: OTHER[3].name, className: '4A', students: 30, ipad: 10, pencil: 0, remark: '', createdAt: ts(today, '08:30') }, d2, '10:00', '11:00');
  s5.activityName = 'STEM 工作坊';
  const s6 = special({ teacherEmail: OTHER[0].email, teacherName: OTHER[0].name, className: '合唱團', students: 40, ipad: 10, pencil: 0, remark: '', createdAt: ts(today, '08:40') }, d2, '16:00', '17:00');
  s6.activityName = '合唱團練習';
  const s7 = special({ teacherEmail: OTHER[3].email, teacherName: OTHER[3].name, className: '2C', students: 30, ipad: 5, pencil: 5, remark: '', createdAt: ts(today, '08:45') }, d2, '07:30', '08:30');
  s7.activityName = '早讀計劃';

  // 交收（handler）：今天已核准、昨天未完全歸還
  const todayLate = SLOTS.filter(s => dateTimeMinutes(today, s.start) > nowMinutes() && weekdayOf(today) !== 'SUN');
  const pickupSlot = todayLate.length ? todayLate[Math.max(0, todayLate.length - 2)] : null;
  if (pickupSlot) {
    regular({ teacherEmail: OTHER[2].email, teacherName: OTHER[2].name, className: '3B', subject: '電腦', students: 30, ipad: 30, pencil: 15, status: STATUS.APPROVED, createdAt: ts(addDays(today, -2), '13:15') }, today, [pickupSlot.slotId]);
  }
  const partial = regular({ teacherEmail: OTHER[1].email, teacherName: OTHER[1].name, className: '5A', subject: '通識', students: 30, ipad: 30, pencil: 10, status: STATUS.PARTIAL, ipadOutstanding: 2, pencilOutstanding: 0, abnormalNote: '2 部 iPad 遺留於課室，翌日交回', createdAt: ts(addDays(today, -3), '09:00') }, yesterday, ['P05', 'P06']);
  handovers.push({ recordId: hoId(), applicationId: partial.applicationId, type: '領取', time: ts(yesterday, '11:05'), ipad: 30, pencil: 10, handler: H.email, note: '' });
  handovers.push({ recordId: hoId(), applicationId: partial.applicationId, type: '部分歸還', time: ts(yesterday, '12:40'), ipad: 28, pencil: 10, handler: H.email, note: '2 部 iPad 遺留於課室，翌日交回' });
  const picked = special({ teacherEmail: OTHER[0].email, teacherName: OTHER[0].name, className: '學生會', students: 40, ipad: 20, pencil: 0, remark: '大會後由學生會老師保管，翌日交回。', status: STATUS.PICKED, ipadOutstanding: 20, pencilOutstanding: 0, createdAt: ts(addDays(today, -4), '10:10') }, today, '07:30', '18:00');
  picked.activityName = '學生會周年大會';
  handovers.push({ recordId: hoId(), applicationId: picked.applicationId, type: '領取', time: ts(today, '07:20'), ipad: 20, pencil: 0, handler: H.email, note: '' });
}
seed();

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function envelope(ok, data, error) {
  return JSON.stringify({ ok, data: ok ? data : null, error: ok ? null : error, requestId: reqId(), serverTime: new Date().toISOString() });
}
function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function handleApi(req, res, body) {
  let parsed;
  try { parsed = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, envelope(false, null, { code: 'VALIDATION_ERROR', message: '請求格式不正確。', details: null })); }
  const action = parsed.action;
  try {
    if (typeof action !== 'string' || !actions[action]) throw new ApiError('UNKNOWN_ACTION', `未知的動作：${action}`);
    const user = resolveUser(parsed.idToken);
    processScheduled();
    const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
    const data = actions[action](user, payload);
    console.log(`[api] ${action} ${user.email} ok`);
    sendJson(res, envelope(true, data, null));
  } catch (e) {
    if (e instanceof ApiError) {
      console.log(`[api] ${action} -> ${e.code}: ${e.message}`);
      return sendJson(res, envelope(false, null, { code: e.code, message: e.message, details: e.details }));
    }
    console.error(e);
    sendJson(res, envelope(false, null, { code: 'INTERNAL_ERROR', message: '系統發生未預期錯誤，請稍後再試。', details: null }));
  }
}

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/') { res.writeHead(302, { Location: '/dev/mock.html' }); return res.end(); }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || file.includes(path.sep + '.git' + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
  if (url.split('?')[0] === '/dev-config.js') {
    const cfg = {
      API_URL: '/api', GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com', ALLOWED_DOMAIN: 'blcwc.edu.hk',
      SCHOOL_NAME: '香港正覺蓮社佛教梁植偉中學', APP_TITLE: 'iPad 預約及借還系統（測試模式）', REQUEST_TIMEOUT_MS: 20000, WEEK_CACHE_TTL_MS: 60000, AUTH_MODE: 'mock'
    };
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('// 由 dev/mock-server.js 產生，僅供本機測試\nwindow.APP_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
  }
  if (url.split('?')[0] === '/api') {
    if (req.method === 'GET') {
      const q = new URL(url, 'http://localhost').searchParams;
      if (q.get('action') === 'health') return sendJson(res, envelope(true, { status: 'ok', schemaVersion: 3, version: 'mock-1.0.0' }, null));
      return sendJson(res, envelope(false, null, { code: 'METHOD_NOT_ALLOWED', message: '請使用 POST。', details: null }));
    }
    if (req.method !== 'POST') return sendJson(res, envelope(false, null, { code: 'METHOD_NOT_ALLOWED', message: '請使用 POST。', details: null }));
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => handleApi(req, res, body));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock server: http://127.0.0.1:${PORT}/dev/mock.html  (API: /api, config: /dev-config.js)`);
  console.log(`今天（${TZ}）：${todayStr()} ${nowHM()}；種子申請 ${applications.length} 筆`);
});
