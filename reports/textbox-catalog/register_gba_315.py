"""Register the visually reviewed 22:45:03 screenshot and its scope updates."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,shutil
HERE=Path(__file__).resolve().parent;ROOT=HERE.parent.parent
archive=HERE/'archive/before-gba-315-20261101-224503';archive.mkdir(exist_ok=True)
for name in ['gba.json','ngc.json','review_selection.json','inventory.json','validation.json']:
    if not (archive/name).exists():shutil.copy2(HERE/name,archive/name)
source='gba_testcase/Screenshot 2026-11-01 22-45-03.png';size=list(Image.open(ROOT/source).size)
assert size==[1200,800]
file=HERE/'inventory.json';records=json.loads(file.read_text(encoding='utf-8'))
if not any(r['source']==source for r in records):
    assert not any(r['id']=='GBA-315' for r in records)
    insert=max(i for i,r in enumerate(records) if r['platform']=='gba')+1
    records.insert(insert,{'id':'GBA-315','platform':'gba','source':source,'size':size})
file.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
file=HERE/'review_selection.json';selection=json.loads(file.read_text(encoding='utf-8'));scope=selection['platforms']['gba']
meta=next(a for a in scope['additional_types'] if a['key']=='battle_move_meta')
meta.update(review_status='未审阅',sample_status='gba_sample_present',logical_box_provisional=False,reference_platform='gba',reference_image_id='GBA-315',initial_reference_image_id='NGC-116',note='已由新增 GBA-315 实图确认：右下招式信息显示 PP 4/5 与 わざタイプ／ノーマル。现有坐标为本张 GBA 画面的人工近似外接框。')
addition={'key':'battle_moves','review_id':'GBA-T074','review_status':'未审阅','sample_status':'gba_sample_present','logical_box_provisional':False,'reference_platform':'gba','reference_image_id':'GBA-315','note':'新增 GBA-315 补齐左下四招式选择菜单；两列两行，选择箭头指向「あさのひざし」。与红底战斗消息、四项行动菜单及摘要招式页分别建档。'}
if not any(a['key']==addition['key'] for a in scope['additional_types']):scope['additional_types'].append(addition)
updates=selection.setdefault('sample_updates',[])
if not any(a.get('image_id')=='GBA-315' for a in updates):
    updates.append({'date':'2026-11-01','image_id':'GBA-315','source':source,'confirmed_type':'battle_move_meta','additional_missing_type':'battle_moves','kept_excluded_types':['battle_enemy','battle_own'],'manual_visible_text':{'battle_moves':['あさのひざし　すいとる','かぜおこし　しびれごな'],'battle_move_meta':['PP　4/5','わざタイプ／ノーマル']},'selected_move':'あさのひざし','coordinate_method':'原图除以 5，按可见框目视近似定位。'})
file.write_text(json.dumps(selection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
gba=[r for r in records if r['platform']=='gba'];canvas=Image.new('RGB',(1200,1120),'#eee');draw=ImageDraw.Draw(canvas)
for j,r in enumerate(gba[300:320]):
    im=Image.open(ROOT/r['source']).resize((300,200));x=j%4*300;y=j//4*224
    canvas.paste(im,(x,y));draw.text((x+4,y+201),r['id']+' '+Path(r['source']).stem.replace('Screenshot 2026-',''),fill='black')
canvas.save(HERE/'sheets/gba-16.jpg',quality=92)
print('GBA-315 registered; GBA-T073 confirmed, GBA-T074 added; prior exclusions retained.')
