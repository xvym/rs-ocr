"""Capture the latest saved Excel selection without changing any workbook."""
from datetime import datetime
from check_excel_sync import HERE, ROOT, read_workbook, data_rows
import json, hashlib, shutil

source=max((ROOT/'outputs').rglob('*.xlsx'),key=lambda p:p.stat().st_mtime)
sheets=read_workbook(source)
documents={p:json.loads((HERE/(p+'.json')).read_text(encoding='utf-8')) for p in ('gba','ngc')}
for p,d in documents.items():
    rows=data_rows(sheets,p.upper()+'类型审阅')
    known={t['key']:t for t in d['region_types']+d.get('excluded_region_types',[])}
    assert len({r['P'] for r in rows})==len(rows)
    for r in rows:
        t=known[r['P']]
        assert t['review_id']==r['A']
        assert not r.get('J') and r['I']=='['+', '.join(map(str,t['logical_box']))+']','坐标变更须先核对，不能静默忽略'

tag=datetime.fromtimestamp(source.stat().st_mtime).strftime('%Y%m%d-%H%M%S')
archive=HERE/'archive'/('before-review-'+tag)
archive.mkdir(parents=True,exist_ok=True)
snapshot=archive/'用户筛选原件.xlsx'
if not snapshot.exists():shutil.copy2(source,snapshot)
digest=hashlib.sha256(source.read_bytes()).hexdigest()
assert digest==hashlib.sha256(snapshot.read_bytes()).hexdigest()
for name in ['gba.json','ngc.json','index.html','gba.html','ngc.html','build_catalog.py','finish_catalog.py','validation.json','review_selection.json','说明.txt']:
    if not (archive/name).exists():shutil.copy2(HERE/name,archive/name)
selection={'date':datetime.now().strftime('%Y-%m-%d'),
    'source_workbook':source.relative_to(ROOT).as_posix(),'source_sha256':digest,
    'source_modified_at':datetime.fromtimestamp(source.stat().st_mtime).astimezone().isoformat(),
    'snapshot':snapshot.relative_to(ROOT).as_posix(),'archive':archive.relative_to(HERE).as_posix(),
    'method':'以最新 Excel 类型审阅页实际保留的行确定范围；区域明细页仍含筛选前的全量行，按保留类型编号筛选后核对。最新 Excel 未列出的类型不沿用旧版追加项。原图仅存档，不自动加入审阅范围。',
    'platforms':{}}
for p,d in documents.items():
    rows=data_rows(sheets,p.upper()+'类型审阅');keep=[r['P'] for r in rows]
    image_rows=data_rows(sheets,p.upper()+'逐图审阅')
    known=d['region_types']+d.get('excluded_region_types',[])
    selected_ids={r['A'] for r in rows};detail=data_rows(sheets,p.upper()+'区域明细')
    selection['platforms'][p]={'retained_keys':keep,
        'excluded_keys':[t['key'] for t in known if t['key'] not in keep],
        'review_rows':rows,
        'image_reviews':{r['A']:{'status':r.get('B',''),'comment':r.get('C','')} for r in image_rows},
        'source_image_ids':[r['A'] for r in image_rows],
        'source_detail_rows':len(detail),
        'selected_detail_rows':sum(r['C'] in selected_ids for r in detail)}
(HERE/'review_selection.json').write_text(json.dumps(selection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Latest source:',source.name,'SHA256:',digest)
for p,s in selection['platforms'].items():print(p,len(s['retained_keys']),'types',s['selected_detail_rows'],'selected detail rows')
