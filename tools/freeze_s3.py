"""Create a guarded fixed-set snapshot after explicit AI visual review.

No OCR output is read here. Decisions live in the AI review audit, not in an
automatic comparison with predictions. Rebuilding refuses changed evidence.
"""
from pathlib import Path
from collections import Counter
import copy
import hashlib
import json
import re
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/s3-acceptance'
BASE=ROOT/'outputs/ocr-ground-truth-20261102'


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    audit=read(OUT/'ai-review.json')
    for item in audit['inputs']:
        assert sha(ROOT/item['path'])==item['sha256'],f'Changed reviewed input: {item["path"]}'
    assert audit['status']=='completed_ai_visual_rereview'
    original=read(BASE/'ground_truth.json')
    manifest=read(BASE/'manifest.json')
    assert {s['file'] for s in manifest['sheets']}=={s['file'] for s in audit['sheets']}
    reviewed=set()
    for sheet in audit['sheets']:
        assert sheet['decision']=='confirmed_against_pixels'
        assert sheet['sha256']==sha(BASE/sheet['file'])
        declared=next(s for s in manifest['sheets'] if s['file']==sheet['file'])
        assert sheet['regions']==declared['regions']
        reviewed.update(sheet['regions'])
    rows=copy.deepcopy(original['regions'])
    byid={r['instance_id']:r for r in original['regions']}
    assert len(reviewed)==524
    assert len(audit['occlusion_region_ids'])==21
    assert set(audit['occlusion_region_ids'])=={r['instance_id'] for r in read(BASE/'occlusion_review.json')['regions']}
    for r in rows:
        rid=r['instance_id']
        if not r['expect_region_visible']:
            assert rid in audit['occlusion_region_ids']
        elif r.get('duplicate_of'):
            source=byid[r['duplicate_of']]
            assert source['instance_id'] in reviewed
            assert r['text']==source['text'] and r['crop_sha256']==source['crop_sha256']
            assert Image.open(BASE/r['crop']).convert('RGB').tobytes()==Image.open(BASE/source['crop']).convert('RGB').tobytes()
        else:assert rid in reviewed,rid
        r['origin']='retained_catalog'
        r['crop']='outputs/ocr-ground-truth-20261102/'+r['crop']
    images=copy.deepcopy(original['images'])
    image_by_source={im['source']:im for im in images}
    for im in images:assert sha(ROOT/im['source'])==im['sha256']
    (OUT/'crops').mkdir(exist_ok=True)
    supplement=read(ROOT/'reports/ocr-development/scope-review.json')['records']
    assert len(supplement)==5 and audit['supplemental_reviewed']==5
    counters=Counter()
    for s in supplement:
        im=image_by_source[s['source']]
        assert s['source_sha256']==im['sha256']
        counters[im['id']]+=1
        rid=f'{im["id"]}-S{counters[im["id"]]:02}'
        image=Image.open(ROOT/s['source']).convert('RGB')
        if image.size==(1200,800):normalized=image.resize((240,160),Image.Resampling.NEAREST)
        else:
            normalized=Image.new('RGB',(240,160))
            for y in range(160):
                for x in range(240):normalized.putpixel((x,y),image.getpixel((int(212+(x+.5)*1168/240),int(200+(y+.5)*800/160))))
        x,y,w,h=s['logical_box']
        crop=OUT/f'crops/{rid}.png'
        normalized.crop((x,y,x+w,y+h)).save(crop)
        rows.append(dict(instance_id=rid,image_id=im['id'],platform=im['id'].split('-')[0].lower(),
            source=s['source'],source_sha256=im['sha256'],region_type=s['type'],logical_box=s['logical_box'],
            expect_region_visible=True,recognition_in_scope=True,assertion_ready=True,text=s['text'],
            number_tokens=re.findall(r'[0-9]+',s['text']),crop=crop.relative_to(ROOT).as_posix(),
            origin='supplemental_visual_review',target_text_visibility='fully_visible'))
    fields=['instance_id','image_id','platform','source','source_sha256','region_type','logical_box','text',
            'number_tokens','expect_region_visible','recognition_in_scope','assertion_ready','origin','crop',
            'duplicate_of','target_text_visibility','target_text_visibility_reason','recognition_exclusion_reason']
    rows=[{k:r[k] for k in fields if k in r} for r in rows]
    for r in rows:r['review_status']='ai_rereviewed';r['lines']=r['text'].split('\n') if r['text'] else []
    active=[r for r in rows if r['recognition_in_scope']]
    target_sources={r['source'] for r in active}
    zero_ids={im['id'] for im in images if im['source'] not in target_sources}
    assert zero_ids==set(audit['scope_negative_image_ids'])
    for im in images:
        im['region_ids']=[r['instance_id'] for r in rows if r['source']==im['source']]
        im['recognition_target_count']=sum(r['recognition_in_scope'] for r in rows if r['source']==im['source'])
        im['scope_negative_approved']=im['id'] in zero_ids
        im['whole_image_text_free']=False
    assert len(rows)==590 and len(active)==579 and len(images)==456
    policy_path=OUT/'policy.json'
    data=dict(schema_version=1,date='2026-11-02',freeze_status='frozen_ai_reviewed',
        purpose='S3 fixed hardware screenshot acceptance under the user-authorized AI review policy',
        policy=read(policy_path),policy_sha256=sha(policy_path),ai_review_sha256=sha(OUT/'ai-review.json'),
        baseline_reference_sha256=sha(BASE/'ground_truth.json'),
        comparator='outputs/ocr-ground-truth-20261102/compare.py',
        comparator_sha256=sha(BASE/'compare.py'),
        runtime_jar_sha256=sha(ROOT/'target/rs-ocr-0.1.0.jar'),
        recognition_scope_policy=original['recognition_scope_policy'],
        images=images,regions=rows,
        summary=dict(images=456,targets=579,baseline_targets=574,additional_targets=5,excluded=11,
            target_images=len(target_sources),scope_negative_images=len(zero_ids),
            platforms=dict(Counter(r['platform'] for r in active)),
            holdout_required=False,holdout_established=False,reviewer='AI',human_review_required=False))
    write(OUT/'reference.json',data)
    paths=[OUT/'reference.json',OUT/'policy.json',OUT/'ai-review.json',*sorted((OUT/'crops').glob('*.png'))]
    paths.extend(ROOT/f'tools/{name}' for name in ['accept_s3.py','evaluate_ocr.py','freeze_s3.py'])
    for name in ['fonts','labels','regions','sprites']:paths.append(ROOT/f'src/main/resources/ocr/{name}.json')
    files={p.relative_to(ROOT).as_posix():sha(p) for p in paths}
    for im in images:files[im['source']]=im['sha256']
    write(OUT/'freeze-manifest.json',dict(schema_version=1,files=files,
        runtime_jar_sha256=data['runtime_jar_sha256'],reference_sha256=sha(OUT/'reference.json')))
    print(json.dumps(data['summary'],ensure_ascii=False))


if __name__=='__main__':main()
