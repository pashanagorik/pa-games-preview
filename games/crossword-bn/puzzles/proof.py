#!/usr/bin/env python3
"""Build a proof sheet: the printed page beside the puzzle we shipped.

One page per puzzle. Left is the scan, untouched. Right is the JSON rendered —
numbering, answers, clue list — so a person can compare the two directly and see
any disagreement without reading JSON.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
PUZ = os.path.dirname(os.path.abspath(__file__))
SCANS = os.path.join(REPO, 'Screenshot')
OUT = os.path.join(REPO, 'Verify')

BN = '০১২৩৪৫৬৭৮৯'
def bn(n):
    return ''.join(BN[int(c)] for c in str(n))

def scan_for(day):
    for name in ('%d.8.26.png' % day, '%d.8.2026.png' % day):
        p = os.path.join(SCANS, name)
        if os.path.exists(p):
            return p, name
    return None, None

def crops(day, pid):
    """Puzzle page (grid + clues) and the next day's solution grid."""
    made = {}
    p1, n1 = scan_for(day)
    if p1:
        g = detect.analyse(p1)
        im = Image.open(p1).convert('RGB')
        bot = g[1]['ys'][0] - 6 if len(g) > 1 else im.height
        c = im.crop((0, max(0, g[0]['ys'][0] - 70), im.width, bot))
        c.save(os.path.join(OUT, '%s-page.png' % pid)); made['page'] = '%s-page.png' % pid
    p2, n2 = scan_for(day + 1)
    if p2:
        g = detect.analyse(p2)
        if len(g) > 1:
            im = Image.open(p2).convert('RGB')
            b = g[1]
            c = im.crop((b['xs'][0] - 8, b['ys'][0] - 8, b['xs'][-1] + 8, b['ys'][-1] + 8))
            c.save(os.path.join(OUT, '%s-sol.png' % pid)); made['sol'] = '%s-sol.png' % pid
    return made, n1, n2

def render(doc):
    nums = {}
    for e in doc['entries']:
        nums.setdefault(e['cell'], e['n'])
    cells = []
    for i, ch in enumerate(doc['grid']):
        if ch is None:
            cells.append('<td class="blk"></td>')
        else:
            n = '<i>%s</i>' % bn(nums[i]) if i in nums else ''
            cells.append('<td>%s<b>%s</b></td>' % (n, ch))
    rows = ''.join('<tr>%s</tr>' % ''.join(cells[r*8:(r+1)*8]) for r in range(8))
    def lst(d):
        out = []
        for e in sorted([x for x in doc['entries'] if x['dir'] == d], key=lambda x: x['n']):
            step = 1 if d == 'across' else 8
            w = ''.join(doc['grid'][e['cell'] + k*step] for k in range(e['len']))
            out.append('<li><span class="n">%s.</span> <span class="c">%s</span> <span class="w">%s</span></li>'
                       % (bn(e['n']), e['clue'], w))
        return ''.join(out)
    return rows, lst('across'), lst('down')

CSS = """
body{margin:0;background:#1b1c1e;color:#e8e6e1;font:15px/1.6 system-ui,-apple-system,sans-serif}
header{position:sticky;top:0;background:#111;padding:12px 20px;border-bottom:1px solid #333;z-index:5}
header a{color:#8ab4f8;margin-right:14px;text-decoration:none;font-variant-numeric:tabular-nums}
section{padding:28px 20px;border-bottom:1px solid #333;scroll-margin-top:56px}
h2{margin:0 0 4px;font-size:22px}
.meta{color:#9a978f;font-size:13px;margin-bottom:16px}
.split{display:grid;grid-template-columns:minmax(300px,1fr) minmax(340px,1.15fr);gap:24px;align-items:start}
.scan{background:#fff;border-radius:4px;overflow:hidden}
.scan img{width:100%;display:block}
.solimg{margin-top:12px}
table{border-collapse:collapse;background:#fff;color:#111}
td{width:46px;height:46px;border:1px solid #888;text-align:center;position:relative;font-size:19px;vertical-align:middle}
td.blk{background:#cfe0ec}
td i{position:absolute;top:1px;left:3px;font-size:10px;font-style:normal;color:#0b6}
td b{font-weight:500}
ul{list-style:none;margin:12px 0 0;padding:0;columns:1}
li{padding:2px 0;border-bottom:1px solid #2a2b2e}
.n{color:#8ab4f8;font-variant-numeric:tabular-nums}
.w{float:right;font-weight:700;color:#ffd479}
h3{margin:18px 0 0;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#9a978f}
.flag{background:#3a2a12;border-left:3px solid #e0a33e;padding:8px 12px;margin:12px 0;font-size:13px}
"""

def main():
    os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(os.path.join(PUZ, 'index.json'), encoding='utf-8'))
    only_new = '--all' not in sys.argv
    body, nav = [], []
    for entry in idx['puzzles']:
        pid, date = entry['id'], entry['date']
        day = int(date.split('-')[2])
        if only_new and day < 10:
            continue
        doc = json.load(open(os.path.join(PUZ, pid + '.json'), encoding='utf-8'))
        made, n1, n2 = crops(day, pid)
        rows, ac, dn = render(doc)
        note = doc.get('verificationNote', '')
        flag = ''
        if 'Print correction' in note:
            flag = '<div class="flag">%s</div>' % note.split('Print correction:')[1].strip()
        nav.append('<a href="#%s">%s</a>' % (pid, bn(day)))
        body.append("""
<section id="%s">
  <h2>%s আগস্ট ২০২৬</h2>
  <div class="meta">grid + clues: %s &nbsp;·&nbsp; solution: %s &nbsp;·&nbsp; %d entries</div>
  %s
  <div class="split">
    <div>
      <div class="scan"><img src="%s" alt="printed page"></div>
      <div class="scan solimg"><img src="%s" alt="printed solution"></div>
    </div>
    <div>
      <table>%s</table>
      <h3>বাঁ থেকে ডানে</h3><ul>%s</ul>
      <h3>ওপর থেকে নিচে</h3><ul>%s</ul>
    </div>
  </div>
</section>""" % (pid, bn(day), n1 or '—', n2 or '—', len(doc['entries']), flag,
                 made.get('page', ''), made.get('sol', ''), rows, ac, dn))

    html = ('<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">'
            '<title>শব্দভেদ — proof sheet</title><style>%s</style></head><body>'
            '<header><b>শব্দভেদ proof sheet</b> &nbsp; %s</header>%s</body></html>'
            % (CSS, ''.join(nav), ''.join(body)))
    p = os.path.join(OUT, 'index.html')
    open(p, 'w', encoding='utf-8').write(html)
    print('wrote', p)

if __name__ == '__main__':
    main()
