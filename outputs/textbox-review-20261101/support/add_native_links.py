"""Add native OpenXML hyperlinks, unavailable through the authoring API.

All cells, styles, pictures, tables and formulas are authored by artifact-tool.
This preserves that workbook and only adds hyperlink elements/relationships.
"""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import xml.etree.ElementTree as ET
import json,posixpath,sys

base=Path(__file__).resolve().parent
target=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else base.parent/'文本框分类审阅.xlsx'
links=json.loads((base/'native_links.json').read_text(encoding='utf-8'))
MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
DOCREL='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
ET.register_namespace('',MAIN);ET.register_namespace('r',DOCREL)
with ZipFile(target) as z:entries={i.filename:z.read(i.filename) for i in z.infolist()}
workbook=ET.fromstring(entries['xl/workbook.xml'])
relationships=ET.fromstring(entries['xl/_rels/workbook.xml.rels'])
rels={r.attrib['Id']:r.attrib['Target'] for r in relationships}
def sheet_part(target):
    if target.startswith('/'):return target.lstrip('/')
    if target.startswith('xl/'):return target
    return posixpath.normpath('xl/'+target)
sheets={s.attrib['name']:sheet_part(rels[s.attrib['{'+DOCREL+'}id']]) for s in workbook.find('{'+MAIN+'}sheets')}
for name,part in sheets.items():
    selected=[v for v in links if v['sheet']==name]
    if not selected:continue
    sheet=ET.fromstring(entries[part]);hyperlinks=ET.Element('{'+MAIN+'}hyperlinks')
    relpart=posixpath.join(posixpath.dirname(part),'_rels',posixpath.basename(part)+'.rels')
    relationships=ET.fromstring(entries[relpart]) if relpart in entries else ET.Element('{'+REL+'}Relationships')
    used={r.attrib['Id'] for r in relationships}
    for n,v in enumerate(selected,1):
        attrs={'ref':v['address'],'display':v['label']}
        if v['target'].startswith('#'):attrs['location']=v['target'][1:]
        else:
            id=f'reviewLink{n}'
            while id in used:id+='x'
            used.add(id);attrs['{'+DOCREL+'}id']=id
            ET.SubElement(relationships,'{'+REL+'}Relationship',{'Id':id,'Type':DOCREL+'/hyperlink','Target':v['target'],'TargetMode':'External'})
        ET.SubElement(hyperlinks,'{'+MAIN+'}hyperlink',attrs)
    # Hyperlinks follow data validations/conditional formats, before drawings/tables.
    later={'printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'}
    idx=next((i for i,c in enumerate(sheet) if c.tag.rsplit('}',1)[-1] in later),len(sheet))
    sheet.insert(idx,hyperlinks)
    entries[part]=ET.tostring(sheet,encoding='utf-8',xml_declaration=True)
    entries[relpart]=ET.tostring(relationships,encoding='utf-8',xml_declaration=True)
temp=target.with_suffix('.tmp')
with ZipFile(temp,'w',ZIP_DEFLATED) as z:
    for name,data in entries.items():z.writestr(name,data)
temp.replace(target)
print('Added',len(links),'native hyperlinks to the workbook.')
