/*
 * শব্দভেদ — Prothom Alo daily Bangla crossword.
 *
 * Engine is size-agnostic: rows, cols, blocks and entries all come from the
 * puzzle JSON, so a 5×5 or 10×10 pack runs unchanged. Cell identity is one
 * akshara, segmented by shared/bn-text.js rather than by the platform.
 */
(function () {
  'use strict';

  var B = window.BnText;
  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

  /* Every user-visible string in one place, so an EN pack is a swap rather
     than a grep through the file. Static copy lives in index.html. */
  var T = {
    across: 'বাঁ থেকে ডানে',
    down: 'ওপর থেকে নিচে',

    today: 'আজকের ধাঁধা',
    latest: 'সর্বশেষ ধাঁধা',
    todayBadge: 'আজকের',
    latestBadge: 'সর্বশেষ',
    todayPrefix: 'আজ · ',

    start: 'শুরু করুন',
    resume: 'চালিয়ে যান',
    review: 'আবার দেখুন',

    stateNew: 'এখনো শুরু হয়নি',
    stateFull: 'ছক সম্পূর্ণ হয়েছে',
    stateRunning: 'চলছে',
    stateSolved: 'সমাধান হয়েছে',
    cellsLeft: 'টি ঘর বাকি',
    clueCount: 'টি সূত্র',
    puzzleCount: 'টি ধাঁধা',
    solvedCount: 'টি সমাধান হয়েছে',
    timePrefix: 'সময় ',

    clear: 'ছক ফাঁকা করুন',
    clearArm: 'নিশ্চিত? আবার ক্লিক করুন',

    noAssist: 'কোনো সহায়তা ছাড়াই সমাধান',
    withAssist: 'সহায়তা নিয়ে সম্পন্ন',
    newBest: 'এটিই আপনার সেরা সময়',
    nextPuzzle: 'পরের ধাঁধা',
    allPuzzles: 'সব ধাঁধা',

    loadFail: 'ধাঁধা লোড হয়নি।',
    retry: 'আবার চেষ্টা করুন',

    ariaRow: 'সারি ',
    ariaCol: ' ঘর ',
    ariaNum: ' নম্বর',
    ariaEmpty: 'ফাঁকা'
  };

  var K_COACH = 'pa-xw-coach';
  var K_HOWTO = 'pa-xw-howto';

  var KAR_ROWS = [
    ['া', 'ি', 'ী', 'ু', 'ূ', 'ৃ', 'ে'],
    ['ৈ', 'ো', 'ৌ', '্', 'ং', 'ঁ', 'ঃ']
  ];
  var ROWS = [
    { cls: 'v', keys: ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'ঋ', 'এ', 'ঐ', 'ও', 'ঔ'] },
    { cls: 'c', keys: ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ', 'ছ', 'জ', 'ঝ', 'ঞ'], gapAt: 5 },
    { cls: 'c', keys: ['ট', 'ঠ', 'ড', 'ঢ', 'ণ', 'ত', 'থ', 'দ', 'ধ', 'ন'], gapAt: 5 },
    { cls: 'c', keys: ['প', 'ফ', 'ব', 'ভ', 'ম', 'য', 'র', 'ল', 'শ', 'ষ'], gapAt: 5 },
    { cls: 'c', keys: ['স', 'হ', 'ড়', 'ঢ়', 'য়', 'ৎ'], del: true }
  ];

  var DEL_SVG = '<svg width="20" height="16" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5h13a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5H8L1 9z"/><path d="M12 6.5l6 5M18 6.5l-6 5"/></svg>';
  var ARROW_R = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h7M6.5 2.5L10 6l-3.5 3.5"/></svg>';
  var ARROW_D = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v7M2.5 5.5L6 9l3.5-3.5"/></svg>';

  /* ---- state --------------------------------------------------------- */

  var P = null;            // puzzle
  var cells = [];          // player entries, '' when empty
  var nums = [];           // 0 = unnumbered
  var sel = 0;
  var dir = 'across';
  var fresh = true;        // next base letter replaces rather than extends
  var wrong = {};          // idx -> true, cleared on edit
  var revealed = {};
  var elapsed = 0;
  var solved = false;
  var autocheck = false;
  var assists = { check: 0, reveal: 0 };
  var tab = 'across';
  var tick = null;
  var clearArmed = false;

  var INDEX = { puzzles: [] };
  var currentId = null;

  var view = 'front';      // 'front' | 'play' — two views, one document
  var coachDone = false;
  var fullSeen = false;    // grid-full notice already shown for this fill

  var els = {};

  /* ---- flags ---------------------------------------------------------- */

  function flag(k) { try { return !!localStorage.getItem(k); } catch (e) { return false; } }
  function setFlag(k) { try { localStorage.setItem(k, '1'); } catch (e) {} }

  /* The spread breakpoint, asked in JS so layout and behaviour cannot drift
     apart. Two-dimensional on purpose: a wide but short window is a phone
     layout problem, not a desktop one. */
  function isDesktop() {
    return window.matchMedia
      ? window.matchMedia('(min-width: 60rem) and (min-height: 40rem)').matches
      : false;
  }

  /* ---- helpers ------------------------------------------------------- */

  function isBlock(i) { return P.grid[i] === null; }
  function rc(i) { return { r: Math.floor(i / P.cols), c: i % P.cols }; }
  function step(dirName) { return dirName === 'across' ? 1 : P.cols; }

  function entryCells(e) {
    var out = [], s = step(e.dir);
    for (var k = 0; k < e.len; k++) out.push(e.cell + k * s);
    return out;
  }

  function entryAt(idx, dirName) {
    for (var i = 0; i < P.entries.length; i++) {
      var e = P.entries[i];
      if (e.dir !== dirName) continue;
      if (entryCells(e).indexOf(idx) >= 0) return e;
    }
    return null;
  }

  function currentEntry() { return entryAt(sel, dir) || entryAt(sel, other(dir)); }
  function other(d) { return d === 'across' ? 'down' : 'across'; }

  function orderedEntries() {
    return P.entries.slice().sort(function (a, b) {
      if (a.n !== b.n) return a.n - b.n;
      return a.dir === 'across' ? -1 : 1;
    });
  }

  function entryFilled(e) {
    return entryCells(e).every(function (i) { return cells[i]; });
  }

  function computeNumbers() {
    nums = new Array(P.rows * P.cols).fill(0);
    var n = 1;
    for (var i = 0; i < nums.length; i++) {
      if (isBlock(i)) continue;
      var p = rc(i);
      var startA = (p.c === 0 || isBlock(i - 1)) && p.c + 1 < P.cols && !isBlock(i + 1);
      var startD = (p.r === 0 || isBlock(i - P.cols)) && p.r + 1 < P.rows && !isBlock(i + P.cols);
      if (startA || startD) nums[i] = n++;
    }
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return B.toBn(m) + ':' + B.toBn(s < 10 ? '0' + s : String(s));
  }

  /* ---- persistence --------------------------------------------------- */

  function storeKey() { return 'pa-xw:' + P.id; }
  function bestKey() { return 'pa-xw-best:' + P.id; }

  function save() {
    try {
      localStorage.setItem(storeKey(), JSON.stringify({
        cells: cells, elapsed: elapsed, solved: solved,
        revealed: Object.keys(revealed), assists: assists, autocheck: autocheck
      }));
    } catch (err) { /* private mode — play on, just don't resume */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(storeKey());
      if (!raw) return;
      var s = JSON.parse(raw);
      if (Array.isArray(s.cells) && s.cells.length === cells.length) cells = s.cells;
      elapsed = s.elapsed || 0;
      solved = !!s.solved;
      autocheck = !!s.autocheck;
      if (s.assists) assists = s.assists;
      (s.revealed || []).forEach(function (i) { revealed[i] = true; });
    } catch (err) { /* corrupt entry — start clean */ }
  }

  function best() {
    try { return parseInt(localStorage.getItem(bestKey()) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(sec) {
    try { var b = best(); if (!b || sec < b) localStorage.setItem(bestKey(), String(sec)); } catch (e) {}
  }

  /* ---- host contract -------------------------------------------------- */

  var lastProgress = 0;
  function emit(type, extra) {
    var msg = { type: type, game: 'crossword-bn', puzzleId: P ? P.id : null };
    if (extra) for (var k in extra) msg[k] = extra[k];
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) {}
  }
  function emitProgress() {
    var now = Date.now();
    if (now - lastProgress < 15000) return;
    lastProgress = now;
    var total = 0, done = 0;
    for (var i = 0; i < cells.length; i++) { if (!isBlock(i)) { total++; if (cells[i]) done++; } }
    emit('game:progress', { filled: done, total: total, elapsedMs: elapsed * 1000 });
  }

  /* ---- rendering ------------------------------------------------------ */

  function buildGrid() {
    var g = els.grid;
    g.style.setProperty('--cols', P.cols);
    g.innerHTML = '';
    for (var i = 0; i < P.rows * P.cols; i++) {
      var d = document.createElement(isBlock(i) ? 'div' : 'button');
      d.className = 'xw-cell' + (isBlock(i) ? ' xw-cell--block' : '');
      d.style.setProperty('--i', i);
      if (!isBlock(i)) {
        d.type = 'button';
        d.dataset.i = i;
        if (nums[i]) d.insertAdjacentHTML('beforeend', '<span class="xw-cell__n">' + B.toBn(nums[i]) + '</span>');
        d.insertAdjacentHTML('beforeend', '<span class="xw-cell__v"></span>');
      }
      g.appendChild(d);
    }
  }

  function fitGlyph(span, box) {
    span.style.transform = '';
    var w = span.scrollWidth;
    if (!w || !box) return;
    var max = box * 0.92;
    if (w > max) span.style.transform = 'scaleX(' + Math.max(0.6, max / w) + ')';
  }

  function render() {
    var e = currentEntry();
    var inWord = e ? entryCells(e) : [];

    // grid
    var kids = els.grid.children;
    for (var i = 0; i < kids.length; i++) {
      if (isBlock(i)) continue;
      var el = kids[i];
      el.classList.toggle('in-word', inWord.indexOf(i) >= 0 && i !== sel);
      el.classList.toggle('is-active', i === sel);
      el.classList.toggle('is-wrong', !!wrong[i]);
      el.classList.toggle('is-revealed', !!revealed[i]);
      var v = el.querySelector('.xw-cell__v');
      if (v.textContent !== cells[i]) v.textContent = cells[i];
      el.setAttribute('aria-label', ariaFor(i));
      fitGlyph(v, el.clientWidth);
    }

    var act = els.grid.children[sel];
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    renderStrip(e, inWord);
    renderClue(e);
    renderLists();

    els.timer.textContent = fmtTime(Math.floor(elapsed));
    els.timer.classList.toggle('is-done', solved);
  }

  function ariaFor(i) {
    var p = rc(i);
    var s = T.ariaRow + B.toBn(p.r + 1) + T.ariaCol + B.toBn(p.c + 1);
    if (nums[i]) s += ', ' + B.toBn(nums[i]) + T.ariaNum;
    s += ', ' + (cells[i] ? cells[i] : T.ariaEmpty);
    return s;
  }

  function renderStrip(e, inWord) {
    var s = els.strip;
    s.innerHTML = '';
    if (!e) return;

    var cs = getComputedStyle(s);
    var band = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var size = Math.floor((band - (inWord.length - 1) * 3) / inWord.length);
    size = Math.max(40, Math.min(size, 56));
    s.style.setProperty('--scell', size + 'px');

    inWord.forEach(function (idx) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'xw-scell'
        + (cells[idx] ? ' has-v' : '')
        + (idx === sel ? ' is-active' : '')
        + (wrong[idx] ? ' is-wrong' : '')
        + (idx === sel && !fresh && cells[idx] ? ' is-composing' : '');
      d.dataset.i = idx;
      d.setAttribute('aria-label', ariaFor(idx));
      if (nums[idx]) d.insertAdjacentHTML('beforeend', '<span class="xw-scell__n">' + B.toBn(nums[idx]) + '</span>');
      var v = document.createElement('span');
      v.className = 'xw-scell__v';
      v.textContent = cells[idx] || '';
      d.appendChild(v);
      s.appendChild(d);
      fitGlyph(v, size);
    });
    var act = s.querySelector('.is-active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderClue(e) {
    if (!e) return;
    els.clueNum.innerHTML = B.toBn(e.n) + (e.dir === 'across' ? ARROW_R : ARROW_D);
    els.clueText.textContent = e.clue;
    els.clueText.setAttribute('title', e.clue);
  }

  var DIR_LABEL = { across: T.across, down: T.down };

  function clueRow(e, cur, onPick) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'xw-cluerow' + (entryFilled(e) ? ' is-filled' : '');
    if (cur && cur.n === e.n && cur.dir === e.dir) b.setAttribute('aria-current', 'true');
    b.innerHTML = '<span class="xw-cluerow__n">' + B.toBn(e.n) + '</span><span class="xw-cluerow__t"></span>';
    b.querySelector('.xw-cluerow__t').textContent = e.clue;
    b.onclick = function () {
      dir = e.dir;
      var free = entryCells(e).filter(function (i) { return !cells[i]; });
      select(free.length ? free[0] : e.cell);
      onPick();
    };
    li.appendChild(b);
    return li;
  }

  function renderLists() {
    var cur = currentEntry();

    // sheet: tabbed, one direction at a time — screen is scarce on a phone
    if (els.tabs && els.list) {
      els.tabs.innerHTML = '';
      ['across', 'down'].forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'xw-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(tab === d));
        b.textContent = DIR_LABEL[d];
        b.onclick = function () { tab = d; renderLists(); };
        els.tabs.appendChild(b);
      });
      els.list.innerHTML = '';
      orderedEntries().forEach(function (e) {
        if (e.dir !== tab) return;
        els.list.appendChild(clueRow(e, cur, function () { closeSheet(els.sheetClues); }));
      });
    }

    // desktop aside: both directions, headed — the printed spread
    if (els.listDesk) {
      els.listDesk.innerHTML = '';
      ['across', 'down'].forEach(function (d) {
        var h = document.createElement('li');
        h.className = 'xw-cluehead';
        h.textContent = DIR_LABEL[d];
        els.listDesk.appendChild(h);
        orderedEntries().forEach(function (e) {
          if (e.dir !== d) return;
          els.listDesk.appendChild(clueRow(e, cur, function () {}));
        });
      });
    }
  }

  /* ---- sizing --------------------------------------------------------- */

  function sizeGrid() {
    /* The ResizeObserver below starts observing while the front page is up,
       and an observer fires once on observe() — so this ran before any puzzle
       was loaded and threw on P.cols on every single page load, plus again on
       every resize until a puzzle opened. Nothing visible broke, which is why
       it survived: the board is rendered again when the puzzle loads. But an
       uncaught TypeError on first paint is the first thing anyone opening dev
       tools sees. Nothing to size until there is a puzzle. */
    if (!P) return;
    var wrap = els.gridwrap;
    var cs = getComputedStyle(wrap);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var availW = wrap.clientWidth - padX;
    var availH = wrap.clientHeight - padY;
    var gutters = P.cols + 1; // 1px gap/padding lines
    var byW = (availW - gutters) / P.cols;
    var byH = (availH - (P.rows + 1)) / P.rows;
    // the ceiling is a token, so the breakpoint that widens the page is the
    // same one that lets the board grow into it
    var cap = parseFloat(cs.getPropertyValue('--cell-max')) || 64;
    var size = Math.floor(Math.min(byW, byH));
    size = Math.max(24, Math.min(size, cap));
    els.grid.style.setProperty('--cell', size + 'px');
    render();
    /* The arithmetic above counts one gutter per track, but the board also
       carries its own rule on both edges — so a cell size that "fits" could
       still overflow by a few pixels, which is exactly enough to clip the
       last row. Rather than encode the frame's thickness here, where it would
       drift the moment the rule changes, measure what was actually laid out
       and step down until it fits. Bounded, and it almost never runs twice. */
    for (var guard = 0; guard < 6 && size > 24
         && (els.grid.offsetHeight > availH || els.grid.offsetWidth > availW); guard++) {
      size -= 1;
      els.grid.style.setProperty('--cell', size + 'px');
    }
    requestAnimationFrame(function () {
      wrap.classList.toggle('is-scrollable', wrap.scrollHeight > wrap.clientHeight + 1);
    });
  }

  /* ---- interaction ---------------------------------------------------- */

  function select(idx, toggle) {
    if (isBlock(idx)) return;
    if (idx === sel && toggle) {
      var alt = entryAt(sel, other(dir));
      if (alt) dir = other(dir);
    } else {
      sel = idx;
      if (!entryAt(sel, dir)) {
        var a = entryAt(sel, other(dir));
        if (a) dir = other(dir);
      }
    }
    fresh = true;
    /* On a phone the keyboard IS the input, so touching a square must bring
       it back. On desktop there is a real keyboard and the on-screen one is
       opt-in — re-opening it on every click would steal the board's height
       back each time the player selects a square. */
    if (!isDesktop() && els.kb.classList.contains('is-collapsed')) {
      els.kb.classList.remove('is-collapsed');
      document.querySelector('.xw').classList.remove('is-scanning');
      var gb = els.kb.querySelector('.xw-kb__grab');
      if (gb) gb.setAttribute('aria-expanded', 'true');
      sizeGrid();
    }
    render();
  }

  function advance() {
    var e = currentEntry();
    if (!e) return;
    var list = entryCells(e);
    var pos = list.indexOf(sel);
    if (pos >= 0 && pos + 1 < list.length) sel = list[pos + 1];
  }

  function retreat() {
    var e = currentEntry();
    if (!e) return false;
    var list = entryCells(e);
    var pos = list.indexOf(sel);
    if (pos > 0) { sel = list[pos - 1]; return true; }
    return false;
  }

  function typeKey(ch) {
    if (solved) return;
    var isMark = B.isKar(ch) || B.isSign(ch) || ch === B.VIRAMA;

    if (isMark) {
      if (!cells[sel]) return;              // a mark needs a letter under it
      cells[sel] = B.compose(cells[sel], ch).cell;
      fresh = false;
    } else if (fresh) {
      cells[sel] = ch;
      fresh = false;
    } else {
      var r = B.compose(cells[sel], ch);
      if (r.commit) {
        cells[sel] = r.cell;
        advance();
        cells[sel] = r.next;
      } else {
        cells[sel] = r.cell;
      }
    }

    delete wrong[sel];
    delete revealed[sel];
    if (autocheck) checkCells([sel]);
    afterEdit();
  }

  function backspace() {
    if (solved) return;
    if (cells[sel]) {
      cells[sel] = B.backspace(cells[sel]);
      delete wrong[sel];
      delete revealed[sel];
      fresh = false;
    } else if (retreat()) {
      cells[sel] = '';
      delete wrong[sel];
      delete revealed[sel];
      fresh = false;
    }
    afterEdit();
  }

  function afterEdit() {
    save();
    emitProgress();
    // the coach has done its job once the reader is typing
    if (!coachDone && filledCount() >= 3) dismissCoach();
    checkSolved();
    updateFullNotice();
    render();
  }

  /* ---- assists -------------------------------------------------------- */

  function checkCells(list) {
    list.forEach(function (i) {
      if (isBlock(i) || !cells[i]) return;
      if (!B.equals(cells[i], P.grid[i])) wrong[i] = true; else delete wrong[i];
    });
  }

  function revealCells(list) {
    list.forEach(function (i) {
      if (isBlock(i)) return;
      if (!B.equals(cells[i], P.grid[i])) { cells[i] = P.grid[i]; revealed[i] = true; }
      delete wrong[i];
    });
  }

  function allCells() {
    var out = [];
    for (var i = 0; i < P.grid.length; i++) if (!isBlock(i)) out.push(i);
    return out;
  }

  function filledCount() {
    return allCells().filter(function (i) { return cells[i]; }).length;
  }

  function checkSolved() {
    if (solved) return;
    var ok = allCells().every(function (i) { return B.equals(cells[i], P.grid[i]); });
    if (!ok) return;
    solved = true;
    stopTimer();
    saveBest(Math.floor(elapsed));
    save();
    els.grid.classList.add('is-solved');
    emit('game:complete', {
      elapsedMs: Math.floor(elapsed) * 1000,
      assists: assists,
      perfect: assists.check === 0 && assists.reveal === 0
    });
    setTimeout(showWin, 900);
  }

  /* The newest puzzle the reader has not finished, never a future date and
     never the one just solved. Null when the pack is exhausted. */
  function nextUnsolvedId() {
    var t = todayISO();
    var list = byDate().reverse();
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.id === currentId || x.date > t) continue;
      if (statusOf(x.id).state !== 'solved') return x.id;
    }
    return null;
  }

  function showWin() {
    var perfect = assists.check === 0 && assists.reveal === 0;
    var secs = Math.floor(elapsed);
    var b = best();   // saveBest has already run, so this includes this solve

    els.winTime.textContent = fmtTime(secs);
    els.winBestv.textContent = fmtTime(b || secs);
    els.winAssist.textContent = B.toBn(assists.check + assists.reveal);

    var note = [];
    if (!b || secs <= b) note.push(T.newBest);
    note.push(perfect ? T.noAssist : T.withAssist);
    els.winBest.textContent = note.join(' · ');

    var nid = nextUnsolvedId();
    els.winNext.dataset.next = nid || '';
    els.winNext.textContent = nid ? T.nextPuzzle : T.allPuzzles;

    els.win.classList.add('is-open');
    els.winNext.focus();
  }

  /* ---- timer ---------------------------------------------------------- */

  function startTimer() {
    if (tick || solved) return;
    tick = setInterval(function () {
      if (document.hidden || solved) return;
      elapsed += 1;
      els.timer.textContent = fmtTime(Math.floor(elapsed));
      if (Math.floor(elapsed) % 10 === 0) save();
    }, 1000);
  }
  function stopTimer() { if (tick) { clearInterval(tick); tick = null; } }

  /* ---- sheets --------------------------------------------------------- */

  function openSheet(el) {
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-open'); });
    var panel = el.querySelector('.pa-sheet__panel');
    if (panel) panel.focus();
  }
  function closeSheet(el) {
    el.classList.remove('is-open');
    clearArmed = false;
    var row = el.querySelector('[data-act="clear"] .pa-menu__label');
    if (row) row.textContent = T.clear;
    setTimeout(function () { el.hidden = true; }, 320);
  }

  function openHowto() {
    setFlag(K_HOWTO);
    if (els.fpHowtoNew) els.fpHowtoNew.hidden = true;
    openSheet(els.sheetHowto);
  }

  /* ---- views ----------------------------------------------------------
     The front page and the board are one document. Nothing reloads between
     them, so the loaded puzzle, the restored grid and the elapsed time all
     survive the move — and the count-up does not begin until the reader is
     actually on the board. */

  function showView(v) {
    view = v;
    els.app.dataset.view = v;
  }

  /* Desktop starts in scanning mode: the physical keyboard already types, so
     the type case is a fallback for readers without a Bangla input method
     rather than the primary control. It stays one grabber-tap away. */
  function applyKbMode() {
    if (!isDesktop()) return;
    els.kb.classList.add('is-collapsed');
    document.querySelector('.xw').classList.add('is-scanning');
    var gb = els.kb.querySelector('.xw-kb__grab');
    if (gb) gb.setAttribute('aria-expanded', 'false');
  }

  function enterPlay() {
    showView('play');
    applyKbMode();
    // a chosen puzzle stays linkable and survives a refresh
    try { history.replaceState(null, '', '#p=' + currentId); } catch (e) {}
    maybeCoach();
    emit('game:start');
    // returning to a grid that is already full should say so too
    fullSeen = false;
    updateFullNotice();
    // the board can only be measured once its column has height
    requestAnimationFrame(function () {
      sizeGrid();
      if (!solved) startTimer();
    });
  }

  function goFront() {
    stopTimer();
    if (P) save();
    showView('front');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    renderFront();
  }

  /* ---- first-run coach ------------------------------------------------
     One line, shown once ever. It costs height on a 640dp phone, so it
     retires itself after the third filled square rather than waiting to be
     dismissed. */

  function maybeCoach() {
    if (coachDone || flag(K_COACH) || solved) { els.coach.hidden = true; return; }
    els.coach.hidden = false;
  }

  function dismissCoach() {
    coachDone = true;
    setFlag(K_COACH);
    if (els.coach.hidden) return;
    els.coach.hidden = true;
    sizeGrid();
  }

  /* ---- grid-full notice ------------------------------------------------
     Filling the last square is the moment the player believes they have
     won. checkSolved() returns silently when the grid is complete but
     wrong, so without this the game says nothing at exactly the point it
     most needs to. The notice states the fact and stops: it marks nothing.
     Drawing the slashes costs an assist and is theirs to ask for.

     Shown once per fill — it reappears only after the grid stops being
     full and becomes full again, so correcting one square does not nag. */

  function updateFullNotice() {
    if (!P) return;
    var full = !solved && filledCount() === allCells().length;
    if (!full) { fullSeen = false; hideFullNotice(); return; }
    if (fullSeen) return;
    fullSeen = true;
    els.coach.hidden = true;      // never stack the two head strips
    els.full.hidden = false;
    sizeGrid();
  }

  function hideFullNotice() {
    if (els.full.hidden) return;
    els.full.hidden = true;
    sizeGrid();
  }

  /* ---- keyboard build -------------------------------------------------- */

  function buildKeyboard() {
    var kb = els.kb;
    kb.innerHTML = '';

    var grab = document.createElement('button');
    grab.type = 'button';
    grab.className = 'xw-kb__grab';
    grab.setAttribute('aria-label', 'কীবোর্ড লুকান বা দেখান');
    grab.setAttribute('aria-expanded', 'true');
    grab.innerHTML = '<span class="xw-kb__pill"></span>'
      + '<span class="xw-kb__reopen">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>'
      + 'কীবোর্ড</span>';
    grab.onclick = function () {
      var off = kb.classList.toggle('is-collapsed');
      document.querySelector('.xw').classList.toggle('is-scanning', off);
      grab.setAttribute('aria-expanded', String(!off));
      sizeGrid();
    };
    kb.appendChild(grab);

    KAR_ROWS.forEach(function (row, ri) {
      var karRow = document.createElement('div');
      karRow.className = 'xw-kb__row xw-kb__row--kar'
        + (ri === KAR_ROWS.length - 1 ? ' xw-kb__row--karend' : '');
      row.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'xw-key xw-key--kar' + (k === '্' ? ' xw-key--hasant' : '');
        b.dataset.k = k;
        b.textContent = k === '্' ? '্' : '◌' + k;
        b.setAttribute('aria-label', k === '্' ? 'হসন্ত' : 'কার ' + k);
        karRow.appendChild(b);
      });
      kb.appendChild(karRow);
    });

    ROWS.forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'xw-kb__row xw-kb__row--' + row.cls;
      row.keys.forEach(function (k, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'xw-key' + (row.gapAt === i ? ' xw-key--gap' : '');
        b.dataset.k = k;
        b.textContent = k;
        r.appendChild(b);
      });
      if (row.del) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = 'xw-key xw-key--del';
        d.dataset.del = '1';
        d.setAttribute('aria-label', 'মুছুন');
        d.innerHTML = DEL_SVG;
        r.appendChild(d);
      }
      kb.appendChild(r);
    });
  }

  /* ---- wiring ---------------------------------------------------------- */

  function wire() {
    els.grid.addEventListener('click', function (ev) {
      var t = ev.target.closest('.xw-cell');
      if (!t || t.dataset.i === undefined) return;
      select(+t.dataset.i, true);
    });

    els.strip.addEventListener('click', function (ev) {
      var t = ev.target.closest('.xw-scell');
      if (!t) return;
      select(+t.dataset.i, false);
    });

    els.kb.addEventListener('pointerdown', function (ev) {
      var t = ev.target.closest('.xw-key');
      if (!t) return;
      ev.preventDefault();
      if (t.dataset.del) backspace(); else typeKey(t.dataset.k);
    });

    function stepEntry(delta) {
      var list = orderedEntries();
      var cur = currentEntry();
      var at = 0;
      list.forEach(function (e, i) { if (cur && e.n === cur.n && e.dir === cur.dir) at = i; });
      var next = list[(at + delta + list.length) % list.length];
      dir = next.dir;
      var free = entryCells(next).filter(function (i) { return !cells[i]; });
      select(free.length ? free[0] : next.cell);
    }
    $('btn-prev').onclick = function () { stepEntry(-1); };
    $('btn-next').onclick = function () { stepEntry(1); };
    $('btn-clue').onclick = function () {
      var cur = currentEntry();
      tab = cur ? cur.dir : 'across';
      renderLists();
      openSheet(els.sheetClues);
    };
    $('btn-menu').onclick = function () { openSheet(els.sheetMenu); };
    els.dateline.onclick = function () { renderArchive(); openSheet(els.sheetArchive); };

    /* Back goes up one level, not out: the board returns to the front page,
       and only the front page leaves for the portal. */
    $('btn-back').onclick = goFront;
    $('btn-exit').onclick = function () {
      emit('game:exit');
      if (history.length > 1) history.back(); else location.href = '../../hub/index.html';
    };

    els.fpCta.onclick = function () { if (P) enterPlay(); };
    els.fpArchive.onclick = function () { renderArchive(); openSheet(els.sheetArchive); };
    els.fpHowto.onclick = openHowto;
    $('btn-howto-top').onclick = openHowto;
    $('coach-more').onclick = openHowto;
    $('coach-x').onclick = dismissCoach;

    /* Dismissing costs nothing; only asking for the check spends an assist. */
    $('full-x').onclick = hideFullNotice;
    $('full-check').onclick = function () {
      assists.check++;
      checkCells(allCells());
      hideFullNotice();
      save();
      render();
    };

    els.winClose.onclick = function () { els.win.classList.remove('is-open'); };
    els.winHome.onclick = function () { els.win.classList.remove('is-open'); goFront(); };
    els.winNext.onclick = function () {
      els.win.classList.remove('is-open');
      var nid = els.winNext.dataset.next;
      if (nid) loadPuzzle(nid).then(enterPlay);
      else { renderArchive(); openSheet(els.sheetArchive); }
    };

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeSheet(b.closest('.pa-sheet')); });
    });

    els.sheetMenu.addEventListener('click', function (ev) {
      var row = ev.target.closest('[data-act]');
      if (!row) return;
      var act = row.dataset.act;
      var e = currentEntry();

      if (act === 'howto') { closeSheet(els.sheetMenu); openHowto(); return; }
      if (act === 'autocheck') {
        autocheck = !autocheck;
        row.setAttribute('aria-checked', String(autocheck));
        if (autocheck) checkCells(allCells());
        save(); render();
        return;
      }
      if (act === 'clear') {
        var label = row.querySelector('.pa-menu__label');
        if (!clearArmed) { clearArmed = true; label.textContent = T.clearArm; return; }
        cells = cells.map(function () { return ''; });
        wrong = {}; revealed = {}; clearArmed = false;
        label.textContent = T.clear;
        afterEdit(); closeSheet(els.sheetMenu);
        return;
      }

      if (act.indexOf('check') === 0) assists.check++; else assists.reveal++;
      var scope = act.split('-')[1];
      var list = scope === 'cell' ? [sel] : scope === 'word' ? (e ? entryCells(e) : [sel]) : allCells();
      if (act.indexOf('check') === 0) checkCells(list); else revealCells(list);
      afterEdit();
      closeSheet(els.sheetMenu);
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'Escape') {
        [els.sheetClues, els.sheetMenu, els.sheetArchive, els.sheetHowto].forEach(function (s) { if (s.classList.contains('is-open')) closeSheet(s); });
        if (els.win.classList.contains('is-open')) els.win.classList.remove('is-open');
        return;
      }
      if (view !== 'play') return;   // the board is not on screen
      var p = rc(sel), moved = null;
      if (ev.key === 'ArrowRight') moved = p.c + 1 < P.cols ? sel + 1 : null;
      if (ev.key === 'ArrowLeft') moved = p.c > 0 ? sel - 1 : null;
      if (ev.key === 'ArrowDown') moved = p.r + 1 < P.rows ? sel + P.cols : null;
      if (ev.key === 'ArrowUp') moved = p.r > 0 ? sel - P.cols : null;
      if (moved !== null) {
        ev.preventDefault();
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') dir = 'across'; else dir = 'down';
        if (!isBlock(moved)) select(moved, false);
        return;
      }
      if (ev.key === 'Backspace') { ev.preventDefault(); backspace(); return; }
      if (ev.key === ' ') { ev.preventDefault(); select(sel, true); return; }
      if (ev.key && ev.key.length >= 1) {
        var ch = ev.key.charAt(0);
        var cp = ch.charCodeAt(0);
        if (cp >= 0x0980 && cp <= 0x09FE) { ev.preventDefault(); typeKey(ch); }
      }
    });

    var ro = window.ResizeObserver ? new ResizeObserver(sizeGrid) : null;
    if (ro) ro.observe(els.gridwrap); else window.addEventListener('resize', sizeGrid);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeGrid);

    document.addEventListener('visibilitychange', function () { if (!document.hidden) save(); });
  }

  /* ---- boot ------------------------------------------------------------ */

  /* ---- archive -------------------------------------------------------- */

  function dateLabel(iso) {
    var b = String(iso || '').split('-');
    if (b.length !== 3) return iso || '';
    return B.toBn(parseInt(b[2], 10)) + ' ' + MONTHS[parseInt(b[1], 10) - 1] + ' ' + B.toBn(b[0]);
  }

  function todayISO() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function byDate() {
    return (INDEX.puzzles || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /* Today's puzzle if one is dated today; otherwise the most recent that has
     already been published. Never a future date. */
  function dailyId() {
    var list = byDate();
    if (!list.length) return null;
    var t = todayISO();
    var published = list.filter(function (x) { return x.date <= t; });
    return (published.length ? published[published.length - 1] : list[0]).id;
  }

  /* Read a puzzle's saved state without loading the puzzle itself. */
  function statusOf(id) {
    try {
      var raw = localStorage.getItem('pa-xw:' + id);
      if (!raw) return { state: 'new' };
      var st = JSON.parse(raw);
      if (st.solved) return { state: 'solved', elapsed: st.elapsed || 0 };
      var filled = (st.cells || []).filter(function (c) { return c; }).length;
      return filled ? { state: 'started', filled: filled } : { state: 'new' };
    } catch (e) { return { state: 'new' }; }
  }

  /* Renders into every list that exists: the bottom sheet on a phone, and on
     desktop the same rows inline on the front page. One builder, so the two
     can never disagree about a puzzle's state. */
  function renderArchive() {
    [els.archive, els.frontArchive].forEach(function (target) {
      if (target) renderArchiveInto(target);
    });
  }

  function renderArchiveInto(list) {
    var t = todayISO();
    var latestId = dailyId();
    var hasToday = (INDEX.puzzles || []).some(function (x) { return x.date === t; });
    list.innerHTML = '';

    byDate().reverse().forEach(function (item) {
      var st = statusOf(item.id);
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'xw-arcrow';
      if (item.id === currentId) b.setAttribute('aria-current', 'true');

      var mark = st.state === 'solved'
        ? '<span class="xw-arcrow__dot is-solved" aria-hidden="true"></span>' + T.stateSolved
        : st.state === 'started'
          ? '<span class="xw-arcrow__dot is-started" aria-hidden="true"></span>' + T.stateRunning
          : '<span class="xw-arcrow__dot" aria-hidden="true"></span>নতুন';

      b.innerHTML =
        '<span class="xw-arcrow__date"></span>' +
        (item.date === t
          ? '<span class="xw-arcrow__today">' + T.todayBadge + '</span>'
          : (!hasToday && item.id === latestId ? '<span class="xw-arcrow__today is-latest">' + T.latestBadge + '</span>' : '')) +
        '<span class="xw-arcrow__state">' + mark + '</span>' +
        '<span class="xw-arcrow__time">' + (st.state === 'solved' ? fmtTime(Math.floor(st.elapsed)) : '') + '</span>';
      b.querySelector('.xw-arcrow__date').textContent = dateLabel(item.date);

      /* Picking a puzzle always lands on the board — from the front page it
         is the way in, and from the board it is a swap. */
      b.onclick = function () {
        if (els.sheetArchive.classList.contains('is-open')) closeSheet(els.sheetArchive);
        if (item.id === currentId) { if (view !== 'play') enterPlay(); return; }
        loadPuzzle(item.id).then(enterPlay);
      };
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  /* ---- front page ------------------------------------------------------
     The top of a printed puzzle page: what today's puzzle is, how far the
     reader got, and one way in. */

  function renderFront() {
    var t = todayISO();
    var list = INDEX.puzzles || [];

    // the standing rows do not depend on a puzzle having loaded
    var solvedN = 0;
    list.forEach(function (x) { if (statusOf(x.id).state === 'solved') solvedN++; });
    var count = B.toBn(list.length) + T.puzzleCount
      + (solvedN ? ' · ' + B.toBn(solvedN) + T.solvedCount : '');
    els.fpArchiveMeta.textContent = count;
    if (els.fpAsideCount) els.fpAsideCount.textContent = count;
    els.fpHowtoNew.hidden = flag(K_HOWTO);
    els.frontToday.textContent = dateLabel(t);
    renderArchive();   // fills the desktop front page's inline list too

    if (!P) return;   // the error state owns the lead block

    var isToday = P.date === t;
    els.fpKicker.textContent = isToday ? T.today : T.latest;
    els.fpKicker.classList.toggle('is-stale', !isToday);
    els.fpDate.textContent = dateLabel(P.date);
    els.fpSize.textContent = B.toBn(P.rows) + '×' + B.toBn(P.cols)
      + ' · ' + B.toBn(P.entries.length) + T.clueCount;

    /* The board at thumbnail scale, carrying its blocks and the reader's own
       progress. No letters: a conjunct is illegible at 15px, so drawing one
       would be noise pretending to be information. */
    var pv = els.fpPreview;
    pv.classList.remove('is-waiting');
    pv.style.setProperty('--pcols', P.cols);
    pv.innerHTML = '';
    for (var i = 0; i < P.grid.length; i++) {
      var s = document.createElement('span');
      if (isBlock(i)) s.className = 'is-block';
      else if (cells[i]) s.className = 'is-filled';
      pv.appendChild(s);
    }

    var open = allCells().length - filledCount();
    var dot = '', state, sub = '';
    if (solved) {
      dot = 'is-solved';
      state = T.stateSolved;
      sub = T.timePrefix + fmtTime(Math.floor(elapsed));
      els.fpCta.textContent = T.review;
    } else if (open === 0) {
      // every square filled but not solved — "০টি ঘর বাকি" would be nonsense
      dot = 'is-started';
      state = T.stateFull;
      sub = T.timePrefix + fmtTime(Math.floor(elapsed));
      els.fpCta.textContent = T.resume;
    } else if (open < allCells().length) {
      dot = 'is-started';
      state = B.toBn(open) + T.cellsLeft;
      sub = T.timePrefix + fmtTime(Math.floor(elapsed));
      els.fpCta.textContent = T.resume;
    } else {
      state = T.stateNew;
      els.fpCta.textContent = T.start;
    }
    els.fpState.innerHTML = '<span class="fp-facts__dot ' + dot + '"></span>';
    els.fpState.appendChild(document.createTextNode(state));
    els.fpSub.textContent = sub;
    els.fpCta.disabled = false;
  }

  /* A failed load lands on the front page with a way out, not on an empty
     board with a sentence. */
  function frontError() {
    els.fpLead.innerHTML = '';
    var p = document.createElement('p');
    p.textContent = T.loadFail;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pa-btn pa-btn--primary fp-cta';
    b.textContent = T.retry;
    b.onclick = function () { location.reload(); };
    els.fpLead.className = 'fp-error';
    els.fpLead.appendChild(p);
    els.fpLead.appendChild(b);
    showView('front');
  }

  /* ---- loading -------------------------------------------------------- */

  function loadPuzzle(id) {
    stopTimer();
    return fetch('puzzles/' + id + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('puzzle ' + id + ' not found');
        return r.json();
      })
      .then(function (puz) {
        P = puz;
        currentId = id;

        // full reset — nothing may leak from the previous puzzle
        cells = new Array(P.rows * P.cols).fill('');
        wrong = {}; revealed = {}; elapsed = 0; solved = false;
        assists = { check: 0, reveal: 0 };
        fresh = true; tab = 'across';
        els.grid.classList.remove('is-solved');
        els.win.classList.remove('is-open');

        computeNumbers();
        restore();
        if (autocheck) checkCells(allCells());

        els.datelineText.textContent = (P.date === todayISO() ? T.todayPrefix : '') + dateLabel(P.date);

        buildGrid();

        sel = allCells().filter(function (i) { return !cells[i]; })[0];
        if (sel === undefined) sel = allCells()[0];
        dir = entryAt(sel, 'across') ? 'across' : 'down';

        sizeGrid();
        if (solved) els.grid.classList.add('is-solved');

        /* Loading is not entering. The hash, the timer and game:start all
           belong to enterPlay, so the front page can hold a fully loaded
           puzzle with the clock still at zero. */
        if (view === 'front') renderFront();
      });
  }

  function boot() {
    els = {
      app: $('app'),
      grid: $('grid'), gridwrap: $('gridwrap'), strip: $('strip'), kb: $('kb'),
      coach: $('coach'),
      timer: $('timer'), dateline: $('dateline'), datelineText: $('dateline-text'),
      clueNum: $('clue-num'), clueText: $('clue-text'),
      tabs: $('tabs'), list: $('cluelist'),
      tabsDesk: $('tabs-desk'), listDesk: $('cluelist-desk'),
      sheetClues: $('sheet-clues'), sheetMenu: $('sheet-menu'),
      sheetArchive: $('sheet-archive'), archive: $('archivelist'),
      frontArchive: $('fp-archivelist'), fpAsideCount: $('fp-aside-count'),
      sheetHowto: $('sheet-howto'), full: $('full'),
      frontToday: $('front-today'), fpLead: $('fp-lead'),
      fpKicker: $('fp-kicker'), fpDate: $('fp-date'), fpPreview: $('fp-preview'),
      fpSize: $('fp-size'), fpState: $('fp-state'), fpSub: $('fp-sub'),
      fpCta: $('fp-cta'), fpArchive: $('fp-archive'), fpArchiveMeta: $('fp-archive-meta'),
      fpHowto: $('fp-howto'), fpHowtoNew: $('fp-howto-new'),
      win: $('win'), winBest: $('win-best'),
      winTime: $('win-time'), winBestv: $('win-bestv'), winAssist: $('win-assist'),
      winNext: $('win-next'), winClose: $('win-close'), winHome: $('win-home')
    };

    var deepLink = false;

    fetch('puzzles/index.json')
      .then(function (r) { return r.json(); })
      .then(function (index) {
        INDEX = index;
        if (!(INDEX.puzzles || []).length) throw new Error('no puzzles');

        buildKeyboard();
        wire();

        // a #p= link is a request for that board, so it skips the front page
        var hash = (location.hash.match(/p=([\w-]+)/) || [])[1];
        deepLink = INDEX.puzzles.some(function (x) { return x.id === hash; });
        return loadPuzzle(deepLink ? hash : dailyId());
      })
      .then(function () {
        renderFront();
        if (deepLink) enterPlay();
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { if (view === 'play') sizeGrid(); });
        }
      })
      .catch(function (err) {
        frontError();
        if (window.console) console.error(err);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
