"""Record the user's explicit GBA scope addition without inventing a screenshot."""
from pathlib import Path
import json,shutil
HERE=Path(__file__).resolve().parent
archive=HERE/'archive/before-gba-move-info-restore';archive.mkdir(exist_ok=True)
for name in ['gba.json','ngc.json','review_selection.json','validation.json']:
    if not (archive/name).exists():shutil.copy2(HERE/name,archive/name)
file=HERE/'review_selection.json';selection=json.loads(file.read_text(encoding='utf-8'))
addition={'key':'battle_move_meta','review_id':'GBA-T073','review_status':'待确认','sample_status':'missing_gba_sample','logical_box_provisional':True,'reference_platform':'ngc','reference_image_id':'NGC-116','note':'按用户要求加入 GBA 保留范围。现有 GBA 截图未见此区域，待补 GBA 样本；坐标仅参考 NGC-116，未在 GBA 验证。'}
scope=selection['platforms']['gba'];extras=scope.setdefault('additional_types',[])
if not any(a['key']==addition['key'] for a in extras):extras.append(addition)
updates=selection.setdefault('scope_updates',[])
if not any(a.get('key')==addition['key'] and a.get('platform')=='gba' for a in updates):
    updates.append({'date':'2026-11-01','platform':'gba','key':'battle_move_meta','action':'restore_to_retained_scope','user_instruction':'GBA的页面里误把战斗右下招式信息删掉了，把这项重新加回来','evidence':'原始 GBA 72 类及 314 张截图无该布局记录；NGC-116 有此项，因此作为待补样本的 GBA 类型加入，不添加虚构区域实例。'})
file.write_text(json.dumps(selection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('GBA battle_move_meta added to scope; no GBA sample invented.')
