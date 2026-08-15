/*
 * শব্দফুল — Bangla word flower.
 *
 * A petal holds a CONSONANT, not an akshara. That is the whole design, and it
 * was settled by measurement, not taste: over the 713-word শব্দ সন্ধান corpus,
 * the best seven-akshara flower yields 7 findable words and the best
 * seven-consonant flower yields 24. Kars, hasant and the three signs live on
 * a rail beneath the flower and no puzzle constrains them.
 *
 * Composition goes through shared/bn-text.js unchanged — the same two-tap rule
 * শব্দভেদ's type case uses, so a reader who has filled one crossword square
 * already knows how to type here.
 *
 * The word list is two lists. The targets are human-reviewed and gate the win;
 * the bonus tier is machine-screened and accepted but never required, so a
 * real Bangla word the flower can make is never refused. A word search that
 * omits a word costs nothing; a word flower that refuses one is broken.
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
    recent: 'সাম্প্রতিক ধাঁধা',
    start: 'শুরু করুন',
    resume: 'চালিয়ে যান',
    review: 'আবার দেখুন',
    fresh: 'নতুন',
    solved: 'সম্পূর্ণ',
    progress: ' শব্দ পাওয়া গেছে',
    of: ' / ',
    letters: ' অক্ষর',
    words: ' শব্দ',
    packCount: 'টি ধাঁধা',
    todayBadge: 'আজ',
    latestBadge: 'সর্বশেষ',
    newBest: 'নতুন সেরা সময়',
    firstSolve: 'প্রথমবার সমাধান',
    unaided: 'কোনো সহায়তা ছাড়াই',
    prompt: 'অক্ষরে চাপ দিন',
    /* A refusal that does not say why is the failure the two-list design
       exists to prevent. Four reasons, one line, replaced not stacked. */
    badShort: 'তিন অক্ষরের কম',
    badCentre: 'মাঝের অক্ষরটি নেই',
    badPetal: 'ফুলের বাইরের অক্ষর',
    badDupe: 'আগেই পাওয়া গেছে',
    /* Not "the word was not recognised", which puts the doubt on the reader.
       The accept-set is a 2018 lemma list expanded through its own affix
       rules; where it is short, that is a fact about our dictionary and the
       message should say which of the two of you is missing something. */
    badList: 'আমাদের শব্দকোষে নেই',
    askThis: 'অনুরোধ করুন',
    askSent: 'ধন্যবাদ — শব্দটি পাঠানো হয়েছে',
    bonusTook: 'অতিরিক্ত শব্দ',
    hintNone: 'সব শব্দ পাওয়া গেছে',
    winWords: 'টি শব্দ, ',
    winLetters: 'টি অক্ষর'
  };

  /* The mark rail: everything a petal is not. Ten kars, the hasant, the three
     signs, then delete and submit. Two rows of eight — fourteen columns at
     360dp gives 21.8px keys, under the 24px floor, which is the same
     arithmetic that split শব্দভেদ's mark keys. */
  var KARS_1 = ['া', 'ি', 'ী', 'ু', 'ূ', 'ৃ', 'ে', 'ৈ'];
  var KARS_2 = ['ো', 'ৌ', '্', 'ং', 'ঁ', 'ঃ'];

  var STORE = 'pa:wf-bn:';
  var BEST = 'pa:wf-bn:best:';

  var PACK = null;
  var P = null;          // active puzzle
  var petals = [];       // the six outer letters, in display order
  var found = {};        // target word -> true
  var order = [];        // target words IN FIND ORDER — the taken list reads this
  var bonus = {};        // bonus word -> true
  var hinted = {};       // target word -> true (first akshara revealed)
  var cells = [];        // committed aksharas of the word being built
  var buf = '';          // the akshara currently under composition

  var clock = { secs: 0, running: false, iv: null };
  /* Read LIVE, not once at boot. The token layer flattens CSS animation on its
     own, but the flight, the ink spray and the FLIP are driven from here and a
     value sampled at load is wrong for any reader who changes the OS setting
     while the tab is open — which is exactly when they most want it obeyed. */
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var quiet = !!(mq && mq.matches);
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', function (e) { quiet = e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { quiet = e.matches; });
  }
  var byTouch = false;
  var bandHold = null;

  function $(id) { return document.getElementById(id); }
  function nfc(s) { return String(s == null ? '' : s).normalize ? String(s).normalize('NFC') : String(s); }

  /* ---- the flower ------------------------------------------------------- */

  /* Seven hexes: centre first, then the ring clockwise from the top-left.
     Percentages of a square box, so the whole flower scales by setting one
     width — board, front-page thumbnail and how-to figure are the same
     construction at three sizes.

     Derived, not eyeballed. For a pointy-top regular hexagon of width W the
     height is W/0.866, neighbours sit at (±W, 0) and (±W/2, ±0.75·H), and the
     cells then share edges exactly — which is what lets the ink ring on each
     cell read as one printed rule between two of them rather than two rules
     with a gap. W = 33, H = 38.10, centre at (50, 50); left/top are the
     centre coordinates less half the box. */
  var W = 33, H = 33 / 0.8660;
  function at(cx, cy) {
    return { l: (cx - W / 2).toFixed(2) + '%', t: (cy - H / 2).toFixed(2) + '%' };
  }
  /* The ring runs CLOCKWISE from the top-left, which is not decoration: the
     thumbnail inks one petal per sixth of the words found, and it can only do
     that by walking the DOM in the order the eye walks the flower. */
  var POS = [
    Object.assign({ c: 1 }, at(50, 50)),
    at(50 - W / 2, 50 - 0.75 * H), at(50 + W / 2, 50 - 0.75 * H),
    at(50 + W, 50),
    at(50 + W / 2, 50 + 0.75 * H), at(50 - W / 2, 50 + 0.75 * H),
    at(50 - W, 50)
  ];

  function hiveHTML(centre, ring, interactive) {
    var html = '', i;
    for (i = 0; i < POS.length; i++) {
      var p = POS[i];
      var ch = p.c ? centre : (ring[i - 1] || '');
      html += '<' + (interactive ? 'button type="button"' : 'span')
        + ' class="wf-hex' + (p.c ? ' is-centre' : '') + '"'
        + ' data-i="' + i + '" data-ch="' + ch + '"'
        + ' style="left:' + p.l + ';top:' + p.t + '"'
        + (interactive ? ' aria-label="' + ch + (p.c ? ', মাঝের অক্ষর' : '') + '"' : ' aria-hidden="true"')
        + '><span class="wf-hex__face">' + ch + '</span>'
        + '</' + (interactive ? 'button' : 'span') + '>';
    }
    return html;
  }

  /* A word's demand on the flower: its distinct base letters. Marks are free,
     so they never appear here — which is exactly why ব্দ demands ব and দ, both
     of which must be petals. */
  function basesOf(word) {
    var out = [], s = nfc(word), i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (B.isKar(ch) || B.isSign(ch) || ch === B.VIRAMA || ch === B.NUKTA) continue;
      if (out.indexOf(ch) < 0) out.push(ch);
    }
    return out;
  }

  /* ---- storage ---------------------------------------------------------- */

  /* Progress is keyed by puzzle id, and an id can outlive the words stored
     against it — re-running the pack builder puts different words on the same
     date. Anything not in THIS puzzle's lists is discarded on the way in, so a
     stale find can never be counted, drawn, or written back. */
  /* `w` is now written in FIND ORDER rather than puzzle order, because the
     taken list is newest-first and puzzle order cannot reconstruct that. A save
     written by the old build reads back cleanly — it is a valid array of this
     puzzle's words, so it simply restores in puzzle order, which is the best
     answer available for a session whose real order was never recorded. */
  function loadState(id, words) {
    var empty = { w: {}, o: [], b: {}, h: {}, t: 0 };
    try {
      var raw = localStorage.getItem(STORE + id);
      if (!raw) return empty;
      var v = JSON.parse(raw), i;
      var valid = {};
      for (i = 0; i < words.length; i++) valid[words[i]] = true;
      var st = { w: {}, o: [], b: {}, h: {}, t: v.t || 0 };
      var list = v.w || [];
      for (i = 0; i < list.length; i++) {
        /* A duplicate in a corrupt save must not become two chips. */
        if (valid[list[i]] && !st.w[list[i]]) { st.w[list[i]] = true; st.o.push(list[i]); }
      }
      list = v.h || [];
      for (i = 0; i < list.length; i++) if (valid[list[i]]) st.h[list[i]] = true;
      list = v.b || [];
      for (i = 0; i < list.length; i++) st.b[list[i]] = true;
      return st;
    } catch (e) { return empty; }
  }

  function saveState() {
    if (!P) return;
    try {
      localStorage.setItem(STORE + P.id, JSON.stringify({
        w: order.slice(),
        b: Object.keys(bonus),
        h: P.words.filter(function (w) { return hinted[w]; }),
        t: clock.secs
      }));
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

  /* Count THIS puzzle's words, never the size of the found map — the map can
     hold a key the puzzle does not contain. */
  function foundCount() {
    var n = 0;
    for (var i = 0; i < P.words.length; i++) if (found[P.words[i]]) n++;
    return n;
  }
  function hintCount() {
    var n = 0;
    for (var i = 0; i < P.words.length; i++) if (hinted[P.words[i]]) n++;
    return n;
  }
  function isComplete() { return P && foundCount() >= P.words.length; }

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
  function longDate(d) { return d ? DAYS[d.getDay()] + ', ' + B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + B.toBn(d.getFullYear()) : ''; }
  function printDate(d) { return d ? B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + B.toBn(d.getFullYear()) : ''; }
  function shortDate(d) { return d ? B.toBn(d.getDate()) + ' ' + MONTHS[d.getMonth()] : ''; }

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

  function nextUnfinished() {
    for (var i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      if (!isDue(pz) || pz.id === P.id) continue;
      if (countFound(pz.id, pz.words) < pz.words.length) return pz;
    }
    return null;
  }

  /* ---- composition ------------------------------------------------------ */

  function word() { return cells.join('') + buf; }
  function wordLen() { return cells.length + (buf ? 1 : 0); }

  function typeChar(ch) {
    if (isComplete()) return;
    var isMark = B.isKar(ch) || B.isSign(ch) || ch === B.VIRAMA || ch === B.NUKTA;
    /* A mark with nothing to sit on is not input, it is a stray tap. Silently
       ignored rather than refused: the reader has not made a word yet, so
       there is nothing to tell them about. */
    if (isMark && !buf) return;
    var r = B.compose(buf, ch);
    if (r.commit) { cells.push(r.cell); buf = r.next; }
    else buf = r.cell;
    paintBand();
    clearWhy();
  }

  function del() {
    if (!buf && !cells.length) return;
    if (buf) {
      buf = B.backspace(buf);
      if (!buf && cells.length) buf = cells.pop();
    } else {
      buf = B.backspace(cells.pop());
    }
    paintBand();
    clearWhy();
  }

  function clearWord() { cells = []; buf = ''; paintBand(); }

  /* ---- painting --------------------------------------------------------- */

  function paintBand() {
    var el = $('band'), w = word();
    el.classList.remove('is-set', 'is-bad');
    if (!w) {
      el.innerHTML = '<span class="wf-band__hint">' + T.prompt + '</span>';
      el.classList.remove('is-on');
    } else {
      el.innerHTML = '<span class="wf-band__w">' + w + '</span><i class="wf-band__caret"></i>';
      el.classList.add('is-on');
    }
    $('go').disabled = wordLen() < (PACK.minLen || 3);
  }

  /* `ask` is the word to offer a request button for. Only the unknown-word
     refusal passes one — the other three refusals are the reader's mistake,
     not the dictionary's, and offering to file a report on ফুলের বাইরের অক্ষর
     would be nonsense. */
  function say(reason, bad, ask) {
    var el = $('why');
    el.textContent = reason || '';
    el.classList.toggle('is-bad', !!bad);
    if (!ask) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wf-ask';
    btn.textContent = T.askThis;
    btn.onclick = function () { askFor(ask); };
    el.appendChild(btn);
  }
  function clearWhy() { say('', false); }

  /* One rule per letter-unit: a blank states its own length without a numeral
     doing it. A hinted first letter is set in full cyan — the same way শব্দভেদ
     sets a revealed letter, so a given stays visibly given.

     Every cell is the same fixed width, so the two-column grid of blanks never
     jogs. That rule was learned when the slot swapped its blanks for a plain
     word of a different width the moment it was found; the fix was equal boxes
     in every state, and it still stands for every blank on this list.

     There is no found state here any more. A blank carries a length, and once
     the word is found the length is known — so the entry leaves this list
     entirely and is set as plain type at the head of the taken list. See
     DESIGN.md, "A Found Entry Leaves the Hunt List". */
  function slotHTML(w) {
    var seg = B.segment(w), i, html = '';
    for (i = 0; i < seg.length; i++) {
      if (hinted[w] && i === 0) html += '<em>' + seg[0] + '</em>';
      else html += '<i></i>';
    }
    return html;
  }

  /* Newest first. A reader's own report is what settled this: a word found near
     the bottom of a scrolled list read as no answer at all — the band went
     green above the flower and the record of it was below the fold. The head of
     this list is where the flight lands and where the panel is scrolled to, so
     the confirmation is never somewhere the reader has to go looking. */
  function renderTaken() {
    var el = $('taken'), html = '', i, w;
    for (i = order.length - 1; i >= 0; i--) {
      w = order[i];
      html += '<li data-w="' + w + '">' + w + '</li>';
    }
    el.innerHTML = html;
    /* No empty state, no label, no box. Its APPEARANCE is the first
       confirmation the reader gets that this list is where words go. */
    el.hidden = order.length === 0;
  }

  function renderBlanks() {
    var html = '', i, w;
    for (i = 0; i < P.words.length; i++) {
      w = P.words[i];
      if (found[w]) continue;
      html += '<li class="wf-slot" data-w="' + w + '">' + slotHTML(w) + '</li>';
    }
    $('slots').innerHTML = html;
  }

  function renderSlots() {
    renderTaken();
    renderBlanks();
    $('count').textContent = B.toBn(foundCount()) + T.of + B.toBn(P.words.length);
    renderBonus();
    paintHint();
  }

  /* The row states a count; the sheet holds the words. Newest first, because
     the word a reader wants to see confirmed is the one they just found. */
  function renderBonus() {
    var list = Object.keys(bonus);
    $('bonus-n').textContent = B.toBn(list.length);
    $('bonus').disabled = list.length === 0;
    $('bonus-list').innerHTML = list.slice().reverse()
      .map(function (w) { return '<span>' + w + '</span>'; }).join('');
    /* The row is fixed height, so this can no longer change the play column —
       but sizeHive() is called anyway, because the reason the flower once
       overlapped the mark rail was a layout change that fired no resize
       event and left the measurement stale. The lesson was the missing call,
       not the specific element that grew. */
    sizeHive();
  }

  function paintHint() {
    var n = hintCount();
    $('hint-n').textContent = n ? B.toBn(n) : '';
    $('hint').disabled = isComplete() || nextHintable() === null;
  }

  function renderHive() {
    $('hive').innerHTML = hiveHTML(P.centre, petals, true);
  }

  /* ---- the front page --------------------------------------------------- */

  function renderFront() {
    var d = dateFromId(P.id);
    var pick = pickForToday();
    var isToday = pick.isToday && pick.pz.id === P.id;

    $('fp-kicker').textContent = isToday ? T.today : T.recent;
    $('fp-kicker').classList.toggle('is-stale', !isToday);
    $('fp-date').textContent = printDate(d);
    $('board-date').textContent = printDate(d);
    $('date').textContent = longDate(new Date());
    /* Derived from the pack, never hardcoded. */
    $('fp-size').textContent = B.toBn(P.petals.length + 1) + T.letters + ' · ' + B.toBn(P.words.length) + T.words;
    $('fp-archive-meta').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    $('fp-aside-count').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    renderArchive();

    var n = foundCount(), total = P.words.length;
    $('fp-dot').className = 'wf-dot' + (n === total ? ' is-solved' : (n > 0 ? ' is-started' : ''));
    $('fp-state').textContent = n === 0 ? T.fresh
      : (n === total ? T.solved + ' · ' + fmt(clock.secs)
        : B.toBn(n) + T.of + B.toBn(total) + T.progress);
    $('fp-cta').textContent = n === 0 ? T.start : (n === total ? T.review : T.resume);

    renderMini(n, total);
  }

  /* The rosette, no letters. The centre inks once the reader has started; the
     six outer petals ink one per sixth of the words found. A conjunct at this
     size is noise pretending to be information, and the silhouette is
     unmistakably this game and no other. */
  function renderMini(n, total) {
    var el = $('fp-mini');
    el.innerHTML = hiveHTML('', ['', '', '', '', '', ''], false);
    var lit = total ? Math.round(6 * n / total) : 0;
    var kids = el.children, i;
    if (n > 0) kids[0].classList.add('is-on');
    for (i = 1; i <= 6; i++) kids[i].classList.toggle('is-on', i <= lit);
  }

  function renderArchive() {
    var key = todayKey(), hasToday = false, latestDue = null, i;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) hasToday = true;
      if (isDue(PACK.puzzles[i])) latestDue = PACK.puzzles[i].id;
    }

    /* Newest first: a reader opening the list wants today at the top, not a
       month ago. Same order both siblings use. */
    var html = '';
    for (i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      var due = isDue(pz);
      var n = countFound(pz.id, pz.words);
      var total = pz.words.length;
      var dotCls = n === total ? ' is-solved' : (n > 0 ? ' is-started' : '');
      var label = n === total ? T.solved : (n > 0 ? B.toBn(n) + T.of + B.toBn(total) : T.fresh);
      var badge = pz.id.slice(-10) === key
        ? '<span class="wf-arcrow__badge">' + T.todayBadge + '</span>'
        : (!hasToday && pz.id === latestDue ? '<span class="wf-arcrow__badge is-latest">' + T.latestBadge + '</span>' : '');

      html += '<button type="button" class="wf-arcrow" data-id="' + pz.id + '"'
        + (pz.id === P.id ? ' aria-current="true"' : '') + (due ? '' : ' disabled') + '>'
        + '<span class="wf-arcrow__date">' + shortDate(dateFromId(pz.id)) + '</span>' + badge
        + '<span class="wf-arcrow__state"><i class="wf-dot' + dotCls + '" aria-hidden="true"></i>' + label + '</span>'
        + '</button>';
    }
    $('arch-list').innerHTML = html;
    $('fp-archlist').innerHTML = html;
  }

  /* ---- feedback --------------------------------------------------------- */

  function buzz(pattern) {
    if (quiet || !byTouch) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  /* Restart an animation class and take it off again. animationend is not
     guaranteed — a backgrounded tab leaves the class stuck, and a spent
     fill-mode animation would then outrank the class rules underneath it. */
  function replay(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  function flashHex(ch) {
    var nodes = $('hive').children, i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-ch') === ch) { replay(nodes[i], 'is-hit', 300); return; }
    }
  }

  /* The petals used, struck back in the order they were typed — contracted in
     WORDFLOWER-SPEC.md and never built until now. It is the flower agreeing
     with the reader: you said this, and these are the letters you said it
     with. Marks are skipped, because a kar is not a petal. */
  function flashWord(w) {
    if (quiet) return;
    var s = nfc(w), n = 0, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (B.isKar(ch) || B.isSign(ch) || ch === B.VIRAMA || ch === B.NUKTA) continue;
      (function (c, k) { setTimeout(function () { flashHex(c); }, k * 30); })(ch, n++);
    }
  }

  /* The ONE axis the design escalates on, and the only one it is allowed.
     Streaks and combos were asked for and refused: the spec bans points and
     ranks, and a combo meter is scoring smuggled in as motion. Length is
     legitimate because it is a real property of what the reader just did, and
     because it explains itself — a longer word visibly sprays more.

     There was a fourth, larger tier for the day's longest word, in two inks.
     It went with the red rule that marked that word, and for the same reason:
     with nothing on the board to announce it, one word a day paying out
     differently is a difference the reader cannot account for. The longest
     word is now simply a long word, and lands in the 6+ tier when it is one. */
  function tierFor(w) {
    var n = B.segment(nfc(w)).length;
    if (n >= 6) return { sparks: 12, buzz: 18, pop: 1.09 };
    if (n >= 4) return { sparks: 8, buzz: 12, pop: 1.06 };
    return { sparks: 6, buzz: 8, pop: 1.03 };
  }

  /* FLIP over both lists. One entry leaving the middle of a two-column grid
     snaps everything after it; measuring first and playing the difference back
     is what makes the blanks close the gap instead of jumping into it. The
     word that was just taken is excluded — the flight is carrying that one. */
  function rectsNow() {
    var m = {}, nodes = document.querySelectorAll('#taken li, #slots li'), i, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      m[n.getAttribute('data-w')] = n.getBoundingClientRect();
    }
    return m;
  }

  function flip(before, skip) {
    if (quiet) return;
    var nodes = document.querySelectorAll('#taken li, #slots li'), i, n, w, a, b, dx, dy;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      w = n.getAttribute('data-w');
      if (w === skip) continue;
      a = before[w];
      if (!a) continue;
      b = n.getBoundingClientRect();
      dx = a.left - b.left;
      dy = a.top - b.top;
      if (!dx && !dy) continue;
      n.animate(
        [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' }
      );
    }
  }

  /* The ink spray. Hard-edged marks in the settled ink, fired at the point the
     word LANDS — never at the band it left. A payoff at the destination is what
     teaches the eye where the record is kept, and that was the whole defect.
     Nothing here is round, blurred or glowing; see DESIGN.md, "The Ink Spray
     Rule". Never fires for an অতিরিক্ত word. */
  function spray(rect, tier) {
    if (quiet || !tier.sparks) return;
    var layer = $('fly'), n = tier.sparks, i;
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (i = 0; i < n; i++) {
      var s = document.createElement('i');
      s.className = 'wf-spark';
      s.style.left = cx + 'px';
      s.style.top = cy + 'px';
      layer.appendChild(s);
      var ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.5;
      var d = 34 + Math.random() * 32;
      (function (node, x, y) {
        var a = node.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: 'translate(' + (x - 1.5) + 'px,' + (y - 1.5) + 'px) scale(0.55)', opacity: 0 }
        ], { duration: 420, easing: 'cubic-bezier(.15,.6,.3,1)' });
        /* animationend is not guaranteed — a backgrounded tab would leave the
           layer full of marks. Same lesson as replay(): always a backstop. */
        function kill() { if (node.parentNode) node.parentNode.removeChild(node); }
        a.onfinish = kill;
        setTimeout(kill, 700);
      })(s, Math.cos(ang) * d, Math.sin(ang) * d);
    }
  }

  /* The flight: the word carried from the band it was read in to the head of
     the list that records it. Capped at three in the air — a fourth find inside
     380ms means the reader is not watching them anyway, and the cap is cheaper
     than a queue nobody sees. */
  var flights = 0;

  function fly(w, tier) {
    var dst = $('taken').querySelector('[data-w="' + w + '"]');
    if (!dst) return;
    var src = $('band').querySelector('.wf-band__w');
    if (quiet || !src || flights >= 3) { spray(dst.getBoundingClientRect(), tier); return; }

    var a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
    if (!a.height || !b.height) return;
    var sf = parseFloat(window.getComputedStyle(src).fontSize) || 1;
    var df = parseFloat(window.getComputedStyle(dst).fontSize) || 1;
    var k = df / sf;

    var el = document.createElement('span');
    el.className = 'wf-fly__w';
    el.textContent = w;
    el.style.left = a.left + 'px';
    el.style.top = a.top + 'px';
    el.style.fontSize = sf + 'px';
    $('fly').appendChild(el);

    dst.style.opacity = '0';
    flights++;

    var spent = false;
    function done() {
      if (spent) return;
      spent = true;
      flights--;
      if (el.parentNode) el.parentNode.removeChild(el);
      /* The destination may have been re-rendered out from under this flight by
         a second find. Painting a detached node is harmless; the live one is
         already visible, so either way nothing is left invisible. */
      dst.style.opacity = '';
      replay(dst, 'is-land', 300);
      spray(dst.getBoundingClientRect(), tier);
    }

    var anim = el.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) scale(' + k + ')' }
    ], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)' });
    anim.onfinish = done;
    setTimeout(done, 700);
  }

  function took(w, isBonus) {
    var band = $('band');
    var tier = isBonus ? { sparks: 0, buzz: 8, pop: 1.03 } : tierFor(w);

    band.innerHTML = '<span class="wf-band__w">' + w + '</span>';
    band.classList.remove('is-on', 'is-bad');
    band.style.setProperty('--pop', tier.pop);
    band.classList.add('is-set');
    clearTimeout(bandHold);
    bandHold = setTimeout(function () { paintBand(); }, 900);

    say(isBonus ? T.bonusTook : '', false);
    buzz(tier.buzz);

    /* An অতিরিক্ত word is acknowledged, not rewarded — there are a median 5,365
       of them findable in a day, and they fly to a list behind a sheet. The
       count on the row is the whole answer. */
    if (isBonus) { replay($('bonus-n'), 'is-tick', 500); return; }

    replay($('count'), 'is-tick', 600);
    flashWord(w);

    /* The landing must be on screen or this rebuilds the bug it was written to
       fix, so the panel returns to its head first. Only when the reader has
       actually scrolled away — smooth-scrolling a panel already at zero would
       delay every flight in the game to pay for the uncommon case. */
    var panel = $('panel'), delay = 180;
    if (panel.scrollTop > 0) {
      if (quiet) panel.scrollTop = 0;
      else { panel.scrollTo({ top: 0, behavior: 'smooth' }); delay = 440; }
    }
    setTimeout(function () { fly(w, tier); }, delay);
  }

  function refuse(reason, ask) {
    var band = $('band');
    band.classList.remove('is-set', 'is-on');
    band.classList.add('is-bad');
    say(reason, true, ask);
    buzz(24);
    clearTimeout(bandHold);
    bandHold = setTimeout(function () { clearWord(); }, 700);
  }

  /* The flower takes the spot red once and releases it, outward from the
     centre — this game's version of the gesture both siblings make when their
     board comes out. A rule, never a fill. */
  function solveSweep() {
    var nodes = $('hive').children, i;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].style.setProperty('--d', (i === 0 ? 0 : 90 + i * 40) + 'ms');
      replay(nodes[i], 'is-solved', 700 + i * 40);
    }
    buzz([16, 70, 16]);
  }

  /* ---- submitting ------------------------------------------------------- */

  function findIn(list, w) {
    for (var i = 0; i < list.length; i++) if (B.equals(list[i], w)) return list[i];
    return null;
  }

  function submit() {
    if (isComplete()) return;
    var w = nfc(word());
    if (!w) return;

    if (wordLen() < (PACK.minLen || 3)) { refuse(T.badShort); return; }

    var bs = basesOf(w);
    if (bs.indexOf(P.centre) < 0) { refuse(T.badCentre); return; }

    var flower = [P.centre].concat(P.petals), i;
    for (i = 0; i < bs.length; i++) {
      if (flower.indexOf(bs[i]) < 0) { refuse(T.badPetal); return; }
    }

    var hit = findIn(P.words, w);
    if (hit && found[hit]) { refuse(T.badDupe); return; }

    /* Two accept tiers, checked in the order they become available. The
       inline list is a linear scan of 160 and always present; the fetched
       set is a hash lookup over as many as 17,000 and arrives a moment
       later. Both are already NFC and so is `w`, so the set can be indexed
       directly — normalising 17,000 words per keystroke to use the same
       comparator the small list uses would be the obvious way to make this
       feel slow. */
    var extra = null;
    if (!hit) {
      extra = findIn(P.bonus || [], w);
      if (!extra && accept && accept[w] === true) extra = w;
    }
    if (extra && bonus[extra]) { refuse(T.badDupe); return; }

    if (hit) {
      found[hit] = true;
      order.push(hit);
      saveState();
      cells = []; buf = '';
      /* Measured before the re-render, played back after: the blanks close the
         gap the taken word left rather than snapping shut across it. */
      var before = rectsNow();
      renderSlots();
      flip(before, hit);
      took(hit, false);
      if (isComplete()) win();
      return;
    }
    if (extra) {
      bonus[extra] = true;
      saveState();
      cells = []; buf = '';
      renderBonus();
      took(extra, true);
      return;
    }
    /* The word uses the right letters and the right centre and is still not
       known. On the evidence so far that is more often our dictionary's
       fault than the reader's, so the message says so and the word is kept
       for the next pack build. */
    logMiss(w);
    refuse(T.badList, w);
  }

  /* ---- hints ------------------------------------------------------------
     The shape, never the word: length is already on the slot, so a hint adds
     the first letter-unit and nothing else. Unlimited, but every one is
     counted and printed on the completion card — the accounting শব্দভেদ
     already uses. */

  function nextHintable() {
    var i, w, unhinted = null;
    for (i = 0; i < P.words.length; i++) {
      w = P.words[i];
      if (found[w] || hinted[w]) continue;
      /* Longest-first: the words a reader is actually stuck on are the long
         ones, and hinting the three-letter filler would spend an assist on
         nothing. */
      if (!unhinted || B.segment(w).length > B.segment(unhinted).length) unhinted = w;
    }
    return unhinted;
  }

  function hint() {
    var w = nextHintable();
    if (!w) { say(T.hintNone, false); return; }
    hinted[w] = true;
    saveState();
    renderSlots();
    var slot = $('slots').querySelector('[data-w="' + w + '"]');
    if (slot && slot.scrollIntoView) slot.scrollIntoView({ block: 'nearest' });
  }

  /* ---- views ------------------------------------------------------------ */

  function goFront() {
    clockStop();
    saveState();
    renderFront();
    $('app').setAttribute('data-view', 'front');
  }

  function goBoard() {
    renderHive();
    renderSlots();
    clearWord();
    clearWhy();
    paintClock();
    $('app').setAttribute('data-view', 'board');
    sizeHive();
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

    emit('game:complete', { id: P.id, words: P.words.length, hints: hintCount(), secs: clock.secs });

    $('win-sub').textContent = B.toBn(P.words.length) + T.winWords + B.toBn(P.petals.length + 1) + T.winLetters;
    $('win-time').textContent = fmt(clock.secs);
    $('win-best').textContent = fmt(isBest ? clock.secs : prev);
    $('win-hints').textContent = B.toBn(hintCount());
    $('win-note').textContent = !prev ? T.firstSolve : (isBest ? T.newBest : (hintCount() === 0 ? T.unaided : ''));
    paintClock();
    paintHint();

    /* The board gets its moment before the card covers it. */
    solveSweep();
    setTimeout(function () { openSheet($('sheet-win')); }, 1100);
  }

  function emit(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: type, game: 'shobdophul', data: data || {} }, '*');
      }
    } catch (e) {}
  }

  /* The flower shares the viewport with a mark rail and a word list, so it is
     bounded by height at least as often as by width. Measure, then hand the
     size to CSS — a vw-only guess overflows on a short screen.

     There was a `Math.max(180, …)` floor here. A floor on the one zone that
     is supposed to absorb is a contradiction: it says "shrink to fit" and
     then refuses to shrink, so on a short screen the flower stayed 180px and
     spilled over the mark rail. There is no floor now. A very short viewport
     gets a small flower, which is correct and legible; what it must never
     get is a flower drawn on top of its own keyboard.

     Call this after ANY change to the other zones' heights, not just on
     window resize — the layout can change with no resize event at all. */
  function sizeHive() {
    var wrap = $('board-main');
    if (!wrap || !wrap.clientWidth) return;
    var cs = window.getComputedStyle(wrap);
    var w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var maxRem = parseFloat(cs.getPropertyValue('--wf-max')) || 22;
    var root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var side = Math.max(0, Math.min(w, h, maxRem * root));
    $('hive').style.setProperty('--wf-side', side + 'px');
    $('board-main').style.setProperty('--wf-side', side + 'px');
  }

  /* ---- the mark rail ---------------------------------------------------- */

  function renderRail() {
    function keys(list) {
      return list.map(function (k) {
        return '<button type="button" class="wf-key" data-mark="' + k + '" aria-label="' + k + '">◌' + k + '</button>';
      }).join('');
    }
    $('rail-1').innerHTML = keys(KARS_1);
    $('rail-2').innerHTML = keys(KARS_2)
      + '<button type="button" class="wf-key wf-key--act" id="del" aria-label="মুছুন">'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6H9l-5 6 5 6h11z"/><path d="M15 10l-4 4M11 10l4 4"/></svg></button>'
      + '<button type="button" class="wf-key wf-key--go" id="go" aria-label="জমা দিন" disabled>'
      + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>';
  }

  /* ---- binding ---------------------------------------------------------- */

  function bindBoard() {
    $('hive').addEventListener('pointerdown', function (e) { byTouch = e.pointerType === 'touch'; });
    $('hive').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.wf-hex') : null;
      if (!btn) return;
      var ch = btn.getAttribute('data-ch');
      if (!ch) return;
      typeChar(ch);
      replay(btn, 'is-hit', 300);
      buzz(4);
    });

    document.querySelector('.wf-rail').addEventListener('pointerdown', function (e) { byTouch = e.pointerType === 'touch'; });
    document.querySelector('.wf-rail').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.wf-key') : null;
      if (!btn) return;
      if (btn.id === 'del') { del(); buzz(4); return; }
      if (btn.id === 'go') { submit(); return; }
      var mark = btn.getAttribute('data-mark');
      if (mark) { typeChar(mark); buzz(4); }
    });

    $('hint').onclick = hint;

    /* The Input Follows the Device Rule: on a spread there is a real keyboard,
       and a reader with a Bangla input method should be able to use it. Any
       Bangla character is accepted here — including one the flower does not
       hold, because refusing it at submit with a stated reason is more honest
       than swallowing the keystroke and looking broken. */
    document.addEventListener('keydown', function (e) {
      if ($('app').getAttribute('data-view') !== 'board') return;
      if (document.querySelector('.pa-sheet.is-open')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') { e.preventDefault(); del(); return; }
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key && e.key.length === 1) {
        var c = e.key.charCodeAt(0);
        if (c >= 0x0980 && c <= 0x09FF) { e.preventDefault(); byTouch = false; typeChar(e.key); flashHex(e.key); }
      }
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
    $('fp-howto').onclick = openHowto;
    $('board-howto').onclick = openHowto;
    $('top-howto').onclick = openHowto;
    $('bonus').onclick = function () {
      if (Object.keys(bonus).length) openSheet($('sheet-bonus'));
    };

    $('shuffle').onclick = function () {
      /* The six outer petals reorder; the centre never moves, because the
         centre is the rule and not a letter you are hunting for. */
      for (var i = petals.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = petals[i]; petals[i] = petals[j]; petals[j] = t;
      }
      renderHive();
      sizeHive();
      buzz(8);
    };

    function showArchive() { renderArchive(); openSheet($('sheet-arch')); }
    $('fp-archive').onclick = showArchive;
    $('dateline').onclick = showArchive;

    function pickFromList(e) {
      var row = e.target.closest('.wf-arcrow');
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
      if (word()) { clearWord(); clearWhy(); return; }
      if ($('app').getAttribute('data-view') === 'board') goFront();
    });

    /* Time accrued while the tab is in the background is not solving time. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clockStop(); saveState(); }
      else if ($('app').getAttribute('data-view') === 'board') clockStart();
    });

    window.addEventListener('resize', sizeHive);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeHive);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeHive);
  }

  function openHowto() {
    /* The figure shows this puzzle's own flower, not a generic one — the
       how-to and the board are then visibly the same object. */
    $('howto-hive').innerHTML = hiveHTML(P.centre, P.petals, false);
    openSheet($('sheet-howto'));
  }

  /* ---- boot ------------------------------------------------------------- */

  /* ---- the accept-set ----------------------------------------------------
     Every real Bangla word this flower can spell, beyond the 24 the day
     requires. It is fetched per puzzle rather than shipped in index.json,
     because index.json is parsed by the front page and the archive by every
     visitor, and the thirty accept-sets together are 4.2 MB of text that
     only a reader who actually opens a board has any use for. One day is a
     median 15 KB gzipped.

     THE INLINE BONUS LIST IS NOT REPLACED BY THIS, it is joined by it. The
     160 words in index.json are live from the first frame, so there is no
     loading state, no disabled ✓, and no window in which the game refuses a
     word it is about to start accepting. If the fetch fails outright the
     game degrades to exactly the behaviour it shipped with. */
  var accept = null;      // Set of NFC words, or null until it lands
  var acceptFor = null;   // the puzzle id `accept` belongs to
  var MISS = 'pa:wf-bn:miss';

  function loadAccept(id) {
    if (acceptFor === id) return;
    accept = null;
    acceptFor = id;
    fetch('puzzles/accept/' + id + '.txt')
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt || acceptFor !== id) return;
        var set = {}, list = txt.split('\n'), i, w;
        for (i = 0; i < list.length; i++) {
          w = list[i];
          if (w) set[w] = true;
        }
        accept = set;
      })
      .catch(function () { /* the inline 160 still stand */ });
  }

  /* A word the flower can legally spell that neither list knows. The
     dictionary is a 2018 lemma list run through its own affix rules; it has
     holes, and কামরায় is one of them. Recording the misses is how the next
     pack build learns what they are — the refusal message already tells the
     reader it is our dictionary at fault, and this is what makes that true
     rather than merely polite. Capped, because it is a diagnostic and not a
     database. */
  /* ---- requesting a word -------------------------------------------------
     The refusal message admits our dictionary might be the one at fault. This
     is what lets the reader do something about it, and lets us find out.

     Paste a Google Form's response URL here and the reader's tap opens it
     with the word, the puzzle and the date already filled in, so answers land
     in a sheet beside GamesTracker. Until then it falls back to a mail draft,
     which works everywhere and collects almost nothing — the form is the
     real answer, this is the thing that stops the button being dead in the
     meantime.

     To wire it up: make the form with three short-answer questions, take the
     prefilled-link URL, and drop it in below with its entry.* ids. */
  var REQUEST_FORM = '';                       // e.g. 'https://docs.google.com/forms/d/e/FORM_ID/viewform'
  var REQUEST_FIELDS = { word: 'entry.111', puzzle: 'entry.222', date: 'entry.333' };
  var REQUEST_MAIL = 'pasha@nagorik.tech';
  var ASKED = 'pa:wf-bn:asked';

  function requestUrl(w) {
    var pid = P ? P.id : '', when = new Date().toISOString().slice(0, 10);
    if (REQUEST_FORM) {
      return REQUEST_FORM + (REQUEST_FORM.indexOf('?') < 0 ? '?' : '&') + 'usp=pp_url'
        + '&' + REQUEST_FIELDS.word + '=' + encodeURIComponent(w)
        + '&' + REQUEST_FIELDS.puzzle + '=' + encodeURIComponent(pid)
        + '&' + REQUEST_FIELDS.date + '=' + encodeURIComponent(when);
    }
    return 'mailto:' + REQUEST_MAIL
      + '?subject=' + encodeURIComponent('শব্দফুল — শব্দের অনুরোধ')
      + '&body=' + encodeURIComponent('শব্দ: ' + w + '\nধাঁধা: ' + pid + '\nতারিখ: ' + when);
  }

  /* Kept locally as well as sent, so the requests survive a reader who never
     completes the form — and so a rebuild can be checked against what people
     actually asked for rather than against what arrived. */
  function saveAsked(w) {
    try {
      var raw = localStorage.getItem(ASKED);
      var list = raw ? JSON.parse(raw) : [];
      if (list.indexOf(w) < 0 && list.length < 200) {
        list.push(w);
        localStorage.setItem(ASKED, JSON.stringify(list));
      }
    } catch (e) {}
  }

  function askFor(w) {
    if (!w) return;
    saveAsked(w);
    say(T.askSent, false);
    try { window.open(requestUrl(w), '_blank', 'noopener'); }
    catch (e) { location.href = requestUrl(w); }
  }

  function logMiss(w) {
    try {
      var raw = localStorage.getItem(MISS);
      var list = raw ? JSON.parse(raw) : [];
      if (list.indexOf(w) >= 0 || list.length >= 200) return;
      list.push(w);
      localStorage.setItem(MISS, JSON.stringify(list));
    } catch (e) { /* private mode: a diagnostic is not worth an exception */ }
  }

  function loadPuzzle(pz) {
    clockStop();
    P = {
      id: pz.id,
      centre: nfc(pz.centre),
      petals: (pz.petals || []).map(nfc),
      words: (pz.words || []).map(nfc),
      bonus: (pz.bonus || []).map(nfc)
      /* `longest` is still written into the pack — the builder computes it and
         the review CSV is ordered by it — but the game no longer reads it. The
         mark it drove is gone, and nothing else in the board wants to know
         which of twenty-four equal words happens to be the longest. */
    };
    petals = P.petals.slice();
    var st = loadState(P.id, P.words);
    found = st.w; order = st.o; bonus = st.b; hinted = st.h;
    clock.secs = st.t;
    cells = []; buf = '';
    loadAccept(P.id);
    return true;
  }

  function openPuzzle(pz, enter) {
    if (!loadPuzzle(pz)) return;
    if (enter) goBoard(); else goFront();
  }

  function init() {
    fetch('puzzles/index.json')
      .then(function (r) { return r.json(); })
      .then(function (pack) {
        PACK = pack;
        if (!PACK.puzzles || !PACK.puzzles.length) throw new Error('empty pack');
        renderRail();
        /* A #p= link is a request for THAT board, so it skips the front page.
           The same contract both siblings answer, so খেলাঘর addresses a dated
           issue in any hero game with one link shape. An id we cannot serve
           falls through to the daily rather than to an error. */
        var hash = (location.hash.match(/p=([\w-]+)/) || [])[1], wanted = null, i;
        for (i = 0; i < PACK.puzzles.length; i++) {
          if (PACK.puzzles[i].id === hash && isDue(PACK.puzzles[i])) { wanted = PACK.puzzles[i]; break; }
        }
        loadPuzzle(wanted || pickForToday().pz);
        bind();
        bindBoard();
        if (wanted) goBoard(); else goFront();
      })
      .catch(function (err) {
        console.error(err);
        /* The letters line used to carry this. It is gone, so the state line
           does — it is the only thing on the front page whose job is to say
           what is happening. */
        $('fp-state').textContent = 'ধাঁধা লোড করা গেল না';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
