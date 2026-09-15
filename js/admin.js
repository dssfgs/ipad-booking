/* =========================================================
   Admin — 審批中心（admin）與領取／歸還（handler）
   ========================================================= */
(function () {
  'use strict';

  var esc = function (s) { return window.Calendar.esc(s); };
  function el(id) { return document.getElementById(id); }

  /* ========== 審批中心 ========== */
  var pendingApps = [];
  var rejectBound = false;
  var rejectTarget = null;

  function renderApprove(list, apps) {
    var count = el('approve-count');
    if (count) {
      count.hidden = !apps.length;
      count.textContent = '待審 ' + apps.length + ' 筆';
    }
    if (!apps.length) {
      window.App.ui.renderEmpty(list, {
        title: '目前沒有待審批的申請',
        text: '新的申請提交後會即時顯示在這裡。',
        actionText: '重新載入',
        onAction: loadApprove
      });
      return;
    }
    list.innerHTML = apps.map(function (app) {
      var actions =
        '<button type="button" class="btn btn--success btn--sm" data-action="approve" data-id="' + esc(app.applicationId) + '">' + (app.needsSpecialApproval ? '特別批准…' : '核准') + '</button>' +
        '<button type="button" class="btn btn--danger-outline btn--sm" data-action="reject" data-id="' + esc(app.applicationId) + '">拒絕</button>';
      return window.Forms.applicationCard(app, { actions: actions, showTeacher: true, showHandovers: false });
    }).join('');
    list.querySelectorAll('[data-action="approve"]').forEach(function (btn) {
      btn.addEventListener('click', function () { approve(btn.getAttribute('data-id'), btn); });
    });
    list.querySelectorAll('[data-action="reject"]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReject(btn.getAttribute('data-id'), btn); });
    });
  }

  function findPending(id) {
    return pendingApps.filter(function (a) { return a.applicationId === id; })[0] || null;
  }

  function appLine(app) {
    if (window.Forms.isSpecial(app)) {
      return esc(app.applicationId) + '</strong>　<span class="badge badge--special">特別活動</span> ' + esc(app.activityName) + '<br>' +
        esc(window.Forms.slotRangeText(app)) + '<br>' + esc(app.teacherName) + ' · ' + esc(app.className) + ' · iPad ' + esc(app.ipad) + ' · Pencil ' + esc(app.pencil);
    }
    return esc(app.applicationId) + '</strong>　' + esc(window.Forms.slotRangeText(app)) + '<br>' +
      esc(app.teacherName) + ' · ' + esc(app.className) + ' · ' + esc(app.subject) + ' · iPad ' + esc(app.ipad) + ' · Pencil ' + esc(app.pencil);
  }

  function approve(id, btn) {
    var app = findPending(id);
    if (!app) return;
    var siblings = btn.parentElement ? btn.parentElement.querySelectorAll('button') : [];
    function lockSiblings(lock) {
      Array.prototype.forEach.call(siblings, function (b) { if (b !== btn) b.disabled = lock; });
    }
    function doApprove(confirmSpecial) {
      lockSiblings(true);
      var payload = { applicationId: id };
      if (confirmSpecial) payload.confirmSpecial = true;
      return window.App.ui.busy(btn, function () {
        return window.Api.post('approveApplication', payload).then(function () {
          var what = window.Forms.isSpecial(app) ? app.activityName + '，' + app.teacherName : app.teacherName + '，' + app.className;
          window.App.ui.toast((confirmSpecial ? '已特別批准 ' : '已核准 ') + id + '（' + what + '）。', 'success');
          window.App.invalidateWeeks();
          loadApprove();
        }).catch(function (err) {
          lockSiblings(false);
          window.App.handleError(err, { reloadList: loadApprove, reloadWeek: true });
        });
      });
    }
    if (app.needsSpecialApproval) {
      var reasons = window.Forms.specialReasons(app);
      window.App.ui.confirm({
        title: '特別批准確認',
        body: '申請 ' + app.applicationId + '「' + (app.activityName || '特別活動') + '」（' + window.Forms.slotRangeText(app) + '，' + app.teacherName + '，iPad ' + app.ipad + ' 部）落在需要特別批准的日期／時段。確定以管理員身分特別批准？',
        items: reasons.length ? reasons : ['需特別批准'],
        okText: '確定特別批准',
        danger: false,
        withReason: false,
        opener: btn
      }).then(function (result) {
        if (!result || !result.ok) return;
        doApprove(true);
      });
      return;
    }
    doApprove(false);
  }

  function bindRejectOnce() {
    if (rejectBound) return;
    rejectBound = true;
    var reason = el('reject-reason');
    reason.addEventListener('input', function () {
      el('reject-reason-count').textContent = String(reason.value.length);
      el('err-reject-reason').textContent = '';
      reason.removeAttribute('aria-invalid');
    });
    el('form-reject').addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitReject();
    });
  }

  function openReject(id, opener) {
    bindRejectOnce();
    var app = findPending(id);
    if (!app) return;
    rejectTarget = app;
    el('reject-summary').innerHTML = '<strong>' + appLine(app);
    el('reject-reason').value = '';
    el('reject-reason-count').textContent = '0';
    el('err-reject-reason').textContent = '';
    el('reject-reason').removeAttribute('aria-invalid');
    window.App.ui.openDialog(el('dlg-reject'), opener);
    el('reject-reason').focus();
  }

  function submitReject() {
    if (!rejectTarget) return;
    var reasonEl = el('reject-reason');
    var reason = reasonEl.value.trim();
    if (reason.length < 1 || reason.length > 200) {
      el('err-reject-reason').textContent = '請填寫拒絕原因（1 至 200 字）。';
      reasonEl.setAttribute('aria-invalid', 'true');
      reasonEl.focus();
      return;
    }
    var id = rejectTarget.applicationId;
    var btn = el('reject-submit');
    window.App.ui.busy(btn, function () {
      return window.Api.post('rejectApplication', { applicationId: id, reason: reason }).then(function () {
        window.App.ui.closeDialog(el('dlg-reject'));
        window.App.ui.toast('已拒絕 ' + id + '。', 'success');
        window.App.invalidateWeeks();
        loadApprove();
      }).catch(function (err) {
        window.App.handleError(err, {
          form: function (field, message) {
            el('err-reject-reason').textContent = message;
            reasonEl.setAttribute('aria-invalid', 'true');
          },
          inline: function (message) { el('err-reject-reason').textContent = message; },
          reloadList: function () {
            window.App.ui.closeDialog(el('dlg-reject'));
            loadApprove();
          }
        });
      });
    });
  }

  function loadApprove() {
    var list = el('approve-list');
    if (!list) return Promise.resolve();
    var ticket = window.Api.latest('approve');
    list.setAttribute('aria-busy', 'true');
    window.App.ui.renderSkeletonCards(list, 3);
    return window.Api.post('getPendingApplications', {}).then(function (data) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      pendingApps = (data && data.applications) || [];
      renderApprove(list, pendingApps);
    }).catch(function (err) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      if (!window.App.handleError(err, { silent: true })) return;
      window.App.ui.renderError(list, err, loadApprove);
    });
  }

  /* ========== 領取／歸還 ========== */
  var handoverApps = [];
  var handoverBound = false;
  var handoverTarget = null;
  var PICKUP_STATES = { '已核准': true, '逾時未領取': true };
  var RETURN_STATES = { '已領取': true, '未完全歸還': true, '逾時未歸還': true };

  function currentHandoverDate() {
    var input = el('handover-date');
    var v = input && input.value;
    return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : window.App.todayStr();
  }

  function renderHandover(list, apps) {
    if (!apps.length) {
      window.App.ui.renderEmpty(list, {
        title: '此日期沒有需要交收的申請',
        text: '這裡會顯示所選日期已核准的申請，以及所有仍有未歸還設備的申請。',
        actionText: '重新載入',
        onAction: loadHandover
      });
      return;
    }
    list.innerHTML = apps.map(function (app) {
      var actions = '';
      if (PICKUP_STATES[app.status]) {
        actions += '<button type="button" class="btn btn--primary btn--sm" data-action="pickup" data-id="' + esc(app.applicationId) + '">登記領取</button>';
      }
      if (RETURN_STATES[app.status]) {
        actions += '<button type="button" class="btn btn--primary btn--sm" data-action="return" data-id="' + esc(app.applicationId) + '">登記歸還</button>';
      }
      return window.Forms.applicationCard(app, { actions: actions, showTeacher: true, showHandovers: true, showOutstanding: true });
    }).join('');
    list.querySelectorAll('[data-action="pickup"]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPickup(btn.getAttribute('data-id'), btn); });
    });
    list.querySelectorAll('[data-action="return"]').forEach(function (btn) {
      btn.addEventListener('click', function () { openReturn(btn.getAttribute('data-id'), btn); });
    });
  }

  function findHandover(id) {
    return handoverApps.filter(function (a) { return a.applicationId === id; })[0] || null;
  }

  function summaryHtml(app) {
    var head = window.Forms.isSpecial(app)
      ? '<strong>' + esc(app.applicationId) + '</strong>　<span class="badge badge--special">特別活動</span> ' + esc(app.activityName) + '<br>' +
        esc(window.Forms.slotRangeText(app)) + '<br>' + esc(app.teacherName) + ' · ' + esc(app.className) +
        (app.afterHoursConfirm ? '<br><span class="tag tag--after">17:15 後自行保管</span>' : '')
      : '<strong>' + esc(app.applicationId) + '</strong>　' + esc(window.Forms.slotRangeText(app)) + '<br>' +
        esc(app.teacherName) + ' · ' + esc(app.className) + ' · ' + esc(app.subject);
    return head + '<br>申請數量：iPad ' + esc(app.ipad) + ' · Pencil ' + esc(app.pencil) +
      '；未還：iPad ' + esc(Number(app.ipadOutstanding) || 0) + ' · Pencil ' + esc(Number(app.pencilOutstanding) || 0);
  }

  function intValue(inputEl) {
    var raw = String(inputEl.value || '').trim();
    if (!/^\d+$/.test(raw)) return NaN;
    return parseInt(raw, 10);
  }

  function setErr(id, inputId, msg) {
    el(id).textContent = msg || '';
    var input = el(inputId);
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function bindHandoverOnce() {
    if (handoverBound) return;
    handoverBound = true;
    el('pickup-note').addEventListener('input', function () { el('pickup-note-count').textContent = String(el('pickup-note').value.length); });
    el('return-note').addEventListener('input', function () { el('return-note-count').textContent = String(el('return-note').value.length); });
    ['pickup-ipad', 'pickup-pencil'].forEach(function (id) {
      el(id).addEventListener('input', function () { setErr('err-' + id, id, ''); el('pickup-form-error').textContent = ''; });
    });
    ['return-ipad', 'return-pencil'].forEach(function (id) {
      el(id).addEventListener('input', function () { setErr('err-' + id, id, ''); el('return-form-error').textContent = ''; updateReturnAfter(); });
    });
    el('form-pickup').addEventListener('submit', function (ev) { ev.preventDefault(); submitPickup(); });
    el('form-return').addEventListener('submit', function (ev) { ev.preventDefault(); submitReturn(); });
  }

  /* --- 領取 --- */
  function openPickup(id, opener) {
    bindHandoverOnce();
    var app = findHandover(id);
    if (!app) return;
    handoverTarget = app;
    el('pickup-summary').innerHTML = summaryHtml(app);
    el('pickup-ipad').value = String(app.ipad);
    el('pickup-pencil').value = String(app.pencil);
    el('pickup-ipad').max = String(app.ipad);
    el('pickup-pencil').max = String(app.pencil);
    el('pickup-ipad-hint').textContent = '申請 ' + app.ipad + ' 部；實領少於申請量時請填寫異常備註。';
    el('pickup-pencil-hint').textContent = '申請 ' + app.pencil + ' 支';
    el('pickup-note').value = '';
    el('pickup-note-count').textContent = '0';
    setErr('err-pickup-ipad', 'pickup-ipad', '');
    setErr('err-pickup-pencil', 'pickup-pencil', '');
    el('pickup-form-error').textContent = '';
    window.App.ui.openDialog(el('dlg-pickup'), opener);
    el('pickup-ipad').focus();
    el('pickup-ipad').select();
  }

  function submitPickup() {
    var app = handoverTarget;
    if (!app) return;
    var ipad = intValue(el('pickup-ipad'));
    var pencil = intValue(el('pickup-pencil'));
    var note = el('pickup-note').value.trim();
    var ok = true;
    setErr('err-pickup-ipad', 'pickup-ipad', '');
    setErr('err-pickup-pencil', 'pickup-pencil', '');
    el('pickup-form-error').textContent = '';
    if (!isFinite(ipad) || ipad < 0 || ipad > app.ipad) { setErr('err-pickup-ipad', 'pickup-ipad', '實領 iPad 須為 0 至 ' + app.ipad + ' 的整數。'); ok = false; }
    if (!isFinite(pencil) || pencil < 0 || pencil > app.pencil) { setErr('err-pickup-pencil', 'pickup-pencil', '實領 Pencil 須為 0 至 ' + app.pencil + ' 的整數。'); ok = false; }
    if (ok && ipad === 0 && pencil === 0) { el('pickup-form-error').textContent = '實領數量不可全為 0。'; ok = false; }
    if (ok && (ipad < app.ipad || pencil < app.pencil) && !note) { el('pickup-form-error').textContent = '實領數量少於申請量，請填寫異常備註。'; el('pickup-note').focus(); ok = false; }
    if (!ok) return;
    var btn = el('pickup-submit');
    window.App.ui.busy(btn, function () {
      var payload = { applicationId: app.applicationId, ipad: ipad, pencil: pencil };
      if (note) payload.note = note;
      return window.Api.post('recordPickup', payload).then(function () {
        window.App.ui.closeDialog(el('dlg-pickup'));
        window.App.ui.toast('已登記領取 ' + app.applicationId + '：iPad ' + ipad + ' 部、Pencil ' + pencil + ' 支。', 'success');
        window.App.invalidateWeeks();
        loadHandover();
      }).catch(function (err) {
        window.App.handleError(err, {
          form: function (field, message) {
            if (field === 'ipad') setErr('err-pickup-ipad', 'pickup-ipad', message);
            else if (field === 'pencil') setErr('err-pickup-pencil', 'pickup-pencil', message);
            else el('pickup-form-error').textContent = message;
          },
          inline: function (message) { el('pickup-form-error').textContent = message; },
          reloadList: function () { window.App.ui.closeDialog(el('dlg-pickup')); loadHandover(); }
        });
      });
    });
  }

  /* --- 歸還 --- */
  function updateReturnAfter() {
    var app = handoverTarget;
    if (!app) return;
    var box = el('return-after');
    var ipadOut = Number(app.ipadOutstanding) || 0;
    var pencilOut = Number(app.pencilOutstanding) || 0;
    var ipad = intValue(el('return-ipad'));
    var pencil = intValue(el('return-pencil'));
    if (!isFinite(ipad)) ipad = 0;
    if (!isFinite(pencil)) pencil = 0;
    var ipadAfter = ipadOut - ipad;
    var pencilAfter = pencilOut - pencil;
    if (ipadAfter < 0 || pencilAfter < 0) {
      box.className = 'stock-summary is-warn';
      box.innerHTML = '歸還數量不可多於未還數量（iPad ' + ipadOut + '、Pencil ' + pencilOut + '）。';
      return;
    }
    var complete = ipadAfter === 0 && pencilAfter === 0;
    box.className = 'stock-summary' + (complete ? '' : ' is-warn');
    box.innerHTML = '歸還後仍未還：<strong>iPad ' + ipadAfter + ' 部</strong>、<strong>Pencil ' + pencilAfter + ' 支</strong>' +
      (complete ? '，此申請將標記為「已歸還」。' : '，此申請將標記為「未完全歸還」。');
  }

  function openReturn(id, opener) {
    bindHandoverOnce();
    var app = findHandover(id);
    if (!app) return;
    handoverTarget = app;
    var ipadOut = Number(app.ipadOutstanding) || 0;
    var pencilOut = Number(app.pencilOutstanding) || 0;
    el('return-summary').innerHTML = summaryHtml(app);
    el('return-ipad').value = String(ipadOut);
    el('return-pencil').value = String(pencilOut);
    el('return-ipad').max = String(ipadOut);
    el('return-pencil').max = String(pencilOut);
    el('return-ipad-hint').textContent = '未還 ' + ipadOut + ' 部';
    el('return-pencil-hint').textContent = '未還 ' + pencilOut + ' 支';
    el('return-note').value = '';
    el('return-note-count').textContent = '0';
    setErr('err-return-ipad', 'return-ipad', '');
    setErr('err-return-pencil', 'return-pencil', '');
    el('return-form-error').textContent = '';
    updateReturnAfter();
    window.App.ui.openDialog(el('dlg-return'), opener);
    el('return-ipad').focus();
    el('return-ipad').select();
  }

  function submitReturn() {
    var app = handoverTarget;
    if (!app) return;
    var ipadOut = Number(app.ipadOutstanding) || 0;
    var pencilOut = Number(app.pencilOutstanding) || 0;
    var ipad = intValue(el('return-ipad'));
    var pencil = intValue(el('return-pencil'));
    var note = el('return-note').value.trim();
    var ok = true;
    setErr('err-return-ipad', 'return-ipad', '');
    setErr('err-return-pencil', 'return-pencil', '');
    el('return-form-error').textContent = '';
    if (!isFinite(ipad) || ipad < 0 || ipad > ipadOut) { setErr('err-return-ipad', 'return-ipad', '歸還 iPad 須為 0 至 ' + ipadOut + ' 的整數。'); ok = false; }
    if (!isFinite(pencil) || pencil < 0 || pencil > pencilOut) { setErr('err-return-pencil', 'return-pencil', '歸還 Pencil 須為 0 至 ' + pencilOut + ' 的整數。'); ok = false; }
    if (ok && ipad === 0 && pencil === 0) { el('return-form-error').textContent = '本次歸還數量不可全為 0。'; ok = false; }
    if (!ok) return;
    var btn = el('return-submit');
    window.App.ui.busy(btn, function () {
      var payload = { applicationId: app.applicationId, ipad: ipad, pencil: pencil };
      if (note) payload.note = note;
      return window.Api.post('recordReturn', payload).then(function (data) {
        var updated = data && data.application;
        window.App.ui.closeDialog(el('dlg-return'));
        var status = updated && updated.status ? '，狀態：' + updated.status : '';
        window.App.ui.toast('已登記歸還 ' + app.applicationId + '：iPad ' + ipad + ' 部、Pencil ' + pencil + ' 支' + status + '。', 'success');
        window.App.invalidateWeeks();
        loadHandover();
      }).catch(function (err) {
        window.App.handleError(err, {
          form: function (field, message) {
            if (field === 'ipad') setErr('err-return-ipad', 'return-ipad', message);
            else if (field === 'pencil') setErr('err-return-pencil', 'return-pencil', message);
            else el('return-form-error').textContent = message;
          },
          inline: function (message) { el('return-form-error').textContent = message; },
          reloadList: function () { window.App.ui.closeDialog(el('dlg-return')); loadHandover(); }
        });
      });
    });
  }

  function loadHandover() {
    var list = el('handover-list');
    if (!list) return Promise.resolve();
    var date = currentHandoverDate();
    var ticket = window.Api.latest('handover');
    list.setAttribute('aria-busy', 'true');
    window.App.ui.renderSkeletonCards(list, 3);
    return window.Api.post('getApprovedForHandover', { date: date }).then(function (data) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      handoverApps = (data && data.applications) || [];
      renderHandover(list, handoverApps);
    }).catch(function (err) {
      if (!ticket.isLatest()) return;
      list.setAttribute('aria-busy', 'false');
      if (!window.App.handleError(err, { silent: true })) return;
      window.App.ui.renderError(list, err, loadHandover);
    });
  }

  var handoverControlsBound = false;
  function initHandoverControls() {
    if (handoverControlsBound) return;
    handoverControlsBound = true;
    var dateInput = el('handover-date');
    if (dateInput && !dateInput.value) dateInput.value = window.App.todayStr();
    dateInput.addEventListener('change', function () { loadHandover(); });
    el('btn-handover-today').addEventListener('click', function () {
      dateInput.value = window.App.todayStr();
      loadHandover();
    });
    el('btn-refresh-handover').addEventListener('click', function () { loadHandover(); });
    el('btn-refresh-approve').addEventListener('click', function () { loadApprove(); });
  }

  window.Admin = {
    loadApprove: loadApprove,
    loadHandover: loadHandover,
    initHandoverControls: initHandoverControls
  };
})();
