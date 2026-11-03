"""Verify the frozen, AI-rereviewed S3 hardware screenshot set.

Recognition is executed separately on images alone. This tool reads its output
and the frozen reference, retaining raw strict metrics alongside approved
native-pixel equivalence metrics. Exit 0 means this S3 gate actually passes.
"""
from pathlib import Path
from collections import Counter,defaultdict
import argparse
import copy
import hashlib
import html
import importlib.util
import json
from evaluate_ocr import equivalence_adjusted_text

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/s3-acceptance'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))


def assign(reference,frames,comparator):
    predictions=[];assigned={};used=defaultdict(set)
    # Active targets own their panel before excluded candidates are considered.
    for r in sorted(reference['regions'],key=lambda r:not r['recognition_in_scope']):
        candidates=[(i,p) for i,p in enumerate(frames[r['source']]['regions'])
                    if i not in used[r['source']] and r['region_type'] in p['typeCandidates']
                    and comparator.iou(r['logical_box'],p['logicalBox'])>.5]
        if not candidates:continue
        i,p=max(candidates,key=lambda t:comparator.iou(r['logical_box'],t[1]['logicalBox']))
        used[r['source']].add(i);assigned[r['instance_id']]=p
        predictions.append(dict(instance_id=r['instance_id'],text=p['rawOcr'],logical_box=p['logicalBox']))
    unexpected=[dict(source=s,region=p) for s,f in frames.items() for i,p in enumerate(f['regions']) if i not in used[s]]
    return predictions,assigned,unexpected


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results',type=Path,nargs='+',required=True)
    args=parser.parse_args()
    freeze=read(OUT/'freeze-manifest.json')
    for path,digest in freeze['files'].items():
        if sha(ROOT/path)!=digest:raise ValueError(f'Frozen evidence changed: {path}')
    reference=read(OUT/'reference.json')
    if reference['freeze_status']!='frozen_ai_reviewed':raise ValueError('S3 reference is not frozen.')
    if sha(OUT/'policy.json')!=reference['policy_sha256'] or sha(OUT/'ai-review.json')!=reference['ai_review_sha256']:
        raise ValueError('Review/policy belongs to another snapshot.')
    review=read(OUT/'ai-review.json')
    for item in review['inputs']:
        if sha(ROOT/item['path'])!=item['sha256']:raise ValueError(f'Reviewed evidence changed: {item["path"]}')
    base=ROOT/'outputs/ocr-ground-truth-20261102'
    for sheet in review['sheets']:
        if sha(base/sheet['file'])!=sheet['sha256']:raise ValueError('Reviewed crop sheet changed.')
    jar=ROOT/'target/rs-ocr-0.1.0.jar'
    jar_hash=sha(jar)
    if jar_hash!=freeze['runtime_jar_sha256'] or jar_hash!=reference['runtime_jar_sha256']:
        raise ValueError('Engine changed after freezing; review the version before a new acceptance run.')
    comparator_path=ROOT/reference['comparator']
    if sha(comparator_path)!=reference['comparator_sha256']:raise ValueError('Frozen comparator changed.')
    spec=importlib.util.spec_from_file_location('s3_compare',comparator_path)
    comparator=importlib.util.module_from_spec(spec);spec.loader.exec_module(comparator)
    images={im['source']:im for im in reference['images']};frames={}
    for path in args.results:
        result=read(path)
        if result['engineSha256']!=jar_hash:raise ValueError(f'Stale engine output: {path}')
        for frame in result['frames']:
            source=frame['source'].replace('\\','/')
            if Path(source).is_absolute():source=Path(source).relative_to(ROOT).as_posix()
            if source in frames:raise ValueError('Duplicate frame: '+source)
            if source not in images or frame['sourceSha256']!=images[source]['sha256']:raise ValueError('Wrong image identity: '+source)
            frames[source]=frame
    if set(frames)!=set(images):raise ValueError('Acceptance requires all frozen 456 original images.')
    glyphs=read(ROOT/'src/main/resources/ocr/fonts.json')['glyphs'];pairs=set();evidence=[]
    for a,b in reference['policy']['equivalence']['pairs']:
        first=next(g['rows'] for g in glyphs if g['font']==3 and g['text']==a)
        second=next(g['rows'] for g in glyphs if g['font']==3 and g['text']==b)
        if first!=second:raise ValueError('Visual equivalence has no native bitmap evidence.')
        pairs.add(frozenset((a,b)));evidence.append(dict(characters=[a,b],font=3,rows=first))
    raw,assigned,unexpected=assign(reference,frames,comparator)
    strict=comparator.compare(reference,dict(regions=raw))
    byid={r['instance_id']:r for r in reference['regions']}
    adjusted=[dict(p,text=equivalence_adjusted_text(byid[p['instance_id']]['text'],assigned[p['instance_id']],pairs)) for p in raw]
    approved=comparator.compare(reference,dict(regions=adjusted))
    for result in (strict,approved):result.pop('warning',None)
    groups={}
    for platform in ('gba','ngc'):
        subset=dict(reference,regions=[r for r in reference['regions'] if r['platform']==platform])
        ids={r['instance_id'] for r in subset['regions']}
        a=comparator.compare(subset,dict(regions=[p for p in raw if p['instance_id'] in ids]))
        b=comparator.compare(subset,dict(regions=[p for p in adjusted if p['instance_id'] in ids]))
        groups[platform]=dict(chain='NDS' if platform=='gba' else 'NGC',targets=b['total_scope_records'],
            strict_correct=a['strict_correct'],approved_correct=b['strict_correct'],approved_CER=b['strict_CER'],
            target_images=b['fully_evaluated_images'],approved_correct_images=b['strict_fully_correct_images'])
    baseline_ids={r['instance_id'] for r in reference['regions'] if r['origin']=='retained_catalog'}
    baseline_reference=dict(reference,regions=[r for r in reference['regions'] if r['instance_id'] in baseline_ids])
    baseline=comparator.compare(baseline_reference,dict(regions=[p for p in raw if p['instance_id'] in baseline_ids]))
    zero_sources=[s for s,im in images.items() if im['scope_negative_approved']]
    negative_outputs=[s for s in zero_sources if frames[s]['regions']]
    unknown=[rid for rid,p in assigned.items() if byid[rid]['recognition_in_scope'] and ('�' in p['rawOcr'] or p['status']!='recognized')]
    passed=bool(approved['entire_scope_verified'] and approved['strict_CER']==0 and not unexpected and not unknown and not negative_outputs)
    equivalence_ids=[p['instance_id'] for p,q in zip(raw,adjusted) if p['text']!=q['text']]
    report=dict(stage='S3',s3_gate_passed=passed,policy_id=reference['policy']['id'],
        reference_sha256=sha(OUT/'reference.json'),freeze_manifest_sha256=sha(OUT/'freeze-manifest.json'),
        runtime_jar_sha256=jar_hash,implementation_version='0.1.0',evaluated_frames=len(frames),
        strict=strict,approved=approved,groups=groups,
        baseline=dict(targets=baseline['total_scope_records'],strict_correct=baseline['strict_correct']),
        additional_targets=5,equivalent_only_records=equivalence_ids,equivalence_evidence=evidence,
        unexpected_detections=unexpected,unknown_or_unsupported=unknown,
        scope_negative_images=len(zero_sources),scope_negative_false_outputs=negative_outputs,
        target_game='Japanese Ruby/Sapphire as specified by user',
        per_image_game_assignment='not established; not an S3 blocker under the user-confirmed scope',
        evidence_kind='fixed_existing_hardware_screenshot_set_with_ai_rereview',
        holdout_established=False,human_review_performed=False,
        limitations=reference['policy']['limitations'])
    (OUT/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'predictions.json').write_text(json.dumps(dict(regions=raw),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    strict_failures={r['instance_id'] for r in strict['failures']}
    approved_failures={r['instance_id'] for r in approved['failures']}
    cards=[]
    for r in reference['regions']:
        rid=r['instance_id'];p=assigned.get(rid)
        state='排除' if not r['recognition_in_scope'] else '未通过' if rid in approved_failures else '同形字等价' if rid in strict_failures else '严格相同'
        cards.append(f'<article data-state="{state}"><h2>{rid} · {html.escape(r["region_type"])} · {state}</h2>'
            f'<a href="../../{html.escape(r["source"],quote=True)}"><img loading="lazy" src="../../{html.escape(r["crop"],quote=True)}" alt="区域截图"></a>'
            f'<div class="texts"><section><h3>AI 复核冻结原文</h3><pre>{html.escape(r["text"])}</pre></section>'
            f'<section><h3>原始 OCR</h3><pre>{html.escape(p["rawOcr"] if p else "[未输出]")}</pre></section></div></article>')
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S3 固定实机截图验收</title>
<style>body{max-width:1100px;margin:32px auto;padding:0 20px;font:16px/1.6 system-ui;background:#f4f6f8;color:#18232f}article{background:white;border:1px solid #d7dce1;border-radius:10px;padding:20px;margin:20px 0}h2{font-size:18px}h3{font-size:14px;color:#51616e}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:17px/1.7 ui-monospace,monospace}img{max-width:100%;max-height:260px;object-fit:contain;image-rendering:pixelated}.texts{display:grid;grid-template-columns:1fr 1fr;gap:24px}select{padding:8px;margin:8px}article[hidden]{display:none}@media(max-width:700px){.texts{grid-template-columns:1fr}}</style>'''
    page+=f'<h1>S3 固定实机截图验收：{"通过" if passed else "未通过"}</h1><p>456 张实机原图；原 574 项加 5 个遗漏字段，共 579 项目标。严格相同 {strict["strict_correct"]} / 579；冻结同形字规则下 {approved["strict_correct"]} / 579，CER={approved["strict_CER"]}。有目标图片 {approved["strict_fully_correct_images"]} / {approved["fully_evaluated_images"]} 全部正确。</p>'
    page+='<p>AI 再次复核；按用户要求使用现有实机 testcase，不要求人工复核或新保留素材。当前图片曾用于开发，此结果不外推到未见画面、实时或中文验收。11 项文字遮挡／不可见区域单列，5 张范围内无目标图片不误输出；它们不是全图无文字。</p><p><a href="evaluation.json">完整指标</a> · <a href="ai-review.json">AI 复核</a> · <a href="policy.json">冻结规则</a> · <a href="freeze-manifest.json">输入与资源哈希</a></p><label>筛选<select id="state"><option>全部</option><option>未通过</option><option>同形字等价</option><option>严格相同</option><option>排除</option></select></label>'
    page+=''.join(cards)+'''<script>const s=document.querySelector('#state');function filter(){document.querySelectorAll('article').forEach(a=>a.hidden=s.value!=='全部'&&a.dataset.state!==s.value)}s.addEventListener('change',filter);filter();</script></html>'''
    (OUT/'review.html').write_text(page,encoding='utf-8')
    print(json.dumps(dict(s3_gate_passed=passed,frames=len(frames),strict_correct=strict['strict_correct'],
        approved_correct=approved['strict_correct'],targets=approved['total_scope_records'],CER=approved['strict_CER'],
        target_images=approved['fully_evaluated_images'],correct_images=approved['strict_fully_correct_images'],
        excluded_outputs=approved['false_positive_excluded_regions'],unexpected=len(unexpected),groups=groups),ensure_ascii=False,indent=2))
    return 0 if passed else 1


if __name__=='__main__':raise SystemExit(main())
