/*
 * hub.js — খেলাঘর, the dated ledger.
 *
 * The hub owns no puzzle state. It reads the two hero games' own
 * localStorage records (`pa-xw:<id>`, `pa:ws-bn:<id>`) and their published
 * puzzle indexes, so a solve inside a game moves the streak here without
 * anything being written twice. The only key this file writes is its own
 * demo flag — the games' records are read-only from the hub.
 */
(function () {
  'use strict';

  var B = window.BnText;
  var toBn = B.toBn;

  /* ---- copy ------------------------------------------------------------ */

  var T = {
    days: ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'],
    daysFull: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'],
    months: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
    today: 'আজকের খেলা',
    dayGames: 'ের খেলা',
    streakLabel: 'দিনের ধারা',
    streakNone: 'ধারা শুরু করুন',
    play: 'খেলুন',
    resume: 'চালিয়ে যান',
    solved: 'সমাধান হয়েছে',
    soon: 'আসছে',
    share: 'শেয়ার করুন'
  };

  /* ---- storage keys the games own -------------------------------------- */

  var XW_STORE = 'pa-xw:';
  var XW_BEST  = 'pa-xw-best:';
  var WS_STORE = 'pa:ws-bn:';
  var WS_BEST  = 'pa:ws-bn:best:';
  var DEMO_KEY = 'pa-hub:demo';

  /* ---- the five heroes -------------------------------------------------
     Two are built. The other three carry the contracted build week rather
     than a date we cannot keep. */

  var HEROES = [
    { key: 'xw', name: 'শব্দভেদ', href: '../games/crossword-bn/index.html', live: true,
      note: 'প্রথম আলোর ছাপা শব্দভেদ' },
    { key: 'ws', name: 'শব্দ সন্ধান', href: '../games/word-search-bn/index.html', live: true,
      note: '৮×৮ · ১২টি শব্দ' },
    { key: 'sd', name: 'সুডোকু', live: false, when: 'সপ্তাহ ১', note: 'বাংলা সংখ্যায় ১–৯' },
    { key: 'wf', name: 'শব্দফুল', live: false, when: 'সপ্তাহ ২', note: 'অক্ষরের চাক থেকে শব্দ' },
    { key: 'qz', name: 'কুইজ', live: false, when: 'সপ্তাহ ৩', note: 'দিনে ১০টি প্রশ্ন' }
  ];

  /* ---- the catalogue ----------------------------------------------------
     35 reskins, the launch's other half. Names from game-names-bn.csv. */

  var CATALOGUE = [
    { h: 'শব্দ', items: ['শব্দ অনুমান', 'অ্যানাগ্রাম', 'শব্দচক্র', 'অক্ষর শিকার', 'গুপ্তলিপি', 'সংযোগ', 'অক্ষর বাক্স', 'শব্দ সংযোগ'] },
    { h: 'সংখ্যা ও যুক্তি', items: ['কেনকেন', 'কাকুরো', 'ফুতোশিকি', 'বাইনারিও', 'জাদু বর্গ', 'আলোক প্রজ্বালন', '২৪ বানাও', 'সংকেত ভাঙো', 'পিপস', 'পাইপ সংযোগ', 'দেশলাই ধাঁধা'] },
    { h: 'ক্লাসিক', items: ['ননোগ্রাম', '২০৪৮', 'বাতি নেভাও', '১৫ পাজল', 'ট্যানগ্রাম', 'হ্যানয় টাওয়ার', 'ব্যাটলশিপ', 'বিন্দু সংযোগ', 'জোড়া মেলাও', 'ট্রিপল টাইল', 'একরঙা সাফ'] },
    { h: 'সলিটেয়ার', items: ['মাহজং', 'পিরামিড', 'ট্রাই-পিকস', 'পেগ সলিটেয়ার', 'ক্লনডাইক'] }
  ];

  /* ---- dates ------------------------------------------------------------ */

  function iso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function parseISO(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function weekStart(d) {
    /* The Bangladeshi week opens on শনিবার. */
    return addDays(d, -((d.getDay() + 1) % 7));
  }
  function longDate(d) {
    return T.daysFull[d.getDay()] + ', ' + toBn(d.getDate()) + ' ' + T.months[d.getMonth()] + ' ' + toBn(d.getFullYear());
  }
  function shortDate(d) {
    return toBn(d.getDate()) + ' ' + T.months[d.getMonth()];
  }
  function mmss(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return toBn(m) + ':' + toBn(s < 10 ? '0' + s : String(s));
  }

  var TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);
  var TODAY_ISO = iso(TODAY);

  /* ---- state ------------------------------------------------------------ */

  var XW = { puzzles: [], byDate: {} };   // crossword index
  var WS = { puzzles: [], byDate: {} };   // word-search index
  var GRIDS = {};                          // crossword id -> grid array
  var selected = TODAY_ISO;
  var weekOf = weekStart(TODAY);

  function demoOn() {
    try {
      var v = localStorage.getItem(DEMO_KEY);
      if (v === null) return null;         // never decided
      return v === '1';
    } catch (e) { return false; }
  }
  function setDemo(on) {
    try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch (e) {}
  }

  /* ---- reading the games' own records ----------------------------------- */

  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* state: 'new' | 'started' | 'solved' */
  function xwStatus(id) {
    if (!id) return { state: 'none' };
    var st = readJSON(XW_STORE + id);
    if (!st) return { state: 'new' };
    if (st.solved) return { state: 'solved', secs: st.elapsed || 0 };
    var filled = (st.cells || []).filter(function (c) { return c; }).length;
    var total = (st.cells || []).length || 64;
    return filled ? { state: 'started', done: filled, total: total } : { state: 'new' };
  }

  function wsStatus(id) {
    if (!id) return { state: 'none' };
    var p = WS.byDate[id.slice(3)];
    if (!p) return { state: 'none' };
    var st = readJSON(WS_STORE + id);
    var total = p.words.length;
    if (!st) return { state: 'new', total: total };
    var list = Array.isArray(st) ? st : (st.w || []);
    var valid = {}, i;
    for (i = 0; i < p.words.length; i++) valid[p.words[i]] = true;
    var n = 0;
    for (i = 0; i < list.length; i++) if (valid[list[i]]) n++;
    if (n >= total) return { state: 'solved', secs: (st.t || 0), total: total };
    return n ? { state: 'started', done: n, total: total } : { state: 'new', total: total };
  }

  function bestOf(prefix, id) {
    try { return parseInt(localStorage.getItem(prefix + id) || '0', 10) || 0; } catch (e) { return 0; }
  }

  /* ---- what happened on a given day -------------------------------------
     A day is "kept" when at least one of that day's puzzles is solved. Demo
     history fills only days BEFORE today, so the ribbon and today's own
     rows can never contradict each other. */

  var DEMO_BACK = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15];

  function demoWeight(dateISO) {
    if (!demoActive()) return 0;
    var back = Math.round((TODAY - parseISO(dateISO)) / 86400000);
    if (back <= 0) return 0;                       // today is always the real thing
    for (var i = 0; i < DEMO_BACK.length; i++) {
      if (DEMO_BACK[i] === back) return back % 3 === 0 ? 2 : 1;
    }
    return 0;
  }

  /* One demo day, resolved down to the individual game, so the ledger and the
     per-game numbers can never tell two different stories. A demo solve is
     only ever claimed against a puzzle that actually exists in that game's
     published pack. Times derive from the date, so the sample history is
     stable between loads. */
  function demoSolve(key, dateISO) {
    var w = demoWeight(dateISO);
    if (!w) return null;
    if (key === 'ws' && !WS.byDate[dateISO]) return null;
    if (key === 'xw' && (w < 2 || !XW.byDate[dateISO])) return null;
    var d = parseISO(dateISO);
    var seed = d.getDate() * 37 + d.getMonth() * 11 + (key === 'xw' ? 0 : 5);
    return { state: 'solved', secs: (key === 'xw' ? 260 : 150) + (seed % 190), demo: true };
  }

  /* The one place a game's state for a date is decided: the game's own record
     first, the sample history only where the reader has played nothing. */
  function statusFor(key, dateISO) {
    var map = key === 'xw' ? XW : WS;
    var p = map.byDate[dateISO];
    if (!p) return { state: 'none' };
    var st = key === 'xw' ? xwStatus(p.id) : wsStatus(p.id);
    if (st.state === 'new' || st.state === 'none') {
      var d = demoSolve(key, dateISO);
      if (d) return d;
    }
    return st;
  }

  var _hasReal = null;
  function hasRealPlay() {
    if (_hasReal !== null) return _hasReal;
    _hasReal = false;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf(XW_STORE) === 0 || (k.indexOf(WS_STORE) === 0 && k.indexOf(WS_BEST) !== 0))) {
          _hasReal = true; break;
        }
      }
    } catch (e) {}
    return _hasReal;
  }

  /* Demo runs until the reader has played something real, or until they
     switch it off; either way the choice is theirs to change in the sheet. */
  function demoActive() {
    var v = demoOn();
    if (v === null) return !hasRealPlay();
    return v;
  }

  function dayRecord(dateISO) {
    var out = { solved: 0, started: 0, demo: false };
    ['xw', 'ws'].forEach(function (key) {
      var s = statusFor(key, dateISO);
      if (s.state === 'solved') { out.solved++; if (s.demo) out.demo = true; }
      else if (s.state === 'started') out.started++;
    });
    return out;
  }

  function kept(dateISO) { return dayRecord(dateISO).solved > 0; }

  function streak() {
    var todayKept = kept(TODAY_ISO);
    var n = 0;
    var cur = todayKept ? TODAY : addDays(TODAY, -1);
    while (kept(iso(cur)) && n < 400) { n++; cur = addDays(cur, -1); }
    return { n: n, atRisk: !todayKept && n > 0 };
  }

  function maxStreak() {
    var best = 0, run = 0;
    for (var i = 180; i >= 0; i--) {
      if (kept(iso(addDays(TODAY, -i)))) { run++; if (run > best) best = run; }
      else run = 0;
    }
    return best;
  }

  /* ---- which puzzle a game serves on a given date -----------------------
     Never a future issue, and never a fake one: when the pack has nothing
     dated to the selected day, the row says which issue it is serving. */

  function issueFor(map, dateISO) {
    if (map.byDate[dateISO]) return { p: map.byDate[dateISO], exact: true };
    var prior = map.puzzles.filter(function (x) { return x.date <= dateISO; });
    if (!prior.length) return null;
    return { p: prior[prior.length - 1], exact: false };
  }

  /* ---- svg thumbnails ---------------------------------------------------
     Blocks and progress only. A conjunct at this size is noise, so no
     thumbnail in this system ever draws a letter. */

  function svg(inner, cls) {
    return '<svg class="kg-thumb' + (cls ? ' ' + cls : '') + '" viewBox="0 0 64 64" role="img" aria-hidden="true">'
      + '<rect class="bg" x="0" y="0" width="64" height="64"/>' + inner + '</svg>';
  }

  function gridLines(n) {
    var step = 64 / n, out = '', i;
    for (i = 1; i < n; i++) {
      out += '<line class="g" x1="' + (i * step) + '" y1="0" x2="' + (i * step) + '" y2="64"/>'
           + '<line class="g" x1="0" y1="' + (i * step) + '" x2="64" y2="' + (i * step) + '"/>';
    }
    return out;
  }

  function xwThumb(id, status) {
    var g = GRIDS[id];
    var cells = '', i;
    if (g) {
      var filled = {};
      var st = readJSON(XW_STORE + id);
      if (st && st.cells) st.cells.forEach(function (c, j) { if (c) filled[j] = true; });
      for (i = 0; i < g.length; i++) {
        var r = Math.floor(i / 8), c2 = i % 8;
        var cls = g[i] === null ? 'b' : (filled[i] ? 'f' : '');
        if (cls) cells += '<rect class="' + cls + '" x="' + (c2 * 8) + '" y="' + (r * 8) + '" width="8" height="8"/>';
      }
    } else {
      /* index not reachable (file://) — a plain ruled 8×8, no invented blocks */
      cells = '';
    }
    return svg(cells + gridLines(8) + '<rect class="fr" x="1" y="1" width="62" height="62"/>');
  }

  function wsThumb(status) {
    var strike = status && status.state === 'solved'
      ? '<line x1="6" y1="14" x2="58" y2="14" stroke="var(--pa-red)" stroke-width="2.5"/>'
        + '<line x1="6" y1="34" x2="46" y2="34" stroke="var(--pa-red)" stroke-width="2.5"/>'
        + '<line x1="18" y1="52" x2="58" y2="52" stroke="var(--pa-red)" stroke-width="2.5"/>'
      : status && status.state === 'started'
        ? '<line x1="6" y1="22" x2="42" y2="22" stroke="var(--pa-red)" stroke-width="2.5"/>'
        : '';
    return svg(gridLines(8) + strike + '<rect class="fr" x="1" y="1" width="62" height="62"/>');
  }

  function soonThumb(key) {
    if (key === 'sd') {
      return svg(gridLines(9)
        + '<line class="fr" x1="21.3" y1="1" x2="21.3" y2="63"/><line class="fr" x1="42.6" y1="1" x2="42.6" y2="63"/>'
        + '<line class="fr" x1="1" y1="21.3" x2="63" y2="21.3"/><line class="fr" x1="1" y1="42.6" x2="63" y2="42.6"/>'
        + '<rect class="fr" x="1" y="1" width="62" height="62" fill="none"/>', 'is-soon');
    }
    if (key === 'wf') {
      var hex = function (cx, cy, r) {
        var pts = [], a;
        for (var i = 0; i < 6; i++) {
          a = Math.PI / 180 * (60 * i - 30);
          pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
        }
        return '<polygon class="fr" points="' + pts.join(' ') + '" fill="none"/>';
      };
      var out = hex(32, 32, 10), k, ang;
      for (k = 0; k < 6; k++) {
        ang = Math.PI / 180 * (60 * k);
        out += hex(32 + 18 * Math.cos(ang), 32 + 18 * Math.sin(ang), 10);
      }
      return svg(out, 'is-soon');
    }
    /* quiz: an answer sheet */
    var rows = '';
    for (var j = 0; j < 4; j++) {
      var y = 14 + j * 13;
      rows += '<circle class="fr" cx="12" cy="' + y + '" r="4" fill="none"/>'
            + '<line class="g" x1="22" y1="' + y + '" x2="' + (56 - (j % 2) * 10) + '" y2="' + y + '" stroke-width="3"/>';
    }
    return svg(rows + '<rect class="fr" x="1" y="1" width="62" height="62" fill="none"/>', 'is-soon');
  }

  /* ---- render: header ---------------------------------------------------- */

  function el(id) { return document.getElementById(id); }

  function renderHead() {
    el('dateline').textContent = longDate(TODAY);
    el('edition').textContent = 'প্রিভিউ সংস্করণ';
  }

  /* ---- render: the week ledger -------------------------------------------- */

  function renderWeek() {
    var host = el('week');
    host.innerHTML = '';
    var start = weekOf, i;

    for (i = 0; i < 7; i++) {
      var d = addDays(start, i);
      var dISO = iso(d);
      var future = d > TODAY;
      var rec = future ? { solved: 0, started: 0 } : dayRecord(dISO);

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kg-day'
        + (dISO === TODAY_ISO ? ' is-today' : '')
        + (dISO === selected ? ' is-sel' : '')
        + (future ? ' is-future' : '')
        + (!future && rec.solved ? ' is-solved' : '')
        + (!future && !rec.solved && !rec.started ? ' is-empty' : '');
      b.disabled = future;
      b.setAttribute('aria-pressed', dISO === selected ? 'true' : 'false');
      b.setAttribute('aria-label', longDate(d) + (rec.solved ? ', ' + toBn(rec.solved) + 'টি সমাধান' : ''));

      var tally = '';
      var m;
      for (m = 0; m < rec.solved; m++) tally += '<i></i>';
      for (m = 0; m < rec.started; m++) tally += '<i class="is-part"></i>';

      b.innerHTML = '<span class="kg-day__w">' + (dISO === TODAY_ISO ? 'আজ' : T.days[d.getDay()]) + '</span>'
        + '<span class="kg-day__n">' + toBn(d.getDate()) + '</span>'
        + '<span class="kg-day__tally">' + tally + '</span>';
      b.onclick = (function (v) { return function () { selected = v; renderWeek(); renderDay(); }; })(dISO);
      host.appendChild(b);
    }

    var wsLabel = shortDate(start) + ' – ' + shortDate(addDays(start, 6));
    el('wk-label').textContent = wsLabel;
    el('wk-next').disabled = addDays(start, 7) > TODAY;

    var s = streak();
    var sEl = el('streak');
    el('streak-n').textContent = toBn(s.n);
    el('streak-l').textContent = s.n ? T.streakLabel : T.streakNone;
    sEl.classList.toggle('is-risk', s.atRisk);

    var note = el('ledger-note');
    if (s.atRisk) {
      note.innerHTML = 'আজকের ধাঁধা এখনো বাকি। <b>একটি সমাধান করলেই ধারা ' + toBn(s.n + 1) + ' দিন।</b>';
    } else if (s.n && kept(TODAY_ISO)) {
      note.innerHTML = 'আজকের ধারা রাখা হয়েছে। সর্বোচ্চ ধারা ' + toBn(maxStreak()) + ' দিন।';
    } else {
      note.innerHTML = 'আজ একটি ধাঁধা সমাধান করলেই ধারা শুরু।';
    }
  }

  /* ---- render: the selected day's games ----------------------------------- */

  function stateLine(cls, icon, text) {
    return '<span class="kg-game__s ' + cls + '">' + icon + text + '</span>';
  }

  var ICON = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>',
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5l12 7.5-12 7.5z"/></svg>',
    resume: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v5l3.5 2"/><circle cx="12" cy="12" r="8.5"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>',
    share: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V4m0 0L8 8m4-4l4 4"/><path d="M5 13v5.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V13"/></svg>',
    /* Square shackle-and-body, no rounded corners: a lock drawn the way the
       rest of the ledger draws its blocks. The row lock rides the state line
       next to আসছে; the index lock replaces the mark on all 35 entries, so it
       carries no width of its own and takes the cell's. */
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.75 10.5h14.5v9.75H4.75z"/><path d="M8 10.5V7.75a4 4 0 018 0v2.75"/></svg>',
    lockMark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.75 10.5h14.5v9.75H4.75z"/><path d="M8 10.5V7.75a4 4 0 018 0v2.75"/></svg>'
  };

  function renderDay() {
    var isToday = selected === TODAY_ISO;
    var d = parseISO(selected);
    el('day-h').textContent = isToday ? T.today : (shortDate(d) + T.dayGames);
    el('day-meta').innerHTML = isToday
      ? T.daysFull[d.getDay()]
      : '<button type="button" id="back-today">আজকের খেলায় ফিরুন</button>';
    if (!isToday) {
      el('back-today').onclick = function () {
        selected = TODAY_ISO; weekOf = weekStart(TODAY); renderWeek(); renderDay();
      };
    }

    var host = el('games');
    host.innerHTML = '';

    HEROES.forEach(function (h) {
      var li = document.createElement('li');
      if (!h.live) { li.innerHTML = soonRow(h); host.appendChild(li); return; }

      var map = h.key === 'xw' ? XW : WS;
      var found = issueFor(map, selected);
      if (!found) { li.innerHTML = soonRow(h, 'এই তারিখে কোনো সংখ্যা নেই'); host.appendChild(li); return; }

      var p = found.p;
      var st = statusFor(h.key, p.date);
      var best = bestOf(h.key === 'xw' ? XW_BEST : WS_BEST, p.id);

      var deck = h.key === 'ws' && p.theme ? p.theme + ' · ' + toBn(p.words.length) + 'টি শব্দ' : h.note;
      if (!found.exact) deck = shortDate(parseISO(p.date)) + 'ের সংখ্যা · ' + deck;

      var line, prog = '';
      if (st.state === 'solved') {
        /* Time and best both belong to the state line. Hanging the best time
           off the row's end squeezed the deck until the puzzle's own
           description truncated — the row's last column is for the chevron. */
        line = stateLine('is-done', ICON.check, T.solved
          + (st.secs ? ' · ' + mmss(st.secs) : '')
          + (best && best !== st.secs ? ' · সেরা ' + mmss(best) : ''));
      } else if (st.state === 'started') {
        line = stateLine('is-run', ICON.resume, T.resume + ' · ' + toBn(st.done) + '/' + toBn(st.total));
        prog = '<span class="kg-prog"><i style="width:' + Math.round(st.done / st.total * 100) + '%"></i></span>';
      } else {
        line = stateLine('is-new', ICON.play, T.play);
      }

      var thumb = h.key === 'xw' ? xwThumb(p.id, st) : wsThumb(st);
      var end = ICON.chev;

      var a = document.createElement('a');
      a.className = 'kg-game';
      a.href = h.href + '#p=' + p.id;
      a.innerHTML = thumb
        + '<span class="kg-game__body">'
        +   '<span class="kg-game__t">' + h.name + '</span>'
        +   '<span class="kg-game__d">' + deck + '</span>'
        +   line + prog
        + '</span>'
        + '<span class="kg-game__end">' + end + '</span>';
      li.appendChild(a);

      if (st.state === 'solved') {
        var sh = document.createElement('button');
        sh.type = 'button';
        sh.className = 'pa-btn pa-btn--ghost';
        sh.style.cssText = 'margin:0 0 var(--pa-s-3);min-height:2.25rem;padding-inline:var(--pa-s-3);font-size:var(--pa-size-meta)';
        sh.innerHTML = ICON.share + '<span style="margin-inline-start:.35rem">' + T.share + '</span>';
        sh.onclick = function () { openShare(h, p, st, best); };
        li.appendChild(sh);
      }
      host.appendChild(li);
    });

    renderNext();
  }

  function soonRow(h, why) {
    return '<div class="kg-game is-soon">'
      + soonThumb(h.key)
      + '<span class="kg-game__body">'
      +   '<span class="kg-game__t">' + h.name + '</span>'
      +   '<span class="kg-game__d">' + h.note + '</span>'
      +   '<span class="kg-game__s">' + ICON.lock + (why || (T.soon + ' · ' + (h.when || ''))) + '</span>'
      + '</span>'
      + '<span class="kg-game__end"></span>'
      + '</div>';
  }

  /* ---- render: next edition ------------------------------------------------ */

  function renderNext() {
    var now = new Date();
    var mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var ms = mid - now;
    var hh = Math.floor(ms / 3600000);
    var mm = Math.floor((ms % 3600000) / 60000);
    el('next-line').innerHTML = 'আগামীকালের ধাঁধা আসবে <b>' + toBn(hh) + ' ঘণ্টা ' + toBn(mm) + ' মিনিট</b> পরে';
  }

  /* ---- render: catalogue ---------------------------------------------------- */

  function renderCatalogue() {
    var host = el('catalogue');
    var total = CATALOGUE.reduce(function (n, g) { return n + g.items.length; }, 0);
    el('cat-meta').textContent = toBn(total) + 'টি · ' + T.soon;
    host.innerHTML = CATALOGUE.map(function (g) {
      return '<div class="kg-cat">'
        + '<h3 class="kg-cat__h">' + g.h + '</h3>'
        + '<ul class="kg-idx">'
        + g.items.map(function (n) {
            return '<li><span>' + n + '</span><span class="kg-idx__lead"></span>'
              + '<span class="kg-idx__mark">' + ICON.lockMark + '</span>'
              + '<span class="pa-sr">' + T.soon + '</span></li>';
          }).join('')
        + '</ul></div>';
    }).join('');
  }

  /* ---- stats sheet ---------------------------------------------------------- */

  function openSheet(sheet) {
    sheet.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
    var panel = sheet.querySelector('.pa-sheet__panel');
    if (panel) panel.focus();
  }
  function closeSheet(sheet) {
    sheet.classList.remove('is-open');
    setTimeout(function () { sheet.hidden = true; }, 260);
  }

  function gameStats(key) {
    var map = key === 'xw' ? XW : WS;
    var store = key === 'xw' ? XW_STORE : WS_STORE;
    var bestPre = key === 'xw' ? XW_BEST : WS_BEST;
    var played = 0, solved = 0, best = 0, run = 0, maxRun = 0, lastKept = null;

    map.puzzles.forEach(function (p) {
      var st = statusFor(key, p.date);
      if (st.state === 'started' || st.state === 'solved') played++;
      if (st.state === 'solved') {
        solved++;
        var b = bestOf(bestPre, p.id) || st.secs;
        if (b && (!best || b < best)) best = b;
      }
    });

    /* Per-game streak walks back day by day on the same rule the ledger uses:
       today still open does not break the run, it puts it at risk. Counting
       from the pack's last entry instead reported ০ to a reader on a six-day
       streak, because the day was not over yet. */
    var cur = statusFor(key, TODAY_ISO).state === 'solved' ? TODAY : addDays(TODAY, -1);
    while (statusFor(key, iso(cur)).state === 'solved' && run < 400) {
      run++; cur = addDays(cur, -1);
    }

    var streakRun = 0;
    map.puzzles.forEach(function (p) {
      var solvedHere = statusFor(key, p.date).state === 'solved';
      if (solvedHere) {
        var gap = lastKept ? Math.round((parseISO(p.date) - parseISO(lastKept)) / 86400000) : 0;
        streakRun = gap === 1 ? streakRun + 1 : 1;
        lastKept = p.date;
      } else { streakRun = 0; }
      if (streakRun > maxRun) maxRun = streakRun;
    });

    return { played: played, solved: solved, best: best, run: run, max: maxRun, store: store };
  }

  function renderStats() {
    var s = streak();
    var host = el('stats-body');
    var out = '';

    out += '<div class="kg-stats__g">'
      + '<h4 class="kg-stats__t">সব খেলা মিলিয়ে</h4>'
      + '<dl class="kg-nums">'
      +   '<div><dt>বর্তমান ধারা</dt><dd>' + toBn(s.n) + '</dd></div>'
      +   '<div><dt>সর্বোচ্চ ধারা</dt><dd>' + toBn(maxStreak()) + '</dd></div>'
      +   '<div><dt>এই সপ্তাহে</dt><dd>' + toBn(weekKeptCount()) + '</dd></div>'
      +   '<div><dt>মোট সমাধান</dt><dd>' + toBn(totalSolved()) + '</dd></div>'
      + '</dl>'
      + weekBars()
      + '</div>';

    HEROES.filter(function (h) { return h.live; }).forEach(function (h) {
      var g = gameStats(h.key);
      out += '<div class="kg-stats__g">'
        + '<h4 class="kg-stats__t">' + h.name + '</h4>'
        + '<dl class="kg-nums">'
        +   '<div><dt>খেলা হয়েছে</dt><dd>' + toBn(g.played) + '</dd></div>'
        +   '<div><dt>সমাধান</dt><dd>' + toBn(g.solved) + '</dd></div>'
        +   '<div><dt>ধারা</dt><dd>' + toBn(g.run) + '</dd></div>'
        +   '<div><dt>দ্রুততম</dt><dd>' + (g.best ? mmss(g.best) : '—') + '</dd></div>'
        + '</dl></div>';
    });

    var on = demoActive();
    out += '<div class="kg-demo">'
      + '<div class="kg-demo__row">'
      +   '<div><div class="kg-demo__l">ডেমো রেকর্ড</div>'
      +   '<p class="kg-demo__h">' + (on
            ? 'আগের দিনগুলোর সমাধান নমুনা হিসেবে দেখানো হচ্ছে। আজকের দিন সবসময় আসল।'
            : 'শুধু আসল খেলার হিসাব দেখানো হচ্ছে।') + '</p></div>'
      +   '<button type="button" class="pa-btn pa-btn--ghost" id="demo-toggle">' + (on ? 'বন্ধ করুন' : 'চালু করুন') + '</button>'
      + '</div>'
      + '<div class="kg-demo__row">'
      +   '<div><div class="kg-demo__l">সব অগ্রগতি মুছুন</div>'
      +   '<p class="kg-demo__h">এই ব্রাউজারে রাখা সব সমাধান ও সময় মুছে যাবে।</p></div>'
      +   '<button type="button" class="pa-btn pa-btn--ghost" id="wipe">মুছুন</button>'
      + '</div></div>';

    host.innerHTML = out;

    el('demo-toggle').onclick = function () {
      setDemo(!demoActive());
      renderStats(); renderWeek(); renderDay();
    };
    el('wipe').onclick = function () {
      if (!window.confirm('এই ব্রাউজারে রাখা সব অগ্রগতি মুছে ফেলা হবে। চালিয়ে যাবেন?')) return;
      try {
        var kill = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf('pa-xw') === 0 || k.indexOf('pa:ws-bn') === 0)) kill.push(k);
        }
        kill.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
      _hasReal = null;
      renderStats(); renderWeek(); renderDay();
    };
  }

  function weekKeptCount() {
    var n = 0, i;
    for (i = 0; i < 7; i++) {
      var d = addDays(weekStart(TODAY), i);
      if (d <= TODAY && kept(iso(d))) n++;
    }
    return n;
  }

  function totalSolved() {
    var n = 0;
    XW.puzzles.forEach(function (p) { if (statusFor('xw', p.date).state === 'solved') n++; });
    WS.puzzles.forEach(function (p) { if (statusFor('ws', p.date).state === 'solved') n++; });
    return n;
  }

  function weekBars() {
    var bars = '', labels = '', i;
    for (i = 13; i >= 0; i--) {
      var d = addDays(TODAY, -i);
      var rec = dayRecord(iso(d));
      var h = rec.solved ? (rec.solved >= 2 ? 100 : 55) : (rec.started ? 25 : 0);
      bars += '<i class="' + (h ? (i === 0 ? 'is-today' : '') : 'is-none') + '" style="height:' + Math.max(h, 4) + '%"></i>';
    }
    labels = '<span>' + shortDate(addDays(TODAY, -13)) + '</span><span>আজ</span>';
    return '<div class="kg-bars">' + bars + '</div><div class="kg-bars__l">' + labels + '</div>';
  }

  /* ---- share sheet ------------------------------------------------------------ */

  function openShare(h, p, st, best) {
    var host = el('share-body');
    var d = parseISO(p.date);
    var grid = '';
    var cols = 8;

    /* The card carries the grid's silhouette, which is what a solver
       recognises — blocks against open squares, the way the puzzle prints.
       Filling every solved square with spot red made a red wall that says
       nothing and breaks the two-ink discipline. */
    if (h.key === 'xw' && GRIDS[p.id]) {
      GRIDS[p.id].forEach(function (c) { grid += '<i class="' + (c === null ? 'b' : '') + '"></i>'; });
    } else {
      for (var i = 0; i < 64; i++) grid += '<i></i>';
    }

    /* A streak of zero is not a result worth carrying out of the product. */
    var run = streak().n;
    var line = 'প্রথম আলো · খেলাঘর\n' + h.name + ' · ' + shortDate(d) + '\n'
      + 'সময় ' + mmss(st.secs || 0) + (best && best !== st.secs ? ' · সেরা ' + mmss(best) : '')
      + (run ? '\nধারা ' + toBn(run) + ' দিন' : '');

    host.innerHTML = '<div class="kg-share__card">'
      + '<p class="kg-share__t">' + h.name + '</p>'
      + '<div class="kg-share__rule"></div>'
      + '<p class="kg-share__d">' + longDate(d) + '</p>'
      + '<div class="kg-share__grid" style="grid-template-columns:repeat(' + cols + ',12px)">' + grid + '</div>'
      + '<p class="kg-share__m">সময় ' + mmss(st.secs || 0) + (run ? ' · ধারা ' + toBn(run) + ' দিন' : '') + '</p>'
      + '</div>'
      + '<p class="kg-share__x">ফলাফল লেখা হিসেবে পাঠানো হবে</p>'
      + '<div class="kg-share__acts">'
      +   '<button type="button" class="pa-btn pa-btn--primary" id="share-go">লেখা পাঠান</button>'
      +   '<button type="button" class="pa-btn pa-btn--ghost" id="share-copy">কপি করুন</button>'
      + '</div>'
      + '<p class="kg-copied" id="share-msg"></p>';

    el('share-go').onclick = function () {
      if (navigator.share) {
        navigator.share({ title: 'প্রথম আলো · খেলাঘর', text: line }).catch(function () {});
      } else { copy(line); }
    };
    el('share-copy').onclick = function () { copy(line); };

    openSheet(el('sheet-share'));
  }

  function copy(text) {
    var done = function () { el('share-msg').textContent = 'কপি হয়েছে'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
      return;
    }
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---- data ------------------------------------------------------------------- */

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function indexBy(list) {
    var m = {};
    list.forEach(function (p) {
      if (!p.date && /^pa-\d{4}-\d{2}-\d{2}$/.test(p.id)) p.date = p.id.slice(3);
      m[p.date] = p;
    });
    return m;
  }

  function boot() {
    renderHead();
    renderCatalogue();

    var jobs = [
      getJSON('../games/crossword-bn/puzzles/index.json').then(function (j) {
        XW.puzzles = (j.puzzles || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        XW.byDate = indexBy(XW.puzzles);
      }).catch(function () {}),
      getJSON('../games/word-search-bn/puzzles/index.json').then(function (j) {
        WS.puzzles = (j.puzzles || []).slice();
        WS.byDate = indexBy(WS.puzzles);
        WS.puzzles.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      }).catch(function () {})
    ];

    Promise.all(jobs).then(function () {
      var shown = issueFor(XW, selected);
      if (!shown) { renderWeek(); renderDay(); return; }
      return getJSON('../games/crossword-bn/puzzles/' + shown.p.id + '.json')
        .then(function (p) { GRIDS[p.id] = p.grid; })
        .catch(function () {});
    }).then(function () {
      renderWeek();
      renderDay();
      setInterval(renderNext, 30000);
    });

    el('chip').onclick = function () { renderStats(); openSheet(el('sheet-stats')); };
    el('wk-prev').onclick = function () { weekOf = addDays(weekOf, -7); renderWeek(); };
    el('wk-next').onclick = function () {
      if (addDays(weekOf, 7) > TODAY) return;
      weekOf = addDays(weekOf, 7); renderWeek();
    };

    document.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-close]') : null;
      if (c) closeSheet(c.closest('.pa-sheet'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['sheet-stats', 'sheet-share'].forEach(function (id) {
        var s = el(id);
        if (s && !s.hidden) closeSheet(s);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
