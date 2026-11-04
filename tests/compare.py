"""Compare tests/out/*.png with tests/baseline/*.png and report how much of each screenshot changed.
   python3 tests/compare.py            (diff images for changed shots go to tests/out/diff-*.png)"""
import sys
from pathlib import Path
from PIL import Image, ImageChops

here = Path(__file__).parent
worst = 0.0
for b in sorted((here / 'baseline').glob('*.png')):
    o = here / 'out' / b.name
    if not o.exists():
        print(f'MISSING  {b.name}'); worst = 100; continue
    A, B = Image.open(b).convert('RGB'), Image.open(o).convert('RGB')
    if A.size != B.size:
        print(f'SIZE     {b.name}  {A.size} -> {B.size}'); worst = max(worst, 100)
        w, h = min(A.width, B.width), min(A.height, B.height); A, B = A.crop((0, 0, w, h)), B.crop((0, 0, w, h))
    d = ImageChops.difference(A, B).convert('L').point(lambda v: 255 if v > 24 else 0)
    pct = 100 * sum(d.histogram()[255:]) / (d.width * d.height)
    worst = max(worst, pct)
    print(f"{'SAME ' if pct < 0.05 else 'DIFF '}    {b.name}  {pct:.2f}% of pixels changed")
    if pct >= 0.05:
        bbox = d.getbbox(); Image.composite(Image.new('RGB', B.size, (255, 0, 0)), B, d).save(here / 'out' / f'diff-{b.name}')
        print(f'         changed area {bbox}')
sys.exit(0 if worst < 0.05 else 1)
