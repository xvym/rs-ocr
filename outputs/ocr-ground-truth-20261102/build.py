"""Export visually transcribed screenshot answers and an offline review index."""
from pathlib import Path
from collections import Counter
import csv, hashlib, html, json, re

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]

PRINTING={'GBA-079-R03','GBA-153-R03','GBA-175-R03','GBA-256-R01'}
FRAGMENTS={
    'GBA-201-R08': '恢复弹窗遮住“も”和“ど”的左部；仅完整转录末尾“る”，不补全按钮名。',
    'GBA-229-R08': '恢复弹窗遮住按钮前部；仅完整转录末尾“る”，不补全按钮名。',
    'GBA-285-R03': '上方只露出口味标签的上半字形，没有完整字符；不据其他帧补写。',
    'NGC-095-R03': '上方只露出口味标签的上半字形，没有完整字符；不据其他帧补写。',
    'NGC-097-R03': '右侧选择框遮住“かわいさ”标签后部；只转录完整露出的“か”，不补写后续字形。',
    'GBA-287-R03': '底部消息框遮住 FEEL 标签下部；仅转录五项完整日文标签。',
    'NGC-099-R03': '底部消息框遮住 FEEL 标签下部；仅转录五项完整日文标签。',
}

def dump(path,obj):
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def canonical(text):
    # Deliberate transcription notation, not guessed game encoding.
    return text.replace('／','/').replace('：',':')

