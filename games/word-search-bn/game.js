/*
 * শব্দ সন্ধান — Bangla word search.
 *
 * The grid holds aksharas, not characters: কা, ক্ষ and র্ম each occupy one
 * square, exactly as শব্দভেদ does, because a Bangla reader counts syllables
 * and not code points. All segmentation goes through shared/bn-text.js.
 *
 * Grids are GENERATED, not authored (see wsgrid.js). The only content we
 * ship is the word list per day; the layout is a pure function of the puzzle
 * id, so the same date always yields the same grid on every device with no
 * file to author, validate or diff.
 */
(function () {
  'use strict';

  var B = window.BnText;

  var MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
  var DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

  /* Every user-visible string the module writes. Static copy stays in the
     markup; this is the half that changes with state. */
  var T = {
    today: 'আজকের ধাঁধা',
    recent: 'সর্বশেষ ধাঁধা',
    start: 'শুরু করুন',
    resume: 'চালিয়ে যান',
    review: 'আবার দেখুন',
    fresh: 'নতুন ধাঁধা',
    solved: 'সম্পূর্ণ',
    progress: ' শব্দ পাওয়া গেছে',
    of: ' / ',
    words: ' শব্দ',
    packCount: 'টি ধাঁধা',
    stFresh: 'নতুন',
    stRunning: 'চলছে',
    todayBadge: 'আজ',
    latestBadge: 'সর্বশেষ',
    newBest: 'নতুন সেরা সময়',
    firstSolve: 'প্রথমবার সমাধান',
    ariaRow: ', সারি ',
    ariaCol: ', কলাম '
  };

  var SIZE = 8;
  var STORE = 'pa:ws-bn:';
  var BEST = 'pa:ws-bn:best:';

  var PACK = null;      // puzzles/index.json
  var GEN = null;       // wsgrid generator, bound to SIZE
  var P = null;         // active puzzle { id, theme, words, grid, places }
  var found = {};       // word -> true, for the active puzzle
  var sel = null;       // { anchor, cells[] } during a drag

  /* The clock is a count-up that belongs to the BOARD, not to the document.
     Loading a puzzle is not starting one: it holds at zero on the front page
     and pauses whenever the board is not the visible view. */
  var clock = { secs: 0, running: false, iv: null };

  function $(id) { return document.getElementById(id); }
  function idx(r, c) { return r * SIZE + c; }

  /* ---- progress & best -------------------------------------------------- */

  /* Progress is keyed by puzzle id, and an id can outlive the words it was
     stored against — redating or re-authoring the pack puts a different theme
     on the same date. Anything not in THIS puzzle's list is discarded on the
     way in, so stale finds can never be counted, displayed, or written back. */
  function loadState(id, words) {
    try {
      var raw = localStorage.getItem(STORE + id);
      if (!raw) return { w: {}, t: 0 };
      var v = JSON.parse(raw);
      if (Array.isArray(v)) v = { w: v, t: 0 };            // pre-timer format
      var valid = {}, i;
      for (i = 0; i < words.length; i++) valid[words[i]] = true;
      var w = {}, list = v.w || [];
      for (i = 0; i < list.length; i++) if (valid[list[i]]) w[list[i]] = true;
      return { w: w, t: v.t || 0 };
    } catch (e) { return { w: {}, t: 0 }; }
  }

  function saveState() {
    try {
      localStorage.setItem(STORE + P.id, JSON.stringify({ w: P.words.filter(function (w) { return found[w]; }), t: clock.secs }));
    } catch (e) {}
  }

  function bestOf(id) {
    var v = parseInt(localStorage.getItem(BEST + id) || '0', 10);
    return v > 0 ? v : 0;
  }

  function countFound(id, words) {
    var s = loadState(id, words), n = 0;
    for (var i = 0; i < words.length; i++) if (s.w[words[i]]) n++;
    return n;
  }

  /* Count THIS puzzle's words, never the size of the found map. The map can
     hold a key the current puzzle does not contain, and counting those
     declared the board solved while eight words were still on the list. */
  function foundCount() {
    var n = 0;
    for (var i = 0; i < P.words.length; i++) if (found[P.words[i]]) n++;
    return n;
  }

  function isComplete() { return foundCount() >= P.words.length; }

  /* ---- clock ------------------------------------------------------------ */

  function fmt(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return B.toBn(m) + ':' + B.toBn(s < 10 ? '0' + s : String(s));
  }

  function paintClock() {
    var el = $('timer');
    el.textContent = fmt(clock.secs);
    el.classList.toggle('is-done', isComplete());
  }

  function clockStart() {
    if (clock.running || isComplete()) return;
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
    return d ? DAYS[d.getDay()] + ', ' + B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + B.toBn(d.getFullYear()) : '';
  }
  function printDate(d) {
    return d ? B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + B.toBn(d.getFullYear()) : '';
  }
  function shortDate(d) {
    return d ? B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] : '';
  }

  function todayKey() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function isDue(pz) { return pz.id.slice(-10) <= todayKey(); }

  /* Today's puzzle if the pack covers today; otherwise the last one that has
     come due, so the front page never claims a future date is "today". */
  function pickForToday() {
    var key = todayKey(), i, due = null;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) return { pz: PACK.puzzles[i], isToday: true };
      if (PACK.puzzles[i].id.slice(-10) <= key) due = PACK.puzzles[i];
    }
    return { pz: due || PACK.puzzles[0], isToday: false };
  }

  /* Newest due puzzle the reader has not finished — what the completion card
     offers next. A solved board is never a dead end. */
  function nextUnfinished() {
    for (var i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      if (!isDue(pz) || pz.id === P.id) continue;
      if (countFound(pz.id, pz.words) < pz.words.length) return pz;
    }
    return null;
  }

  /* ---- rendering -------------------------------------------------------- */

  /* A four-codepoint conjunct in a 40px square gives back some size or turns
     into a smudge. Step down, never clip — the reading band above the grid is
     the surface that is actually meant to be read. */
  function cellFont(ch) {
    if (ch.length >= 4) return '0.66em';
    if (ch.length === 3) return '0.78em';
    return '1em';
  }

  function renderGrid() {
    var html = '', i;
    for (i = 0; i < P.grid.length; i++) {
      var ch = P.grid[i];
      html += '<button type="button" class="ws-cell" data-i="' + i + '"'
        + ' style="--ws-fs:' + cellFont(ch) + '"'
        + ' aria-label="' + ch + T.ariaRow + B.toBn(Math.floor(i / SIZE) + 1) + T.ariaCol + B.toBn((i % SIZE) + 1) + '">'
        + '<span class="ws-cell__ch">' + ch + '</span></button>';
    }
    $('grid').innerHTML = html;
    paintFound();
  }

  function foundCells() {
    var mark = {}, i, j;
    for (i = 0; i < P.places.length; i++) {
      if (!found[P.places[i].word]) continue;
      for (j = 0; j < P.places[i].cells.length; j++) mark[P.places[i].cells[j]] = true;
    }
    return mark;
  }

  function paintFound() {
    var mark = foundCells(), nodes = $('grid').children;
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-found', !!mark[i]);
  }

  /* Split deliberately. When a word lands, the squares must drop the drag
     tint IMMEDIATELY while the band keeps holding the word it accepted —
     doing both from one function meant the hit path could not clear the
     squares without also wiping the band, so it cleared neither, and the
     answered squares stayed red until the band timer fired 900ms later. */
  function paintSelCells() {
    var on = {}, i;
    if (sel) for (i = 0; i < sel.cells.length; i++) on[sel.cells[i]] = true;
    var nodes = $('grid').children;
    for (i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-sel', !!on[i]);
  }

  /* The band never empties: at rest it names the theme, which is the theme's
     home now that the nameplate carries the game title. */
  function paintBand() {
    var el = $('reading'), i;
    if (sel && sel.cells.length) {
      var s = '';
      for (i = 0; i < sel.cells.length; i++) s += P.grid[sel.cells[i]];
      el.textContent = s;
      el.classList.remove('is-set');
      el.classList.add('is-on');
    } else {
      el.textContent = P.theme;
      el.classList.remove('is-on');
      el.classList.remove('is-set');
    }
  }

  function paintSelection() { paintSelCells(); paintBand(); }

  function renderWords() {
    var html = '';
    for (var i = 0; i < P.words.length; i++) {
      html += '<li class="ws-word' + (found[P.words[i]] ? ' is-found' : '') + '">' + P.words[i] + '</li>';
    }
    $('words').innerHTML = html;
    $('count').textContent = B.toBn(foundCount()) + T.of + B.toBn(P.words.length);
  }

  function renderFront() {
    var d = dateFromId(P.id);
    var pick = pickForToday();
    var isToday = pick.isToday && pick.pz.id === P.id;

    $('fp-kicker').textContent = isToday ? T.today : T.recent;
    $('fp-kicker').classList.toggle('is-stale', !isToday);
    $('fp-date').textContent = printDate(d);
    $('fp-theme').textContent = P.theme;
    $('board-date').textContent = printDate(d);
    $('date').textContent = longDate(new Date());          // the paper's own date
    /* Derived, not hardcoded: the pack decides the grid and the word count. */
    $('fp-size').textContent = B.toBn(SIZE) + '×' + B.toBn(SIZE) + ' · ' + B.toBn(P.words.length) + T.words;
    $('fp-archive-meta').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    $('fp-aside-count').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    renderArchive();          // the rail is on the page at spread, not behind the sheet

    var n = foundCount(), total = P.words.length;
    var dot = $('fp-dot');
    dot.className = 'ws-dot' + (n === total ? ' is-solved' : (n > 0 ? ' is-started' : ''));
    $('fp-state').textContent = n === 0 ? T.fresh
      : (n === total ? T.solved + ' · ' + fmt(clock.secs)
        : B.toBn(n) + T.of + B.toBn(total) + T.progress);
    $('fp-cta').textContent = n === 0 ? T.start : (n === total ? T.review : T.resume);

    var mark = foundCells(), html = '';
    for (var i = 0; i < P.grid.length; i++) html += '<i' + (mark[i] ? ' class="is-found"' : '') + '></i>';
    $('fp-mini').innerHTML = html;
  }

  /* One renderer, two homes: the bottom sheet on a phone, and the front
     page's second column on a desktop, where the list comes out from behind
     the sheet rather than leaving half the page empty. */
  function renderArchive() {
    var key = todayKey(), hasToday = false, latestDue = null, i;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) hasToday = true;
      if (isDue(PACK.puzzles[i])) latestDue = PACK.puzzles[i].id;
    }

    /* Newest first. The pack is authored in date order, but a reader opening
       the list wants today at the top, not a fortnight ago — same order
       শব্দভেদ's archive uses. */
    var html = '';
    for (i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      var due = isDue(pz);
      var n = countFound(pz.id, pz.words);
      var total = pz.words.length;
      var dotCls = n === total ? ' is-solved' : (n > 0 ? ' is-started' : '');
      var label = n === total ? T.solved : (n > 0 ? B.toBn(n) + T.of + B.toBn(total) : T.stFresh);
      var badge = pz.id.slice(-10) === key
        ? '<span class="ws-arcrow__badge">' + T.todayBadge + '</span>'
        : (!hasToday && pz.id === latestDue ? '<span class="ws-arcrow__badge is-latest">' + T.latestBadge + '</span>' : '');
      var best = (n === total && bestOf(pz.id)) ? fmt(bestOf(pz.id)) : '';

      html += '<button type="button" class="ws-arcrow" data-id="' + pz.id + '"'
        + (pz.id === P.id ? ' aria-current="true"' : '') + (due ? '' : ' disabled') + '>'
        + '<span class="ws-arcrow__date">' + shortDate(dateFromId(pz.id)) + '</span>' + badge
        + '<span class="ws-arcrow__theme">' + pz.theme + '</span>'
        + '<span class="ws-arcrow__state"><i class="ws-dot' + dotCls + '" aria-hidden="true"></i>' + label + '</span>'
        + '<span class="ws-arcrow__time">' + best + '</span></button>';
    }
    $('arch-list').innerHTML = html;
    $('fp-archlist').innerHTML = html;
  }

  /* ---- selection -------------------------------------------------------- */

  function cellFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    var btn = el && el.closest ? el.closest('.ws-cell') : null;
    return btn ? +btn.getAttribute('data-i') : -1;
  }

  /* A drag is only ever a straight run. Anything off-axis holds the last
     valid run rather than snapping somewhere the finger is not — a snap on a
     40px grid picks words the reader did not mean. */
  function lineBetween(a, b) {
    var ar = Math.floor(a / SIZE), ac = a % SIZE;
    var dr = Math.floor(b / SIZE) - ar, dc = (b % SIZE) - ac;
    if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return null;
    var len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
    var sr = dr === 0 ? 0 : dr / Math.abs(dr);
    var sc = dc === 0 ? 0 : dc / Math.abs(dc);
    var cells = [];
    for (var i = 0; i < len; i++) cells.push(idx(ar + sr * i, ac + sc * i));
    return cells;
  }

  function commit() {
    if (!sel || sel.cells.length < 2) { sel = null; paintSelection(); return; }
    var fwd = '', rev = '', i;
    for (i = 0; i < sel.cells.length; i++) fwd += P.grid[sel.cells[i]];
    for (i = sel.cells.length - 1; i >= 0; i--) rev += P.grid[sel.cells[i]];

    var hit = null;
    for (i = 0; i < P.words.length; i++) {
      if (found[P.words[i]]) continue;
      if (B.equals(fwd, P.words[i]) || B.equals(rev, P.words[i])) { hit = P.words[i]; break; }
    }

    if (hit) {
      /* Kept in the order the finger travelled, not the order the word was
         placed in — the ink follows the hand. */
      var order = sel.cells.slice();
      found[hit] = true;
      saveState();
      sel = null;
      paintSelCells();       /* drop the red tint now, not in 900ms */
      paintFound();
      renderWords();
      markFound(hit, order);
      if (isComplete()) win();
    } else {
      var cells = sel.cells.slice();
      sel = null;
      paintSelection();
      var nodes = $('grid').children;
      for (i = 0; i < cells.length; i++) replay(nodes[cells[i]], 'is-miss', 400);
      buzz(24);          /* one blunt tap: wrong, and nothing more to say */
    }
  }

  /* ---- confirming a find ------------------------------------------------
     Four things answer at once, each saying the same thing in its own
     register: the squares set in sequence, the band holds the word it took,
     the list rules it off, and the count ticks. None of them block the next
     drag, and all of them flatten under prefers-reduced-motion. */

  var bandHold = null;
  var byTouch = false;      // set on pointerdown, read when the drag resolves
  var quiet = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Haptics run the whole length of a touch, not just its result: a tick as
     the finger takes each new square, a firmer one when a word lands, a
     single blunt one when it does not. Only for real touches — a mouse drag
     has no wrist to tap — and never when reduced motion is asked for.
     Note: iOS Safari and iOS Chrome do not implement navigator.vibrate at
     all, so on iPhone this is silently a no-op. Android is the audience that
     feels it. */
  function buzz(pattern) {
    if (quiet || !byTouch) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  /* Restart an animation class, and take it off again after it has run.
     animationend does the job when it fires, but it is not guaranteed —
     a backgrounded tab, or a compositor that never ran the animation, leaves
     the class stuck, and a spent fill-mode:both animation would then outrank
     the class rules underneath it. The timer is the guarantee. */
  function replay(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  /* Five flecks thrown off each square as it takes the ink. Absolutely
     positioned in their own layer and removed when spent, so they cannot
     reflow the board or survive a view change. Skipped entirely under
     reduced motion — this is the most motion in the game. */
  function flecks(cellIdx, delay) {
    if (quiet) return;
    var fx = $('fx');
    var host = fx.getBoundingClientRect();
    var b = $('grid').children[cellIdx].getBoundingClientRect();
    var cx = b.left - host.left + b.width / 2;
    var cy = b.top - host.top + b.height / 2;

    var mine = [];
    for (var k = 0; k < 5; k++) {
      var a = Math.random() * Math.PI * 2;
      var r = b.width * (0.45 + Math.random() * 0.65);
      var el = document.createElement('i');
      el.className = 'ws-fleck';
      el.style.left = (cx - 2) + 'px';
      el.style.top = (cy - 2) + 'px';
      el.style.setProperty('--dx', (Math.cos(a) * r).toFixed(1) + 'px');
      el.style.setProperty('--dy', (Math.sin(a) * r).toFixed(1) + 'px');
      el.style.setProperty('--d', delay + 'ms');
      fx.appendChild(el);
      mine.push(el);
    }
    /* Remove exactly the five this call made, not the first five in the
       layer — overlapping bursts would otherwise delete each other's. */
    setTimeout(function () {
      for (var j = 0; j < mine.length; j++) {
        if (mine[j].parentNode) mine[j].parentNode.removeChild(mine[j]);
      }
    }, delay + 620);
  }

  function markFound(word, cells) {
    var nodes = $('grid').children, i;
    for (i = 0; i < cells.length; i++) {
      nodes[cells[i]].style.setProperty('--d', (i * 30) + 'ms');
      replay(nodes[cells[i]], 'just-set', i * 30 + 500);
      flecks(cells[i], i * 30);
    }

    for (i = 0; i < P.words.length; i++) {
      if (P.words[i] === word) { replay($('words').children[i], 'is-hit', 380); break; }
    }
    replay($('count'), 'is-tick', 600);

    var band = $('reading');
    band.textContent = word;
    band.classList.remove('is-on');
    band.classList.add('is-set');
    clearTimeout(bandHold);
    bandHold = setTimeout(function () {
      band.classList.remove('is-set');
      paintBand();                 /* band only — never repaint the squares */
    }, 900);

    buzz(12);
  }

  /* The finished page takes the spot red once, wiping along the diagonal —
     the gesture শব্দভেদ makes when its grid comes out. */
  function solveSweep() {
    var nodes = $('grid').children;
    for (var i = 0; i < nodes.length; i++) {
      var d = (Math.floor(i / SIZE) + (i % SIZE)) * 16;
      nodes[i].style.setProperty('--d', d + 'ms');
      replay(nodes[i], 'is-solved', d + 640);
    }
    buzz([16, 70, 16]);
  }

  function bindGrid() {
    var g = $('grid');

    /* These animations use fill-mode `both`, which keeps the final frame
       applied — and an animated value outranks a class rule, so a spent
       `just-set` would stop a found square ever showing the red drag tint
       again. They clear themselves the moment they finish. */
    g.addEventListener('animationend', function (e) {
      if (e.target.classList) e.target.classList.remove('just-set', 'is-solved', 'is-miss');
    });

    g.addEventListener('pointerdown', function (e) {
      if (isComplete()) return;
      var i = cellFromPoint(e.clientX, e.clientY);
      if (i < 0) return;
      e.preventDefault();
      byTouch = e.pointerType === 'touch';
      g.setPointerCapture(e.pointerId);
      sel = { anchor: i, cells: [i] };
      paintSelection();
      buzz(8);
    });

    g.addEventListener('pointermove', function (e) {
      if (!sel) return;
      var i = cellFromPoint(e.clientX, e.clientY);
      if (i < 0 || i === sel.cells[sel.cells.length - 1]) return;
      var line = lineBetween(sel.anchor, i);
      if (!line) return;
      var grew = line.length !== sel.cells.length;
      sel.cells = line;
      paintSelection();
      /* One tick per square taken, not per pointermove — a finger crossing a
         42px square fires a dozen moves and would buzz continuously. */
      if (grew) buzz(4);
    });

    g.addEventListener('pointerup', function (e) {
      if (!sel) return;
      if (g.hasPointerCapture && g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
      commit();
    });
    g.addEventListener('pointercancel', function () { sel = null; paintSelection(); });

    /* Keyboard: activate a cell to anchor, activate a second to run the line.
       Without this the grid is unplayable without a pointer. */
    g.addEventListener('click', function (e) {
      if (e.detail !== 0) return;
      var btn = e.target.closest('.ws-cell');
      if (!btn || isComplete()) return;
      var i = +btn.getAttribute('data-i');
      var line = sel ? lineBetween(sel.anchor, i) : null;
      if (line) { sel.cells = line; paintSelection(); commit(); }
      else { sel = { anchor: i, cells: [i] }; paintSelection(); }
    });
  }

  /* ---- views & sheets --------------------------------------------------- */

  function goFront() {
    clockStop();
    saveState();
    renderFront();
    $('app').setAttribute('data-view', 'front');
  }

  function goBoard() {
    renderGrid();
    renderWords();
    paintSelection();
    paintClock();
    $('app').setAttribute('data-view', 'board');
    sizeBoard();
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

  function win() {
    clockStop();
    saveState();

    var prev = bestOf(P.id);
    var isBest = !prev || clock.secs < prev;
    if (isBest) { try { localStorage.setItem(BEST + P.id, String(clock.secs)); } catch (e) {} }

    emit('game:complete', { id: P.id, theme: P.theme, words: P.words.length, secs: clock.secs });

    $('win-theme').textContent = P.theme;
    $('win-time').textContent = fmt(clock.secs);
    $('win-best').textContent = fmt(isBest ? clock.secs : prev);
    $('win-words').textContent = B.toBn(P.words.length);
    $('win-note').textContent = !prev ? T.firstSolve : (isBest ? T.newBest : '');
    paintClock();

    /* The board gets its moment before the card covers it. The sweep is
       ~560ms plus a 15-square diagonal at 16ms, so the card follows it
       rather than interrupting it. */
    solveSweep();
    setTimeout(function () { openSheet($('sheet-win')); }, 1150);
  }

  function emit(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: type, game: 'shobdo-sondhan', data: data || {} }, '*');
      }
    } catch (e) {}
  }

  /* The grid is square and shares the viewport with a word list, so its size
     is bounded by height as often as by width on a phone. Measure, then hand
     the cell size to CSS — a vw-only guess overflows on short screens. */
  function sizeBoard() {
    var wrap = $('board-main');
    if (!wrap || !wrap.clientWidth) return;
    var cs = window.getComputedStyle(wrap);
    var w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    /* The ceiling is declared in CSS per breakpoint, not hardcoded here, so
       the board grows with the screen alongside the type ramp. */
    var max = parseFloat(cs.getPropertyValue('--ws-max')) || 544;
    var side = Math.max(200, Math.min(w, h, max));
    $('grid').style.setProperty('--ws-side', side + 'px');
  }

  /* ---- boot ------------------------------------------------------------- */

  function loadPuzzle(pz) {
    if (!GEN) GEN = window.WSGrid.make(SIZE);
    var built = GEN.build(pz, !!PACK.allowReverse);
    if (!built) { console.error('grid generation failed for', pz.id); return false; }
    clockStop();
    P = built;
    var st = loadState(P.id, P.words);
    found = st.w;
    clock.secs = st.t;
    sel = null;
    return true;
  }

  function openPuzzle(pz, enter) {
    if (!loadPuzzle(pz)) return;
    if (enter) goBoard(); else goFront();
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
    $('fp-howto').onclick = function () { openSheet($('sheet-howto')); };
    $('board-howto').onclick = function () { openSheet($('sheet-howto')); };

    function showArchive() { renderArchive(); openSheet($('sheet-arch')); }
    $('fp-archive').onclick = showArchive;
    $('dateline').onclick = showArchive;
    $('top-howto').onclick = function () { openSheet($('sheet-howto')); };

    function pickFromList(e) {
      var row = e.target.closest('.ws-arcrow');
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
      if (sel) { sel = null; paintSelection(); return; }
      if ($('app').getAttribute('data-view') === 'board') goFront();
    });

    /* Time accrued while the tab is in the background is not solving time. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clockStop(); saveState(); }
      else if ($('app').getAttribute('data-view') === 'board') clockStart();
    });

    window.addEventListener('resize', sizeBoard);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeBoard);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeBoard);
  }

  function init() {
    fetch('puzzles/index.json')
      .then(function (r) { return r.json(); })
      .then(function (pack) {
        PACK = pack;
        SIZE = pack.size || 8;
        /* A #p= link is a request for that board, so it skips the front page.
           Same contract শব্দভেদ already answers, so খেলাঘর can address a dated
           issue in either game with one link shape. A future-dated id is not
           a valid request and falls through to today's. */
        var hash = (location.hash.match(/p=([\w-]+)/) || [])[1], wanted = null, i;
        for (i = 0; i < PACK.puzzles.length; i++) {
          if (PACK.puzzles[i].id === hash && isDue(PACK.puzzles[i])) { wanted = PACK.puzzles[i]; break; }
        }
        if (!loadPuzzle(wanted || pickForToday().pz)) return;
        bind();
        bindGrid();
        if (wanted) goBoard(); else goFront();
      })
      .catch(function (err) {
        console.error(err);
        $('fp-theme').textContent = 'ধাঁধা লোড হয়নি';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
