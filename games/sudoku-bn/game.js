/*
 * সুডোকু — the daily sudoku.
 *
 * The pack ships GIVENS ONLY. Each board has exactly one solution by
 * construction (see puzzles/build-pack.mjs), so shipping the answer would be
 * shipping something derivable — and a solution string sitting in the JSON is
 * a solution string a curious reader can open in a new tab. It is solved here
 * at load instead, once, in about a millisecond.
 *
 * THE GAME KEEPS NO SCORE AGAINST THE READER. There is no mistake counter, no
 * lives, no failure. A wrong numeral is allowed to sit there like pencil on
 * newsprint. Two things speak without being asked, and only two:
 *
 *   - a contradiction VISIBLE ON THE BOARD (the same numeral twice in a row,
 *     column or box) inks both offenders deep red. This tells the reader
 *     nothing the page does not already show them, so it costs nothing.
 *   - when the last empty square is filled and the grid is not correct, the
 *     head slot says so once. It states and stops; it marks nothing.
 *
 * Everything about the SOLUTION is behind পরীক্ষা, which the reader asks for.
 * It is unlimited and counted, and the count is reported on the completion
 * card — "unaided" means zero.
 */
(function () {
  'use strict';

  var B = window.BnText;

  var MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  var DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

  /* Every user-visible string this module writes. Static copy stays in the
     markup; this is the half that changes with state. */
  var T = {
    today: 'আজকের ধাঁধা',
    recent: 'সাম্প্রতিক ধাঁধা',
    start: 'শুরু করুন',
    resume: 'চালিয়ে যান',
    review: 'আবার দেখুন',
    fresh: 'নতুন',
    solved: 'সম্পূর্ণ',
    cells: ' ঘর ভরা',
    of: ' / ',
    givens: 'টি সংখ্যা দেওয়া',
    packCount: 'টি ধাঁধা',
    todayBadge: 'আজ',
    latestBadge: 'সর্বশেষ',
    newBest: 'নতুন সেরা সময়',
    firstSolve: 'প্রথমবার সমাধান',
    unaided: 'একবারও পরীক্ষা না করে',
    puzzle: ' ধাঁধা',
    coach: 'নিশ্চিত না হলে পেন্সিল চেপে সম্ভাব্য সংখ্যা টুকে রাখুন।',
    full: 'কিছু সংখ্যা মিলছে না।',
    allRight: 'এ পর্যন্ত সব ঠিক আছে।',
    numsBn: 'বাংলা',
    numsEn: 'ইংরেজি',
    ariaCell: ' নম্বর ঘর, সারি ',
    ariaCol: ', কলাম ',
    ariaGiven: ', ছাপা',
    ariaEmpty: 'খালি'
  };

  var DIFF = { easy: 'সহজ', medium: 'মাঝারি', hard: 'কঠিন' };

  var STORE = 'pa:sd-bn:';
  var BEST = 'pa:sd-bn:best:';
  /* Programme-wide, deliberately not namespaced to this game: a reader who
     wants Arabic numerals wants them on every surface, so the hub and the
     other heroes can read this same key rather than inventing a second
     switch that disagrees with this one. */
  var NUM_KEY = 'pa:numerals';
  var COACH_KEY = 'pa:sd-bn:coach';

  var PACK = null;      // puzzles/index.json
  var P = null;         // active puzzle { id, d, given[], sol[] }
  var entries = [];     // 81 — the reader's own numerals, 0 for empty
  var marks = [];       // 81 — arrays of pencil digits
  var wrong = [];       // 81 — caught by পরীক্ষা, cleared when the cell changes
  var checks = 0;
  var sel = -1;
  var pencil = false;
  var undoStack = [];
  var placed = 0;       // placements this session, for retiring the coach
  var cells = [];       // flat 81 element lookup
  var solvedFlag = false;

  var clock = { secs: 0, running: false, iv: null };

  function $(id) { return document.getElementById(id); }

  /* ---- geometry --------------------------------------------------------- */

  var PEERS = [];
  var UNITS = [];
  (function buildGeometry() {
    var rows = [], colsU = [], boxes = [], r, c, i;
    for (i = 0; i < 9; i++) { rows.push([]); colsU.push([]); boxes.push([]); }
    for (i = 0; i < 81; i++) {
      r = (i / 9) | 0; c = i % 9;
      rows[r].push(i);
      colsU[c].push(i);
      boxes[((r / 3) | 0) * 3 + ((c / 3) | 0)].push(i);
    }
    UNITS = rows.concat(colsU, boxes);
    for (i = 0; i < 81; i++) {
      r = (i / 9) | 0; c = i % 9;
      var b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
      var seen = {}, list = [];
      var all = rows[r].concat(colsU[c], boxes[b]);
      for (var k = 0; k < all.length; k++) {
        if (all[k] === i || seen[all[k]]) continue;
        seen[all[k]] = 1;
        list.push(all[k]);
      }
      PEERS.push(list);
    }
  }());

  function boxOf(i) { return ((((i / 9) | 0) / 3) | 0) * 3 + (((i % 9) / 3) | 0); }

  /* ---- solving ---------------------------------------------------------- */

  function canPlace(g, i, v) {
    var p = PEERS[i];
    for (var k = 0; k < p.length; k++) if (g[p[k]] === v) return false;
    return true;
  }

  /* Most-constrained-cell backtracking. The pack guarantees exactly one
     solution, so the first one found IS the solution. */
  function solve(given) {
    var g = given.slice();
    function walk() {
      var best = -1, bestN = 10, i, v, n;
      for (i = 0; i < 81; i++) {
        if (g[i]) continue;
        n = 0;
        for (v = 1; v <= 9; v++) if (canPlace(g, i, v)) n++;
        if (n < bestN) { bestN = n; best = i; if (n <= 1) break; }
      }
      if (best === -1) return true;
      if (bestN === 0) return false;
      for (v = 1; v <= 9; v++) {
        if (!canPlace(g, best, v)) continue;
        g[best] = v;
        if (walk()) return true;
        g[best] = 0;
      }
      return false;
    }
    return walk() ? g : null;
  }

  /* ---- numerals ---------------------------------------------------------
     One switch, read everywhere a numeral is written. The board, the clock,
     the dates and the counts all go through here, so the page can never be
     half Bangla and half not. */

  function bnNums() {
    try { return localStorage.getItem(NUM_KEY) !== 'en'; } catch (e) { return true; }
  }
  function num(v) { return bnNums() ? B.toBn(v) : String(v); }

  /* ---- progress & best -------------------------------------------------- */

  function valueAt(i) { return P.given[i] || entries[i] || 0; }
  function filledCount() {
    var n = 0;
    for (var i = 0; i < 81; i++) if (valueAt(i)) n++;
    return n;
  }
  function isGridFull() { return filledCount() >= 81; }
  function isCorrect() {
    for (var i = 0; i < 81; i++) if (valueAt(i) !== P.sol[i]) return false;
    return true;
  }

  /* A stored record can outlive the board it was written against — a pack
     rebuilt on the same dates puts a different puzzle on the same id. Any
     entry landing on a cell that is now a given is discarded on the way in,
     so a stale record can never contradict the printed board. */
  function loadState(id, given) {
    var blank = { e: new Array(81).fill(0), m: {}, t: 0, c: 0, s: false };
    try {
      var raw = localStorage.getItem(STORE + id);
      if (!raw) return blank;
      var v = JSON.parse(raw);
      var e = new Array(81).fill(0), i;
      var str = String(v.e || '');
      for (i = 0; i < 81; i++) {
        var d = +str.charAt(i) || 0;
        e[i] = (d >= 1 && d <= 9 && !given[i]) ? d : 0;
      }
      var m = {};
      for (var k in (v.m || {})) {
        var ki = +k;
        if (ki >= 0 && ki < 81 && !given[ki] && !e[ki]) m[ki] = String(v.m[k]).split('').map(Number).filter(function (x) { return x >= 1 && x <= 9; });
      }
      return { e: e, m: m, t: v.t || 0, c: v.c || 0, s: !!v.s };
    } catch (err) { return blank; }
  }

  function saveState() {
    if (!P) return;
    try {
      var e = '', mo = {}, i;
      for (i = 0; i < 81; i++) {
        e += entries[i] ? String(entries[i]) : '0';
        if (marks[i] && marks[i].length) mo[i] = marks[i].join('');
      }
      localStorage.setItem(STORE + P.id, JSON.stringify({ e: e, m: mo, t: clock.secs, c: checks, s: solvedFlag }));
    } catch (err) {}
  }

  /* The hub cannot verify a sudoku — it does not have the solution — so the
     solved flag is written here and read there. Progress is counted from the
     stored entries, which needs no solution at all. */
  function recordOf(id) {
    try {
      var raw = localStorage.getItem(STORE + id);
      if (!raw) return null;
      var v = JSON.parse(raw);
      var n = 0, str = String(v.e || '');
      for (var i = 0; i < 81; i++) if (+str.charAt(i)) n++;
      return { filled: n, secs: v.t || 0, solved: !!v.s, checks: v.c || 0 };
    } catch (e) { return null; }
  }

  function bestOf(id) {
    var v = parseInt(localStorage.getItem(BEST + id) || '0', 10);
    return v > 0 ? v : 0;
  }

  /* ---- clock ------------------------------------------------------------ */

  function fmt(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return num(m) + ':' + num(s < 10 ? '0' + s : String(s));
  }

  function paintClock() {
    var el = $('timer');
    el.textContent = fmt(clock.secs);
    el.classList.toggle('is-done', solvedFlag);
  }

  function clockStart() {
    if (clock.running || solvedFlag) return;
    clock.running = true;
    clock.iv = setInterval(function () {
      clock.secs++;
      paintClock();
      if (clock.secs % 10 === 0) saveState();
    }, 1000);
  }

  function clockStop() {
    clock.running = false;
    if (clock.iv) { clearInterval(clock.iv); clock.iv = null; }
  }

  /* ---- dates ------------------------------------------------------------ */

  function dateFromId(id) {
    var m = /(\d{4})-(\d{2})-(\d{2})$/.exec(id);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function longDate(d) {
    return d ? DAYS[d.getDay()] + ', ' + num(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + num(d.getFullYear()) : '';
  }
  function printDate(d) {
    return d ? num(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + num(d.getFullYear()) : '';
  }
  function shortDate(d) {
    return d ? num(d.getDate()) + ' ' + MONTHS[d.getMonth()] : '';
  }
  function todayKey() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function isDue(pz) { return pz.id.slice(-10) <= todayKey(); }

  function pickForToday() {
    var key = todayKey(), i, due = null;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) return { pz: PACK.puzzles[i], isToday: true };
      if (PACK.puzzles[i].id.slice(-10) <= key) due = PACK.puzzles[i];
    }
    return { pz: due || PACK.puzzles[0], isToday: false };
  }

  /* Newest due puzzle the reader has not finished — what the completion card
     offers next. A finished board is never a dead end. */
  function nextUnfinished() {
    for (var i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      if (!isDue(pz) || pz.id === P.id) continue;
      var rec = recordOf(pz.id);
      if (!rec || !rec.solved) return pz;
    }
    return null;
  }

  /* ---- board rendering --------------------------------------------------
     Built once per puzzle as nine boxes of nine cells, so the heavy box rules
     and the hairline cell rules are the same ink showing through two gap
     widths. Everything after that is a class or a text swap on the 81
     elements held in `cells`. */

  function buildBoard() {
    var grid = $('grid'), b, k;
    grid.innerHTML = '';
    cells = new Array(81);
    for (b = 0; b < 9; b++) {
      var box = document.createElement('div');
      box.className = 'sd-box';
      for (k = 0; k < 9; k++) {
        var r = ((b / 3) | 0) * 3 + ((k / 3) | 0);
        var c = (b % 3) * 3 + (k % 3);
        var i = r * 9 + c;
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'sd-cell';
        el.setAttribute('data-i', i);
        box.appendChild(el);
        cells[i] = el;
      }
      grid.appendChild(box);
    }
    paintBoard();
  }

  function dupSet() {
    var dup = {}, u, seen, i, v;
    for (u = 0; u < UNITS.length; u++) {
      seen = {};
      for (i = 0; i < UNITS[u].length; i++) {
        v = valueAt(UNITS[u][i]);
        if (!v) continue;
        if (seen[v] === undefined) seen[v] = UNITS[u][i];
        else { dup[UNITS[u][i]] = 1; dup[seen[v]] = 1; }
      }
    }
    return dup;
  }

  function paintCell(i, dup, selVal, peerOf) {
    var el = cells[i];
    var given = P.given[i];
    var v = given || entries[i];
    var cls = 'sd-cell';
    if (given) cls += ' is-given';
    if (dup[i]) cls += ' is-dup';
    if (wrong[i] && !given) cls += ' is-wrong';
    if (selVal && v === selVal && i !== sel) cls += ' is-same';
    if (peerOf[i]) cls += ' is-peer';
    if (i === sel) cls += ' is-sel';
    el.className = cls;

    var label;
    if (v) {
      el.textContent = num(v);
      label = num(v) + (given ? T.ariaGiven : '');
    } else if (marks[i] && marks[i].length) {
      var html = '';
      for (var d = 1; d <= 9; d++) html += '<span>' + (marks[i].indexOf(d) >= 0 ? num(d) : '') + '</span>';
      el.innerHTML = '<span class="sd-marks">' + html + '</span>';
      label = marks[i].map(num).join(' ');
    } else {
      el.textContent = '';
      label = T.ariaEmpty;
    }
    el.setAttribute('aria-label', label + T.ariaCell + num(((i / 9) | 0) + 1) + T.ariaCol + num((i % 9) + 1));
  }

  function paintBoard() {
    var dup = dupSet();
    var selVal = sel >= 0 ? valueAt(sel) : 0;
    var peerOf = {}, i;
    if (sel >= 0) for (i = 0; i < PEERS[sel].length; i++) peerOf[PEERS[sel][i]] = 1;
    for (i = 0; i < 81; i++) paintCell(i, dup, selVal, peerOf);
    paintPad();
  }

  /* A numeral all nine of which are on the board has nothing left to place.
     The key stays where it is — the pad must never reflow mid-solve — and
     stops being ink. */
  function paintPad() {
    var count = new Array(10).fill(0), i;
    for (i = 0; i < 81; i++) { var v = valueAt(i); if (v) count[v]++; }
    var pad = $('pad').children;
    for (i = 0; i < pad.length; i++) {
      var d = +pad[i].getAttribute('data-d');
      pad[i].textContent = num(d);
      pad[i].classList.toggle('is-done', count[d] >= 9);
    }
  }

  function buildPad() {
    var html = '';
    for (var d = 1; d <= 9; d++) {
      html += '<button type="button" class="sd-key" data-d="' + d + '" aria-label="' + num(d) + '">' + num(d) + '</button>';
    }
    $('pad').innerHTML = html;
  }

  /* ---- head slot --------------------------------------------------------
     One line, one occupant. The band names the difficulty at rest; the coach
     and the grid-full notice each take the whole slot and never stack. */

  function paintBand() {
    $('band').textContent = DIFF[P.d] + T.puzzle;
  }

  /* The board's dateline belongs to the BOARD, so it is painted whenever the
     board is shown — not as a side effect of rendering the front page. A #p=
     deep link from খেলাঘর never touches the front page, and hanging this off
     renderFront left exactly that entry — the one the hub actually uses —
     with an empty rule under the nameplate. */
  function paintDates() {
    var d = dateFromId(P.id);
    $('board-date').textContent = printDate(d);
    $('date').textContent = longDate(new Date());          // the paper's own date
  }

  function showNote(kind, text, withAction) {
    $('note-text').textContent = text;
    $('note-act').hidden = !withAction;
    $('head').setAttribute('data-note', kind);
    $('head').classList.add('has-note');
  }

  function hideNote() {
    $('head').classList.remove('has-note');
    $('head').removeAttribute('data-note');
  }

  function noteKind() { return $('head').getAttribute('data-note'); }

  /* Shown once ever, carrying the one non-obvious interaction, and retiring
     itself after the third placement rather than waiting to be dismissed — it
     is spending height a 640dp screen needs for the board. */
  function maybeCoach() {
    if (solvedFlag) return;
    try { if (localStorage.getItem(COACH_KEY)) return; } catch (e) { return; }
    showNote('coach', T.coach, false);
  }

  function retireCoach() {
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {}
    if (noteKind() === 'coach') hideNote();
  }

  /* Fires only when the board is already full, so it does not restate that;
     it says the one thing the reader does not know. Once per fill: it returns
     only after the board stops being full and becomes full again, so
     correcting a single square does not nag. */
  var fullNoticeArmed = true;
  function checkGridFull() {
    if (!isGridFull()) { fullNoticeArmed = true; return; }
    if (isCorrect()) return;
    if (!fullNoticeArmed) return;
    fullNoticeArmed = false;
    showNote('full', T.full, true);
  }

  /* ---- editing ---------------------------------------------------------- */

  function snapshot() {
    undoStack.push({
      e: entries.slice(),
      m: marks.map(function (a) { return a ? a.slice() : []; }),
      w: wrong.slice()
    });
    if (undoStack.length > 200) undoStack.shift();
    $('t-undo').disabled = false;
  }

  function undo() {
    var s = undoStack.pop();
    if (!s) return;
    entries = s.e;
    marks = s.m;
    wrong = s.w;
    $('t-undo').disabled = !undoStack.length;
    fullNoticeArmed = true;
    saveState();
    paintBoard();
  }

  function selectCell(i) {
    sel = i;
    paintBoard();
  }

  function toggleMark(i, d) {
    var list = marks[i] || (marks[i] = []);
    var at = list.indexOf(d);
    if (at >= 0) list.splice(at, 1);
    else { list.push(d); list.sort(); }
  }

  /* Placing a numeral wipes that numeral's pencil marks from its row, column
     and box. Doing it by hand is twenty taps of bookkeeping a machine should
     do, and undo puts them all back because the snapshot covers marks too. */
  function clearPeerMarks(i, d) {
    for (var k = 0; k < PEERS[i].length; k++) {
      var p = PEERS[i][k], list = marks[p];
      if (!list || !list.length) continue;
      var at = list.indexOf(d);
      if (at >= 0) list.splice(at, 1);
    }
  }

  function input(d) {
    if (sel < 0 || solvedFlag) return;
    var i = sel;
    if (P.given[i]) return;                       // printed: not yours to change

    snapshot();

    if (pencil) {
      /* A pencil mark on a cell that already carries a numeral is a
         contradiction of the reader's own making — the numeral goes, and the
         mark takes its place, which is what they meant by reaching for the
         pencil at all. */
      if (entries[i]) { entries[i] = 0; wrong[i] = false; }
      toggleMark(i, d);
    } else if (entries[i] === d) {
      entries[i] = 0;                             // same numeral again clears it
      wrong[i] = false;
    } else {
      entries[i] = d;
      marks[i] = [];
      wrong[i] = false;
      clearPeerMarks(i, d);
      placed++;
      if (placed >= 3) retireCoach();
    }

    if (noteKind() === 'full') hideNote();
    saveState();
    paintBoard();
    checkGridFull();
    if (isCorrect()) win();
  }

  function erase() {
    if (sel < 0 || solvedFlag) return;
    var i = sel;
    if (P.given[i]) return;
    if (!entries[i] && !(marks[i] && marks[i].length)) return;
    snapshot();
    entries[i] = 0;
    marks[i] = [];
    wrong[i] = false;
    fullNoticeArmed = true;
    if (noteKind() === 'full') hideNote();
    saveState();
    paintBoard();
  }

  /* The only assist, and the only thing in the game that knows the solution.
     Unlimited, counted, and it marks rather than corrects: the reader is told
     WHICH squares are wrong, never what belongs there. */
  function check() {
    if (solvedFlag) return;
    var any = false;
    for (var i = 0; i < 81; i++) {
      wrong[i] = !P.given[i] && !!entries[i] && entries[i] !== P.sol[i];
      if (wrong[i]) any = true;
    }
    checks++;
    $('t-check-n').textContent = checks ? num(checks) : '';
    retireCoach();
    saveState();
    paintBoard();
    /* Nothing wrong is still an answer, and the reader asked for it — but it
       is an answer with a shelf life, so it retires itself rather than
       sitting on the board's height for the rest of the puzzle. */
    if (!any) {
      showNote('reply', T.allRight, false);
      clearTimeout(replyHold);
      replyHold = setTimeout(function () { if (noteKind() === 'reply') hideNote(); }, 2600);
    } else hideNote();
  }
  var replyHold = null;

  function resetPuzzle() {
    snapshot();
    entries = new Array(81).fill(0);
    marks = new Array(81).fill(null).map(function () { return []; });
    wrong = new Array(81).fill(false);
    checks = 0;
    solvedFlag = false;
    clock.secs = 0;
    fullNoticeArmed = true;
    $('t-check-n').textContent = '';
    hideNote();
    saveState();
    paintBoard();
    paintClock();
  }

  /* ---- completion ------------------------------------------------------- */

  function solveSweep() {
    for (var i = 0; i < 81; i++) {
      var d = (((i / 9) | 0) + (i % 9)) * 16;
      cells[i].style.setProperty('--d', d + 'ms');
      cells[i].classList.remove('is-solved');
      void cells[i].offsetWidth;
      cells[i].classList.add('is-solved');
      (function (el, ms) { setTimeout(function () { el.classList.remove('is-solved'); }, ms); }(cells[i], d + 640));
    }
  }

  function win() {
    if (solvedFlag) return;
    solvedFlag = true;
    clockStop();
    sel = -1;
    hideNote();
    retireCoach();
    saveState();

    var prev = bestOf(P.id);
    var isBest = !prev || clock.secs < prev;
    if (isBest) { try { localStorage.setItem(BEST + P.id, String(clock.secs)); } catch (e) {} }

    emit('game:complete', { id: P.id, difficulty: P.d, secs: clock.secs, checks: checks });

    $('win-diff').textContent = DIFF[P.d] + T.puzzle;
    $('win-time').textContent = fmt(clock.secs);
    $('win-best').textContent = fmt(isBest ? clock.secs : prev);
    $('win-checks').textContent = num(checks);
    $('win-note').textContent = checks === 0 ? T.unaided
      : (!prev ? T.firstSolve : (isBest ? T.newBest : ''));
    paintClock();
    paintBoard();

    /* The board gets its moment before the card covers it: the sweep is
       ~560ms plus a 16-square diagonal at 16ms. */
    solveSweep();
    setTimeout(function () { openSheet($('sheet-win')); }, 1150);
  }

  function emit(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: type, game: 'sudoku', data: data || {} }, '*');
      }
    } catch (e) {}
  }

  /* ---- front page ------------------------------------------------------- */

  function renderFront() {
    var d = dateFromId(P.id);
    var pick = pickForToday();
    var isToday = pick.isToday && pick.pz.id === P.id;

    $('fp-kicker').textContent = isToday ? T.today : T.recent;
    $('fp-kicker').classList.toggle('is-stale', !isToday);
    $('fp-date').textContent = printDate(d);
    $('fp-diff').textContent = DIFF[P.d] + T.puzzle;
    paintDates();
    $('fp-size').textContent = num(9) + '×' + num(9) + ' · ' + num(P.n) + T.givens;
    $('fp-archive-meta').textContent = num(PACK.puzzles.length) + T.packCount;
    $('fp-aside-count').textContent = num(PACK.puzzles.length) + T.packCount;
    $('fp-settings-meta').textContent = bnNums() ? T.numsBn : T.numsEn;
    renderArchive();

    var filled = filledCount(), dot = $('fp-dot');
    dot.className = 'sd-dot' + (solvedFlag ? ' is-solved' : (filled > P.n ? ' is-started' : ''));
    $('fp-state').textContent = solvedFlag ? T.solved + ' · ' + fmt(clock.secs)
      : (filled > P.n ? num(filled) + T.of + num(81) + T.cells : T.fresh);
    $('fp-cta').textContent = solvedFlag ? T.review : (filled > P.n ? T.resume : T.start);

    var html = '';
    for (var i = 0; i < 81; i++) {
      html += '<i' + (P.given[i] ? ' class="is-given"' : (entries[i] ? ' class="is-filled"' : '')) + '></i>';
    }
    $('fp-mini').innerHTML = html;
  }

  function renderArchive() {
    var key = todayKey(), hasToday = false, latestDue = null, i;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) hasToday = true;
      if (isDue(PACK.puzzles[i])) latestDue = PACK.puzzles[i].id;
    }

    /* Newest first — a reader opening the list wants today at the top, not a
       fortnight ago. Same order শব্দভেদ and শব্দ সন্ধান use. */
    var html = '';
    for (i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      var due = isDue(pz);
      var rec = pz.id === P.id
        ? { filled: filledCount(), solved: solvedFlag }
        : recordOf(pz.id);
      var filled = rec ? rec.filled : 0;
      var isSolved = rec && rec.solved;
      var started = !isSolved && filled > 0 && (pz.id === P.id ? filled > pz.n : true);
      var dotCls = isSolved ? ' is-solved' : (started ? ' is-started' : '');
      var label = isSolved ? T.solved : (started ? num(pz.id === P.id ? filled : filled + pz.n) + T.of + num(81) : T.fresh);
      var badge = pz.id.slice(-10) === key
        ? '<span class="sd-arcrow__badge">' + T.todayBadge + '</span>'
        : (!hasToday && pz.id === latestDue ? '<span class="sd-arcrow__badge is-latest">' + T.latestBadge + '</span>' : '');
      var best = (isSolved && bestOf(pz.id)) ? fmt(bestOf(pz.id)) : '';

      html += '<button type="button" class="sd-arcrow" data-id="' + pz.id + '"'
        + (pz.id === P.id ? ' aria-current="true"' : '') + (due ? '' : ' disabled') + '>'
        + '<span class="sd-arcrow__date">' + shortDate(dateFromId(pz.id)) + '</span>' + badge
        + '<span class="sd-arcrow__diff">' + DIFF[pz.d] + '</span>'
        + '<span class="sd-arcrow__state"><i class="sd-dot' + dotCls + '" aria-hidden="true"></i>' + label + '</span>'
        + '<span class="sd-arcrow__time">' + best + '</span></button>';
    }
    $('arch-list').innerHTML = html;
    $('fp-archlist').innerHTML = html;
  }

  /* ---- views & sheets --------------------------------------------------- */

  function goFront() {
    clockStop();
    saveState();
    renderFront();
    $('app').setAttribute('data-view', 'front');
  }

  function goBoard() {
    buildBoard();
    paintBand();
    paintDates();
    paintClock();
    $('t-check-n').textContent = checks ? num(checks) : '';
    $('t-undo').disabled = !undoStack.length;
    $('app').setAttribute('data-view', 'board');
    sizeBoard();
    maybeCoach();
    clockStart();
  }

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

  /* The grid is square and shares the viewport with a docked deck, so its
     size is bounded by height as often as by width. Measure, then hand the
     side to CSS — a vw-only guess overflows on short screens. */
  function sizeBoard() {
    var wrap = $('board-main');
    if (!wrap || !wrap.clientWidth) return;
    var cs = window.getComputedStyle(wrap);
    var w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var max = parseFloat(cs.getPropertyValue('--sd-max')) || 544;
    var side = Math.max(234, Math.min(w, h, max));
    /* Snapped so the nine cells divide the remaining width evenly. The ink is
       18px of the side and never scales: 3px of padding either side, a 3px
       gutter between the three boxes twice, and a 1px gutter twice inside
       each of the three boxes across. A fractional cell size lands the box
       rules on half-pixels, and a printed grid with uneven rules is the one
       thing this board cannot be. */
    side = Math.floor((side - 18) / 9) * 9 + 18;
    $('grid').style.setProperty('--sd-side', side + 'px');
  }

  /* ---- input binding ---------------------------------------------------- */

  function bindBoard() {
    $('grid').addEventListener('click', function (e) {
      var btn = e.target.closest('.sd-cell');
      if (!btn) return;
      selectCell(+btn.getAttribute('data-i'));
    });

    $('pad').addEventListener('click', function (e) {
      var btn = e.target.closest('.sd-key');
      if (!btn) return;
      input(+btn.getAttribute('data-d'));
    });

    $('t-pencil').onclick = function () {
      pencil = !pencil;
      $('t-pencil').setAttribute('aria-pressed', pencil ? 'true' : 'false');
      retireCoach();
    };
    $('t-undo').onclick = undo;
    $('t-erase').onclick = erase;
    $('t-check').onclick = check;
    $('note-act').onclick = check;
    $('note-x').onclick = function () {
      if (noteKind() === 'coach') retireCoach();
      hideNote();
    };

    /* On a desktop the physical keyboard is the input and the pad is the
       touch fallback, so both stay live — the pad is nine keys and never
       takes enough height to be worth hiding. */
    document.addEventListener('keydown', function (e) {
      if ($('app').getAttribute('data-view') !== 'board') return;
      if (document.querySelector('.pa-sheet.is-open')) return;
      var k = e.key;
      if (k >= '1' && k <= '9') { input(+k); e.preventDefault(); return; }
      if (k >= '১' && k <= '৯') { input(k.charCodeAt(0) - 0x09E6); e.preventDefault(); return; }
      if (k === 'Backspace' || k === 'Delete' || k === '0') { erase(); e.preventDefault(); return; }
      if (k === 'p' || k === 'P') { $('t-pencil').click(); e.preventDefault(); return; }
      var move = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
      if (move === undefined) return;
      e.preventDefault();
      if (sel < 0) { selectCell(0); return; }
      var next = sel + move;
      if (move === -1 && sel % 9 === 0) return;
      if (move === 1 && sel % 9 === 8) return;
      if (next < 0 || next > 80) return;
      selectCell(next);
    });
  }

  function bind() {
    $('exit').onclick = function () {
      emit('game:exit');
      if (history.length > 1) history.back(); else location.href = '../../hub/index.html';
    };
    /* Back goes up one level, not out: the board returns to the front page,
       and only the front page leaves for the portal. */
    $('back').onclick = goFront;
    $('fp-cta').onclick = goBoard;

    function showHowto() { openSheet($('sheet-howto')); }
    function showArchive() { renderArchive(); openSheet($('sheet-arch')); }
    function showSettings() { openSheet($('sheet-set')); }

    $('fp-howto').onclick = showHowto;
    $('top-howto').onclick = showHowto;
    $('fp-archive').onclick = showArchive;
    $('dateline').onclick = showArchive;
    $('fp-settings').onclick = showSettings;
    $('board-more').onclick = showSettings;

    $('set-howto').onclick = function () { closeSheet($('sheet-set')); showHowto(); };
    $('set-arch').onclick = function () { closeSheet($('sheet-set')); showArchive(); };
    $('set-reset').onclick = function () { closeSheet($('sheet-set')); resetPuzzle(); };
    $('set-num').onclick = function () {
      var on = !bnNums();
      try { localStorage.setItem(NUM_KEY, on ? 'bn' : 'en'); } catch (e) {}
      $('set-num').setAttribute('aria-checked', on ? 'true' : 'false');
      repaintNumerals();
    };

    function pickFromList(e) {
      var row = e.target.closest('.sd-arcrow');
      if (!row || row.disabled) return;
      var id = row.getAttribute('data-id');
      for (var i = 0; i < PACK.puzzles.length; i++) {
        if (PACK.puzzles[i].id === id) { closeSheet($('sheet-arch')); openPuzzle(PACK.puzzles[i], false); break; }
      }
    }
    $('arch-list').addEventListener('click', pickFromList);
    $('fp-archlist').addEventListener('click', pickFromList);

    $('win-next').onclick = function () {
      closeSheet($('sheet-win'));
      var pz = nextUnfinished();
      if (pz) openPuzzle(pz, true); else showArchive();
    };
    $('win-board').onclick = function () { closeSheet($('sheet-win')); };
    $('win-front').onclick = function () { closeSheet($('sheet-win')); goFront(); };

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { closeSheet(b.closest('.pa-sheet')); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.pa-sheet__scrim'), function (s) {
      s.onclick = function () { closeSheet(s.closest('.pa-sheet')); };
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = document.querySelector('.pa-sheet.is-open');
      if (open) { closeSheet(open); return; }
      if (sel >= 0) { sel = -1; paintBoard(); return; }
      if ($('app').getAttribute('data-view') === 'board') goFront();
    });

    /* Time accrued while the tab is in the background is not solving time. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clockStop(); saveState(); }
      else if ($('app').getAttribute('data-view') === 'board' && !solvedFlag) clockStart();
    });

    window.addEventListener('resize', sizeBoard);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeBoard);
  }

  /* Every numeral on the page is written by this module, so the switch is one
     repaint of whichever view is up rather than a reload. */
  function repaintNumerals() {
    if ($('app').getAttribute('data-view') === 'board') {
      paintBoard();
      paintClock();
      paintBand();
      paintDates();
      $('t-check-n').textContent = checks ? num(checks) : '';
    } else {
      renderFront();
    }
  }

  /* ---- boot ------------------------------------------------------------- */

  function loadPuzzle(pz) {
    var given = new Array(81).fill(0), i;
    for (i = 0; i < 81; i++) {
      var ch = pz.g.charAt(i);
      given[i] = ch >= '1' && ch <= '9' ? +ch : 0;
    }
    var sol = solve(given);
    if (!sol) { console.error('no solution for', pz.id); return false; }

    clockStop();
    P = { id: pz.id, d: pz.d, n: pz.n, given: given, sol: sol };
    var st = loadState(P.id, given);
    entries = st.e;
    marks = new Array(81).fill(null).map(function () { return []; });
    for (var k in st.m) marks[+k] = st.m[k];
    wrong = new Array(81).fill(false);
    checks = st.c;
    clock.secs = st.t;
    /* Trust the stored flag only if the board still agrees with it: a pack
       rebuilt under the same id must not inherit someone else's solve. */
    solvedFlag = st.s && isCorrect();
    sel = -1;
    pencil = false;
    placed = 0;
    undoStack = [];
    fullNoticeArmed = true;
    $('t-pencil').setAttribute('aria-pressed', 'false');
    return true;
  }

  function openPuzzle(pz, enter) {
    if (!loadPuzzle(pz)) return;
    if (enter) goBoard(); else goFront();
  }

  /* The one place `#p=` is resolved, so boot and a later hash change cannot
     disagree about what the link means. */
  function puzzleFromHash() {
    var hash = (location.hash.match(/p=([\w-]+)/) || [])[1];
    if (!hash) return null;
    for (var i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id === hash && isDue(PACK.puzzles[i])) return PACK.puzzles[i];
    }
    return null;                      // unknown or not yet due: fall through
  }

  function init() {
    $('set-num').setAttribute('aria-checked', bnNums() ? 'true' : 'false');
    buildPad();

    /* A `#p=` that arrives after boot is the same request as one that arrives
       with it — খেলাঘর links to a dated board, and a reader who follows a
       second such link while the game is already open must land on that
       board rather than on nothing. Ignored when it names the board already
       open, so re-entering the same link does not restart the reader's
       puzzle. */
    window.addEventListener('hashchange', function () {
      if (!PACK) return;
      var pz = puzzleFromHash();
      if (pz && (!P || pz.id !== P.id)) openPuzzle(pz, true);
    });

    fetch('puzzles/index.json')
      .then(function (r) { return r.json(); })
      .then(function (pack) {
        PACK = pack;
        /* A #p= link is a request for THAT board, so it skips the front page.
           An id the game cannot serve — unknown, or not yet due — falls
           through to the ordinary daily, so a stale or future-dated link from
           খেলাঘর degrades to something playable rather than to an error. */
        var wanted = puzzleFromHash();
        if (!loadPuzzle(wanted || pickForToday().pz)) return;
        bind();
        bindBoard();
        if (wanted) goBoard(); else goFront();
      })
      .catch(function (err) {
        console.error(err);
        $('fp-diff').textContent = 'ধাঁধা লোড করা গেল না';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
