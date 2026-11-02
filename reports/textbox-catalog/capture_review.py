"""Capture the user's saved row selection without changing the source workbook."""
from pathlib import Path
from zipfile import ZipFile
from datetime import datetime
import xml.etree.ElementTree as ET
import json, hashlib, posixpath, shutil, sys
sys.stdout.reconfigure(encoding='utf-8')
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
source=ROOT/'outputs/textbox-review-20261101/文本框分类审阅.xlsx'
tag=datetime.fromtimestamp(source.stat().st_mtime).strftime('%Y%m%d-%H%M%S')
archive=HERE/'archive'/('before-review-'+tag);archive.mkdir(parents=True,exist_ok=True)
snapshot=archive/'用户筛选原件.xlsx'
if not snapshot.exists():snapshot.write_bytes(source.read_bytes())
assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(snapshot.read_bytes()).digest()
for name in ['gba.json','ngc.json','index.html','gba.html','ngc.html','build_catalog.py','finish_catalog.py','validation.json']:
    if not (archive/name).exists():shutil.copy2(HERE/name,archive/name)
n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
selection={'date':'2026-11-01','source_workbook':source.relative_to(ROOT).as_posix(),'source_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'snapshot':snapshot.relative_to(ROOT).as_posix(),'archive':archive.relative_to(HERE).as_posix(),'method':'以用户在类型审阅页实际保留/删除的行确定本轮范围；没有筛选器条件或隐藏行。删除不等于界面不存在，保留不等于审阅通过。','platforms':{}}
with ZipFile(snapshot) as z:
    strings=[''.join(s.itertext()) for s in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    rel={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    def value(c):
        v=c.find('s:v',n)
        if c.attrib.get('t')=='s':return strings[int(v.text)] if v is not None else ''
        if c.attrib.get('t')=='inlineStr':return ''.join(c.find('s:is',n).itertext())
        return v.text if v is not None else ''
    for s in wb.find('s:sheets',n):
        name=s.attrib['name'];target=rel[s.attrib['{'+n['r']+'}id']]
        part=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
        rows=[]
        for r in ET.fromstring(z.read(part)).findall('s:sheetData/s:row',n):
            if int(r.attrib['r'])<7:continue
            cells={''.join(v for v in c.attrib['r'] if v.isalpha()):value(c) for c in r}
            if cells.get('A'):rows.append(cells)
        if name.endswith('类型审阅'):
            p=name[:3].lower();before=json.loads((archive/(p+'.json')).read_text(encoding='utf-8'))
            keep=[r['P'] for r in rows]
            assert len(set(keep))==len(keep) and set(keep)<={d['key'] for d in before['region_types']}
            selection['platforms'][p]={'retained_keys':keep,'excluded_keys':[t['key'] for t in before['region_types'] if t['key'] not in keep],'review_rows':rows,'image_reviews':{}}
        elif name.endswith('逐图审阅'):
            p=name[:3].lower()
            selection['platforms'][p]['image_reviews']={r['A']:{'status':r.get('B',''),'comment':r.get('C','')} for r in rows}
(HERE/'review_selection.json').write_text(json.dumps(selection,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Snapshot:',snapshot)
for p,v in selection['platforms'].items():print(p,'kept',len(v['retained_keys']),'excluded',len(v['excluded_keys']))
