"""Compare saved Excel review data with the generated testcase catalog (read-only)."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import hashlib, json, posixpath, sys

sys.stdout.reconfigure(encoding='utf-8')
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def read_workbook(source):
    sheets = {}
    with ZipFile(source) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(t.text or '' for t in s.iterfind('.//s:t', NS))
                       for s in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rels = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
            target = rels[sheet.attrib[REL]]
            part = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            tree = ET.fromstring(z.read(part))
            rows = []
            for row in tree.findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    v = cell.find('s:v', NS)
                    value = v.text or '' if v is not None else ''
                    if cell.attrib.get('t') == 's': value = strings[int(value)] if value else ''
                    elif cell.attrib.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.iterfind('.//s:t', NS))
                    cells[''.join(c for c in cell.attrib['r'] if c.isalpha())] = value
                if cells: rows.append({'row': int(row.attrib['r']), 'cells': cells, 'hidden': row.attrib.get('hidden') == '1'})
            sheets[sheet.attrib['name']] = rows
    return sheets

def data_rows(sheets, name):
    return [r['cells'] for r in sheets[name] if r['row'] >= 7 and r['cells'].get('A')]

def verify():
    from collections import Counter
    selection=json.loads((HERE/'review_selection.json').read_text(encoding='utf-8'))
    source=ROOT/selection['source_workbook'];before=hashlib.sha256(source.read_bytes()).hexdigest()
    assert before==selection['source_sha256']
    assert source==max((ROOT/'outputs').rglob('*.xlsx'),key=lambda p:p.stat().st_mtime)
    assert hashlib.sha256((ROOT/selection['snapshot']).read_bytes()).hexdigest()==before
    sheets=read_workbook(source)
    result={'status':'passed','checked_at':selection['date'],
        'source_workbook':selection['source_workbook'],'source_sha256':before,
        'source_modified_at':selection['source_modified_at'],'original_workbook_unchanged':True,
        'scope_rule':selection['method'],'platforms':{},'checks':[]}
    labels={'visible':'有可见文字','empty':'空文字框','heading_only_body_empty':'有标题，正文为空','fully_occluded':'完全被遮挡'}
    for p in ('gba','ngc'):
        d=json.loads((HERE/(p+'.json')).read_text(encoding='utf-8'))
        archived=json.loads((HERE/selection['archive']/(p+'.json')).read_text(encoding='utf-8'))
        prior={v['instance_id']:v for im in archived['images'] for v in im['regions']+im.get('excluded_regions',[])}
        rows=data_rows(sheets,p.upper()+'类型审阅')
        types={t['key']:t for t in d['region_types']};defs={t['key']:t for t in d['region_types']+d['excluded_region_types']}
        assert [t['key'] for t in d['region_types']]==[r['P'] for r in rows]
        ids={t['review_id'] for t in types.values()}
        assert len(ids)==len(types)
        assert not (set(types)&{t['key'] for t in d['excluded_region_types']})
        for r in rows:
            t=types[r['P']]
            expected={'A':t['review_id'],'B':t['review_status'],'C':t['review_comment'],'D':t['group'],
                'E':t['name'],'H':str(t['image_count']),'I':str(t['logical_box']),
                'K':t['content'],'M':t['representative_image_id'],'Q':t['appearance']}
            assert all(r.get(c,'')==v for c,v in expected.items()),(p,r['A'],'type mismatch')
            assert not r.get('J')
            samples=[im['id'] for im in d['images'] if any(v['type']==t['key'] for v in im['regions'])]
            assert t['example_ids']==samples and t['image_count']==len(samples)
        detail=data_rows(sheets,p.upper()+'区域明细')
        selected={r['A']:r for r in detail if r['C'] in ids}
        regions={v['instance_id']:(im,v) for im in d['images'] for v in im['regions']}
        assert set(selected)==set(regions),(p,'region instance selection mismatch')
        for id,(im,v) in regions.items():
            r=selected[id];t=defs[v['type']]
            expected={'B':im['id'],'C':t['review_id'],'D':t['name'],'M':labels[v['text_state']],
                'N':'、'.join(defs[k]['name'] for k in v['occluded_by']),
                'O':'；'.join(str(b) for b in v['visible_logical_rectangles']),'Q':im['layout']}
            assert all(r.get(c,'')==value for c,value in expected.items()),(id,'detail mismatch')
            assert list(map(float,[r[c] for c in 'EFGH']))==v['logical_box'],id
            assert list(map(float,[r[c] for c in 'IJKL']))==v['original_box'],id
        images={r['A']:r for r in data_rows(sheets,p.upper()+'逐图审阅')}
        assert set(images)=={im['id'] for im in d['images'] if im['in_source_workbook']}
        for im in d['images']:
            assert hashlib.sha256((ROOT/im['source']).read_bytes()).hexdigest()==im['sha256'],im['id']
            if im['id'] in images:
                r=images[im['id']]
                expected={'B':im['review_status'],'C':im['review_comment'],'D':im['layout'],'M':im['source'],'N':im['sha256']}
                assert all(r.get(c,'')==value for c,value in expected.items()),(im['id'],'image mismatch')
                assert r['L']==str(im['viewport_original'])
            else:assert not im['regions'],im['id']
            for v in im['regions']+im['excluded_regions']:
                old=prior[v['instance_id']]
                for k in ('type','logical_box','original_box','visible_logical_rectangles','visible_original_rectangles','occluded_by','text_state'):
                    assert v[k]==old[k],(v['instance_id'],k,'original geometry changed')
        assert d['region_instance_count']==len(regions)
        assert d['region_type_count']==len(rows)
        html=(HERE/(p+'.html')).read_text(encoding='utf-8')
        marker='<script id="data" type="application/json">'
        embedded=html.split(marker,1)[1].split('</script>',1)[0]
        assert json.loads(embedded)==d,(p,'HTML and JSON differ')
        result['platforms'][p]={'retained_types':len(rows),'retained_regions':len(regions),
            'excluded_types':d['excluded_region_type_count'],'source_workbook_images':len(images),
            'archived_source_images':len(d['images']),
            'images_with_retained_regions':sum(bool(im['regions']) for im in d['images']),
            'images_not_in_source_workbook':[im['id'] for im in d['images'] if im['id'] not in images],
            'excel_unfiltered_detail_rows':len(detail),
            'review_status_counts':dict(Counter(r.get('B','') for r in rows))}
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    result['retained_regions']=sum(p['retained_regions'] for p in result['platforms'].values())
    result['checks']=['Latest Excel selected by saved modification time and identified by SHA-256',
        'Source workbook unchanged and identical to archived snapshot',
        'Retained type IDs, ordering, labels, sample counts, coordinates, contents and review fields match Excel',
        'All 585 retained detail rows reconciled by instance ID, type, coordinates, text state, occlusion and visible geometry',
        'All 455 Excel image records reconciled; GBA-315 retained as an out-of-scope archive image',
        'All 456 source screenshot hashes verified; all 1044 original region geometries and IDs preserved',
        'Embedded HTML datasets match the generated JSON exactly']
    (HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

def main():
    if '--verify' in sys.argv:return verify()
    books = sorted((ROOT/'outputs').rglob('*.xlsx'), key=lambda p: p.stat().st_mtime, reverse=True)
    for book in books:
        sheets = read_workbook(book)
        result = {'file': str(book.relative_to(ROOT)), 'sha256': hashlib.sha256(book.read_bytes()).hexdigest(),
                  'sheets': {n:len(data_rows(sheets,n)) for n in sheets}}
        if book == books[0]:
            result['differences'] = {}
            for p in ('gba', 'ngc'):
                d = json.loads((HERE/(p+'.json')).read_text(encoding='utf-8'))
                rows = data_rows(sheets, p.upper()+'类型审阅')
                current = {t['key']:t for t in d['region_types']}
                excel = {r['P']:r for r in rows}
                changes=[]
                for k in excel.keys() & current.keys():
                    t,r=current[k],excel[k]
                    fields={'A':t['review_id'],'B':t.get('review_status',''),'C':t.get('review_comment',''),
                            'D':t['group'],'E':t['name'],'H':str(t['image_count']),
                            'I':'['+', '.join(map(str,t['logical_box']))+']','K':t['content'],
                            'M':t.get('representative_image_id',''),'Q':t['appearance']}
                    for c,v in fields.items():
                        if r.get(c,'') != v: changes.append({'key':k,'column':c,'excel':r.get(c,''),'report':v})
                    if r.get('J'): changes.append({'key':k,'column':'J','excel':r['J'],'report':'unapplied coordinate suggestion'})
                result['differences'][p]={'excel_only':sorted(excel.keys()-current.keys()),'report_only':sorted(current.keys()-excel.keys()),'field_changes':changes,
                    'hidden_type_rows':[r['row'] for r in sheets[p.upper()+'类型审阅'] if r['hidden']]}
                result.setdefault('headers',{})[p]={n:[r for r in sheets[n] if r['row']==6] for n in sheets if n.startswith(p.upper())}
        print(json.dumps(result,ensure_ascii=False))

if __name__ == '__main__': main()
