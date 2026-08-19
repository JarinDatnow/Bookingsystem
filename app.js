/* Equipment Desk — front end */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var state = { cfg: null, date: null, bookings: [], late: [], busy: false };

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function todayISO() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  }

  function shiftDay(iso, n) {
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return [d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')].join('-');
  }

  function prettyDate(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('up');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('up'); }, bad ? 6000 : 3200);
  }

  /* ----------------------------------------------------------------- api */

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__ed' + Math.random().toString(36).slice(2);
      url.searchParams.set('callback', name);
      var s = document.createElement('script');
      var timer;
      var finish = function (ok, val) {
        clearTimeout(timer);
        delete window[name];
        if (s.parentNode) s.parentNode.removeChild(s);
        (ok ? resolve : reject)(val);
      };
      window[name] = function (d) { finish(true, d); };
      s.onerror = function () { finish(false, new Error('Could not reach the booking server.')); };
      timer = setTimeout(function () {
        finish(false, new Error('The server did not answer. Check the web app URL, and that access is set to Anyone.'));
      }, 20000);
      s.src = url.toString();
      document.body.appendChild(s);
    });
  }

  function call(action, params) {
    var url = new URL(window.API_URL);
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] != null) url.searchParams.set(k, params[k]);
    });

    return fetch(url.toString())
      .then(function (r) { return r.json(); })
      .catch(function () { return jsonp(url); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
        return res.data;
      });
  }

  /* -------------------------------------------------------------- status */

  function isPast(iso) { return iso < todayISO(); }

  function look(b) {
    if (b.status === 'Returned') return 'back';
    if (isPast(b.date)) return 'late';
    return b.status === 'Out' ? 'out' : 'booked';
  }

  function nowPeriodIndex() {
    var times = state.cfg.periodTimes;
    if (!times || !times.length || state.date !== todayISO()) return -1;
    var d = new Date();
    var mins = d.getHours() * 60 + d.getMinutes();
    for (var i = 0; i < times.length; i++) {
      var m = String(times[i]).split('-');
      if (m.length !== 2) continue;
      var a = m[0].split(':'), b = m[1].split(':');
      var start = +a[0] * 60 + +a[1], end = +b[0] * 60 + +b[1];
      if (mins >= start && mins < end) return i;
    }
    return -1;
  }

  /* --------------------------------------------------------------- board */

  function renderBoard() {
    var el = $('#board');
    var periods = state.cfg.periods;
    var items = state.cfg.items;

    if (!items.length) {
      el.innerHTML = '<p class="empty">No equipment listed yet. Add rows to the Items tab in the sheet.</p>';
      el.style.display = 'block';
      return;
    }

    el.style.display = 'grid';
    el.style.gridTemplateColumns = '132px repeat(' + periods.length + ', minmax(84px, 1fr))';

    var now = nowPeriodIndex();
    var html = '<div class="cell head name" style="grid-row:1;grid-column:1">PERIOD</div>';

    periods.forEach(function (p, i) {
      html += '<div class="cell head' + (i === now ? ' now' : '') + '" style="grid-row:1;grid-column:' +
        (i + 2) + '">' + esc(p) + '</div>';
    });

    items.forEach(function (item, r) {
      var row = r + 2;
      html += '<div class="cell name" style="grid-row:' + row + ';grid-column:1">' +
        '<b>' + esc(item.name) + '</b><span>' + esc(item.id) + '</span></div>';
      periods.forEach(function (p, i) {
        html += '<div class="cell slot' + (i === now ? ' now' : '') +
          '" style="grid-row:' + row + ';grid-column:' + (i + 2) + '"></div>';
      });
    });

    state.bookings.forEach(function (b) {
      var r = items.findIndex(function (i) { return i.id === b.itemId; });
      var f = periods.indexOf(b.from), t = periods.indexOf(b.to);
      if (r < 0 || f < 0 || t < 0) return;
      html += '<div class="bar-book is-' + look(b) + '" title="' + esc(b.teacher + ' · ' + b.status +
        (b.notes ? ' · ' + b.notes : '')) + '" style="grid-row:' + (r + 2) +
        ';grid-column:' + (f + 2) + ' / ' + (t + 3) + '">' +
        '<b>' + esc(b.teacher) + '</b><span>' + esc(b.notes || b.status) + '</span></div>';
    });

    el.innerHTML = html;
  }

  /* ---------------------------------------------------------------- desk */

  function slip(b, showDate) {
    var k = look(b);
    var when = (showDate ? b.date + ' · ' : '') +
      (b.from === b.to ? 'Period ' + b.from : 'Periods ' + b.from + '–' + b.to);
    var meta = when + ' · ' + b.teacher + (b.notes ? ' · ' + b.notes : '');

    var doing = '';
    if (b.status === 'Booked') {
      doing = '<button class="act" data-do="checkout" data-id="' + esc(b.id) + '">Check out</button>' +
        '<button class="act ghost" data-do="cancel" data-id="' + esc(b.id) + '">Cancel</button>';
    } else if (b.status === 'Out') {
      doing = '<button class="act" data-do="return" data-id="' + esc(b.id) + '">Mark returned</button>';
    } else {
      doing = '<span class="done">Returned ' + esc(b.returnedAt || '') + '</span>';
    }

    return '<div class="slip s-' + k + '">' +
      '<div class="slip-what"><b>' + esc(b.itemName) + '</b><span>' + esc(meta) + '</span></div>' +
      '<div class="slip-do">' + doing + '</div></div>';
  }

  function renderDesk() {
    var order = state.cfg.periods;
    var list = state.bookings.slice().sort(function (a, b) {
      return order.indexOf(a.from) - order.indexOf(b.from);
    });

    $('#deskList').innerHTML = list.length
      ? list.map(function (b) { return slip(b, false); }).join('')
      : '<p class="empty">Nothing booked for ' + esc(prettyDate(state.date)) + '.</p>';

    var lateBox = $('#late');
    if (state.late.length) {
      lateBox.hidden = false;
      lateBox.innerHTML = '<h2>Still not back (' + state.late.length + ')</h2>' +
        state.late.map(function (b) { return slip(b, true); }).join('');
    } else {
      lateBox.hidden = true;
      lateBox.innerHTML = '';
    }
  }

  /* ---------------------------------------------------------------- form */

  function fillForm() {
    var t = $('#f-teacher');
    t.innerHTML = '<option value="">Choose your name…</option>' +
      state.cfg.teachers.map(function (x) {
        return '<option value="' + esc(x.name) + '">' + esc(x.name) + '</option>';
      }).join('');

    var i = $('#f-item');
    i.innerHTML = '<option value="">Choose equipment…</option>' +
      state.cfg.items.map(function (x) {
        return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
      }).join('');

    var opts = state.cfg.periods.map(function (p) {
      return '<option value="' + esc(p) + '">' + esc(p) + '</option>';
    }).join('');
    $('#f-from').innerHTML = opts;
    $('#f-to').innerHTML = opts;
  }

  function itemHint() {
    var id = $('#f-item').value;
    var el = $('#itemHint');
    if (!id) { el.textContent = ''; return; }

    var taken = state.bookings.filter(function (b) {
      return b.itemId === id && b.status !== 'Returned';
    });

    el.textContent = taken.length
      ? 'Taken ' + taken.map(function (b) {
        return (b.from === b.to ? b.from : b.from + '–' + b.to) + ' (' + b.teacher + ')';
      }).join(', ')
      : 'Free all day.';
  }

  function keepOrder(changed) {
    var p = state.cfg.periods;
    var f = p.indexOf($('#f-from').value);
    var t = p.indexOf($('#f-to').value);
    if (t < f) $(changed === 'from' ? '#f-to' : '#f-from').value = $(changed === 'from' ? '#f-from' : '#f-to').value;
  }

  /* --------------------------------------------------------------- loads */

  function loadDay() {
    return Promise.all([
      call('day', { date: state.date }),
      call('outstanding')
    ]).then(function (res) {
      state.bookings = res[0].bookings;
      state.late = res[1].bookings;
      renderBoard();
      renderDesk();
      itemHint();

      var out = state.bookings.filter(function (b) { return b.status === 'Out'; }).length;
      $('#tally').innerHTML = out + ' signed out' +
        (state.late.length ? ' · <span class="flag">' + state.late.length + ' overdue</span>' : '');
      $('#bookFor').textContent = 'Booking for ' + prettyDate(state.date) + '.';
    });
  }

  function boot() {
    if (!window.API_URL || window.API_URL.indexOf('script.google.com') < 0) {
      document.querySelector('main').innerHTML =
        '<p class="empty">Open <b>config.js</b> and paste your Apps Script web app URL into it.</p>';
      $('#tally').textContent = 'Not connected';
      return;
    }

    call('bootstrap').then(function (cfg) {
      state.cfg = cfg;
      state.date = cfg.today || todayISO();
      $('#school').textContent = cfg.schoolName;
      document.title = cfg.schoolName;
      $('#date').value = state.date;
      fillForm();
      return loadDay();
    }).catch(function (e) {
      $('#tally').textContent = 'Not connected';
      toast(e.message, true);
    });
  }

  /* -------------------------------------------------------------- events */

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('is-on'); });
      tab.classList.add('is-on');
      ['board', 'book', 'desk'].forEach(function (v) {
        $('#view-' + v).hidden = (v !== tab.dataset.view);
      });
    });
  });

  $('#date').addEventListener('change', function () {
    state.date = this.value || todayISO();
    loadDay().catch(function (e) { toast(e.message, true); });
  });

  $('#prevDay').addEventListener('click', function () {
    $('#date').value = state.date = shiftDay(state.date, -1);
    loadDay().catch(function (e) { toast(e.message, true); });
  });

  $('#nextDay').addEventListener('click', function () {
    $('#date').value = state.date = shiftDay(state.date, 1);
    loadDay().catch(function (e) { toast(e.message, true); });
  });

  $('#reload').addEventListener('click', function () {
    loadDay().then(function () { toast('Up to date.'); })
      .catch(function (e) { toast(e.message, true); });
  });

  $('#f-item').addEventListener('change', itemHint);
  $('#f-from').addEventListener('change', function () { keepOrder('from'); });
  $('#f-to').addEventListener('change', function () { keepOrder('to'); });

  $('#bookForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (state.busy) return;
    state.busy = true;
    $('#bookBtn').disabled = true;

    call('book', {
      date: state.date,
      item: $('#f-item').value,
      teacher: $('#f-teacher').value,
      from: $('#f-from').value,
      to: $('#f-to').value,
      notes: $('#f-notes').value
    }).then(function () {
      $('#f-notes').value = '';
      toast('Booked.');
      return loadDay();
    }).catch(function (e) {
      toast(e.message, true);
    }).then(function () {
      state.busy = false;
      $('#bookBtn').disabled = false;
    });
  });

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-do]');
    if (!btn || state.busy) return;

    var what = btn.dataset.do;
    if (what === 'cancel' && !confirm('Cancel this booking?')) return;

    state.busy = true;
    btn.disabled = true;

    call(what, { id: btn.dataset.id }).then(function () {
      toast(what === 'checkout' ? 'Signed out.' : what === 'return' ? 'Back in.' : 'Cancelled.');
      return loadDay();
    }).catch(function (e) {
      toast(e.message, true);
      btn.disabled = false;
    }).then(function () {
      state.busy = false;
    });
  });

  boot();
})();
