/*
 * wsgrid.js — grid generation for শব্দ সন্ধান.
 *
 * Kept out of game.js and free of any DOM reference so the same code that
 * runs in the browser can be run over the whole 14-day pack from Node
 * (puzzles/validate.mjs). A generator that is only exercised by playing the
 * game is a generator whose bad days ship.
 */
(function (root, factory) {
  var bn = root.BnText;
  if (!bn && typeof require === 'function') {
    /* bn-text.js binds to `this` under CommonJS, which is module.exports —
       so a require() hands back { BnText } rather than the object itself. */
    var mod = require('../../shared/bn-text.js');
    bn = mod.BnText || mod;
  }
  var api = factory(bn);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WSGrid = api;
}(typeof window !== 'undefined' ? window : globalThis, function (BnTextArg) {
  'use strict';

  var B = BnTextArg;

  /* Forward-only at launch. Reverse placement is a product decision, not a
     code limit — flip allowReverse in puzzles/index.json and the last four
     directions wake up. */
  var DIRS_FWD = [[0, 1], [1, 0], [1, 1], [-1, 1]];
  var DIRS_REV = [[0, -1], [-1, 0], [-1, -1], [1, -1]];

  function seedOf(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function rngFrom(str) {
    var a = seedOf(str);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function make(size) {
    var idx = function (r, c) { return r * size + c; };
    var inB = function (r, c) { return r >= 0 && r < size && c >= 0 && c < size; };

    function slotsFor(len, dirs) {
      var out = [];
      for (var d = 0; d < dirs.length; d++) {
        var dr = dirs[d][0], dc = dirs[d][1];
        for (var r = 0; r < size; r++) {
          for (var c = 0; c < size; c++) {
            if (inB(r + dr * (len - 1), c + dc * (len - 1))) out.push([r, c, dr, dc]);
          }
        }
      }
      return out;
    }

    /* Overlaps are allowed and wanted — crossings are what stop the grid
       reading as eight stripes of word laid over a field of noise. */
    function tryPlace(grid, units, slot) {
      var r = slot[0], c = slot[1], dr = slot[2], dc = slot[3];
      var cells = [], i;
      for (i = 0; i < units.length; i++) {
        var p = idx(r + dr * i, c + dc * i);
        if (grid[p] !== null && !B.equals(grid[p], units[i])) return null;
        cells.push(p);
      }
      for (i = 0; i < units.length; i++) grid[cells[i]] = units[i];
      return cells;
    }

    /* Every straight run in the grid, both ways, at every length a listed
       word could occupy. If a word appears anywhere but where it was placed,
       the grid is thrown away. This is the spec's "filler accidentally spells
       a word" guard, and it also catches a duplicate made by two words
       crossing. Reading backwards counts: selection accepts a reversed drag,
       so a reversed accidental copy would be a false find. */
    function accidental(grid, words, places) {
      var want = {}, lens = {}, i;
      for (i = 0; i < words.length; i++) {
        want[words[i]] = B.segment(words[i]);
        lens[want[words[i]].length] = true;
      }
      var placed = {};
      for (i = 0; i < places.length; i++) {
        placed[places[i].word] = places[i].cells.slice().sort(function (a, b) { return a - b; }).join(',');
      }

      var dirs = DIRS_FWD.concat(DIRS_REV);
      for (var d = 0; d < dirs.length; d++) {
        for (var r = 0; r < size; r++) {
          for (var c = 0; c < size; c++) {
            for (var L in lens) {
              var len = +L;
              if (!inB(r + dirs[d][0] * (len - 1), c + dirs[d][1] * (len - 1))) continue;
              var s = '', cells = [];
              for (i = 0; i < len; i++) {
                var p = idx(r + dirs[d][0] * i, c + dirs[d][1] * i);
                s += grid[p]; cells.push(p);
              }
              for (var w in want) {
                if (want[w].length !== len || !B.equals(s, w)) continue;
                var key = cells.slice().sort(function (a, b) { return a - b; }).join(',');
                if (key !== placed[w]) return w;
              }
            }
          }
        }
      }
      return null;
    }

    /* Filler drawn from the puzzle's own aksharas. Uniform random Bangla
       would salt the grid with letters no word in it uses, and a reader spots
       those instantly — the seeded letters stop looking like a hiding place. */
    function fillerPool(words) {
      var pool = [];
      for (var i = 0; i < words.length; i++) {
        var u = B.segment(words[i]);
        for (var j = 0; j < u.length; j++) pool.push(u[j]);
      }
      return pool;
    }

    function build(pz, allowReverse) {
      var dirs = allowReverse ? DIRS_FWD.concat(DIRS_REV) : DIRS_FWD;
      var pool = fillerPool(pz.words);
      var order = pz.words.map(function (w) { return { word: w, units: B.segment(w) }; })
        .sort(function (a, b) { return b.units.length - a.units.length; });

      for (var attempt = 0; attempt < 400; attempt++) {
        var rnd = rngFrom(pz.id + ':' + attempt);
        var grid = new Array(size * size).fill(null);
        var places = [];
        var ok = true;

        for (var i = 0; i < order.length; i++) {
          var cells = null;
          var slots = shuffled(slotsFor(order[i].units.length, dirs), rnd);
          for (var s = 0; s < slots.length; s++) {
            cells = tryPlace(grid, order[i].units, slots[s]);
            if (cells) break;
          }
          if (!cells) { ok = false; break; }
          places.push({ word: order[i].word, cells: cells });
        }
        if (!ok) continue;

        for (var p = 0; p < grid.length; p++) {
          if (grid[p] === null) grid[p] = pool[Math.floor(rnd() * pool.length)];
        }
        if (accidental(grid, pz.words, places)) continue;

        return { id: pz.id, theme: pz.theme, words: pz.words, grid: grid, places: places, attempt: attempt };
      }
      return null;
    }

    return { build: build, accidental: accidental, size: size };
  }

  return { make: make, seedOf: seedOf };
}));
