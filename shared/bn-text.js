/*
 * bn-text.js — Bangla akshara segmentation for grid games.
 *
 * WHY THIS EXISTS INSTEAD OF Intl.Segmenter
 * -----------------------------------------
 * A crossword cell holds one orthographic syllable at arbitrary conjunct depth.
 * Prothom Alo's printed শব্দভেদ puts ন্দ্র (5 codepoints) in a single square.
 *
 * Intl.Segmenter only clusters consonant + virama + consonant as one unit under
 * Unicode 15.1 rule GB9c, which needs ICU >= 74, i.e. Chrome >= 116. Our stated
 * floor is WebView ~Chrome 90. Below that, ট্ট segments as ট্ + ট, an 8-cell
 * word becomes 9 cells, and the puzzle silently breaks on exactly the devices
 * most of the audience owns.
 *
 * So we own the rule set. It is small, total, and identical on every engine.
 */
(function (global) {
  'use strict';

  var VIRAMA = '্'; // ্  hasant
  var NUKTA = '়';  // ়

  function cp(ch) { return ch ? ch.charCodeAt(0) : -1; }
  function within(c, a, b) { return c >= a && c <= b; }

  function isConsonant(ch) {
    var c = cp(ch);
    return within(c, 0x0995, 0x09A8) // ক–ন
      || within(c, 0x09AA, 0x09B0)   // প–র
      || c === 0x09B2                // ল
      || within(c, 0x09B6, 0x09B9)   // শ–হ
      || within(c, 0x09DC, 0x09DD)   // ড় ঢ়
      || c === 0x09DF                // য়
      || c === 0x09CE;               // ৎ khanda ta
  }

  function isVowel(ch) {
    var c = cp(ch);
    return within(c, 0x0985, 0x098C) // অ–ঌ
      || within(c, 0x098F, 0x0990)   // এ ঐ
      || within(c, 0x0993, 0x0994);  // ও ঔ
  }

  function isKar(ch) {
    var c = cp(ch);
    return within(c, 0x09BE, 0x09C4) // া ি ী ু ূ ৃ ৄ
      || within(c, 0x09C7, 0x09C8)   // ে ৈ
      || within(c, 0x09CB, 0x09CC)   // ো ৌ
      || c === 0x09D7;               // ৗ
  }

  function isSign(ch) {
    var c = cp(ch);
    return c === 0x0981 || c === 0x0982 || c === 0x0983; // ঁ ং ঃ
  }

  function isDigit(ch) { return within(cp(ch), 0x09E6, 0x09EF); }

  /* A base opens a new cluster. Anything unrecognised is its own base so the
     segmenter is total and never drops input. */
  function isBase(ch) {
    return isConsonant(ch) || isVowel(ch) || isDigit(ch)
      || !(isKar(ch) || isSign(ch) || ch === VIRAMA || ch === NUKTA);
  }

  /*
   * segment('মোকদ্দমা') -> ['মো','ক','দ্দ','মা']
   * Verified against every conjunct in ProthomAlo-Demo/Screenshot/:
   * ন্দ্র · স্ত্ত · ক্ষি · প্রা · র্ব · জ্জা · ট্ট · গ্ধ · ধোঁ · ড়ি · আঁ · ঞ্চা · ৎ
   */
  function segment(input) {
    var s = String(input == null ? '' : input);
    if (s.normalize) s = s.normalize('NFC');
    var out = [];
    var i = 0;
    var n = s.length;

    while (i < n) {
      var start = i;
      i++; // consume the base

      while (i < n) {
        var ch = s.charAt(i);
        if (ch === NUKTA) { i++; continue; }
        if (ch === VIRAMA) {
          // virama + consonant welds a conjunct; a trailing virama rides along
          if (isConsonant(s.charAt(i + 1))) { i += 2; continue; }
          i++; continue;
        }
        if (isKar(ch) || isSign(ch)) { i++; continue; }
        break;
      }

      out.push(s.slice(start, i));
    }
    return out;
  }

  function length(input) { return segment(input).length; }

  /* Cell comparison. NFC-normalised so ড়ি typed as ড+় +ি equals precomposed ড়ি. */
  function equals(a, b) {
    var x = String(a == null ? '' : a);
    var y = String(b == null ? '' : b);
    if (x.normalize) { x = x.normalize('NFC'); y = y.normalize('NFC'); }
    return x === y;
  }

  /*
   * Keyboard composition. The active cell is a buffer; a tap either extends it
   * or commits it and starts the next one. This mirrors how a Bangla keyboard
   * behaves, so a print solver needs no instruction beyond the first tap.
   *
   * Returns { cell, commit } — commit true means the caller should write `cell`
   * and advance, then start a fresh buffer holding `next`.
   */
  function compose(buffer, ch) {
    var buf = String(buffer || '');

    if (!buf) return { cell: ch, commit: false };

    // hasant: arm a conjunct
    if (ch === VIRAMA) {
      if (buf.charAt(buf.length - 1) === VIRAMA) return { cell: buf, commit: false };
      return { cell: buf + ch, commit: false };
    }

    // a kar replaces any kar already on the buffer rather than stacking
    if (isKar(ch)) {
      var stripped = buf;
      var last = stripped.charAt(stripped.length - 1);
      if (isKar(last)) stripped = stripped.slice(0, -1);
      return { cell: stripped + ch, commit: false };
    }

    if (isSign(ch)) {
      if (buf.indexOf(ch) >= 0) return { cell: buf, commit: false };
      return { cell: buf + ch, commit: false };
    }

    if (ch === NUKTA) return { cell: buf + ch, commit: false };

    // a base letter after an armed hasant completes the conjunct
    if (buf.charAt(buf.length - 1) === VIRAMA && isConsonant(ch)) {
      return { cell: buf + ch, commit: false };
    }

    // otherwise this base belongs to the next cell
    return { cell: buf, commit: true, next: ch };
  }

  /* Peel one component off the buffer: kar, sign, nukta, conjunct tail, or base. */
  function backspace(buffer) {
    var buf = String(buffer || '');
    if (!buf) return '';
    var last = buf.charAt(buf.length - 1);
    if (isKar(last) || isSign(last) || last === NUKTA || last === VIRAMA) {
      return buf.slice(0, -1);
    }
    if (buf.length >= 2 && buf.charAt(buf.length - 2) === VIRAMA) {
      return buf.slice(0, -2); // drop the welded consonant and its hasant
    }
    return buf.slice(0, -1);
  }

  var BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  function toBn(value) {
    return String(value).replace(/[0-9]/g, function (d) { return BN_DIGITS[+d]; });
  }

  global.BnText = {
    segment: segment,
    length: length,
    equals: equals,
    compose: compose,
    backspace: backspace,
    toBn: toBn,
    isConsonant: isConsonant,
    isVowel: isVowel,
    isKar: isKar,
    isSign: isSign,
    VIRAMA: VIRAMA,
    NUKTA: NUKTA
  };
}(typeof window !== 'undefined' ? window : this));
