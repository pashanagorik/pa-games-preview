#!/usr/bin/env python3
"""Locate the 8x8 grids in a Prothom Alo শব্দভেদ scan and report blocked squares.

A page carries two grids: today's puzzle (top) and গত সমস্যার সমাধান, yesterday's
solution (bottom). Blocked squares print in PA Cyan Tint, so they are found by
colour rather than read by eye — transcription is the one step in this pipeline
with no safety net, and this removes the grid half of it.

Rules are found as CONTIGUOUS dark runs, not as a count of dark pixels: a line
of clue text can put plenty of ink on a row without ever being a rule. The scans
vary in exposure, so the threshold is deliberately generous (195/255) and the
geometry check — nine evenly spaced lines — is what rejects a false positive.
"""
import sys
from PIL import Image

N = 8

def _lines(runlen, limit, need):
    ys = [i for i in range(limit) if runlen(i) > need]
    out, cur = [], []
    for y in ys:
        if cur and y - cur[-1] <= 3: cur.append(y)
        else:
            if cur: out.append(sum(cur)//len(cur))
            cur = [y]
    if cur: out.append(sum(cur)//len(cur))
    return out

def runs_of_nine(lines, tol=8):
    found = []
    for i in range(max(0, len(lines) - N)):
        win = lines[i:i+N+1]
        if len(win) < N+1: break
        gaps = [win[j+1]-win[j] for j in range(N)]
        if max(gaps) - min(gaps) <= tol and min(gaps) > 20:
            found.append(win)
    keep = []
    for w in found:
        if not keep or w[0] > keep[-1][-1]:
            keep.append(w)
    return keep

def analyse(path, t=195):
    rgb = Image.open(path).convert('RGB'); W, H = rgb.size; cp = rgb.load()
    g = rgb.convert('L'); gp = g.load()

    def hrun(y):
        run = best = 0
        for x in range(W):
            if gp[x, y] < t: run += 1; best = max(best, run)
            else: run = 0
        return best

    grids = []
    for ys in runs_of_nine(_lines(hrun, H, W * 0.5)):
        top, bot = ys[0], ys[-1]
        def vrun(x, top=top, bot=bot):
            run = best = 0
            for y in range(top, bot):
                if gp[x, y] < t: run += 1; best = max(best, run)
                else: run = 0
            return best
        xs = runs_of_nine(_lines(vrun, W, (bot - top) * 0.5))
        if not xs: continue
        xs = xs[0]
        cells, inks = [], []
        for r in range(N):
            for c in range(N):
                x0, x1, y0, y1 = xs[c], xs[c+1], ys[r], ys[r+1]
                tot = [0, 0, 0]; cnt = 0; ink = 0
                for yy in range(int(y0 + (y1-y0)*0.22), int(y0 + (y1-y0)*0.78)):
                    for xx in range(int(x0 + (x1-x0)*0.22), int(x0 + (x1-x0)*0.78)):
                        p = cp[xx, yy]
                        if sum(p) > 330:          # sample paper, not printed ink
                            tot[0]+=p[0]; tot[1]+=p[1]; tot[2]+=p[2]; cnt += 1
                        elif sum(p) < 300:        # something is printed here
                            ink += 1
                if not cnt:
                    cells.append('#'); continue
                r_, _, b_ = [x/cnt for x in tot]
                tint = (b_ - r_) > 10
                cells.append('#' if tint else '.')
                inks.append(ink)
        # A cell that holds printed ink is an OPEN cell, whatever its tint says.
        # The 9 August page proves why this matters: its bottom-right square is
        # shaded in both the puzzle and the solution, and the solution prints তা
        # inside the shading. The paper's own tint is not authoritative; ink is.
        filled = ''.join('x' if i > 12 else '-' for i in inks)
        grids.append({'box': (xs[0], ys[0], xs[-1], ys[-1]), 'xs': xs, 'ys': ys,
                      'cells': cells, 'ink': inks, 'filled': filled})
    return grids

if __name__ == '__main__':
    for gd in analyse(sys.argv[1]):
        print('grid', gd['box'])
        for r in range(N):
            print('   ', ''.join(gd['cells'][r*N:(r+1)*N]))
