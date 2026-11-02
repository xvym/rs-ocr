from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
(out/'images').mkdir(exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',13)
result={}
for p in ['gba','ngc']:
    d=json.loads((root/'reports/textbox-catalog'/f'{p}.json').read_text(encoding='utf-8'))
    items=[]
    for n,t in enumerate(d['region_types'],1):
        candidates=[(r,v) for r in d['images'] for v in r['regions'] if v['type']==t['key']]
        if not candidates:
            items.append({'id':t['review_id'],'key':t['key'],'representative':'','source':'','actual_box':t['logical_box'],'text_state':'missing_gba_sample','occluded_by':[],'missingSample':True})
            continue
        r,v=next(((r,v) for r,v in candidates if r['id']==t.get('representative_image_id')),next(((r,v) for r,v in candidates if v['text_state']=='visible' and not v['occluded_by']),candidates[0]))
        id=t.get('review_id',f'{p.upper()}-T{n:03}')
        original=Image.open(root/r['source']).convert('RGB')
        x,y,w,h=r['viewport_original'];game=original.crop((x,y,x+w,y+h)).resize((348,232))
        draw=ImageDraw.Draw(game)
        a,b,c,e=v['logical_box'];draw.rectangle((a*348/240,b*232/160,(a+c)*348/240-1,(b+e)*232/160-1),outline='#ff4422',width=3)
        canvas=Image.new('RGB',(348,252),'#eef2f6');canvas.paste(game,(0,20));ImageDraw.Draw(canvas).text((4,2),id+' / '+r['id'],font=font,fill='#183447')
        context=out/'images'/f'{id}-context.png';canvas.save(context)
        x,y,w,h=v['original_box'];crop=original.crop((x,y,x+w,y+h));crop.thumbnail((250,218))
        canvas=Image.new('RGB',(260,252),'#eef2f6');canvas.paste(crop,((260-crop.width)//2,25+(218-crop.height)//2));ImageDraw.Draw(canvas).text((4,2),id+' / '+r['id'],font=font,fill='#183447')
        cropfile=out/'images'/f'{id}-crop.png';canvas.save(cropfile)
        items.append({'id':id,'key':t['key'],'representative':r['id'],'source':r['source'],'actual_box':v['logical_box'],'text_state':v['text_state'],'occluded_by':v['occluded_by'],'context':str(context),'crop':str(cropfile)})
    result[p]=items
(out/'review_images.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(sum(len(v) for v in result.values()),'type rows prepared; original type IDs preserved.')
