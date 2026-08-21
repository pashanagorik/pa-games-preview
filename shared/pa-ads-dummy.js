/*
 * pa-ads-dummy.js — the placeholder provider.
 *
 * What runs when no ad server is wired: a display slot fills with a labelled
 * box at its real IAB size, and a rewarded request produces a simulated spot
 * that takes fifteen seconds to watch, can be closed early after one warning,
 * and grants only when it has run its course. Nothing is fetched from
 * anywhere, so a standalone folder opened off a disk exercises the whole
 * economy with no network at all.
 *
 * It is a stand-in, not a mock. Every path the real adapters take — prepare,
 * then play; pause when hidden; forfeit on early close — is taken here too,
 * so the games are built against the shape of a real rewarded spot and the
 * day GPT replaces this file nothing upstream learns anything new.
 *
 * The creative is deliberately unlovely. It says what it is and how big it
 * is, in the meta voice, on a hatched ground that is not paper, not cell and
 * not a tint the games use. A placeholder that looked designed would invite
 * the question "is that the ad?", and the answer must never be in doubt.
 *
 * Knobs, read off the same PA_ADS object as everything else:
 *
 *   dummyDelay       ms before a display slot fills         (default 200)
 *   dummyRewardedMs  length of the simulated spot           (default 15000)
 *
 * Registered as 'dummy' with pa-ads.js; see that file for the contract.
 */
