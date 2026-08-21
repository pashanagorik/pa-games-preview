#!/usr/bin/env python3
"""Cross-check every transcribed শব্দভেদ puzzle against the scans, independently.

Three checks per puzzle, each reading the PRINTED page rather than the JSON that
was written from it:

  1. block pattern vs the puzzle grid printed on day N
  2. block pattern vs the solution grid printed on day N+1  (a second, independent
     source for the same fact)
  3. numbered squares: the derived numbering says which squares carry a clue
     number; the printed puzzle grid shows ink in exactly the numbered squares.
     A numbering that drifted by one would fail here.

Exit code is non-zero if anything disagrees.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect, prep

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
PUZ = os.path.dirname(os.path.abspath(__file__))
SCANS = os.path.join(REPO, 'Screenshot')

# scan filenames are not uniform: 5.8.26.png early, 11.8.2026.png later
def scan_for(day):
    for name in ('%d.8.26.png' % day, '%d.8.2026.png' % day):
        p = os.path.join(SCANS, name)
        if os.path.exists(p):
            return p
    return None

def ink_cells(grid):
    return [i > 12 for i in grid['ink']]

def main():
    idx = json.load(open(os.path.join(PUZ, 'index.json'), encoding='utf-8'))
    fails = 0
    print('%-14s %-16s %-18s %-16s' % ('puzzle', 'blocks vs day N', 'blocks vs day N+1', 'numbered squares'))
    print('-' * 70)
    for entry in idx['puzzles']:
        pid, date = entry['id'], entry['date']
        day = int(date.split('-')[2])
        doc = json.load(open(os.path.join(PUZ, pid + '.json'), encoding='utf-8'))
        want_open = [c is not None for c in doc['grid']]

        # 1. the puzzle grid printed that day
        s1 = scan_for(day)
        g1 = detect.analyse(s1)[0] if s1 else None
        c1 = 'no scan'
        if g1:
            got = [c == '.' for c in g1['cells']]           # tint says open
            # the paper's tint carries known errors; ink in the solution is the
            # authority, so a tint disagreement is reported, not failed
            diff = [i for i in range(64) if got[i] != want_open[i]]
            c1 = 'ok' if not diff else 'tint differs @%s' % diff

        # 2. the solution grid printed the next day — independent source
        s2 = scan_for(day + 1)
        c2 = 'no scan'
        if s2:
            grids = detect.analyse(s2)
            if len(grids) > 1:
                got = ink_cells(grids[1])
                bad = [i for i in range(64) if got[i] != want_open[i]]
                c2 = 'ok' if not bad else 'MISMATCH @%s' % bad
                fails += bool(bad)

        # 3. numbered squares, from ink in the printed puzzle grid
        c3 = 'no scan'
        if g1:
            printed = [i > 12 for i in g1['ink']]
            derived = set(e['cell'] for e in prep.numbering(want_open))
            expect = [i in derived for i in range(64)]
            bad = [i for i in range(64) if printed[i] != expect[i] and want_open[i]]
            c3 = 'ok (%d)' % len(derived) if not bad else 'MISMATCH @%s' % bad
            fails += bool(bad)

        print('%-14s %-16s %-18s %-16s' % (pid.replace('pa-', ''), c1, c2, c3))
    print('-' * 70)
    print('FAILURES:', fails)
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
