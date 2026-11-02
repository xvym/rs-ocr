"""Compare scoped OCR predictions against candidate screenshot annotations.

Predictions: {"regions": [{"instance_id": "GBA-001-R01", "text": "..."}]}.
Omit a region, or set present=false, to report that it was not detected.
This tool compares results, and does not run an OCR engine.
"""
from pathlib import Path
import argparse, json, re, sys, unicodedata

HERE=Path(__file__).resolve().parent

def distance(a,b):
    """Levenshtein distance on Unicode code points (or token sequences)."""
    previous=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        current=[i]
        for j,cb in enumerate(b,1):
            current.append(min(current[-1]+1,previous[j]+1,previous[j-1]+(ca!=cb)))
        previous=current
    return previous[-1]

def visual(text):
    # Explicit optional equivalences only. Do not use NFKC: kana matter.
    text=unicodedata.normalize('NFC',text)
    text=text.translate(str.maketrans({'!':'！','?':'？','／':'/','：':':'}))
    return re.sub(r'\s+','',text)

def load_predictions(value):
    if not isinstance(value,dict) or not isinstance(value.get('regions'),list):
        raise ValueError('输入必须是含 regions 数组的 JSON 对象。')
    indexed={}
    for r in value['regions']:
        if not isinstance(r,dict) or not isinstance(r.get('instance_id'),str):raise ValueError('每个预测必须包含字符串 instance_id。')
        rid=r['instance_id']
        if rid in indexed:raise ValueError(f'预测 instance_id 重复：{rid}')
        if not isinstance(r.get('present',True),bool):raise ValueError(f'{rid}: present 必须是布尔值。')
        if 'text' not in r and isinstance(r.get('lines'),list) and all(isinstance(s,str) for s in r['lines']):
            r={**r,'text':'\n'.join(r['lines'])}
        if not r.get('present',True):
            if r.get('text',''):raise ValueError(f'{rid}: present=false 不能同时包含非空文本。')
            r={**r,'text':''}
        if not isinstance(r.get('text'),str):raise ValueError(f'{rid}: text 必须是字符串，或提供字符串 lines 数组。')
        if 'logical_box' in r:
            box=r['logical_box']
            if not isinstance(box,list) or len(box)!=4 or not all(isinstance(n,(int,float)) and not isinstance(n,bool) for n in box) or box[2]<=0 or box[3]<=0:
                raise ValueError(f'{rid}: logical_box 必须是有效的 [x,y,w,h]。')
        indexed[rid]=r
    return indexed

def iou(a,b):
    x,y,w,h=a;l,t,c,d=b
    area=max(0,min(x+w,l+c)-max(x,l))*max(0,min(y+h,t+d)-max(y,t))
    return area/(w*h+c*d-area)

