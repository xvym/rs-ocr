"""Extract precomposed UI labels from Japanese ROM graphics, not screenshots.

Label text is a development visual reading of the decoded ROM asset. It is
kept separate from running text and must be reviewed with the glyph mapping.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'reports/textbox-features'))
from rom_assets import reference_rom, load_roms, static_families, palette555, locate_equivalent, decode_tiles


def main():
    ref=reference_rom();families=static_families(ref);roms=load_roms()
    definitions={
        'personal':('summary_info','パーソナル',[88,24,56,8]),
        'ability':('summary_info','とくせい',[88,64,40,8]),
        'memo':('summary_info','トレーナーメモ',[88,104,64,8]),
        'item':('summary_skills','もちもの',[88,24,40,8]),
        'ribbon':('summary_skills','リボン',[168,24,32,8]),
        'stats':('summary_skills','のうりょく',[88,48,48,8]),
        'experience':('summary_skills','けいけんち',[88,104,48,8]),
        'exp':('summary_skills','EXP',[152,144,16,8]),
        'moves_battle':('summary_battle','おぼえているわざ',[88,24,88,8]),
        'moves_contest':('summary_contest','おぼえているわざ',[88,24,88,8]),
        'description_battle':('summary_battle','せつめい',[88,112,48,8]),
        'description_contest':('summary_contest','せつめい',[88,112,48,8]),
        'effect':('summary_contest','こうか',[16,112,48,8]),
        'condition_title':('condition_title','コンディション',[16,8,64,16]),
        'cancel':('party_cancel','もどる',[200,144,32,16]),
        'cancel_selected':('party_cancel_selected','もどる',[200,144,32,16]),
        'smoothness':('pokeblock','なめらかさ',[56,136,32,16]),
        'condition_cool':('condition','かっこよさ',[143,36,26,9]),
        'condition_tough':('condition','たくましさ',[100,58,28,9]),
        'condition_beauty':('condition','うつくしさ',[184,58,26,9]),
        'condition_smart':('condition','かしこさ',[113,117,23,9]),
        'condition_cute':('condition','かわいさ',[175,117,27,9]),
    }
    result=[];evidence={}
    for key,(family,text,rect) in definitions.items():
        asset=families[family];_,pal=palette555(asset['palette']);rgb=pal[asset['indices']]
        x,y,w,h=rect;crop=rgb[y:y+h,x:x+w].astype(int)
        mode='orange' if key=='exp' else 'dark' if key=='smoothness' or key in ('condition_cool','condition_tough','condition_beauty','condition_smart','condition_cute') else 'light'
        mask=(crop[:,:,0]>140)&(crop[:,:,1]>100)&(crop[:,:,2]<100) if mode=='orange' else crop.max(axis=2)<130 if mode=='dark' else crop.min(axis=2)>180
        if not mask.any():raise ValueError(f'Empty label mask: {key}')
        result.append(dict(id=key,text=text,box=rect,color=mode,mask=[''.join('1' if v else '0' for v in row) for row in mask]))
        if family not in evidence:
            offsets={}
            for role,off in asset['offsets'].items():
                size=24 if role=='tilemap' and family.startswith('party_cancel') else 32
                raw=ref['streams'][off][0] if off in ref['streams'] else ref['data'][off:off+size]
                offsets[role]={game:f'0x{locate_equivalent(ref,rom,off,len(raw)):06X}' for game,rom in roms.items()}
            evidence[family]=dict(offsets=offsets)
    # FEEL is a precomposed 32x16 OBJ, not font 4. The native sprite table
    # points to this uncompressed block; only its 15x7 caption is sampled.
    feel_offset=0x3BAF90
    assert int.from_bytes(ref['data'][0x3BBFA8:0x3BBFAC],'little')==0x08000000+feel_offset
    feel_raw=ref['data'][feel_offset:feel_offset+256]
    feel=decode_tiles(feel_raw).reshape(2,4,8,8).transpose(0,2,1,3).reshape(16,32)
    feel_mask=feel[4:11,4:19]==2
    result.append(dict(id='condition_feel',text='FEEL',box=[218,124,15,7],color='light',
        mask=[''.join('1' if v else '0' for v in row) for row in feel_mask]))
    evidence['condition_feel']=dict(
        offsets={'gfx':{game:f'0x{locate_equivalent(ref,rom,feel_offset,256):06X}' for game,rom in roms.items()}},
        decoded_bytes=256,decoded_sha256=hashlib.sha256(feel_raw).hexdigest(),
        native_sprite_table_pointer='AXVJ:0x3BBFA8',tile_sheet=[32,16],
        caption_box_in_sheet=[4,4,15,7],foreground_palette_index=2)
    # A description panel alone resembles other white windows. The stable
    # right-hand part of the berry page header supplies independent context.
    berry=families['berry'];_,pal=palette555(berry['palette'])
    # The header is a separately drawn BG layer, not the panel's blank top
    # tilemap rows: native tile 68, palette bank 4, repeated horizontally.
    tiles=decode_tiles(ref['streams'][berry['offsets']['gfx']][0])
    pattern=np.tile(tiles[68]+64,(1,15))
    runs=[]
    for y in range(8,16):
        for x in range(112,232):runs.append([y,x,x+1,int(pattern[y-8,x-112])])
    context=dict(id='berry_header',detection_roi=[112,8,120,8],
        palette=[dict(index=i,rgb888=c.tolist()) for i,c in enumerate(pal)],fixed_runs=runs)
    evidence['berry']={role:{game:f'0x{locate_equivalent(ref,rom,off):06X}' for game,rom in roms.items()}
        for role,off in berry['offsets'].items()}
    out=ROOT/'src/main/resources/ocr/labels.json'
    out.write_text(json.dumps(dict(schema_version=1,labels=result,contexts=[context]),ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    report=dict(label_count=len(result),assets=evidence,resource_sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
        method='Visual readings of native ROM bitmap labels; templates decoded only from the pinned Japanese ROM. No screenshot transcriptions used; independent review pending.')
    (ROOT/'reports/ocr-development/label-extraction.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{len(result)} ROM label masks')


if __name__=='__main__':main()