(function () {
  'use strict';

  if (!window.PaAds || !window.PaAds.register) return;

  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[+d]; }); }

  var CSS_ID = 'pa-ads-dummy-css';
  var CSS = [
    /* ---- the display placeholder ---- */
    '.pa-ad-dummy{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:.125rem;text-align:center;',
    'font:500 var(--pa-size-meta,.75rem)/1.35 var(--pa-sans,system-ui,sans-serif);color:var(--pa-ink-2,#55585F);',
    'border:1px dashed var(--pa-ink-3,#8A8D94);',
    'background:repeating-linear-gradient(135deg,transparent 0 6px,rgba(138,141,148,.12) 6px 7px) var(--pa-paper-lift,#FBFAF8);',
    'user-select:none;-webkit-user-select:none}',
    '.pa-ad-dummy__size{font-variant-numeric:tabular-nums;color:var(--pa-ink-3,#8A8D94)}',

    /* ---- the simulated rewarded spot ---- */
    '.pa-ad-spot{position:relative;box-sizing:border-box;width:100%;aspect-ratio:16/9;max-height:70vh;',
    'background:var(--pa-ink,#16171A);color:#fff;border-radius:var(--pa-r-md,.5rem);overflow:hidden;',
    'font-family:var(--pa-sans,system-ui,sans-serif);display:flex;align-items:center;justify-content:center}',
    '.pa-ad-spot__body{text-align:center;padding:1rem}',
    '.pa-ad-spot__title{font-size:var(--pa-size-title,1.25rem);font-weight:700;line-height:1.35}',
    '.pa-ad-spot__sub{font-size:var(--pa-size-meta,.75rem);opacity:.7;margin-top:.25rem}',
    '.pa-ad-spot__count{position:absolute;top:.625rem;right:.75rem;font-size:var(--pa-size-meta,.75rem);',
    'font-variant-numeric:tabular-nums;opacity:.85;min-width:4.5em;text-align:right}',
    '.pa-ad-spot__close{position:absolute;top:.375rem;left:.375rem;width:2.25rem;height:2.25rem;border:0;border-radius:50%;',
    'background:rgba(255,255,255,.12);color:#fff;font:400 1.25rem/1 system-ui,sans-serif;cursor:pointer}',
    '.pa-ad-spot__close:hover{background:rgba(255,255,255,.22)}',
    '.pa-ad-spot__close:focus-visible{outline:2px solid #fff;outline-offset:2px}',
    '.pa-ad-spot__bar{position:absolute;left:0;right:0;bottom:0;height:.25rem;background:rgba(255,255,255,.18)}',
    '.pa-ad-spot__fill{height:100%;width:100%;background:#fff;transform:scaleX(0);transform-origin:0 50%;transition:transform .25s linear}',
    '.pa-ad-spot.is-paused .pa-ad-spot__fill{transition:none}',
    '.pa-ad-spot__warn{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;',
    'gap:.75rem;padding:1rem;text-align:center;background:rgba(22,23,26,.92)}',
    '.pa-ad-spot.is-warning .pa-ad-spot__warn{display:flex}',
    '.pa-ad-spot.is-warning .pa-ad-spot__body,.pa-ad-spot.is-warning .pa-ad-spot__count{visibility:hidden}',
    '.pa-ad-spot__warn p{margin:0;font-size:var(--pa-size-body,.9375rem);line-height:1.5}',
    '.pa-ad-spot__warn .pa-ad-spot__btns{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center}',
    '.pa-ad-spot__btn{border:0;border-radius:999px;padding:.5rem 1rem;font:600 var(--pa-size-body,.9375rem)/1.2 inherit;cursor:pointer}',
    '.pa-ad-spot__btn--go{background:#fff;color:var(--pa-ink,#16171A)}',
    '.pa-ad-spot__btn--quit{background:transparent;color:#fff;text-decoration:underline;text-underline-offset:.2em}',
    '.pa-ad-spot__btn:focus-visible{outline:2px solid #fff;outline-offset:2px}',

    /* ---- own overlay, used only when no host is given ---- */
    '.pa-ad-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:1rem;',
    'background:rgba(22,23,26,.88)}',
    '.pa-ad-overlay .pa-ad-spot{width:min(92vw,36rem)}',

    '@media (prefers-reduced-motion:reduce){.pa-ad-spot__fill{transition:none}}'
  ].join('');

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---- display ---------------------------------------------------------- */

  function slot(frame, name, size, cfg) {
    ensureCss();
    var wait = cfg && typeof cfg.dummyDelay === 'number' ? cfg.dummyDelay : 200;
    return delay(wait).then(function () {
      if (!frame.isConnected) return false;
      var box = el('div', 'pa-ad-dummy');
      box.setAttribute('aria-hidden', 'true');
      box.appendChild(el('span', 'pa-ad-dummy__kind', 'নমুনা বিজ্ঞাপন'));
      box.appendChild(el('span', 'pa-ad-dummy__size', bn(size[0]) + ' × ' + bn(size[1])));
      frame.innerHTML = '';
      frame.appendChild(box);
      return true;
    });
  }

  /* ---- rewarded --------------------------------------------------------- */

  /* Prepare is instant here and always fills: the dummy's job is to let the
     economy be seen working. The empty case is exercised by `?ads=empty`,
     which never reaches this file. */
  function rewarded(opts, cfg) {
    ensureCss();
    var total = cfg && typeof cfg.dummyRewardedMs === 'number' ? cfg.dummyRewardedMs : 15000;
    var cancelled = false;
    var closer = null;
    return Promise.resolve({
      duration: total,
      cancel: function () { cancelled = true; },
      close: function () { if (closer) closer(); },
      show: function (host) {
        if (cancelled) return Promise.resolve('forfeited');
        return play(host, total, function (fn) { closer = fn; });
      }
    });
  }

  /* The spot. A countdown that only advances while it is on screen and not
     behind its own warning — the same two pauses a real video creative makes —
     and a close control that warns once. After the warning has been shown and
     declined, a second close is a close. */
  function play(host, total, onCloser) {
    return new Promise(function (resolve) {
      var overlay = null;
      if (!host) {
        overlay = el('div', 'pa-ad-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'বিজ্ঞাপন');
        document.body.appendChild(overlay);
        host = overlay;
      }

      var spot = el('div', 'pa-ad-spot');
      var body = el('div', 'pa-ad-spot__body');
      body.appendChild(el('div', 'pa-ad-spot__title', 'নমুনা বিজ্ঞাপন'));
      body.appendChild(el('div', 'pa-ad-spot__sub', 'ভিডিও বিজ্ঞাপন · ' + bn(Math.round(total / 1000)) + ' সেকেন্ড'));
      var count = el('div', 'pa-ad-spot__count');
      count.setAttribute('aria-hidden', 'true');
      var close = el('button', 'pa-ad-spot__close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'বিজ্ঞাপন বন্ধ করুন');
      var bar = el('div', 'pa-ad-spot__bar');
      var fill = el('div', 'pa-ad-spot__fill');
      bar.setAttribute('aria-hidden', 'true');
      bar.appendChild(fill);

      var warn = el('div', 'pa-ad-spot__warn');
      warn.setAttribute('role', 'alertdialog');
      warn.setAttribute('aria-label', 'সাহায্য হারাবেন');
      warn.appendChild(el('p', '', 'এখন বন্ধ করলে সাহায্য পাবেন না।'));
      var btns = el('div', 'pa-ad-spot__btns');
      var go = el('button', 'pa-ad-spot__btn pa-ad-spot__btn--go', 'দেখতে থাকুন');
      var quit = el('button', 'pa-ad-spot__btn pa-ad-spot__btn--quit', 'বন্ধ করুন');
      go.type = quit.type = 'button';
      btns.appendChild(go); btns.appendChild(quit);
      warn.appendChild(btns);

      spot.appendChild(body); spot.appendChild(count); spot.appendChild(close);
      spot.appendChild(bar); spot.appendChild(warn);
      host.appendChild(spot);

      var elapsed = 0;          /* ms watched, accumulated across pauses */
      var lastTick = null;      /* wall clock at the last tick, null while paused */
      var warned = false;
      var done = false;
      var timer = null;

      function paint() {
        var left = Math.max(0, Math.ceil((total - elapsed) / 1000));
        count.textContent = bn(left) + ' সেকেন্ড';
        fill.style.transform = 'scaleX(' + Math.min(1, elapsed / total).toFixed(4) + ')';
      }

      function tick() {
        if (done || lastTick === null) return;
        var now = Date.now();
        elapsed += now - lastTick;
        lastTick = now;
        paint();
        if (elapsed >= total) finish('granted');
      }

      function running() { return lastTick !== null; }
      function pause() {
        if (!running()) return;
        tick();
        lastTick = null;
        spot.classList.add('is-paused');
      }
      function resume() {
        if (done || running()) return;
        if (document.hidden || spot.classList.contains('is-warning')) return;
        lastTick = Date.now();
        spot.classList.remove('is-paused');
      }

      function finish(result) {
        if (done) return;
        done = true;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVis);
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        else if (spot.parentNode) spot.parentNode.removeChild(spot);
        resolve(result);
      }

      function onVis() { if (document.hidden) pause(); else resume(); }

      close.onclick = function () {
        if (warned) { finish('forfeited'); return; }
        warned = true;
        pause();
        spot.classList.add('is-warning');
        go.focus();
      };
      /* The sheet's Escape arrives here: the close control, or the warning's
         বন্ধ করুন once the warning is up — the same two presses a pointer makes. */
      if (onCloser) onCloser(function () {
        if (done) return;
        if (spot.classList.contains('is-warning')) quit.onclick(); else close.onclick();
      });
      go.onclick = function () {
        spot.classList.remove('is-warning');
        resume();
        close.focus();
      };
      quit.onclick = function () { finish('forfeited'); };

      /* Escape inside the spot behaves like the close control, so a keyboard
         reader gets the same one warning and the same second-press exit. The
         sheet around it (A5) listens on the document; this handler stops the
         event so the two do not both fire. */
      spot.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (spot.classList.contains('is-warning')) quit.onclick();
        else close.onclick();
      });

      document.addEventListener('visibilitychange', onVis);
      paint();
      close.focus();
      resume();
      timer = setInterval(tick, 250);
    });
  }

  window.PaAds.register('dummy', {
    init: function () {},
    slot: slot,
    rewarded: rewarded
  });
}());
