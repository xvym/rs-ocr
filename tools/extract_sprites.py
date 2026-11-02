"""Extract native Japanese type badges and bag captions as pixel OCR templates.

These are precomposed game glyphs, not a dictionary of screenshot answers.
All pixels and the category tile map are read from both pinned Japanese ROMs.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'reports/textbox-features'))
from rom_assets import reference_rom, load_roms, decode_tiles, locate_equivalent, palette555, static_families


def strings(mask):return [''.join('1' if v else '0' for v in row) for row in mask]


def main():
    ref=reference_rom();roms=load_roms();evidence={}
    def asset(name,offset,size=None):
        offsets={game:f'0x{locate_equivalent(ref,rom,offset,size):06X}' for game,rom in roms.items()}
        raw=ref['streams'][offset][0] if offset in ref['streams'] else ref['data'][offset:offset+size]
        evidence[name]=dict(offsets=offsets,decoded_sha256=hashlib.sha256(raw).hexdigest(),decoded_bytes=len(raw))
        return raw

    types=['ノーマル','かくとう','ひこう','どく','じめん','いわ','むし','ゴースト','はがね','？？？',
           'ほのお','みず','くさ','でんき','エスパー','こおり','ドラゴン','あく',
           'かっこよさ','うつくしさ','かわいさ','かしこさ','たくましさ']
    tiles=decode_tiles(asset('type_badges',0x7EE9C8))
    badges=[]
    for i,text in enumerate(types):
        pixels=tiles[i*8:i*8+8].reshape(2,4,8,8).transpose(0,2,1,3).reshape(16,32)
        valid=pixels!=0
        # The highlighted border has palette-dependent whites; only the
        # interior containing the actual label participates in text matching.
        valid[:3]=False;valid[13:]=False;valid[:,0]=False;valid[:,-1]=False
        badges.append(dict(text=text,mask=strings(pixels==15),valid=strings(valid)))

    tiles=decode_tiles(asset('bag_graphics',0x7F2134))
    mapping=asset('bag_category_u8_top_tile_map',0x397A9C,40)
    # In the Japanese renderer the lower half is the top tile index + 16.
    family=static_families(ref)['bag_female'];_,pal=palette555(family['palette'])
    asset('bag_palette_female',family['offsets']['palette'])
    captions=[]
    for i,text in enumerate(['どうぐ','モンスターボール','わざマシン','きのみ','たいせつなもの']):
        top=np.array(list(mapping[i*8:i*8+8]))
        indices=np.concatenate([tiles[top],tiles[top+16]]).reshape(2,8,8,8).transpose(0,2,1,3).reshape(16,64)
        mask=pal[indices].max(axis=2)<130
        captions.append(dict(text=text,mask=strings(mask),valid=strings(np.ones_like(mask))))
    padded=np.pad(tiles,((0,(-len(tiles))%16),(0,0),(0,0)))
    sheet=padded.reshape(-1,16,8,8).transpose(0,2,1,3).reshape(-1,128)
    sel_mask=pal[sheet[44:51,85:93]].max(axis=2)<130
    groups=[dict(id='types',color='light',templates=badges),dict(id='bag',color='dark',templates=captions),
        dict(id='sel',color='dark',templates=[dict(text='SEL',mask=strings(sel_mask),valid=strings(np.ones_like(sel_mask)))])]
    out=ROOT/'src/main/resources/ocr/sprites.json'
    out.write_text(json.dumps(dict(schema_version=1,groups=groups),ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    report=dict(assets=evidence,type_labels=types,bag_labels=[c['text'] for c in captions],
        resource_sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
        method='Visual readings of decoded Japanese ROM graphics, pending independent review; no screenshot pixels or transcriptions in templates.')
    (ROOT/'reports/ocr-development/sprite-extraction.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{len(badges)} badges and {len(captions)} bag captions')


if __name__=='__main__':main()
