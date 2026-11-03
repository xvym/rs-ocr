"""Strip audited panel geometry to desktop-only presentation metadata."""
from pathlib import Path
import hashlib,json,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'reports/textbox-features/features.json'
data=json.loads(source.read_text(encoding='utf-8'))
runtime=json.loads((ROOT/'src/main/resources/ocr/regions.json').read_text(encoding='utf-8'))
profiles=[]
for p in data['profiles']:
    variants=[]
    for v in p['variants']:
        variants.append({k:v[k] for k in ('id','detection_roi','window_allocation_box','panel_body_or_contour_box')})
    expanded=next((v for v in variants if v['id']=='summary_battle_expanded'),None)
    if expanded:variants.append(dict(expanded,id='summary_battle_expanded_selection'))
    profiles.append(dict(key=p['key'],name=p['name'],order=data['visibility_model']['audit_composition_order'].get(p['key'],0),variants=variants))
out=ROOT/'desktop/src/main/resources/presentation.json';out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(dict(source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),profiles=profiles),ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
sys.path.insert(0,str(ROOT/'reports/textbox-features'))
from rom_assets import reference_rom,load_roms,locate_equivalent,decode_tiles
reference=reference_rom();offset=0x67D000
raw=reference['streams'][offset][0]
tiles=decode_tiles(raw)
mask=(np.concatenate((tiles[1],tiles[2]),axis=0)==9)
rows=[sum(int(v)<<(7-x) for x,v in enumerate(row)) for row in mask]
evidence=[]
for game,rom in load_roms().items():
    located=locate_equivalent(reference,rom,offset)
    assert rom['streams'][located][0]==raw
    evidence.append(dict(game=game,rom_sha256=rom['sha256'],stream_offset=hex(located),decoded_sha256=hashlib.sha256(raw).hexdigest(),tiles=[1,2],foreground_index=9))
(out.parent/'cursors.json').write_text(json.dumps(dict(battle_arrow=rows,evidence=evidence),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert {p['key'] for p in profiles}=={p['key'] for p in runtime['profiles']}
print('51 presentation profiles; no screenshot identities or answers')