def build():
    manifest=json.loads((HERE/'manifest.json').read_text(encoding='utf-8'))
    annotations=json.loads((HERE/'transcriptions.json').read_text(encoding='utf-8'))
    annotations.update({p.stem:p.read_text(encoding='utf-8').splitlines() for p in (HERE/'annotations').glob('*.txt')})
    read={}
    for sheet in manifest['sheets']:
        key=Path(sheet['file']).stem
        assert len(annotations[key])==len(sheet['regions']),key
        for rid,text in zip(sheet['regions'],annotations[key]):
            assert rid not in read,rid
            read[rid]=(text,sheet['file'])
    rows=manifest['regions']
    byid={r['instance_id']:r for r in rows}
    assert len(rows)==585 and len(byid)==585 and len(read)==524
    revisions=json.loads((HERE/'annotation-revisions.json').read_text(encoding='utf-8'))
    revised={}
    for revision in revisions['revisions']:
        rid=revision['instance_id']
        original,sheet=read[rid]
        assert original.replace('|','\n')==revision['before'],rid
        assert byid[rid]['source_sha256']==revision['source_sha256'],rid
        assert hashlib.sha256((ROOT/byid[rid]['source']).read_bytes()).hexdigest()==revision['source_sha256'],rid
        read[rid]=(revision['after'].replace('\n','|'),sheet)
        revised[rid]=revision
    for r in rows:
        rid=r['instance_id']
        r['expect_region_visible']=r['status']!='not_visible'
        r['game_version']=None
        r['geometry_status']='native_roi_with_estimated_ngc_viewport' if r['platform']=='ngc' else 'native_roi_on_5x_screenshot'
        r['geometry_note']='区域框含边框和留白，不是字形紧框；NGC 视口为目录人工估计，非像素级裁切真值。'
        viewport=next(im['viewport_original'] for im in manifest['images'] if im['id']==r['image_id'])
        vx,vy,vw,vh=viewport
        r['visible_original_rectangles']=[[round(vx+x*vw/240,3),round(vy+y*vh/160,3),round(w*vw/240,3),round(h*vh/160,3)] for x,y,w,h in r['visible_logical_rectangles']]
        r['notes']=[]
        if not r['expect_region_visible']:
            r['lines']=[];r['text']='';r['text_state']='not_visible'
            r['assertion_ready']=True
            r['notes'].append('覆盖特征表已确认旧目录候选在恢复弹窗状态不可见；不输出该旧候选。此图仍可能有其他目标区域。')
        else:
            reference=r.get('duplicate_of',rid)
            text,sheet=read[reference]
            r['review_sheet']=sheet
            if text=='[EMPTY]':
                r['lines']=[];r['text']='';r['status']='empty';r['text_state']='no_complete_text'
                r['notes'].append('当前可见部分为空白；是否纳入识别由 recognition_in_scope 单独登记。')
            elif text=='[FRAGMENTS_ONLY]':
                r['lines']=[];r['text']='';r['status']='fragment_only';r['text_state']='clipped_glyphs_only'
            else:
                r['lines']=canonical(text).split('|');r['text']='\n'.join(r['lines'])
                r['status']='transcribed';r['text_state']='printing_partial' if reference in PRINTING else 'visible'
            r['assertion_ready']=rid not in FRAGMENTS and reference not in FRAGMENTS
            fragment_note=FRAGMENTS.get(rid,FRAGMENTS.get(reference))
            if fragment_note:
                r['notes'].append(fragment_note)
                r['notes'].append('目标文字存在遮挡；残字转录仅保留供追溯，该区域不再以露出字符作为识别答案。')
            if r['text_state']=='printing_partial':
                r['notes'].append('截图处于逐字打印中；仅转录当前画面已有字符，不补完整句。')
        if r['region_type']=='condition_graph' and 'condition_message' in r['occluded_by']:
            r['notes'].append('本轮补充旧目录遗漏的底部消息框遮挡关系。')
        if rid=='GBA-026-R02':r['notes'].append('注册标记实际可读字样为 SEL，右侧黑色按钮图形不转成 SELECT。')
        if rid=='NGC-095-R02':r['notes'].append('本帧列表中两项均显示 Lv11；不按制作消息的其他帧把第二项改成 Lv17。')
        r['number_tokens']=re.findall(r'[0-9]+',r['text'])
        r['line_indents_logical']=[0]*len(r['lines'])
        if rid in ('GBA-137-R01','NGC-066-R01'):
            r['line_indents_logical']=[0,8]
            r['notes'].append('引号内第二行相对第一行正文起点缩进 8 个逻辑像素；布局缩进另存，不计为词间空格。')
        r['annotation_method']='assistant_visual_transcription'
        r['human_review_status']='pending'
        reference=r.get('duplicate_of',rid)
        if reference in revised:
            r['annotation_revision']=reference
            r['notes'].append('AI 回看原图修正候选转录；修改前后及图像哈希见 annotation-revisions.json，仍待人工复核。')
        r['crop_file_sha256']=hashlib.sha256((HERE/r['crop']).read_bytes()).hexdigest()
    # Use native frame/panel geometry, not padding in an OCR detection ROI.
    features=json.loads((ROOT/'reports/textbox-features/features.json').read_text(encoding='utf-8'))
    profiles={p['key']:p for p in features['profiles']}
    order=features['visibility_model']['audit_composition_order']
    review=json.loads((HERE/'occlusion_review.json').read_text(encoding='utf-8'))
    visibility_review={r['instance_id']:r for r in review['regions']}
    reviewed=set()
    for r in rows:
        profile=profiles[r['region_type']]
        native=next((v for v in profile['variants'] if v['id']==profile['display_variant_id']),profile['variants'][0])
        r['recognition_box']=native['window_allocation_box'] or native['panel_body_or_contour_box'] or r['logical_box']
    for im in manifest['images']:
        related=[r for r in rows if r['image_id']==im['id']]
        for r in related:
            occluders=set(r['occluded_by'])
            x,y,w,h=r['recognition_box']
            for upper in related:
                if order.get(upper['region_type'],0)<=order.get(r['region_type'],0):continue
                a,b,c,d=upper['recognition_box']
                if min(x+w,a+c)>max(x,a) and min(y+h,b+d)>max(y,b):
                    occluders.add(upper['region_type'])
            r['recognition_occluded_by']=sorted(occluders)
            if occluders:
                decision=visibility_review[r['instance_id']]
                assert decision['source_sha256']==r['source_sha256'],r['instance_id']
                r['target_text_visibility']=decision['target_text_visibility']
                r['target_text_visibility_reason']=decision['reason']
                r['notes'].append(decision['reason'])
                reviewed.add(r['instance_id'])
            else:
                r['target_text_visibility']='unoccluded'
                r['target_text_visibility_reason']='没有已确认的上层窗口遮挡。'
            r['target_text_occluded']=r['target_text_visibility'] in ('occluded','text_area_covered')
            r['recognition_in_scope']=r['expect_region_visible'] and not r['target_text_occluded']
            r['recognition_exclusion_reason']=('target_not_visible' if not r['expect_region_visible'] else 'occluded_text') if not r['recognition_in_scope'] else None
            if not r['recognition_in_scope']:
                r['notes'].append('目标文字被遮挡或目标实际不可见，本帧排除该区域；不输出残余文字或历史内容，恢复可见后重新识别。')
            elif occluders:
                r['notes'].append('仅边框、底板或空白被覆盖，目标文字完整，恢复识别；匹配时扣除被覆盖的固定特征。')
    assert reviewed==set(visibility_review),'遮挡复核清单与当前框体重叠候选不一致'
    active=[r for r in rows if r['recognition_in_scope']]
    excluded=[r for r in rows if not r['recognition_in_scope']]
    images=manifest['images']
    for im in images:
        related=[r for r in rows if r['image_id']==im['id']]
        im['region_ids']=[r['instance_id'] for r in related]
        im['visible_target_count']=sum(r['expect_region_visible'] for r in related)
        im['recognition_target_count']=sum(r['recognition_in_scope'] for r in related)
        im['excluded_occluded_count']=sum(not r['recognition_in_scope'] for r in related)
        im['negative_sample_approved']=False
        if not related:im['scope_note']=im.get('scope_note') or '没有当前保留区域；未按全图无文字负样本验收。'
    summary={
        'source_images':len(images),'images_with_scoped_regions':sum(bool(im['region_ids']) for im in images),
        'source_hashes_verified':len(images),'region_records':len(rows),
        'visible_regions':sum(r['expect_region_visible'] for r in rows),
        'not_visible_candidates':sum(not r['expect_region_visible'] for r in rows),
        'unique_crops_visually_read':len(read),'exact_crop_reuse':sum('duplicate_of' in r for r in rows),
        'region_types':len({r['region_type'] for r in rows}),
        'status_counts':dict(Counter(r['status'] for r in rows)),
        'recognition_target_records':len(active),
        'images_with_recognition_targets':sum(im['recognition_target_count']>0 for im in images),
        'excluded_occluded_count':len(excluded),
        'excluded_occluded_records':[r['instance_id'] for r in excluded],
        'frame_overlap_records':len(reviewed),
        'complete_text_with_frame_overlap_records':[r['instance_id'] for r in active if r['recognition_occluded_by']],
        'assertion_ready_records':sum(r['assertion_ready'] for r in active),
        'withheld_fragment_records':[r['instance_id'] for r in active if not r['assertion_ready']],
        'archived_fragment_records':[r['instance_id'] for r in excluded if not r['assertion_ready']],
        'printing_partial_records':[r['instance_id'] for r in rows if r['text_state']=='printing_partial'],
        'platforms':{p:{'regions':sum(r['platform']==p for r in rows),'types':len({r['region_type'] for r in rows if r['platform']==p}),
                        'recognition_targets':sum(r['platform']==p for r in active),'excluded_occluded':sum(r['platform']==p for r in excluded)} for p in ('gba','ngc')},
    }
    data={
        'schema_version':3,'created_date':'2026-11-02','language':'ja',
        'purpose':'截图区域原文识别候选基准；不是 OCR 引擎运行结果或产品验收报告。',
        'freeze_status':'candidate_pending_human_review',
        'recognition_scope_policy':{
            'rule':'exclude_when_target_text_occluded',
            'description':'仅目标文字或其正常显示区域被遮挡、或目标实际不可见时排除；只遮住框边缘、底板或空白且文字完整时保留识别。未拆分原有目标区域，不能补写隐藏文字。',
            'geometry':'原生框和上层窗口重叠用于发现复核候选，不直接作为排除条件；匹配完整可见文字时扣除被遮挡的固定特征像素。',
            'evidence':'已登记遮挡关系及已核查共现组合用于发现候选；最终文字可见性按 occlusion_review.json 的原图目视复核登记，不是 OCR 引擎输出，也不是运行时按截图编号判断。',
            'scope_field':'recognition_in_scope；expect_region_visible 仅表示画面可见事实，不能替代识别范围。',
            'archive':'保留全部585条原始区域转录供追溯；排除记录不进入字符、漏检或译文覆盖分母，单独检查是否被错误输出。',
        },
        'scope_source':'reports/textbox-catalog/review_selection.json',
        'scope_source_sha256':hashlib.sha256((ROOT/'reports/textbox-catalog/review_selection.json').read_bytes()).hexdigest(),
        'geometry_source':'reports/textbox-features/features.json',
        'geometry_source_sha256':hashlib.sha256((ROOT/'reports/textbox-features/features.json').read_bytes()).hexdigest(),
        'occlusion_review_source':'outputs/ocr-ground-truth-20261102/occlusion_review.json',
        'occlusion_review_sha256':hashlib.sha256((HERE/'occlusion_review.json').read_bytes()).hexdigest(),
        'transcription_policy':{
            'evidence':'逐字答案来自截图目视转录；不从 ROM 文本、剧情上下文、字典或相邻帧补全。原生特征表仅用于区域几何及遮挡。',
            'reading_order':'按画面从上到下、同一行从左到右；双列项目保留在同一行，列间用一个 ASCII 空格。',
            'spaces':'可见词间或列间间隔写为一个 ASCII 空格；字距、居中和对齐留白不展开成多个空格，不声称恢复底层空格编码。',
            'unicode':'日文假名按可读字形；数字/拉丁字母为半角，感叹号/问号用 ！/？，斜线/冒号用 //:，数量乘号用 ×，二点省略字形用 ‥。',
            'styled_labels':'等级标志记 Lv，编号标志记 No，训练家编号标志记 IDNo，技能点记 PP；不把预绘制文字当作图形遗漏。',
            'ellipsis_mapping_reference':'本地固定 pokeruby/charmap.txt 的日文 B0=‥ 仅用于符号转写约定，不用于填充正文。',
            'occlusion':'只因目标文字被遮挡或目标不可见而排除；框体部分被遮但文字完整的区域正常识别。7项残字对应区域仍排除，原转录供追溯。',
            'graphics':'光标、滚动/翻页箭头、血条、经验条、心形评分、图标和雷达图多边形不转写；HP/EXP/PP/FEEL/SEL 等文字照录。',
            'variants':'当前 Unicode 约定尚未由人工冻结；工具分别报告严格字符与显式视觉等价结果，不做 NFKC 或词典纠错。',
        },'summary':summary,'images':images,'regions':rows,
    }
    assert all(r['status']!='pending' for r in rows)
    assert len({r['region_type'] for r in rows})==51
    assert len([r for r in rows if not r['expect_region_visible']])==2
    assert all(r['text']=='\n'.join(r['lines']) for r in rows)
    dump(HERE/'ground_truth.json',data)
    (HERE/'regions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    dump(HERE/'summary.json',summary)
    dump(HERE/'excluded_regions.json',{'policy':data['recognition_scope_policy'],'count':len(excluded),
        'regions':[{k:r[k] for k in ('instance_id','image_id','source','region_type','region_name','recognition_box','recognition_occluded_by','target_text_visibility','target_text_visibility_reason','recognition_exclusion_reason')} for r in excluded]})
    columns=['instance_id','image_id','platform','source','source_sha256','region_type','region_name','recognition_in_scope','recognition_exclusion_reason','recognition_box','recognition_occluded_by','target_text_visibility','target_text_visibility_reason','status','text_state','assertion_ready','logical_box','original_box','visible_logical_rectangles','text','number_tokens','notes','crop','duplicate_of']
    with (HERE/'regions.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader()
        for r in rows:writer.writerow({k:json.dumps(r[k],ensure_ascii=False) if isinstance(r.get(k),(list,dict)) else r.get(k,'') for k in columns})
    # A small complete prediction input is useful for integration, never a real engine run.
    examples=[{'instance_id':r['instance_id'],'text':r['text']} for r in active[:3]]
    dump(HERE/'prediction_format.example.json',{'regions':examples})
    cards=[]
    status_names={'transcribed':'已转录','empty':'可见空白','not_visible':'不可见候选','fragment_only':'仅有残字'}
    state_names={'visible':'可见','printing_partial':'逐字打印中','not_visible':'被遮挡','no_complete_text':'无可见文字','clipped_glyphs_only':'仅露出部分字形'}
    for r in rows:
        rid=r['instance_id'];e=html.escape
        scope_label='识别范围内' if r['recognition_in_scope'] else ('已排除：目标不可见' if not r['expect_region_visible'] else '已排除：目标文字被遮挡')
        cards.append(f'''<article id="{rid}" data-platform="{r['platform']}" data-scope="{'active' if r['recognition_in_scope'] else 'excluded'}" data-query="{e((rid+' '+r['region_type']+' '+r['region_name']+' '+r['text']).lower(),quote=True)}">
<header><strong>{rid}</strong> <span>{e(r['region_name'])}</span><small>{scope_label} · {e(status_names[r['status']])} · {e(state_names[r['text_state']])}</small></header>
<div class="body"><a href="../../{e(r['source'],quote=True)}" target="_blank"><img loading="lazy" src="{r['crop']}" alt="{rid} 区域截图"></a><pre>{e(r['text']) or '（无完整可见文字）'}</pre></div>
<footer><code>{e(r['region_type'])} {r['logical_box']}</code><p>{e('；'.join(r['notes']))}</p><a href="../../{e(r['source'],quote=True)}" target="_blank">查看原图</a></footer></article>''')
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>testcase 文本识别审阅</title>
<style>body{font:15px system-ui,"Microsoft YaHei",sans-serif;background:#f1f4f8;color:#172235;margin:0}main{max-width:1280px;margin:auto;padding:24px}h1{font-size:25px}nav{position:sticky;top:0;background:#fff;padding:14px;display:flex;gap:12px;flex-wrap:wrap;border:1px solid #d9e1eb;z-index:1}input,select{padding:8px;border:1px solid #b7c3d1;border-radius:4px}input[type=search]{min-width:260px}article{background:white;border:1px solid #d9e1eb;margin:16px 0;padding:14px;border-radius:8px}header{display:flex;gap:16px;align-items:center}header small{margin-left:auto;color:#55657a}.body{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:16px 0}.body img{image-rendering:pixelated;max-width:100%;width:auto;min-width:160px;max-height:480px}.body a{display:flex;align-items:flex-start;justify-content:flex-start}.body img{zoom:2}pre{white-space:pre-wrap;font:20px/1.7 "Yu Gothic","Meiryo",monospace;margin:0;background:#f6f8fb;padding:12px}footer{font-size:13px;color:#52637a}footer p:empty{display:none}a{color:#145cc5}.notice{border-left:4px solid #df9f28;padding:12px;background:#fff8e7;line-height:1.8}[hidden]{display:none!important}@media(max-width:760px){.body{grid-template-columns:1fr}header{flex-wrap:wrap}header small{margin:0}.body img{zoom:1.5}}</style>
<main><h1>testcase 文本识别审阅</h1><p>456 张原图 · 585 个存档区域 · __ACTIVE__ 个识别目标 · __EXCLUDED__ 个文字被遮挡或不可见区域已排除；候选基准，待人工复核冻结。</p><p class="notice">仅边框、底板或空白被覆盖而文字完整的区域保留识别；目标文字被遮挡或目标不可见时排除。原7项残字及2个不可见旧候选保留供追溯，切换范围可查看。数字、标点、换行照录；本次整理不代表 OCR 应用验收通过。</p>
<nav><input id="q" type="search" placeholder="搜索编号、类型或日文"><select id="platform"><option value="">两组截图</option><option value="gba">GBA</option><option value="ngc">NGC</option></select><select id="scope"><option value="active">仅识别范围</option><option value="excluded">仅排除的区域</option><option value="">全部存档</option></select><span id="count"></span></nav>'''+''.join(cards)+'''</main><script>const q=document.querySelector('#q'),p=document.querySelector('#platform'),s=document.querySelector('#scope'),cards=[...document.querySelectorAll('article')];function filter(){let count=0;const eligible=cards.filter(c=>!s.value||c.dataset.scope===s.value);for(const c of cards){const show=(!p.value||c.dataset.platform===p.value)&&(!s.value||c.dataset.scope===s.value)&&c.dataset.query.includes(q.value.toLowerCase());c.hidden=!show;if(show)count++}document.querySelector('#count').textContent=count+' / '+eligible.length+' 个区域'}q.addEventListener('input',filter);p.addEventListener('change',filter);s.addEventListener('change',filter);filter();</script></html>'''
    page=page.replace('__ACTIVE__',str(len(active))).replace('__EXCLUDED__',str(len(excluded)))
    (HERE/'review.html').write_text(page,encoding='utf-8')
    # Portable digest manifest covers delivered answers and every review crop.
    files=['ground_truth.json','regions.jsonl','regions.csv','summary.json','review.html','excluded_regions.json','occlusion_review.json','annotation-revisions.json']+[r['crop'] for r in rows]
    (HERE/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256((HERE/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in files),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=True,indent=2))

if __name__=='__main__':build()
