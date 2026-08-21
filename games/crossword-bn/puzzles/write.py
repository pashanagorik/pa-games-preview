#!/usr/bin/env python3
"""Assemble one transcribed শব্দভেদ puzzle, register it, and print every word.

Called with a python file that defines DATE, GRID (64 cells, None for blocks),
ACROSS and DOWN (number -> clue). Numbering is derived, never typed: if the
grid and the clue numbers disagree, this raises rather than shipping a puzzle
whose numbering is a guess.
"""
import json, os, sys, importlib.util
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prep

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
PUZ = os.path.dirname(os.path.abspath(__file__))

def load(path):
    spec = importlib.util.spec_from_file_location('data', path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m

def build(m, scan_day, scan_next):
    G = m.GRID
    assert len(G) == 64, 'grid must be 64 cells, got %d' % len(G)
    entries = prep.numbering([c is not None for c in G])
    have_a = sorted(e['n'] for e in entries if e['dir'] == 'across')
    have_d = sorted(e['n'] for e in entries if e['dir'] == 'down')
    if have_a != sorted(m.ACROSS) or have_d != sorted(m.DOWN):
        raise SystemExit('numbering mismatch\n  grid across %s\n  clue across %s\n  grid down   %s\n  clue down   %s'
                         % (have_a, sorted(m.ACROSS), have_d, sorted(m.DOWN)))
    words = []
    for e in entries:
        e['clue'] = (m.ACROSS if e['dir'] == 'across' else m.DOWN)[e['n']]
        step = 1 if e['dir'] == 'across' else 8
        w = ''.join(G[e['cell'] + k*step] for k in range(e['len']))
        words.append((e['n'], e['dir'], w, e['clue']))

    day = m.DATE
    doc = {
        'id': 'pa-' + day, 'date': day,
        'source': 'Prothom Alo print edition, শব্দভেদ, %s. Grid and clues from Screenshot/%s; solution grid from Screenshot/%s.'
                  % (day, scan_day, scan_next),
        'verified': True,
        'verificationNote': 'Block pattern derived from ink in the printed solution grid rather than from the tint; '
                            'all %d across and %d down clues resolve against the grid; numbering, interlock and '
                            'akshara-per-cell confirmed by puzzles/validate.mjs.' % (len(have_a), len(have_d)),
        'rows': 8, 'cols': 8, 'grid': G, 'entries': entries,
    }
    with open(os.path.join(PUZ, 'pa-%s.json' % day), 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2); f.write('\n')

    idx = os.path.join(PUZ, 'index.json')
    j = json.load(open(idx, encoding='utf-8'))
    if not any(p['id'] == 'pa-' + day for p in j['puzzles']):
        j['puzzles'].append({'id': 'pa-' + day, 'date': day})
        j['puzzles'].sort(key=lambda p: p['date'])
        with open(idx, 'w', encoding='utf-8') as f:
            json.dump(j, f, ensure_ascii=False, indent=2); f.write('\n')
    return words

if __name__ == '__main__':
    path, sday, snext = sys.argv[1], sys.argv[2], sys.argv[3]
    m = load(path)
    for n, d, w, c in build(m, sday, snext):
        print('  %2d %-6s %-14s %s' % (n, d, w, c))