def compare(data,predictions,include_fragments=False):
    got=load_predictions(predictions)
    expected={r['instance_id']:r for r in data['regions']}
    unknown=sorted(set(got)-set(expected))
    excluded=[r for r in expected.values() if not r['recognition_in_scope']]
    excluded_outputs=[r['instance_id'] for r in excluded if r['instance_id'] in got and got[r['instance_id']].get('present',True)]
    results=[];withheld=[];image_results={}
    for rid,r in expected.items():
        if not r['recognition_in_scope']:continue
        if not r['assertion_ready'] and not include_fragments:
            withheld.append(rid)
            image_results.setdefault(r['image_id'],[]).append(None)
            continue
        p=got.get(rid);present=p is not None and p.get('present',True)
        # Only CRLF -> LF is automatic in strict mode; spaces and punctuation matter.
        actual=p['text'].replace('\r\n','\n') if present else ''
        target=r['expect_region_visible']
        strict=present==target and actual==r['text']
        equivalent=present==target and visual(actual)==visual(r['text'])
        item={'instance_id':rid,'image_id':r['image_id'],'strict_correct':strict,'visual_correct':equivalent,
              'region_expected':target,'region_predicted':present,'expected_text':r['text'],'actual_text':actual,
              'strict_edits':distance(r['text'],actual) if target else 0,
              'strict_reference_characters':len(r['text']) if target else 0,
              'visual_edits':distance(visual(r['text']),visual(actual)) if target else 0,
              'visual_reference_characters':len(visual(r['text'])) if target else 0,
              'numbers_correct':re.findall(r'[0-9]+',actual)==r['number_tokens'] if target else not actual}
        if present and target and p.get('logical_box'):
            item['roi_iou_informational']=iou(r['logical_box'],p['logical_box'])
        results.append(item);image_results.setdefault(r['image_id'],[]).append(strict)
    strict_den=sum(r['strict_reference_characters'] for r in results)
    visual_den=sum(r['visual_reference_characters'] for r in results)
    strict_edits=sum(r['strict_edits'] for r in results)
    visual_edits=sum(r['visual_edits'] for r in results)
    full_images={k:v for k,v in image_results.items() if None not in v}
    numeric=[r for r in results if expected[r['instance_id']]['number_tokens']]
    report={
        'reference_freeze_status':data['freeze_status'],
        'recognition_scope_rule':data['recognition_scope_policy']['rule'],
        'warning':'此结果验证预测与候选标注的符合程度，不是标注准确率或产品验收结论。',
        'total_reference_records':len(expected),'total_scope_records':len(expected)-len(excluded),'evaluated_records':len(results),
        'excluded_occluded_records':[r['instance_id'] for r in excluded],
        'false_positive_excluded_regions':excluded_outputs,
        'withheld_fragment_records':withheld,'include_fragments':include_fragments,
        'unknown_prediction_ids':unknown,
        'strict_correct':sum(r['strict_correct'] for r in results),
        'strict_region_accuracy':sum(r['strict_correct'] for r in results)/len(results) if results else None,
        'visual_correct':sum(r['visual_correct'] for r in results),
        'visual_region_accuracy':sum(r['visual_correct'] for r in results)/len(results) if results else None,
        'missing_visible_regions':[r['instance_id'] for r in results if r['region_expected'] and not r['region_predicted']],
        'false_positive_invisible_candidates':[r['instance_id'] for r in excluded if not r['expect_region_visible'] and r['instance_id'] in excluded_outputs],
        'strict_CER':strict_edits/strict_den if strict_den else None,
        'strict_character_edits':strict_edits,'strict_reference_characters':strict_den,
        'visual_CER':visual_edits/visual_den if visual_den else None,
        'visual_character_edits':visual_edits,'visual_reference_characters':visual_den,
        'numeric_records':len(numeric),'numeric_records_correct':sum(r['numbers_correct'] for r in numeric),
        'fully_evaluated_images':len(full_images),
        'strict_fully_correct_images':sum(all(v) for v in full_images.values()),
        'partially_withheld_images':[k for k,v in image_results.items() if None in v],
        'failures':[r for r in results if not r['strict_correct']],
        'geometry_iou':[{k:r[k] for k in ('instance_id','roi_iou_informational')} for r in results if 'roi_iou_informational' in r],
        'geometry_note':'IoU 仅为信息项；NGC 视口估计及 ROI 不是字形紧框真值，未设置自动几何验收阈值。',
    }
    report['all_evaluated_passed']=not unknown and not excluded_outputs and all(r['strict_correct'] for r in results)
    report['entire_scope_verified']=report['all_evaluated_passed'] and not withheld
    return report

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('predictions',type=Path)
    parser.add_argument('--reference',type=Path,default=HERE/'ground_truth.json')
    parser.add_argument('--out',type=Path)
    parser.add_argument('--include-fragments',action='store_true',help='仅影响范围内的候选残字；不能重新纳入已排除的遮挡框。')
    args=parser.parse_args()
    try:
        data=json.loads(args.reference.read_text(encoding='utf-8-sig'))
        predictions=json.loads(args.predictions.read_text(encoding='utf-8-sig'))
        result=compare(data,predictions,args.include_fragments)
    except (OSError,ValueError,KeyError) as exc:
        print(str(exc),file=sys.stderr);return 2
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.out:args.out.write_text(text,encoding='utf-8')
    else:print(text)
    return 0 if result['all_evaluated_passed'] else 1

if __name__=='__main__':sys.exit(main())
