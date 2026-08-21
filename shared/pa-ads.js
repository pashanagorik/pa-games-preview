/*
 * pa-ads.js — the ad system's one public face.
 *
 * Five games and the hub reserve a couple of display slots and sell a hint
 * for a rewarded view. None of them should know which ad server is behind
 * that, because the answer changes: the demo runs Google's public test ids,
 * the pilot runs PA's own Ad Manager network, and a brand-safety review may
 * switch the rewarded half off for a while without touching the display half.
 * So the games talk to THIS file, and this file talks to whichever adapter the
 * page's config names. Swapping providers is config; the games do not change.
 *
 * What lives here, and why here:
 *
 *   - the config contract (`window.PA_ADS`) and its `?ads=` overrides
 *   - the provider registry — adapters call `PaAds.register()`; the matching
 *     `pa-ads-<provider>.js` is loaded from beside this file, and only if ads
 *     are enabled at all. `enabled:false` fetches nothing. Not the adapter,
 *     not the vendor library. Nothing.
 *   - the consent gate — every request waits for `setConsent()` or 1500 ms,
 *     whichever comes first. The POC calls it at once; PA's CMP replaces that
 *     one call.
 *   - the slot lifecycle — `slot(el, name)` builds the reserved container at
 *     its declared size BEFORE anything is requested, so a filled slot and an
 *     empty one are the same height. Layout shift is prevented structurally,
 *     not measured and hoped.
 *   - the rewarded round trip — `rewarded()` never rejects. `'empty'` is a
 *     normal answer and it is the caller's job to grant the hint anyway. The
 *     fallback lives in the caller so that no adapter can forget it.
 *   - the rewarded sheet — the price is stated before it is charged, in a
 *     pa-sheet with a focus trap; the spot plays inside it.
 *   - the event bus — every request, fill, miss, grant and forfeit is one
 *     `postMessage` to the parent frame and one `console.debug`. The
 *     `ad_empty` → `hint_used {paid:false}` pair is the number that tells PA
 *     what rewarded fill in Bangladesh is actually worth.
 *   - সাহায্য, the hint economy — `hints(puzzleId)` holds one puzzle's budget
 *     (1 free + 3 rewarded), stores it beside the puzzle's own state, and
 *     grants through `rewarded()` with the no-fill fallback built in, so no
 *     game can forget it. The ceiling never moves: with ads off or rewarded
 *     uncleared the same four are simply free.
 *
 * The contract for all of it is ADS-SPEC.md.
 *
 * Adapter interface — what `pa-ads-<provider>.js` registers:
 *
 *     PaAds.register('dummy', {
 *       init:     function (cfg, consent) { … return Promise|undefined },
 *       slot:     function (frame, name, size, cfg) { … return Promise<boolean> },
 *       rewarded: function (opts, cfg) { … return Promise<handle|null> }
 *     });
 *
 *   `slot` renders into `frame` (the sized inner box) and resolves true when
 *   a creative is showing, false when the request came back unfilled. It may
 *   throw or hang; both are treated as unfilled here.
 *
 *   `rewarded` resolves a handle when a spot is ready to play, or null when
 *   there is nothing to show. Two phases on purpose: the reader is told the
 *   price before it is charged, and the sheet that does the telling must not
 *   open for an ad that does not exist. The handle is
 *
 *       { show: function (host) { … return Promise<'granted'|'forfeited'> },
 *         cancel: function () {},
 *         close: function () {},          optional
 *         duration: ms | undefined }
 *
 *   `show(host)` plays the spot — into `host` if the adapter draws its own
 *   creative (dummy), ignoring it if the vendor owns the surface (GPT).
 *   `cancel()` releases a prepared spot the reader declined. `close()`, if
 *   given, is the spot's own close control pressed from outside — the sheet
 *   routes Escape to it, and the adapter applies its own early-close warning.
 */
