"""Discovery-only bitmap consistency QA; not independent OCR accuracy evidence."""
from pathlib import Path
from collections import defaultdict,Counter
import json
import numpy as np
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
data=json.loads((HERE/'ground_truth.json').read_text(encoding='utf-8'))
cells=defaultdict(list)
for r in data['regions']:
    if r['platform']!='gba' or r['region_type'] not in ('field_dialog','battle_message'):continue
    frame=np.asarray(Image.open(ROOT/r['source']).convert('RGB'))[2::5,2::5]
    left=32 if r['region_type']=='field_dialog' else 16
    for row,line in enumerate(r['lines']):
        if len(line)>27:continue
        indent=8 if r['instance_id']=='GBA-137-R01' and row==1 else 0
        for col,ch in enumerate(line):
            x=left+indent+col*8;y=120+row*16
            tile=frame[y:y+16,x:x+8]
            if tile.shape!=(16,8,3):continue
            mask=tile.max(axis=2)<130 if r['region_type']=='field_dialog' else tile.min(axis=2)>210
            cells[np.packbits(mask).tobytes()].append((r['instance_id'],row,col,ch))
out=[];templates=[]
for bitmap,items in cells.items():
    counts=Counter('へ' if i[3]=='ヘ' else i[3] for i in items)
    dominant=counts.most_common(1)[0][0]
    templates.append((np.unpackbits(np.frombuffer(bitmap,dtype=np.uint8)).reshape(16,8).astype(bool),dominant))
    if len(counts)>1 and len(items)>=3:
        out.append({'counts':dict(counts),'items':items,'bitmap':list(bitmap)})
out.sort(key=lambda c:-sum(c['counts'].values()))
report={'note':'Discovery QA only, GBA field/battle text only. Templates are learned from screenshot transcriptions, not an independent answer source. No automatic text corrections or accuracy claim. NGC excluded because its viewport is not pixel calibrated. Layout indent in GBA-137 line 2 is ignored; same bitmap for katakana/hiragana HE is allowed only for this QA.','gba_cells':sum(map(len,cells.values())),'unique_bitmaps':len(cells),'gba_conflicts':out}
(HERE/'glyph-consistency.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'cells':report['gba_cells'],'gba_conflicts':len(out)},ensure_ascii=True,indent=2))
