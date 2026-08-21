#!/usr/bin/env python3
"""Prepare one শব্দভেদ puzzle for transcription.

  python3 prep.py 10.8.26.png 11.8.2026.png 2026-08-10 OUTDIR

Day N's page carries the puzzle; day N+1's page carries its solution. What this
can do without a human it does: the block pattern comes from ink in the solution
grid, and the clue numbering is derived by standard crossword rules rather than
read off the page. What is left is what only eyes can do — the akshara in each
square and the clue text — and those are cropped, enlarged and laid out so they
can be read in one pass instead of squinting at a full page.
"""
import json, sys, os
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect

N = 8

def numbering(open_cells):
    """Standard crossword numbering over an 8x8 block pattern."""
    def is_open(r, c):
        return 0 <= r < N and 0 <= c < N and open_cells[r*N+c]
    entries, num = [], 0
    for r in range(N):
        for c in range(N):
            if not is_open(r, c):
                continue
            starts_a = (not is_open(r, c-1)) and is_open(r, c+1)
            starts_d = (not is_open(r-1, c)) and is_open(r+1, c)
            if not (starts_a or starts_d):
                continue
            num += 1
            if starts_a:
                ln = 0
                while is_open(r, c+ln): ln += 1
                entries.append({'n': num, 'dir': 'across', 'cell': r*N+c, 'len': ln, 'clue': ''})
            if starts_d:
                ln = 0
                while is_open(r+ln, c): ln += 1
                entries.append({'n': num, 'dir': 'down', 'cell': r*N+c, 'len': ln, 'clue': ''})
    return entries

def contact_sheet(path, grid, open_cells, out, scale=3, pad=8):
    """Every open square, cropped and enlarged, laid out as the grid itself."""
    im = Image.open(path).convert('RGB')
    xs, ys = grid['xs'], grid['ys']
    cw = max(xs[i+1]-xs[i] for i in range(N)) * scale
    ch = max(ys[i+1]-ys[i] for i in range(N)) * scale
    sheet = Image.new('RGB', (int(cw*N + pad*(N+1)), int(ch*N + pad*(N+1))), 'white')
    d = ImageDraw.Draw(sheet)
    for r in range(N):
        for c in range(N):
            x = int(pad + c*(cw+pad)); y = int(pad + r*(ch+pad))
            if not open_cells[r*N+c]:
                d.rectangle([x, y, x+cw, y+ch], fill=(200, 214, 224))
                continue
            cell = im.crop((xs[c], ys[r], xs[c+1], ys[r+1]))
            cell = cell.resize((int(cw), int(ch)), Image.LANCZOS)
            sheet.paste(cell, (x, y))
            d.rectangle([x, y, x+cw, y+ch], outline=(0, 0, 0), width=2)
    sheet.save(out)
    return out

def clue_crop(path, grid, out, scale=2):
    """Everything between the puzzle grid and the solution grid: the clue block."""
    im = Image.open(path).convert('RGB')
    top = grid[0]['ys'][-1] + 4
    bot = grid[1]['ys'][0] - 4 if len(grid) > 1 else im.height
    c = im.crop((0, top, im.width, bot))
    c = c.resize((c.width*scale, c.height*scale), Image.LANCZOS)
    c.save(out)
    return out

if __name__ == '__main__':
    day, nxt, date, outdir = sys.argv[1:5]
    os.makedirs(outdir, exist_ok=True)
    gd = detect.analyse(day)
    gn = detect.analyse(nxt)
    if not gd or len(gn) < 2:
        sys.exit('grid detection failed: %s (%d grids), %s (%d grids)' % (day, len(gd), nxt, len(gn)))
    sol = gn[1]
    open_cells = [i > 12 for i in sol['ink']]
    tint_blocks = [c == '#' for c in gd[0]['cells']]

    # the paper's tint and its ink must agree; where they don't, the ink wins and
    # the disagreement is printed here so it is never silently swallowed
    clash = [i for i in range(N*N) if tint_blocks[i] == open_cells[i]]

    entries = numbering(open_cells)
    skeleton = {
        'id': 'pa-' + date, 'date': date,
        'source': 'Prothom Alo print edition, শব্দভেদ, %s. Grid and clues from Screenshot/%s; solution grid from Screenshot/%s.'
                  % (date, os.path.basename(day), os.path.basename(nxt)),
        'verified': False, 'verificationNote': '',
        'rows': N, 'cols': N,
        'grid': [None if not o else '' for o in open_cells],
        'entries': entries,
    }
    with open(os.path.join(outdir, 'skeleton.json'), 'w', encoding='utf-8') as f:
        json.dump(skeleton, f, ensure_ascii=False, indent=2)
    contact_sheet(nxt, sol, open_cells, os.path.join(outdir, 'letters.png'))
    clue_crop(day, gd, os.path.join(outdir, 'clues.png'))

    print('date        ', date)
    print('open cells  ', sum(open_cells), 'of 64')
    print('entries     ', len([e for e in entries if e['dir']=='across']), 'across,',
                          len([e for e in entries if e['dir']=='down']), 'down,',
                          'highest number', max(e['n'] for e in entries))
    print('tint/ink clash', clash if clash else 'none')
    for r in range(N):
        print('   ', ''.join('.' if open_cells[r*N+c] else '#' for c in range(N)))