(function () {
  'use strict';

  if (window.PaAds) return;

  /* ---- config ----------------------------------------------------------- */

  var DEFAULTS = {
    provider: 'dummy',
    network: '',
    client: '',
    game: 'game',
    enabled: true,
    rewarded: true,
    freeHints: 1,
    maxRewardedHints: 3,
    /* How long a display request may take before the slot is declared empty,
       and how long a rewarded spot may take to become ready. Neither is
       user-visible: a slow fill still lands, it just stops counting. */
    slotTimeout: 8000,
    rewardedTimeout: 8000,
    consentTimeout: 1500
  };

  var PROVIDERS = ['dummy', 'gpt', 'adsense-h5'];
  var FILES = { dummy: 'pa-ads-dummy.js', gpt: 'pa-ads-gpt.js', 'adsense-h5': 'pa-ads-adsense.js' };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  var BN = '০১২৩৪৫৬৭৮৯';
  function bn(n) { return String(n).replace(/\d/g, function (d) { return BN[+d]; }); }

  function readConfig() {
    var cfg = {}, k;
    var given = window.PA_ADS || {};
    /* Every key the page set is kept, known or not: adapters have knobs of
       their own (the dummy's spot length, say) and they read them off the
       same object. Defaults fill only what the page left out. */
    for (k in given) if (own(given, k)) cfg[k] = given[k];
    for (k in DEFAULTS) if (own(DEFAULTS, k) && !own(cfg, k)) cfg[k] = DEFAULTS[k];

    /* `?ads=` is a demo and test control, documented in ADS-SPEC §7. It
       outranks the page's declaration so that one URL can show a reviewer the
       same page under any provider, or with every request coming back empty,
       without a deploy. `empty` is not an adapter: it is a mode in which the
       built-in null provider answers everything. */
    var m = /[?&]ads=([^&#]*)/.exec(location.search || '');
    var force = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    cfg.forced = force || '';
    if (force === 'off') cfg.enabled = false;
    else if (force === 'empty') cfg.provider = 'empty';
    else if (PROVIDERS.indexOf(force) !== -1) cfg.provider = force;

    if (PROVIDERS.indexOf(cfg.provider) === -1 && cfg.provider !== 'empty') {
      warn('unknown provider "' + cfg.provider + '", using empty');
      cfg.provider = 'empty';
    }
    cfg.freeHints = Math.max(0, cfg.freeHints | 0);
    cfg.maxRewardedHints = Math.max(0, cfg.maxRewardedHints | 0);
    return cfg;
  }

  var CFG = readConfig();

  /* ---- slots ------------------------------------------------------------ */

  /* The three slot names in the contract and the one size each takes per
     layout. Phone and desktop are the two-dimensional breakpoint the whole
     design system uses (pa-tokens.css), so a slot goes wide exactly when the
     page spreads. A size is chosen once, at mount: a slot renders once per
     view and is never re-requested on resize. */
  var SLOTS = {
    front:      { phone: [320, 100], desktop: [728, 90] },
    result:     { phone: [300, 250], desktop: [300, 250] },
    'hub-feed': { phone: [320, 100], desktop: [728, 90] }
  };
  var DESKTOP = '(min-width: 60rem) and (min-height: 40rem)';
  var LABEL = 'বিজ্ঞাপন';

  /* The desktop size needs the breakpoint AND a box that can hold it: a
     leaderboard does not go in a rail column. A box that is not laid out yet
     (width 0 — hidden view, sheet not open) is trusted to the breakpoint. */
  function sizeFor(name, el) {
    var s = SLOTS[name] || SLOTS.front;
    var wide = window.matchMedia && window.matchMedia(DESKTOP).matches;
    if (wide && el) {
      var w = el.clientWidth;
      if (w > 0 && w < s.desktop[0]) wide = false;
    }
    return wide ? s.desktop : s.phone;
  }

  /* ---- events ----------------------------------------------------------- */

  var listeners = [];

  function emit(type, data) {
    var payload = { event: type }, k;
    for (k in data) if (own(data, k) && data[k] !== undefined) payload[k] = data[k];
    try { console.debug('[pa-ads]', type, payload); } catch (e) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'ad', game: CFG.game, data: payload }, '*');
      }
    } catch (e) {}
    listeners.slice().forEach(function (l) {
      if (l.type !== '*' && l.type !== type) return;
      try { l.fn(payload); } catch (e) { warn('listener threw', e); }
    });
  }

  function on(type, fn) {
    var l = { type: type, fn: fn };
    listeners.push(l);
    return function () {
      var i = listeners.indexOf(l);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  function warn() {
    try { console.warn.apply(console, ['[pa-ads]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  /* ---- consent gate ----------------------------------------------------- */

  /* Nothing is requested from anyone before consent is known. "Known" means
     the page told us, or 1500 ms passed without it telling us — and in that
     second case we proceed as if allowed but not personalised, which is the
     answer a consent platform that has not loaded yet must get. Consent can
     change later: `setConsent` may be called any number of times and each
     request reads the state current at the moment it is made. */
  var consent = { ads: true, personalized: false, source: 'default' };
  var consentKnown = false;
  var resolveConsent;
  var consentReady = new Promise(function (res) { resolveConsent = res; });

  function setConsent(state) {
    state = state || {};
    consent = {
      ads: state.ads !== false,
      personalized: !!state.personalized,
      source: 'page'
    };
    if (!consentKnown) { consentKnown = true; resolveConsent(consent); }
    if (adapter && adapter.consent) {
      try { adapter.consent(consent); } catch (e) { warn('adapter.consent threw', e); }
    }
  }

  setTimeout(function () {
    if (consentKnown) return;
    consentKnown = true;
    consent.source = 'timeout';
    resolveConsent(consent);
  }, CFG.consentTimeout);

  /* ---- provider registry ------------------------------------------------ */

  /* The null provider. Every request comes back unfilled, at once. It answers
     `?ads=empty`, an unknown provider name, and an adapter whose file failed
     to load — in all three the page keeps working and every miss is logged
     with a reason that says which of the three it was. */
  var EMPTY = {
    init: function () {},
    slot: function () { return Promise.resolve(false); },
    rewarded: function () { return Promise.resolve(null); }
  };

  var registry = { empty: EMPTY };
  var adapter = null;          /* the one in use, once ready */
  var adapterName = '';
  var emptyReason = '';        /* why we fell back to EMPTY, if we did */

  function register(name, impl) {
    if (!impl || typeof impl.slot !== 'function' || typeof impl.rewarded !== 'function') {
      warn('register(' + name + '): adapter needs slot() and rewarded()');
      return;
    }
    /* First registration wins. A page that registers its own adapter under a
       name — a test harness, a hub that proxies — owns that name, and the
       file this module fetched for it must not overwrite it on arrival. */
    if (registry[name]) return;
    registry[name] = impl;
  }

  /* Where this file was loaded from is where the adapters are. Kept as the
     resolved URL at load time because `document.currentScript` is null by the
     time anything asynchronous runs. */
  var HERE = (function () {
    var s = document.currentScript;
    var src = s && s.src;
    if (!src) {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (/pa-ads(\.min)?\.js(\?|$)/.test(all[i].src || '')) { src = all[i].src; break; }
      }
    }
    return src ? src.slice(0, src.lastIndexOf('/') + 1) : '';
  }());

  var loading = {};

  function loadAdapter(name) {
    if (registry[name]) return Promise.resolve(registry[name]);
    if (loading[name]) return loading[name];
    return (loading[name] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = HERE + FILES[name];
      s.async = true;
      s.onload = function () {
        if (registry[name]) resolve(registry[name]);
        else { emptyReason = 'adapter-silent'; resolve(null); }
      };
      s.onerror = function () { emptyReason = 'adapter-missing'; resolve(null); };
      (document.head || document.documentElement).appendChild(s);
    }));
  }

  /* Ready = adapter file loaded AND consent known AND adapter initialised.
     The adapter's own `init` is where a vendor library gets fetched, which is
     why it runs after consent and not before. Built once, shared by every
     request; a failure anywhere degrades to the null provider rather than
     rejecting, so `ready` never rejects either. */
  var ready = null;

  function getReady() {
    if (ready) return ready;
    if (!CFG.enabled) {
      adapter = EMPTY; adapterName = 'off'; emptyReason = 'disabled';
      return (ready = Promise.resolve(adapter));
    }
    var name = CFG.provider;
    if (name === 'empty') emptyReason = CFG.forced === 'empty' ? 'forced-empty' : 'unknown-provider';
    ready = Promise.all([loadAdapter(name), consentReady]).then(function (r) {
      var impl = r[0];
      if (!impl) { warn('adapter "' + name + '" unavailable (' + emptyReason + '), using empty'); impl = EMPTY; name = 'empty'; }
      adapterName = name;
      return Promise.resolve()
        .then(function () { return impl.init ? impl.init(CFG, consent) : undefined; })
        .then(function () { adapter = impl; return adapter; }, function (e) {
          warn('adapter "' + name + '" failed to init, using empty', e);
          emptyReason = 'adapter-init';
          adapter = EMPTY; adapterName = 'empty';
          return adapter;
        });
    });
    return ready;
  }

  /* Warm the adapter file as soon as the page has loaded its own script —
     not the vendor library, that is behind consent — so that a slot mounted
     at first paint is not also waiting on our own network round trip. This is
     the only thing the module does unprompted, and `enabled:false` skips it —
     settling to the null provider at once instead, so `provider()` answers
     'off' from the first line of the page. */
  if (!CFG.enabled) getReady();
  else if (CFG.provider !== 'empty') loadAdapter(CFG.provider);

  function withTimeout(p, ms, onTimeout) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(onTimeout()); } }, ms);
      Promise.resolve(p).then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(t); resolve(onTimeout(e)); } });
    });
  }

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---- display slots ---------------------------------------------------- */

  /* Build the reserved container. Done synchronously, at mount, from the
     declared size, so the page's first paint already holds the box the ad
     will land in. The label is part of the container and not of the creative:
     an ad that could be mistaken for the paper's own column is the one thing
     a newspaper cannot ship, and that must hold on the day no ad is sold. */
  function build(el, name, size) {
    el.classList.add('pa-ad', 'pa-ad--' + name, 'is-pending');
    el.setAttribute('data-slot', name);
    el.setAttribute('data-size', size[0] + 'x' + size[1]);
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', LABEL);
    el.innerHTML = '';
    var label = document.createElement('span');
    label.className = 'pa-ad__label';
    label.textContent = LABEL;
    var frame = document.createElement('div');
    frame.className = 'pa-ad__frame';
    frame.style.width = size[0] + 'px';
    frame.style.height = size[1] + 'px';
    frame.style.maxWidth = '100%';
    el.appendChild(label);
    el.appendChild(frame);
    return frame;
  }

  /* A view that is shown again — tomorrow's completion card in the same
     document — is a new view, and gets a new request. The caller says so by
     unmounting; nothing here refreshes on its own. */
  function unmount(el) {
    if (!el) return;
    delete el.__paAd;
    el.className = el.className.replace(/\bpa-ad\S*|\bis-(pending|filled|empty|off)\b/g, '').replace(/\s+/g, ' ').trim();
    el.hidden = false;
    el.innerHTML = '';
  }

  function settle(el, filled) {
    el.classList.remove('is-pending');
    el.classList.add(filled ? 'is-filled' : 'is-empty');
  }

  function slot(el, name) {
    if (!el || !(el instanceof Element)) return Promise.resolve({ filled: false, reason: 'no-element' });
    if (!SLOTS[name]) { warn('slot(): unknown slot "' + name + '", sizing as front'); }
    if (el.__paAd) return el.__paAd;    /* once per view */

    if (!CFG.enabled) {
      /* The kill switch: the slot collapses to nothing, as if it had never
         been written into the page. */
      el.hidden = true;
      el.classList.add('pa-ad', 'is-off');
      return (el.__paAd = Promise.resolve({ filled: false, reason: 'disabled' }));
    }

    var size = sizeFor(name, el);
    var frame = build(el, name, size);

    el.__paAd = getReady().then(function (impl) {
      var provider = adapterName;
      if (!consent.ads) {
        emit('ad_request', { slot: name, provider: provider });
        settle(el, false);
        emit('ad_empty', { slot: name, provider: provider, reason: 'consent' });
        return { filled: false, reason: 'consent' };
      }
      var t0 = now();
      emit('ad_request', { slot: name, provider: provider });
      var reason = impl === EMPTY ? emptyReason : 'unfilled';
      return withTimeout(
        Promise.resolve().then(function () { return impl.slot(frame, name, size, CFG); }),
        CFG.slotTimeout,
        function (e) { reason = e ? 'adapter-error' : 'timeout'; if (e) warn('slot ' + name + ' threw', e); return false; }
      ).then(function (filled) {
        filled = !!filled;
        settle(el, filled);
        if (filled) emit('ad_filled', { slot: name, provider: provider, ms: Math.round(now() - t0) });
        else emit('ad_empty', { slot: name, provider: provider, reason: reason });
        return { filled: filled, reason: filled ? undefined : reason };
      });
    });
    return el.__paAd;
  }

  /* ---- rewarded --------------------------------------------------------- */

  /* ---- the rewarded sheet ------------------------------------------------ */

  /* The point between "a spot is ready" and "it has played". The reader is
     told the price before it is charged, every time: a sheet — the same
     pa-sheet the five games already use — says what a view buys, in one
     line, and offers বিজ্ঞাপন দেখুন or থাক. Only on confirm does the spot play,
     into the sheet's own host, so the sheet is the frame around the spot
     and not a second surface under it. It opens only for a spot that exists;
     a no-fill never reaches here.

     Focus is trapped in the panel for as long as it is open. Escape at the
     price step is থাক; Escape during the spot is the spot's own close
     control, which carries the adapter's one warning — so a keyboard reader
     and a pointer reader meet the same words in the same order. The
     countdown is announced at start and at end only: a live region that
     ticked would talk over the ad. */

  var SHEET_TITLE = 'সাহায্য';
  var SHEET_WHAT = 'আরেকটি সাহায্য পাওয়া যাবে';
  var SHEET_PRICE_K = 'মূল্য';
  var SHEET_PRICE = 'একটি বিজ্ঞাপন';
  var SHEET_LEFT_K = 'বাকি থাকবে';
  var SHEET_LEFT_LAST = 'এটিই শেষ সাহায্য';
  var SHEET_GO = 'বিজ্ঞাপন দেখুন';
  var SHEET_NO = 'থাক';
  var FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  var sheet = null;   /* built once, reused */

  function buildSheet() {
    if (sheet) return sheet;
    var root = document.createElement('div');
    root.className = 'pa-sheet pa-sheet--reward';
    root.hidden = true;
    root.innerHTML =
      '<div class="pa-sheet__scrim"></div>' +
      '<div class="pa-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="pa-reward-title" tabindex="-1">' +
        '<div class="pa-sheet__head"><h3 class="pa-sheet__title" id="pa-reward-title"></h3></div>' +
        '<div class="pa-sheet__body pa-reward">' +
          '<div class="pa-reward__offer">' +
            '<p class="pa-reward__what"></p>' +
            '<dl class="pa-reward__terms">' +
              '<div><dt></dt><dd class="pa-reward__price"></dd></div>' +
              '<div class="pa-reward__left-row"><dt></dt><dd class="pa-reward__left"></dd></div>' +
            '</dl>' +
            '<div class="pa-reward__actions">' +
              '<button type="button" class="pa-btn pa-btn--primary pa-reward__go"></button>' +
              '<button type="button" class="pa-btn pa-btn--ghost pa-reward__no"></button>' +
            '</div>' +
          '</div>' +
          '<div class="pa-reward__host" hidden></div>' +
          '<p class="pa-sr pa-reward__live" aria-live="polite"></p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    var q = function (sel) { return root.querySelector(sel); };
    sheet = {
      root: root,
      scrim: q('.pa-sheet__scrim'),
      panel: q('.pa-sheet__panel'),
      title: q('.pa-sheet__title'),
      offer: q('.pa-reward__offer'),
      what: q('.pa-reward__what'),
      price: q('.pa-reward__price'),
      leftRow: q('.pa-reward__left-row'),
      left: q('.pa-reward__left'),
      go: q('.pa-reward__go'),
      no: q('.pa-reward__no'),
      host: q('.pa-reward__host'),
      live: q('.pa-reward__live')
    };
    sheet.title.textContent = SHEET_TITLE;
    root.querySelectorAll('.pa-reward__terms dt')[0].textContent = SHEET_PRICE_K;
    root.querySelectorAll('.pa-reward__terms dt')[1].textContent = SHEET_LEFT_K;
    sheet.go.textContent = SHEET_GO;
    sheet.no.textContent = SHEET_NO;
    return sheet;
  }

  function openSheet(S) {
    S.root.hidden = false;
    void S.root.offsetWidth;
    S.root.classList.add('is-open');
  }
  function closeSheet(S) {
    S.root.classList.remove('is-open');
    setTimeout(function () { if (!S.root.classList.contains('is-open')) S.root.hidden = true; }, 260);
  }

  function announce(S, text) {
    S.live.textContent = '';
    setTimeout(function () { S.live.textContent = text; }, 30);
  }

  function present(handle, opts, started) {
    opts = opts || {};
    var S = buildSheet();
    var returnTo = document.activeElement;
    var stage = 'offer';     /* offer | play | done */

    S.what.textContent = opts.what || SHEET_WHAT;
    /* The price, as exactly as the adapter can state it: the dummy and GPT
       both know the spot's length; an adapter that does not says only that
       it is one ad. */
    var priceSecs = handle.duration ? Math.round(handle.duration / 1000) : 0;
    S.price.textContent = SHEET_PRICE + (priceSecs ? ' · ' + bn(priceSecs) + ' সেকেন্ড' : '');
    /* The balance after this one, when the caller keeps one (hints() does).
       A reader should not learn at the next press that the last one is gone. */
    if (typeof opts.after === 'number') {
      S.leftRow.hidden = false;
      S.left.innerHTML = opts.after > 0
        ? 'আরও ' + bn(opts.after) + 'টি সাহায্য'
        : '<span class="pa-reward__last">' + SHEET_LEFT_LAST + '</span>';
    } else {
      S.leftRow.hidden = true;
    }
    S.offer.hidden = false;
    S.host.hidden = true;
    S.host.innerHTML = '';
    S.live.textContent = '';

    return new Promise(function (resolve) {
      function finish(result) {
        if (stage === 'done') return;
        stage = 'done';
        document.removeEventListener('keydown', onKey, true);
        S.scrim.onclick = S.go.onclick = S.no.onclick = null;
        closeSheet(S);
        if (returnTo && returnTo.focus && document.contains(returnTo)) {
          try { returnTo.focus(); } catch (e) {}
        }
        resolve(result);
      }

      function decline() {
        try { if (handle.cancel) handle.cancel(); } catch (e) {}
        finish('forfeited');
      }

      function confirm() {
        if (stage !== 'offer') return;
        stage = 'play';
        S.offer.hidden = true;
        S.host.hidden = false;
        var secs = handle.duration ? Math.round(handle.duration / 1000) : 0;
        announce(S, secs ? 'বিজ্ঞাপন চলছে, ' + bn(secs) + ' সেকেন্ড' : 'বিজ্ঞাপন চলছে');
        if (started) started();
        Promise.resolve()
          .then(function () { return handle.show(S.host); })
          .then(function (r) { return r === 'granted' ? 'granted' : 'forfeited'; },
            function () { return 'forfeited'; })
          .then(function (r) {
            announce(S, r === 'granted' ? 'বিজ্ঞাপন শেষ, সাহায্য পাওয়া গেল' : 'বিজ্ঞাপন বন্ধ, সাহায্য পাওয়া যায়নি');
            /* Leave the announcement a beat before the region is torn down. */
            setTimeout(function () { finish(r); }, 60);
          });
      }

      /* Capture phase, so a game's own document-level Escape handler — which
         closes whichever .pa-sheet is open — never sees the key while this
         sheet owns it. */
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (stage === 'offer') decline();
          else if (stage === 'play' && handle.close) { try { handle.close(); } catch (err) {} }
          return;
        }
        if (e.key !== 'Tab') return;
        var items = Array.prototype.filter.call(S.panel.querySelectorAll(FOCUSABLE), function (n) {
          return n.offsetParent !== null;
        });
        if (!items.length) { e.preventDefault(); S.panel.focus(); return; }
        var first = items[0], last = items[items.length - 1];
        var inside = S.panel.contains(document.activeElement);
        if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }

      S.go.onclick = confirm;
      S.no.onclick = decline;
      /* The scrim declines at the price step; during the spot it does
         nothing, because leaving is the close control's job and it warns. */
      S.scrim.onclick = function () { if (stage === 'offer') decline(); };
      document.addEventListener('keydown', onKey, true);

      openSheet(S);
      S.go.focus();
    });
  }

  var rewardedBusy = false;

  /* `opts.puzzle` tags the events; `opts.what` is the one line the sheet will
     print about what the reader gets. Resolves one of three strings and
     never rejects. 'empty' means: grant the hint, say nothing. */
  function rewarded(opts) {
    opts = opts || {};
    var puzzle = opts.puzzle;

    /* Off by config is not a miss and is not logged as one: `rewarded:false`
       is the state the pilot ships in if brand-safety has not cleared, and
       those free hints must not read as failed fills in PA's numbers. */
    if (!CFG.enabled || !CFG.rewarded) return Promise.resolve('empty');
    /* A second press while a spot is in flight is not a second hint. It is
       not a miss either — 'empty' would grant one for free — so it is the one
       answer that grants nothing and charges nothing. */
    if (rewardedBusy) return Promise.resolve('forfeited');
    rewardedBusy = true;

    return getReady().then(function (impl) {
      var provider = adapterName;
      emit('ad_request', { slot: 'rewarded', provider: provider, puzzle: puzzle });
      if (!consent.ads) {
        emit('ad_empty', { slot: 'rewarded', provider: provider, reason: 'consent', puzzle: puzzle });
        return 'empty';
      }
      var t0 = now();
      var reason = impl === EMPTY ? emptyReason : 'unfilled';
      return withTimeout(
        Promise.resolve().then(function () { return impl.rewarded(opts, CFG); }),
        CFG.rewardedTimeout,
        function (e) { reason = e ? 'adapter-error' : 'timeout'; if (e) warn('rewarded threw', e); return null; }
      ).then(function (handle) {
        if (!handle || typeof handle.show !== 'function') {
          emit('ad_empty', { slot: 'rewarded', provider: provider, reason: reason, puzzle: puzzle });
          return 'empty';
        }
        emit('ad_filled', { slot: 'rewarded', provider: provider, ms: Math.round(now() - t0) });
        /* `started` is the sheet's to call, at the moment the spot begins.
           A reader who sees the price and says থাক never started anything:
           that is a decline, counted on its own, not a forfeit. */
        var t1;
        function started() { if (t1 === undefined) { t1 = now(); emit('reward_started', { puzzle: puzzle }); } }
        return Promise.resolve()
          .then(function () { return present(handle, opts, started); })
          .then(function (r) { return r === 'granted' ? 'granted' : 'forfeited'; },
            function (e) { warn('rewarded show threw', e); return 'forfeited'; })
          .then(function (r) {
            if (t1 === undefined) { emit('reward_declined', { puzzle: puzzle }); return 'forfeited'; }
            emit(r === 'granted' ? 'reward_granted' : 'reward_forfeited', { puzzle: puzzle, ms: Math.round(now() - t1) });
            return r;
          });
      });
    }).then(function (r) { rewardedBusy = false; return r; },
      function (e) { rewardedBusy = false; warn('rewarded failed', e); return 'empty'; });
  }

  /* ---- সাহায্য — the hint economy ------------------------------------------ */

  /* One budget per puzzle: `freeHints` free, then `maxRewardedHints` more at
     one rewarded view each. Not bankable, not transferable; a puzzle id is
     dated, so the budget resets with the day's puzzle by construction and
     yesterday's puzzle, opened from the archive, carries its own. Stored
     under the game's own prefix beside the puzzle's state, so it survives a
     reload and cannot be reset by reopening the page.

     The two config switches change the price, never the shape:
       enabled:false   → the same 1 + 3 ceiling, every one free. The kill
                         switch is about ads, and a kill switch that changed
                         the game would put a different puzzle on the
                         leaderboard on the days ads were off.
       rewarded:false  → the same 1 + 3 ceiling, every one free. The pilot
                         ships this way until brand-safety clears rewarded,
                         and readers must meet the ceiling they will keep.
     Both are 'free' in the event stream, never 'unlimited'; a hint is a hint
     to the board (ADS-SPEC §4), whatever it cost the reader.

     No fill is not a refusal. `rewarded()` answering 'empty' grants the hint
     anyway, unpaid, and the `ad_empty` → `hint_used {paid:false}` pair in the
     event stream is how PA learns what fill is worth. Only a forfeit — the
     reader closed the spot — grants nothing, and charges nothing. */

  var STORE = 'pa:ads:' + CFG.game + ':hints:';

  var memStore = {};   /* private mode, storage full, storage disabled */
  function readStore(id) {
    try {
      var raw = localStorage.getItem(STORE + id);
      if (raw) { var o = JSON.parse(raw); if (o && typeof o.used === 'number') return o; }
    } catch (e) {}
    return memStore[id] || null;
  }
  function writeStore(id, o) {
    memStore[id] = o;
    try { localStorage.setItem(STORE + id, JSON.stringify(o)); } catch (e) {}
  }

  var LABEL_NONE = 'আর সাহায্য নেই';
  var LABEL_HINT = 'সাহায্য';
  var LABEL_LEFT = 'টি বাকি';

  var hintCache = {};

  function Hints(id) {
    this.puzzle = id;
    this.busy = false;
    var saved = readStore(id);
    this.used = saved ? saved.used : 0;
    this.paid = saved ? saved.paid || 0 : 0;
  }

  Hints.prototype.save = function () {
    writeStore(this.puzzle, { used: this.used, paid: this.paid, at: Date.now() });
  };

  Hints.prototype.max = function () { return CFG.freeHints + CFG.maxRewardedHints; };
  Hints.prototype.freeLeft = function () { return Math.max(0, CFG.freeHints - this.used); };
  Hints.prototype.left = function () { return Math.max(0, this.max() - this.used); };

  /* What the next hint costs: 'free', 'rewarded', or 'none' at the ceiling. */
  Hints.prototype.next = function () {
    if (this.used >= this.max()) return 'none';
    if (this.used < CFG.freeHints) return 'free';
    return (CFG.enabled && CFG.rewarded) ? 'rewarded' : 'free';
  };

  /* Everything a control needs to draw itself, in the one vocabulary every
     game shares: the word `সাহায্য`, the balance beside it as `৩টি বাকি` — the
     number the reader is about to spend from, always on the control and
     never only in a sheet — the ad glyph when the next one costs a view, and
     `আর সাহায্য নেই`, disabled, at the ceiling. A game renders this; it does
     not compose its own. */
  Hints.prototype.state = function () {
    var next = this.next();
    var left = this.left();
    return {
      puzzle: this.puzzle,
      next: next,
      ad: next === 'rewarded',
      disabled: next === 'none' || this.busy,
      busy: this.busy,
      label: next === 'none' ? LABEL_NONE : LABEL_HINT,
      balance: next === 'none' ? '' : bn(left) + LABEL_LEFT,
      used: this.used,
      paid: this.paid,
      free: this.freeLeft(),
      left: left,
      max: this.max()
    };
  };

  Hints.prototype.grant = function (paid, via, kind) {
    this.used += 1;
    if (paid) this.paid += 1;
    this.save();
    emit('hint_used', { puzzle: this.puzzle, index: this.used, paid: !!paid, kind: kind, via: via });
    return { granted: true, paid: !!paid, index: this.used, via: via, state: this.state() };
  };

  /* Ask for one hint. Resolves `{granted, paid, index, via, state}`; never
     rejects. `opts.kind` names what the game will reveal, for the event;
     `opts.what` is the one line the rewarded sheet prints about it. The
     caller applies the hint only when `granted` is true, and applies it at
     once — a hint is spent at the moment of being stuck, never held. */
  Hints.prototype.request = function (opts) {
    opts = opts || {};
    var self = this;
    var kind = opts.kind;
    if (self.busy) return Promise.resolve({ granted: false, reason: 'busy', state: self.state() });
    var next = self.next();
    if (next === 'none') return Promise.resolve({ granted: false, reason: 'exhausted', state: self.state() });
    if (next === 'free') return Promise.resolve(self.grant(false, 'free', kind));

    self.busy = true;
    return rewarded({ puzzle: self.puzzle, what: opts.what, kind: kind, after: self.left() - 1 }).then(function (r) {
      self.busy = false;
      if (r === 'granted') return self.grant(true, 'rewarded', kind);
      if (r === 'empty') return self.grant(false, 'fallback', kind);
      return { granted: false, reason: 'forfeited', state: self.state() };
    }, function (e) {
      self.busy = false;
      warn('hint request failed, granting', e);
      return self.grant(false, 'fallback', kind);
    });
  };

  function hints(id) {
    id = String(id || 'default');
    return hintCache[id] || (hintCache[id] = new Hints(id));
  }

  /* ---- the strip -------------------------------------------------------

     The budget, shown the way a game shows lives, in a host the game
     reserves above its board. Built here so five games mount one strip
     rather than draw four. The game decides what the action does and when
     it may:

       PaAds.strip(host, {
         hints:  H,                        the puzzle's Hints
         kind:   'fifty',                  for the event
         what:   'দুটি ভুল উত্তর বাদ যাবে',  the sheet's line
         canUse: function () {             asked on every paint and press
           return { ok: true, ctx: … }     → live; ctx is handed to onUse
           return { ok: false, taken: true }   → this target has had its
           return { ok: false }            → nothing to act on
         },
         onUse:  function (ctx, result) {} the hint landing on the board
       }) → { paint(), hide(), show(), destroy() }

     The strip repaints itself when the budget moves; the game calls
     paint() when what is in front of the reader changes (a scroll, an
     answer, a cursor move). */

  var STRIP_K = 'সাহায্য';
  var STRIP_USE = 'সাহায্য নিন';
  var STRIP_TAKEN = 'নেওয়া হয়েছে';
  var STRIP_AD_ARIA = 'সাহায্য নিন — বিজ্ঞাপন দেখে';
  var STRIP_AD_GLYPH = '<svg class="pa-strip__ad" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor" stroke="none"/></svg>';
  /* The token: a bulb in the system's stroke. The fill is its own path so
     CSS can fill it (yours), outline it (a view) or hollow it (spent). */
  var STRIP_TOKEN = '<i class="pa-token"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
    + '<path class="pa-token__fill" d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>'
    + '<path d="M9.5 19h5M10.5 21.5h3"/></svg></i>';

  function strip(host, opts) {
    opts = opts || {};
    var H = opts.hints;
    if (!host || !H) return null;
    host.classList.add('pa-strip');
    host.innerHTML =
      '<div class="pa-strip__lives">' +
        '<span class="pa-strip__k">' + STRIP_K + '</span>' +
        '<span class="pa-strip__tokens" aria-hidden="true"></span>' +
        '<span class="pa-strip__n" aria-live="polite"></span>' +
      '</div>' +
      '<button type="button" class="pa-strip__use"><span class="pa-strip__use-t"></span></button>';
    var tokens = host.querySelector('.pa-strip__tokens');
    var n = host.querySelector('.pa-strip__n');
    var use = host.querySelector('.pa-strip__use');
    var useT = host.querySelector('.pa-strip__use-t');
    var busy = false, alive = true;

    function paint() {
      if (!alive) return;
      var st = H.state(), max = st.max, i;
      if (tokens.children.length !== max) {
        var html = '';
        for (i = 0; i < max; i++) html += STRIP_TOKEN;
        tokens.innerHTML = html;
      }
      /* Left to right, spent first. Filled when the token is the reader's
         outright (the free tier), outlined when a view buys it. With ads
         off or rewarded uncleared every token is the reader's. */
      var adTier = CFG.enabled && CFG.rewarded;
      for (i = 0; i < max; i++) {
        tokens.children[i].className = 'pa-token' + (i < st.used ? ' is-spent' : (adTier && i >= CFG.freeHints ? ' is-ad' : ''));
      }
      n.textContent = st.balance;

      var can = opts.canUse ? (opts.canUse() || { ok: false }) : { ok: true };
      var out = st.next === 'none';
      useT.textContent = out ? LABEL_NONE : (can.taken ? STRIP_TAKEN : STRIP_USE);
      use.classList.toggle('is-out', out);
      use.disabled = st.disabled || busy || !can.ok;
      use.setAttribute('aria-busy', (st.busy || busy) ? 'true' : 'false');
      if (st.ad) use.setAttribute('aria-label', STRIP_AD_ARIA); else use.removeAttribute('aria-label');
      /* The glyph states the price of the press about to happen; a press
         that cannot happen has no price. */
      var g = use.querySelector('.pa-strip__ad'), showAd = st.ad && !use.disabled;
      if (showAd && !g) use.insertAdjacentHTML('afterbegin', STRIP_AD_GLYPH);
      else if (!showAd && g) g.parentNode.removeChild(g);
    }

    /* The first unspent token pops once as the hint lands — the strip's one
       motion, and the only juice a hint has: what was bought is the board
       changing. */
    function pop() {
      var i;
      for (i = 0; i < tokens.children.length; i++) {
        var t = tokens.children[i];
        if (t.classList.contains('is-spent')) continue;
        t.classList.remove('is-going'); void t.offsetWidth; t.classList.add('is-going');
        setTimeout(function () { t.classList.remove('is-going'); }, 420);
        return;
      }
    }

    use.onclick = function () {
      if (busy || !alive) return;
      var can = opts.canUse ? (opts.canUse() || { ok: false }) : { ok: true };
      if (!can.ok) { paint(); return; }
      busy = true;
      var req = H.request({ kind: opts.kind, what: opts.what });
      paint();   /* after request(): the budget now reads busy */
      req.then(function (r) {
        busy = false;
        if (r.granted) { pop(); if (opts.onUse) { try { opts.onUse(can.ctx, r); } catch (e) { warn('strip onUse threw', e); } } }
        paint();
      });
    };

    var off = on('hint_used', function (e) { if (e.puzzle === H.puzzle) paint(); });
    paint();
    return {
      paint: paint,
      show: function () { host.hidden = false; paint(); },
      hide: function () { host.hidden = true; },
      destroy: function () { alive = false; off(); use.onclick = null; host.innerHTML = ''; host.classList.remove('pa-strip'); }
    };
  }

  /* ---- public ----------------------------------------------------------- */

  window.PaAds = {
    config: CFG,
    sizes: SLOTS,
    slot: slot,
    unmount: unmount,
    rewarded: rewarded,
    hints: hints,
    strip: strip,
    setConsent: setConsent,
    on: on,
    emit: emit,
    register: register,
    /* Resolves with the adapter in use; for tests and the hub. Never rejects. */
    ready: getReady,
    /* The provider name actually answering, once ready: 'dummy', 'gpt',
       'adsense-h5', 'empty', or 'off'. Empty string before that. */
    provider: function () { return adapterName; },
    consent: function () { return consent; },
    /* Test seam: replace the sheet with `fn(handle, opts, started)`. Call
       `started()` before `handle.show()` or the run counts as declined. Not
       part of the contract. */
    _present: function (fn) { if (typeof fn === 'function') present = fn; }
  };
}());
