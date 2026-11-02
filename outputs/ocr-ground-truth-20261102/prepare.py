"""Prepare scoped, source-linked review crops; no text inference."""
from pathlib import Path
import json, hashlib
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FEATURES = json.loads((ROOT/'reports/textbox-features/features.json').read_text(encoding='utf-8'))
PROFILES = {p['key']: p for p in FEATURES['profiles']}
FONT = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 16)

def variant(key):
    p = PROFILES[key]
    return next((v for v in p['variants'] if v['id']==p['display_variant_id']), p['variants'][0])

def subtract(rect, cover):
    x,y,w,h=rect; a,b,c,d=cover
    l,t,r,s=max(x,a),max(y,b),min(x+w,a+c),min(y+h,b+d)
    if l>=r or t>=s: return [rect]
    out=[]
    if t>y: out.append([x,y,w,t-y])
    if s<y+h: out.append([x,s,w,y+h-s])
    if l>x: out.append([x,t,l-x,s-t])
    if r<x+w: out.append([r,t,x+w-r,s-t])
    return out

def prepare():
    (HERE/'crops').mkdir(parents=True,exist_ok=True)
    (HERE/'sheets').mkdir(exist_ok=True)
    rows=[]; images=[]
    for platform in ('gba','ngc'):
        catalog=json.loads((ROOT/f'reports/textbox-catalog/{platform}.json').read_text(encoding='utf-8'))
        for im in catalog['images']:
            images.append({k:im[k] for k in ('id','source','sha256','size','viewport_original','in_current_scope','scope_note')})
            source=Image.open(ROOT/im['source']).convert('RGB')
            assert hashlib.sha256((ROOT/im['source']).read_bytes()).hexdigest()==im['sha256']
            vx,vy,vw,vh=im['viewport_original']
            # Sampling is for the review aid only; originals remain the evidence.
            xs=np.clip((vx+(np.arange(240)+.5)*vw/240).astype(int),0,source.width-1)
            ys=np.clip((vy+(np.arange(160)+.5)*vh/160).astype(int),0,source.height-1)
            logical=Image.fromarray(np.asarray(source)[ys[:,None],xs[None,:]])
            all_regions=im['regions']+im.get('excluded_regions',[])
            for reg in im['regions']:
                key=reg['type']; native=variant(key)
                roi=native['detection_roi'][:]
                # Preserve larger observed (expanded move list) states.
                if key in ('summary_battle_moves','summary_contest_moves') and reg['logical_box'][3]>roi[3]:
                    roi[3]=min(160-roi[1],reg['logical_box'][1]+reg['logical_box'][3]-roi[1])
                visible=[roi]
                occluders=reg.get('occluded_by',[])[:]
                # The old catalog omitted these two real overlay relationships.
                if key=='condition_graph' and any(r['type']=='condition_message' for r in all_regions):
                    if 'condition_message' not in occluders: occluders.append('condition_message')
                for occluder in occluders:
                    other=next((r for r in all_regions if r['type']==occluder),None)
                    if not other: continue
                    cover=variant(occluder)['detection_roi'] if occluder in PROFILES else other['logical_box']
                    if occluder=='condition_choice': cover=[184,80,56,48]
                    visible=[piece for rect in visible for piece in subtract(rect,cover)]
                invisible=im['id'] in ('GBA-201','GBA-229') and key=='party_prompt'
                if invisible: visible=[]
                x,y,w,h=roi
                crop=logical.crop((x,y,x+w,y+h))
                mask=Image.new('1',(w,h)); draw=ImageDraw.Draw(mask)
                for a,b,c,d in visible: draw.rectangle((a-x,b-y,a+c-x-1,b+d-y-1),fill=1)
                crop=Image.composite(crop,Image.new('RGB',(w,h),(190,190,190)),mask)
                crop.save(HERE/'crops'/f"{reg['instance_id']}.png")
                row=dict(instance_id=reg['instance_id'],image_id=im['id'],platform=platform,source=im['source'],source_sha256=im['sha256'],region_type=key,region_name=PROFILES[key]['name'],catalog_logical_box=reg['logical_box'],catalog_original_box=reg['original_box'],logical_box=roi,original_box=[round(vx+x*vw/240,3),round(vy+y*vh/160,3),round(w*vw/240,3),round(h*vh/160,3)],visible_logical_rectangles=visible,occluded_by=occluders,status='not_visible' if invisible else 'pending',crop=f"crops/{reg['instance_id']}.png",crop_sha256=hashlib.sha256(crop.tobytes()).hexdigest(),lines=[])
                rows.append(row)
    # Exact sampled-crop reuse is explicit; never deduplicate by inferred text.
    seen={}; unique=[]
    for row in rows:
        token=(row['region_type'],row['logical_box'][2],row['logical_box'][3],row['crop_sha256'])
        if row['status']=='not_visible': continue
        if token in seen: row['duplicate_of']=seen[token]
        else: seen[token]=row['instance_id']; unique.append(row)
    groups=[('dialog',[r for r in unique if r['region_type'] in ('field_dialog','battle_message','blender_message','boot_dialog')]),('panel',[r for r in unique if r['region_type'] not in ('field_dialog','battle_message','blender_message','boot_dialog')])]
    sheets=[]
    for kind,group in groups:
        batch_size=24 if kind=='dialog' else 12
        for start in range(0,len(group),batch_size):
            batch=group[start:start+batch_size]; positions=[]; top=0
            for k in range(0,len(batch),2):
                pair=batch[k:k+2]
                height=max(r['logical_box'][3]*3 for r in pair)+30
                for col,row in enumerate(pair): positions.append((row,col*730,top))
                top+=height
            sheet=Image.new('RGB',(1460,top),'white'); draw=ImageDraw.Draw(sheet)
            for row,x,y in positions:
                draw.text((x+4,y+3),f"{row['instance_id']} {row['region_type']}",font=FONT,fill='black')
                crop=Image.open(HERE/row['crop']); crop=crop.resize((crop.width*3,crop.height*3),Image.Resampling.NEAREST)
                sheet.paste(crop,(x,y+25))
            name=f'{kind}-{start//batch_size+1:02d}.png'; sheet.save(HERE/'sheets'/name)
            sheets.append({'file':f'sheets/{name}','regions':[r['instance_id'] for r in batch]})
    (HERE/'manifest.json').write_text(json.dumps({'images':images,'regions':rows,'sheets':sheets},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'regions':len(rows),'unique_to_read':len(unique),'not_visible':2,'sheets':[(s['file'],len(s['regions'])) for s in sheets]},ensure_ascii=False))

if __name__=='__main__': prepare()
