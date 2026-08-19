/*
 * কুইজ — Prothom Alo's daily quiz.
 *
 * Ten questions a day on one subject, four options each, in a single
 * scrolling column. Tapping an option answers it and the answer is shown at
 * once, right or wrong. There is no clock in this file: not counting down,
 * not counting up, not stored. The other four heroes are scored on time and
 * this one is scored on a count of correct answers, which is the whole
 * difference between a puzzle you solve and a question you know.
 *
 * The questions are not ours. They come from Prothom Alo's own quiz library,
 * screened and reviewed into puzzles/index.json by build-pack.mjs.
 *
 * This file ships to a public URL, so it names no internal system of the
 * client's. Which library, how it was exported and what was cut from it are
 * in QUIZ-SPEC.md, which does not ship.
 *
 * A finished day LOCKS. Reopening it is reading, not replaying: a quiz's
 * second run measures memory, so there is no better score to chase and no
 * way to chase one.
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
    today: 'আজকের কুইজ',
    recent: 'সর্বশেষ কুইজ',
    start: 'শুরু করুন',
    resume: 'চালিয়ে যান',
    review: 'উত্তর দেখুন',
    fresh: 'নতুন কুইজ',
    done: 'শেষ',
    answered: 'টির উত্তর দেওয়া হয়েছে',
    of: ' / ',
    correct: ' সঠিক',
    packCount: 'টি কুইজ',
    stFresh: 'নতুন',
    todayBadge: 'আজ',
    latestBadge: 'সর্বশেষ',
    qCount: 'টি প্রশ্ন · ৪টি করে উত্তর',
    failLoad: 'কুইজ লোড হয়নি',
    /* The card's headline moves with the result, because "চমৎকার!" over ২/১০
       is the game not reading the room. Nothing here scolds: the lowest band
       is an invitation to look at the answers, not a verdict on the reader. */
    markHigh: 'চমৎকার!',
    markMid: 'বেশ ভালো',
    markLow: 'শেষ',
    noteAll: 'দশে দশ। একটিও ভুল হয়নি।',
    noteMid: 'সঠিক উত্তরগুলো নিচে সবুজ চিহ্ন দেওয়া আছে।',
    noteLow: 'উত্তরগুলো একবার দেখে নিন — সবগুলোই নিচে চিহ্ন দেওয়া আছে।'
  };

  var STORE = 'pa:qz-bn:';
  var BEST = 'pa:qz-bn:best:';

  var PACK = null;      // puzzles/index.json
  var P = null;         // active puzzle { id, theme, questions[] }
  var picks = [];       // one entry per question: option index, or -1
  var locked = false;   // this day is finished and read-only

  /* Read from a LIVE listener, never sampled once at boot: the token layer
     only flattens CSS, and everything below — the spray, the haptics, the
     pacing — is driven from here. The reader who changes the setting
     mid-session is exactly the reader who meant it. */
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var quiet = !!(mq && mq.matches);
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', function (e) { quiet = e.matches; });
    else if (mq.addListener) mq.addListener(function (e) { quiet = e.matches; });
  }

  /* Set on the pointerdown that precedes a tap, and read when the answer
     resolves. A mouse has no wrist to tap. */
  var byTouch = false;

  function $(id) { return document.getElementById(id); }

  /* ---- state ------------------------------------------------------------ */

  /* A fingerprint of the day's questions, so an answer sheet can be matched to
     the puzzle it was written against.

     Checking the sheet's LENGTH is not enough and was the bug: every day holds
     exactly ten questions, so a length check passes for every rebuild of the
     pack and the guard never fires. Rebuilding genuinely does move questions —
     re-running build-pack.mjs after a screening change put a different set on
     the same date — and the old answers then landed on the new questions, one
     by one, scoring nonsense. Cheap FNV-1a over the question texts; a changed
     day fails it and the reader starts that day clean. */
  function fingerprint(pz) {
    var s = '', i;
    for (i = 0; i < pz.questions.length; i++) s += pz.questions[i].q + '\u0001';
    var h = 2166136261;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  /* Progress is keyed by puzzle id, and an id outlives the questions it was
     stored against. Any sheet whose fingerprint does not match this day's
     questions is discarded whole rather than half-applied — including a sheet
     written before fingerprints existed, which cannot be verified and so
     cannot be trusted. Any index outside the four options a question has
     becomes "unanswered". */
  function loadState(pz) {
    var n = pz.questions.length, blank = [], i;
    for (i = 0; i < n; i++) blank.push(-1);
    try {
      var raw = localStorage.getItem(STORE + pz.id);
      if (!raw) return blank;
      var v = JSON.parse(raw);
      var a = v && v.a;
      if (!Array.isArray(a) || a.length !== n) return blank;
      if (v.f !== fingerprint(pz)) return blank;
      return a.map(function (x) {
        return (typeof x === 'number' && x >= 0 && x < 4) ? x : -1;
      });
    } catch (e) { return blank; }
  }

  function saveState() {
    if (!P) return;
    try {
      localStorage.setItem(STORE + P.id, JSON.stringify({ a: picks, f: fingerprint(P) }));
    } catch (e) {}
  }

  /* The hub reads these two functions' answers off localStorage itself, so
     the shapes here and the shapes in hub.js are one contract. */
  function answeredIn(pz) {
    var a = loadState(pz), c = 0, i;
    for (i = 0; i < a.length; i++) if (a[i] >= 0) c++;
    return c;
  }

  function scoreIn(pz) {
    var a = loadState(pz), c = 0, i;
    for (i = 0; i < pz.questions.length; i++) if (a[i] === pz.questions[i].a) c++;
    return c;
  }

  function answered() {
    var c = 0, i;
    for (i = 0; i < picks.length; i++) if (picks[i] >= 0) c++;
    return c;
  }

  function score() {
    var c = 0, i;
    for (i = 0; i < picks.length; i++) if (picks[i] === P.questions[i].a) c++;
    return c;
  }

  function isComplete() { return answered() >= P.questions.length; }

  /* Best is a MAXIMUM here, where every other hero's is a minimum — theirs is
     the shortest time, this one's is the highest score. It cannot actually
     move after the first play, because a finished day locks, but it is
     written so খেলাঘর has one place to read a result from. */
  function bestOf(id) {
    try { return parseInt(localStorage.getItem(BEST + id) || '-1', 10); } catch (e) { return -1; }
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

  /* Today's quiz if the pack covers today; otherwise the last one that has
     come due, so the front page never claims a future date is "today". */
  function pickForToday() {
    var key = todayKey(), i, due = null;
    for (i = 0; i < PACK.puzzles.length; i++) {
      if (PACK.puzzles[i].id.slice(-10) === key) return { pz: PACK.puzzles[i], isToday: true };
      if (PACK.puzzles[i].id.slice(-10) <= key) due = PACK.puzzles[i];
    }
    return { pz: due || PACK.puzzles[0], isToday: false };
  }

  /* Newest due quiz the reader has not finished — what the card offers next.
     A finished day is never a dead end. */
  function nextUnfinished() {
    for (var i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      if (!isDue(pz) || pz.id === P.id) continue;
      if (answeredIn(pz) < pz.questions.length) return pz;
    }
    return null;
  }

  /* ---- rendering -------------------------------------------------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var TICK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4.5 4.5L19 7"/></svg>';
  var CROSS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 18L18 6"/></svg>';

  /* The three carriers of a locked question, decided once, here. The right
     answer is marked whether or not the reader found it; the reader's wrong
     pick takes the proof-reader's slash; everything else simply stops being
     theirs to pick. Nothing is left to hue on its own — DESIGN.md forbids it,
     and red/green is the exact pair it forbids it for. */
  function optClass(qi, oi) {
    var pick = picks[qi];
    if (pick < 0) return '';
    var right = P.questions[qi].a;
    if (oi === right) return ' is-right';
    if (oi === pick) return ' is-wrong';
    return ' is-idle';
  }

  function optMark(qi, oi) {
    var pick = picks[qi];
    if (pick < 0) return '';
    if (oi === P.questions[qi].a) return TICK;
    if (oi === pick) return CROSS;
    return '';
  }

  /* The marks are SVG and carry aria-hidden, so a screen reader would meet a
     locked option as bare option text with no idea which one was right. This
     is what says it. */
  function optLabel(qi, oi) {
    var pick = picks[qi];
    if (pick < 0) return '';
    if (oi === P.questions[qi].a) return 'সঠিক উত্তর';
    if (oi === pick) return 'আপনার ভুল উত্তর';
    return '';
  }

  function renderColumn() {
    var html = '', qi, oi;
    for (qi = 0; qi < P.questions.length; qi++) {
      var q = P.questions[qi];
      html += '<article class="qz-q" id="q' + qi + '">'
        + '<div class="qz-q__head">'
        + '<span class="qz-q__n" aria-hidden="true">' + B.toBn(qi + 1) + '</span>'
        + '<h3 class="qz-q__t">' + esc(q.q) + '</h3>'
        + '</div>'
        + '<ul class="qz-opts" role="list">';
      for (oi = 0; oi < q.o.length; oi++) {
        var answeredQ = picks[qi] >= 0;
        var label = optLabel(qi, oi);
        html += '<li><button type="button" class="qz-opt' + optClass(qi, oi) + '"'
          + ' data-q="' + qi + '" data-o="' + oi + '"'
          + (answeredQ ? ' disabled' : '')
          + (label ? ' aria-label="' + esc(label) + ' — ' + esc(q.o[oi]) + '"' : '') + '>'
          + '<span class="qz-opt__mark" aria-hidden="true">' + optMark(qi, oi) + '</span>'
          + '<span class="qz-opt__t">' + esc(q.o[oi]) + '</span>'
          + '</button></li>';
      }
      html += '</ul></article>';
    }
    /* The spray layer is part of the render, not of the static markup: this
       function replaces the column's innerHTML, which would otherwise delete
       it the first time a puzzle was re-opened. */
    $('qlist').innerHTML = '<div class="qz-fx" id="fx" aria-hidden="true"></div>' + html;
  }

  /* Repaint ONE question after it is answered. A full re-render would throw
     away the scroll position mid-column, which on a ten-question page means
     the reader loses their place every time they answer. */
  function repaintQuestion(qi) {
    var q = P.questions[qi];
    var btns = $('q' + qi).querySelectorAll('.qz-opt');
    for (var oi = 0; oi < btns.length; oi++) {
      var b = btns[oi];
      b.className = 'qz-opt' + optClass(qi, oi);
      b.disabled = true;
      b.querySelector('.qz-opt__mark').innerHTML = optMark(qi, oi);
      var label = optLabel(qi, oi);
      if (label) b.setAttribute('aria-label', label + ' — ' + q.o[oi]);
    }
  }

  /* ---- juice ------------------------------------------------------------

     Everything here is bounded, self-removing and suppressed under reduced
     motion, and none of it escalates on a streak or a run — the Ink Spray
     Rule bans that, and this game has exactly one real property to escalate
     on anyway: right or wrong. Right sprays, wrong strikes. */

  function buzz(pattern) {
    if (quiet || !byTouch) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  /* Restart an animation class and take it off again. animationend is not
     guaranteed — a backgrounded tab or a compositor that never ran the
     animation leaves the class stuck, and a spent fill-mode:both animation
     then outranks the resting rules underneath it. The timer is the
     guarantee, not the optimisation. */
  function replay(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }

  /* Eight hard-edged marks thrown off the option as it takes the ink. They
     live in the column's own layer so they scroll with the page rather than
     hanging in the air when it moves, and exactly the ones this call made are
     removed — overlapping bursts would otherwise delete each other's. */
  function spray(el) {
    if (quiet) return;
    var fx = $('fx');
    if (!fx || !el) return;
    var host = fx.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    var cx = b.left - host.left + b.width / 2;
    var cy = b.top - host.top + b.height / 2;
    var mine = [], k, a, r, sp;
    for (k = 0; k < 8; k++) {
      a = Math.random() * Math.PI * 2;
      r = 26 + Math.random() * 44;
      sp = document.createElement('i');
      sp.className = 'qz-spark';
      sp.style.left = (cx - 2.5) + 'px';
      sp.style.top = (cy - 2.5) + 'px';
      sp.style.setProperty('--dx', (Math.cos(a) * r).toFixed(1) + 'px');
      sp.style.setProperty('--dy', (Math.sin(a) * r).toFixed(1) + 'px');
      fx.appendChild(sp);
      mine.push(sp);
    }
    setTimeout(function () {
      for (var j = 0; j < mine.length; j++) {
        if (mine[j].parentNode) mine[j].parentNode.removeChild(mine[j]);
      }
    }, 640);
  }

  /* `struck` is the tick that just earned its ink, and only that one gets the
     strike animation — repainting the rail must not re-run the other nine. */
  function paintProgress(struck) {
    var n = answered(), total = P.questions.length;
    $('progress').textContent = B.toBn(n) + '/' + B.toBn(total);
    $('rail-n').textContent = B.toBn(n) + T.of + B.toBn(total);
    var ticks = $('ticks').children;
    for (var i = 0; i < ticks.length; i++) {
      ticks[i].className = 'qz-rail__t' + (picks[i] >= 0 ? ' is-done' : '');
    }
    if (struck >= 0 && ticks[struck]) replay(ticks[struck], 'is-striking', 300);
  }

  function renderTicks() {
    var html = '', i;
    for (i = 0; i < P.questions.length; i++) html += '<i class="qz-rail__t"></i>';
    $('ticks').innerHTML = html;
  }

  /* The column's own head. It lived inside renderFront() and was therefore
     never written when a #p= link opened the column directly, so a deep link
     into a dated quiz printed the placeholder — the subject line read "…" on
     exactly the entry point খেলাঘর uses. */
  function paintPaperHead() {
    $('paper-theme').textContent = P.theme;
    $('paper-date').textContent = printDate(dateFromId(P.id));
  }

  function renderFront() {
    var d = dateFromId(P.id);
    var pick = pickForToday();
    var isToday = pick.isToday && pick.pz.id === P.id;
    var total = P.questions.length;

    $('fp-kicker').textContent = isToday ? T.today : T.recent;
    $('fp-date').textContent = printDate(d);
    $('fp-theme').textContent = P.theme;
    $('date').textContent = longDate(new Date());          // the paper's own date
    $('fp-size').textContent = B.toBn(total) + T.qCount;
    $('fp-archive-meta').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    $('fp-aside-count').textContent = B.toBn(PACK.puzzles.length) + T.packCount;
    renderArchive();          // the rail is on the page at spread, not behind the sheet

    var n = answered(), done = n >= total;
    var dot = $('fp-dot');
    dot.className = 'qz-dot' + (done ? ' is-done' : (n > 0 ? ' is-part' : ''));
    $('fp-state').textContent = n === 0 ? T.fresh
      : (done ? B.toBn(score()) + T.of + B.toBn(total) + T.correct
        : B.toBn(n) + T.of + B.toBn(total) + T.answered);
    $('fp-cta').textContent = n === 0 ? T.start : (done ? T.review : T.resume);
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

    /* Newest first — a reader opening the list wants today at the top, not a
       fortnight ago. Same order every other hero's archive uses. */
    var html = '';
    for (i = PACK.puzzles.length - 1; i >= 0; i--) {
      var pz = PACK.puzzles[i];
      var due = isDue(pz);
      var total = pz.questions.length;
      var n = answeredIn(pz);
      var done = n >= total;
      var dotCls = done ? ' is-done' : (n > 0 ? ' is-part' : '');
      var label = done ? B.toBn(scoreIn(pz)) + T.of + B.toBn(total)
        : (n > 0 ? B.toBn(n) + T.of + B.toBn(total) : T.stFresh);
      var badge = pz.id.slice(-10) === key
        ? '<span class="qz-arc__badge">' + T.todayBadge + '</span>'
        : (!hasToday && pz.id === latestDue ? '<span class="qz-arc__badge">' + T.latestBadge + '</span>' : '');

      html += '<button type="button" class="qz-arc" data-id="' + pz.id + '"'
        + (pz.id === P.id ? ' aria-current="true"' : '') + (due ? '' : ' disabled') + '>'
        + '<i class="qz-dot' + dotCls + '" aria-hidden="true"></i>'
        + '<span class="qz-arc__d">'
        + '<span class="qz-arc__date">' + shortDate(dateFromId(pz.id)) + '</span>'
        + '<span class="qz-arc__theme">' + esc(pz.theme) + '</span>'
        + '</span>'
        + '<span class="qz-arc__end">' + badge
        + '<span class="qz-arc__score">' + label + '</span></span>'
        + '</button>';
    }
    $('arch-list').innerHTML = html;
    $('fp-archlist').innerHTML = html;
  }

  /* ---- answering -------------------------------------------------------- */

  function answer(qi, oi) {
    if (locked || picks[qi] >= 0) return;
    var right = oi === P.questions[qi].a;
    picks[qi] = oi;
    saveState();
    repaintQuestion(qi);
    paintProgress(qi);

    var opts = $('q' + qi).querySelectorAll('.qz-opt');
    var rightEl = opts[P.questions[qi].a];

    if (right) {
      /* Everything lands at once: there is only one thing to say. The spray
         fires on the option, which is where the record of this answer is
         kept, and the rail tick strikes in the same beat — that is what
         teaches ten silent bars what they are counting. */
      replay(rightEl, 'is-settling', 340);
      spray(rightEl);
      buzz(14);
    } else {
      /* Two beats, in the order the reader asked for them. The slash draws
         through their own pick first — the answer to "was I right?" — and the
         truth settles behind it. Both inside ~420ms, so it reads as one
         sentence and not as a wait. */
      replay(opts[oi], 'is-striking', 280);
      buzz([0, 26]);
      setTimeout(function () { replay(rightEl, 'is-settling', 340); }, 180);
    }

    if (isComplete()) { finish(right); return; }

    /* Walk the reader on. The next UNANSWERED question, not qi + 1: someone
       filling in the gaps of a half-done column should not be dragged back
       to a question they already settled. */
    var next = -1, i;
    for (i = qi + 1; i < picks.length; i++) if (picks[i] < 0) { next = i; break; }
    if (next < 0) for (i = 0; i < qi; i++) if (picks[i] < 0) { next = i; break; }
    if (next < 0) return;

    /* A right answer needs one glance to confirm. A wrong one asks the reader
       to read a line they have not read yet — the correct option — so it is
       given roughly twice as long before anything moves. The difference is
       meant to be felt and not noticed.

       The hold is a floor, not a sentence: the reader can cut it short at any
       point with a swipe (see holdThen). */
    holdThen(next, quiet ? 0 : (right ? 650 : 1100));
  }

  /* ---- the hold ---------------------------------------------------------

     The column advances on its own, but never against the reader. Any touch
     on the column during the hold cancels the automatic move outright — a
     finger on the page means the reader is driving, and a surface that scrolls
     itself under a moving thumb is the worst thing this game could do. If that
     touch was an upward swipe, the move happens immediately on release
     instead, which is the reader saying "yes, go on" rather than "wait".

     So the hold has three exits: it expires, the reader waves it through, or
     the reader takes the wheel. It can never fire twice, and it can never fire
     after the reader has started scrolling somewhere else. */
  var hold = { timer: null, next: -1, y0: 0, live: false };

  function clearHold() {
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
    hold.live = false;
    hold.next = -1;
  }

  function holdThen(next, ms) {
    clearHold();
    hold.next = next;
    hold.live = true;
    hold.timer = setTimeout(function () {
      var n = hold.next;
      clearHold();
      walkTo(n);
    }, ms);
  }

  function bindHold() {
    var col = $('col');
    if (!col) return;

    col.addEventListener('touchstart', function (e) {
      if (!hold.live) return;
      hold.y0 = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
      /* Stop the clock the moment a finger lands. Whether the reader is
         waving it through or reading at their own pace is decided on
         release; either way the timer must not fire underneath them. */
      if (hold.timer) clearTimeout(hold.timer);
      hold.timer = null;
    }, { passive: true });

    col.addEventListener('touchend', function (e) {
      if (!hold.live) return;
      var y1 = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : hold.y0;
      var next = hold.next;
      var swipedUp = hold.y0 - y1 > 40;
      clearHold();
      /* An upward swipe is "go on"; anything else is the reader reading, and
         they are left exactly where they put themselves. */
      if (swipedUp) walkTo(next);
    }, { passive: true });

    /* A wheel or a trackpad has no touchend to wait for, so it simply takes
       the wheel: the automatic move is cancelled and nothing snaps. */
    col.addEventListener('wheel', function () { clearHold(); }, { passive: true });
  }

  /* Bring the NEXT question to the top.

     This was briefly the other way round — the ANSWERED question pinned, so
     the mark stayed on screen for good. It solved the problem it was aimed at
     and lost the game: two questions in view at once reads as a form, not as
     something being played (user, 2026-08-19). The payoff is protected by the
     hold instead, which the reader owns and can cut short.

     Reverted deliberately. The insight that produced the pin still stands and
     is recorded in DESIGN.md — a confirmation that is scrolled away in the
     frame it is painted was never seen — but the fix for it here is TIME the
     reader controls, not a layout that keeps the past on screen. */
  function walkTo(next) {
    var el = $('q' + next), col = $('col');
    if (!el || !col) return;
    /* Assignment, not scrollIntoView and not scrollTo({behavior:'smooth'}).
       Both were tried and both failed silently: scrollIntoView picked a
       different scrollable ancestor and moved nothing, and a smooth scroll
       moves nothing at all wherever the engine declines to animate. The
       easing is CSS's job (scroll-behavior on .qz-col); the position is
       guaranteed here. */
    col.scrollTop += el.getBoundingClientRect().top - col.getBoundingClientRect().top;
  }

  function finish(lastWasRight) {
    locked = true;
    $('locked').hidden = false;

    var n = score(), total = P.questions.length;
    var prev = bestOf(P.id);
    if (n > prev) { try { localStorage.setItem(BEST + P.id, String(n)); } catch (e) {} }

    emit('game:complete', { id: P.id, theme: P.theme, score: n, total: total });

    $('win-mark').textContent = n === total ? T.markHigh : (n * 2 >= total ? T.markMid : T.markLow);
    $('win-theme').textContent = P.theme;
    $('win-score').textContent = B.toBn(n) + '/' + B.toBn(total);
    $('win-theme-n').textContent = P.theme;
    $('win-note').textContent = n === total ? T.noteAll : (n * 2 >= total ? T.noteMid : T.noteLow);

    /* The day's ledger, filled in front of the reader before the card covers
       it. Ten ticks are already inked by now; the sweep re-strikes them left
       to right so the rail reads as one finished row rather than as ten
       separate marks — the same gesture সুডোকু ends on, and the reason the
       card follows the motion instead of interrupting it.

       It escalates on nothing. Every day ends this way whatever the score,
       because a finish is not a performance. */
    var ticks = $('ticks').children, k;
    if (!quiet) {
      for (k = 0; k < ticks.length; k++) {
        (function (el, delay) {
          setTimeout(function () { replay(el, 'is-striking', 300); }, delay);
        }(ticks[k], k * 40));
      }
    }
    /* The tenth answer's own beat, then the sweep, then the card. A wrong
       tenth answer holds longer for the same reason every other wrong answer
       does: there is a line still to read. */
    var lead = quiet ? 200 : ((lastWasRight ? 420 : 900) + ticks.length * 40 + 160);
    setTimeout(function () { openSheet($('sheet-win')); }, lead);
  }

  /* ---- navigation ------------------------------------------------------- */

  function goFront() {
    clearHold();
    saveState();
    renderFront();
    $('app').setAttribute('data-view', 'front');
  }

  /* A question takes exactly one screenful, and the screenful is MEASURED.
     The column shares the viewport with a masthead, a subject bar and the
     rail, and their heights move with the reader's font size and with browser
     chrome that collapses on scroll — so a vh guess is wrong on every phone
     it matters on. Measure, then hand the number to CSS, which is how সুডোকু
     sizes its board for the same reason. */
  function sizePage() {
    var col = $('col'), list = $('qlist');
    if (!col || !list) return;
    var h = col.clientHeight;
    if (h > 0) list.style.setProperty('--qz-page', h + 'px');
  }

  function goPaper() {
    paintPaperHead();
    renderColumn();
    renderTicks();
    paintProgress();
    $('locked').hidden = !locked;
    $('app').setAttribute('data-view', 'paper');
    /* Size before resetting the scroll: the questions have no height until
       the page measurement lands, so scrollTop = 0 against an unsized column
       is meaningless. */
    sizePage();
    $('col').scrollTop = 0;
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

  function emit(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: type, game: 'quiz', data: data || {} }, '*');
      }
    } catch (e) {}
  }

  /* ---- wiring ----------------------------------------------------------- */

  function loadPuzzle(pz) {
    /* A hold armed against the previous day must not fire into this one. */
    clearHold();
    P = pz;
    picks = loadState(P);
    locked = isComplete();
    return true;
  }

  function openPuzzle(pz, enter) {
    if (!loadPuzzle(pz)) return;
    if (enter) goPaper(); else goFront();
  }

  function bind() {
    $('exit').onclick = function () {
      emit('game:exit');
      if (history.length > 1) history.back(); else location.href = '../../hub/index.html';
    };
    /* Back goes up one level, not out: the column returns to the front page,
       and only the front page leaves for the portal. */
    $('back').onclick = goFront;
    $('fp-cta').onclick = goPaper;
    $('fp-howto').onclick = function () { openSheet($('sheet-howto')); };
    $('paper-howto').onclick = function () { openSheet($('sheet-howto')); };
    $('top-howto').onclick = function () { openSheet($('sheet-howto')); };

    function showArchive() { renderArchive(); openSheet($('sheet-arch')); }
    $('fp-archive').onclick = showArchive;
    $('dateline').onclick = showArchive;

    /* Set on the pointer event that precedes the click, so the answer knows
       whether there is a wrist to tap. Passive: it never calls preventDefault. */
    $('qlist').addEventListener('pointerdown', function (e) {
      byTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    }, { passive: true });

    $('qlist').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.qz-opt') : null;
      if (!btn || btn.disabled) return;
      answer(+btn.getAttribute('data-q'), +btn.getAttribute('data-o'));
    });

    function pickFromList(e) {
      var row = e.target.closest('.qz-arc');
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
    $('win-review').onclick = function () { closeSheet($('sheet-win')); };
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
      if ($('app').getAttribute('data-view') === 'paper') goFront();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveState();
    });

    window.addEventListener('resize', sizePage);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', sizePage);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizePage);
  }

  function init() {
    fetch('puzzles/index.json')
      .then(function (r) { return r.json(); })
      .then(function (pack) {
        PACK = pack;
        /* A #p= link is a request for that day, so it skips the front page.
           Same contract শব্দভেদ and সুডোকু already answer, so খেলাঘর can address
           a dated issue in any hero with one link shape. A future-dated id is
           not a valid request and falls through to today's. */
        var hash = (location.hash.match(/p=([\w-]+)/) || [])[1], wanted = null, i;
        for (i = 0; i < PACK.puzzles.length; i++) {
          if (PACK.puzzles[i].id === hash && isDue(PACK.puzzles[i])) { wanted = PACK.puzzles[i]; break; }
        }
        if (!loadPuzzle(wanted || pickForToday().pz)) return;
        bind();
        bindHold();
        if (wanted) goPaper(); else goFront();
      })
      .catch(function (err) {
        console.error(err);
        $('fp-theme').textContent = T.failLoad;
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
