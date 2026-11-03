"""Evaluate previously generated image-only OCR output against candidate labels.

The engine never reads this module or the reference. Assignment uses only
detected type candidates and geometry; missing regions stay missing.
"""
from pathlib import Path
from collections import defaultdict
import argparse
import hashlib
import importlib.util
import html
import json

ROOT=Path(__file__).resolve().parents[1]


def equivalence_adjusted_text(expected,prediction,ambiguous):
    """Comparison only: substitute exact native candidates at their observed positions."""
    actual=prediction['rawOcr']
    if len(expected)!=len(actual):return actual
    adjusted=list(actual)
    characters=iter(c for c in prediction['characters'] for ch in c['raw'] if ch not in ' \n')
    for i,(wanted,got) in enumerate(zip(expected,actual)):
        character=None if got in ' \n' else next(characters,None)
        if wanted==got:continue
        if not character or character['raw']!=got or character['font']!=3 or character['distance']!=0:continue
        if wanted in character['candidates'] and frozenset((wanted,got)) in ambiguous:adjusted[i]=wanted
    return ''.join(adjusted)


def font3_equivalent(expected,prediction,ambiguous):
    return equivalence_adjusted_text(expected,prediction,ambiguous)==expected


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results',type=Path,nargs='+',required=True)
    parser.add_argument('--reference',type=Path,default=ROOT/'outputs/ocr-ground-truth-20261102/ground_truth.json')
    parser.add_argument('--out',type=Path,default=ROOT/'reports/ocr-development/evaluation.json')
    args=parser.parse_args()
    ref=json.loads(args.reference.read_text(encoding='utf-8'))
    spec=importlib.util.spec_from_file_location('candidate_compare',args.reference.parent/'compare.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    frames={}
    source_hashes={r['source']:r['sha256'] for r in ref['images']}
    jar_hash=hashlib.sha256((ROOT/'target/rs-ocr-0.1.0.jar').read_bytes()).hexdigest()
    for path in args.results:
        result=json.loads(path.read_text(encoding='utf-8'))
        if result.get('engineSha256')!=jar_hash:raise ValueError(f'Stale or unidentified engine output: {path}')
        for f in result['frames']:
            source=f['source'].replace('\\','/')
            source_path=Path(source)
            if source_path.is_absolute():source=source_path.relative_to(ROOT).as_posix()
            if source in frames:raise ValueError(f'Duplicate frame: {source}')
            if source not in source_hashes or f.get('sourceSha256')!=source_hashes[source]:
                raise ValueError(f'Input image hash does not match the reference inventory: {source}')
            frames[source]=f
    if set(frames)!=set(source_hashes):
        raise ValueError('Full development evaluation requires every inventoried original image.')
    fonts_path=ROOT/'src/main/resources/ocr/fonts.json'
    glyphs=json.loads(fonts_path.read_text(encoding='utf-8'))['glyphs']
    ambiguous=set()
    pairs=[]
    for a,b in [('へ','ヘ'),('0','O')]:
        first=[g['rows'] for g in glyphs if g['font']==3 and g['text']==a]
        second=[g['rows'] for g in glyphs if g['font']==3 and g['text']==b]
        if not first or not second or first[0]!=second[0]:raise ValueError(f'Font-3 equivalence has no identical native masks: {a}/{b}')
        ambiguous.add(frozenset((a,b)))
        pairs.append(dict(characters=[a,b],font=3,rows=first[0]))
    equivalence_proposal=dict(status='development_proposal_not_frozen',
        font_resource_sha256=hashlib.sha256(fonts_path.read_bytes()).hexdigest(),pairs=pairs,
        policy='Each changed codepoint must be an exact-distance font-3 observation retaining both candidates. Spaces, linebreaks, labels and all other codepoints remain strict.')
    predictions=[];assignments={};used=defaultdict(set)
    for r in ref['regions']:
        frame=frames.get(r['source'],{'regions':[]})
        candidates=[(i,p) for i,p in enumerate(frame['regions']) if r['region_type'] in p['typeCandidates']
                    and module.iou(r['logical_box'],p['logicalBox'])>.5]
        candidates.sort(key=lambda t:module.iou(r['logical_box'],t[1]['logicalBox']),reverse=True)
        if candidates:
            i,p=candidates[0]
            used[r['source']].add(i)
            assignments[r['instance_id']]=p
            predictions.append(dict(instance_id=r['instance_id'],text=p['rawOcr'],logical_box=p['logicalBox']))
    report=module.compare(ref,dict(regions=predictions))
    byid={r['instance_id']:r for r in ref['regions']}
    strict_failures={r['instance_id']:r for r in report['failures']}
    groups=defaultdict(lambda:dict(total=0,strict_correct=0,font3_equivalent_correct=0,missing=0,unknown=0,unsupported=0))
    equivalent_ids=[]
    for r in ref['regions']:
        if not r['recognition_in_scope']:continue
        p=assignments.get(r['instance_id'])
        strict=r['instance_id'] not in strict_failures
        equivalent=strict or bool(p and font3_equivalent(r['text'],p,ambiguous))
        if equivalent and not strict:equivalent_ids.append(r['instance_id'])
        for key in ('all',r['platform'],r['region_type']):
            g=groups[key];g['total']+=1;g['strict_correct']+=strict;g['font3_equivalent_correct']+=equivalent
            g['missing']+=not bool(p);g['unknown']+=bool(p and p['status']=='unknown_glyph');g['unsupported']+=bool(p and p['status']=='unsupported_layout')
    report['groups']=dict(groups)
    report['font3_equivalence_proposal']={'rule':'font 3: へ=ヘ; 0=O; other codepoints/spaces/linebreaks unchanged',
        'basis':'Identical full 8x16 foreground masks extracted byte-identically from both pinned Japanese ROMs.',
        'status':'development_proposal_not_frozen','correct':groups['all']['font3_equivalent_correct'],
        'equivalent_only_records':equivalent_ids,'evidence':'font3-equivalence.json'}
    report['unassigned_detections']=[dict(source=s,region=p) for s,f in frames.items() for i,p in enumerate(f['regions']) if i not in used[s]]
    scope_review=json.loads((ROOT/'reports/ocr-development/scope-review.json').read_text(encoding='utf-8'))
    for detection in report['unassigned_detections']:
        p=detection['region']
        matches=[r for r in scope_review['records'] if r['source']==detection['source']
                 and r['type'] in p['typeCandidates'] and r['logical_box']==p['logicalBox']
                 and r['source_sha256']==source_hashes[detection['source']]]
        detection['scope_review']='unreviewed'
        if len(matches)==1:
            detection['scope_review']='visible_outside_retained_catalog'
            detection['matches_reviewed_text']=matches[0]['text']==p['rawOcr']
    report['unreviewed_detections']=sum(d['scope_review']=='unreviewed' for d in report['unassigned_detections'])
    report['supplemental_text_mismatches']=sum(d.get('matches_reviewed_text') is False for d in report['unassigned_detections'])
    report['supplemental_missing_records']=[dict(source=r['source'],type=r['type']) for r in scope_review['records']
        if not any(d['source']==r['source'] and r['type'] in d['region']['typeCandidates']
                   and r['logical_box']==d['region']['logicalBox'] for d in report['unassigned_detections'])]
    report['coverage_note']='All 574 candidate targets remain in the denominator. Supplemental detections are separately reviewed against original pixels in scope-review.json; neither added to the original denominator nor treated as approved negatives.'
    report['evaluated_frames']=len(frames)
    report['reference_sha256']=hashlib.sha256(args.reference.read_bytes()).hexdigest()
    report['runtime_jar_sha256']=jar_hash
    args.out.parent.mkdir(parents=True,exist_ok=True)
    (args.out.parent/'font3-equivalence.json').write_text(json.dumps(equivalence_proposal,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    args.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (args.out.parent/'predictions.json').write_text(json.dumps(dict(regions=predictions),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    cards=[]
    for r in ref['regions']:
        if not r['recognition_in_scope']:continue
        p=assignments.get(r['instance_id'])
        fail=strict_failures.get(r['instance_id'])
        status='同形字提案相同' if r['instance_id'] in equivalent_ids else '差异' if fail else '严格相同'
        crop=f'../../outputs/ocr-ground-truth-20261102/{r["crop"]}'
        unknown=[c for c in (p or {}).get('characters',[]) if c['distance'] or len(c['candidates'])>1]
        cards.append(f'<article data-state="{status}" data-platform="{r["platform"]}"><h2>{r["instance_id"]} · {html.escape(r["region_type"])} · {status}</h2>'
            f'<img loading="lazy" src="{html.escape(crop,quote=True)}" alt="原图区域">'
            f'<div class="texts"><section><h3>候选转录（待人工复核）</h3><pre>{html.escape(r["text"])}</pre></section>'
            f'<section><h3>原始 OCR</h3><pre>{html.escape(p["rawOcr"] if p else "[未检测到]")}</pre></section></div>'
            f'<details><summary>检测与字形诊断</summary><pre>{html.escape(json.dumps(dict(status=(p or {}).get("status"),score=(p or {}).get("detectionScore"),characters=unknown),ensure_ascii=False,indent=2))}</pre></details></article>')
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>日文 OCR 开发比对</title>
<style>body{max-width:1100px;margin:32px auto;padding:0 20px;font:16px/1.6 system-ui;background:#f4f6f8;color:#18232f}article{background:white;border:1px solid #d7dce1;border-radius:10px;padding:20px;margin:20px 0}h2{font-size:18px}h3{font-size:14px;color:#51616e}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.7 ui-monospace,monospace}img{max-width:100%;max-height:260px;object-fit:contain;image-rendering:pixelated}.texts{display:grid;grid-template-columns:1fr 1fr;gap:24px}select{padding:8px;margin:8px}details pre{font-size:13px}article[hidden]{display:none}@media(max-width:700px){.texts{grid-template-columns:1fr}}</style>
<h1>日文原文 OCR 开发比对</h1>'''+f'<p>严格相同 {report["strict_correct"]} / {report["total_scope_records"]}；574 项分母完整保留。11 个遮挡排除区域误输出 {len(report["false_positive_excluded_regions"])} 项。另有 {len(report["unassigned_detections"])} 项原目录外补充检测，处理状态见下文。</p>'
    page+=f'<p>同形字提案相同 {groups["all"]["font3_equivalent_correct"]} / {report["total_scope_records"]}，仅同形字差异 {len(equivalent_ids)} 项。额外检测中未复核 {report["unreviewed_detections"]} 项、与补充转录不一致 {report["supplemental_text_mismatches"]} 项；<a href="scope-review.json">范围复核</a>、<a href="font3-equivalence.json">同形字证据</a>。</p>'
    page+='<p>此页比较程序输出与尚未冻结的候选转录，不能视为 100% 产品验收。图片只用于测试；运行程序不读取答案。</p><label>状态<select id="state"><option>全部</option><option>差异</option><option>同形字提案相同</option><option>严格相同</option></select></label><label>分组<select id="platform"><option>全部</option><option>gba</option><option>ngc</option></select></label>'
    page+=''.join(cards)+'''<script>const controls=[document.querySelector('#state'),document.querySelector('#platform')];function filter(){document.querySelectorAll('article').forEach(a=>a.hidden=(controls[0].value!=='全部'&&a.dataset.state!==controls[0].value)||(controls[1].value!=='全部'&&a.dataset.platform!==controls[1].value));}controls.forEach(s=>s.addEventListener('change',filter));filter();</script></html>'''
    (args.out.parent/'review.html').write_text(page,encoding='utf-8')
    print(json.dumps(dict(groups=dict(groups),excluded_outputs=report['false_positive_excluded_regions'],unassigned_detections=len(report['unassigned_detections'])),ensure_ascii=True,indent=2))
    return 0 if report['entire_scope_verified'] else 1


if __name__=='__main__':raise SystemExit(main())
