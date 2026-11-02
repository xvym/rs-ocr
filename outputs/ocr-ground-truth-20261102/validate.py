"""Validate delivered data, source identity, and comparator behavior."""
from pathlib import Path
import copy, csv, hashlib, importlib.util, json, re
from collections import Counter
from html.parser import HTMLParser

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]

def main():
    data=json.loads((HERE/'ground_truth.json').read_text(encoding='utf-8'))
    rows=data['regions'];byid={r['instance_id']:r for r in rows};checks=[]
    def check(label,condition):
        assert condition,label
        checks.append(label)
    check('unique_region_ids',len(rows)==len(byid)==585)
    check('all_51_types',len({r['region_type'] for r in rows})==51)
    check('platform_type_counts',{p:len({r['region_type'] for r in rows if r['platform']==p}) for p in ('gba','ngc')}=={'gba':45,'ngc':47})
    check('platform_instance_counts',Counter(r['platform'] for r in rows)=={'gba':379,'ngc':206})
    scoped={}
    for p in ('gba','ngc'):
        catalog=json.loads((ROOT/f'reports/textbox-catalog/{p}.json').read_text(encoding='utf-8'))
        for im in catalog['images']:
            for r in im['regions']:scoped[r['instance_id']]=r
    check('exact_retained_catalog_membership',set(scoped)==set(byid))
    excluded_ids={
        'GBA-027-R04','GBA-028-R04','GBA-201-R07','GBA-201-R08','GBA-229-R07','GBA-229-R08',
        'GBA-285-R03','GBA-287-R03','NGC-095-R03','NGC-097-R03','NGC-099-R03',
    }
    restored_ids={'GBA-027-R03','GBA-028-R03','GBA-090-R03','GBA-278-R01','GBA-278-R03','GBA-285-R02',
                  'NGC-084-R01','NGC-084-R03','NGC-095-R02','NGC-115-R03'}
    active=[r for r in rows if r['recognition_in_scope']]
    check('only_text_occluded_or_invisible_excluded',{r['instance_id'] for r in rows if not r['recognition_in_scope']}==excluded_ids)
    check('active_recognition_counts',len(active)==574 and Counter(r['platform'] for r in active)=={'gba':371,'ngc':203})
    check('frame_overlap_not_automatic_exclusion',{r['instance_id'] for r in active if r['recognition_occluded_by']}==restored_ids)
    check('exclusion_matches_text_visibility',all(r['recognition_in_scope']==(r['expect_region_visible'] and not r['target_text_occluded']) for r in rows))
    check('text_visibility_review_source_hash',hashlib.sha256((HERE/'occlusion_review.json').read_bytes()).hexdigest()==data['occlusion_review_sha256'])
    check('upper_dialog_remains_target',byid['GBA-027-R01']['recognition_in_scope'])
    check('shared_battle_frame_retains_complete_prompt',byid['GBA-090-R03']['recognition_in_scope'] and byid['GBA-090-R03']['recognition_box']==[0,112,240,48] and byid['GBA-090-R03']['text']=='カイオーガは どうする？')
    check('clipped_feel_regions_remain_excluded',all(not byid[rid]['recognition_in_scope'] and byid[rid]['target_text_occluded'] for rid in ('GBA-287-R03','NGC-099-R03')))
    check('roi_padding_does_not_exclude_panel',byid['GBA-287-R04']['recognition_in_scope'])
    for im in data['images']:
        check('source_hash:'+im['id'],hashlib.sha256((ROOT/im['source']).read_bytes()).hexdigest()==im['sha256'])
        check('not_assumed_negative:'+im['id'],im['negative_sample_approved'] is False)
    invisible=[r for r in rows if not r['expect_region_visible']]
    check('invisible_overrides',{r['image_id'] for r in invisible}=={'GBA-201','GBA-229'} and all(r['region_type']=='party_prompt' and not r['text'] and r['visible_logical_rectangles']==[] for r in invisible))
    check('no_gba315_expansion',not any(r['image_id']=='GBA-315' for r in rows))
    for r in rows:
        check('text_lines:'+r['instance_id'],r['text']=='\n'.join(r['lines']))
        check('no_build_sentinels:'+r['instance_id'],'[EMPTY]' not in r['text'] and '[FRAGMENTS_ONLY]' not in r['text'])
        check('number_strings:'+r['instance_id'],r['number_tokens']==re.findall('[0-9]+',r['text']))
        check('crop_hash:'+r['instance_id'],hashlib.sha256((HERE/r['crop']).read_bytes()).hexdigest()==r['crop_file_sha256'])
        x,y,w,h=r['logical_box']
        check('roi_bounds:'+r['instance_id'],0<=x<240 and 0<=y<160 and w>0 and h>0 and x+w<=240 and y+h<=160)
        for a,b,c,d in r['visible_logical_rectangles']:
            check('visible_bounds:'+r['instance_id'],x<=a and y<=b and c>0 and d>0 and a+c<=x+w and b+d<=y+h)
        if 'duplicate_of' in r:
            ref=byid[r['duplicate_of']]
            check('exact_crop_reuse:'+r['instance_id'],r['crop_sha256']==ref['crop_sha256'] and r['text']==ref['text'] and r['region_type']==ref['region_type'])
    check('no_pending_transcriptions',all(r['status']!='pending' for r in rows))
    check('explicit_human_review_pending',all(r['human_review_status']=='pending' for r in rows))
    check('seven_fragments_archived_outside_scope',sum(not r['assertion_ready'] for r in rows)==7 and all(r['assertion_ready'] for r in active))
    check('full_image_index',len(data['images'])==456)
    with (HERE/'regions.csv').open(encoding='utf-8-sig',newline='') as f:csv_rows=list(csv.DictReader(f))
    check('csv_roundtrip',len(csv_rows)==585 and all(r['text']==byid[r['instance_id']]['text'] and json.loads(r['number_tokens'])==byid[r['instance_id']]['number_tokens'] and r['recognition_in_scope']==str(byid[r['instance_id']]['recognition_in_scope']) for r in csv_rows))
    jsonl=[json.loads(line) for line in (HERE/'regions.jsonl').read_text(encoding='utf-8').splitlines()]
    check('jsonl_roundtrip',jsonl==rows)
    class Links(HTMLParser):
        def __init__(self):super().__init__();self.refs=[];self.articles=0
        def handle_starttag(self,tag,attrs):
            if tag=='article':self.articles+=1
            self.refs += [value for key,value in attrs if key in ('src','href') and value and not value.startswith('#')]
    links=Links();links.feed((HERE/'review.html').read_text(encoding='utf-8'))
    check('review_article_count',links.articles==585)
    check('review_local_links',all((HERE/p).exists() for p in links.refs))
    for line in (HERE/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        digest,path=line.split('  ',1)
        check('export_hash:'+path,hashlib.sha256((HERE/path).read_bytes()).hexdigest()==digest)
    spec=importlib.util.spec_from_file_location('ocr_compare',HERE/'compare.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    baseline={'regions':[{'instance_id':r['instance_id'],'text':r['text']} for r in active]}
    report=module.compare(data,baseline)
    check('comparator_full_candidate_input',report['all_evaluated_passed'] and report['strict_CER']==0 and report['evaluated_records']==574)
    check('excluded_records_not_character_targets',report['total_reference_records']==585 and report['total_scope_records']==574 and set(report['excluded_occluded_records'])==excluded_ids and not report['withheld_fragment_records'])
    missing_restored={'regions':[p for p in baseline['regions'] if p['instance_id']!='GBA-090-R03']}
    check('restored_prompt_is_required',module.compare(data,missing_restored)['missing_visible_regions']==['GBA-090-R03'])
    changed=copy.deepcopy(baseline)
    changed['regions'][0]['text']='X'+changed['regions'][0]['text'][1:]
    mutated=module.compare(data,changed)
    check('comparator_detects_one_wrong_character',not mutated['all_evaluated_passed'] and mutated['strict_character_edits']==1)
    missing=copy.deepcopy(baseline);missing['regions']=missing['regions'][1:]
    check('comparator_detects_missing_region',module.compare(data,missing)['missing_visible_regions']==[baseline['regions'][0]['instance_id']])
    extra=copy.deepcopy(baseline);extra['regions'].append({'instance_id':invisible[0]['instance_id'],'text':'ポケモンを えらんで ください'})
    check('comparator_detects_hidden_prompt_hallucination',module.compare(data,extra)['false_positive_invisible_candidates']==[invisible[0]['instance_id']])
    occluded=copy.deepcopy(baseline);occluded['regions'].append({'instance_id':'GBA-201-R08','text':'る'})
    rejected=module.compare(data,occluded,include_fragments=True)
    check('excluded_partial_text_rejected_even_with_fragment_flag',not rejected['all_evaluated_passed'] and rejected['false_positive_excluded_regions']==['GBA-201-R08'] and rejected['strict_CER']==0)
    absent=copy.deepcopy(baseline);absent['regions'].append({'instance_id':'GBA-201-R08','present':False})
    check('explicitly_absent_excluded_frame_allowed',module.compare(data,absent)['all_evaluated_passed'])
    duplicate=copy.deepcopy(baseline);duplicate['regions'].append(duplicate['regions'][0])
    try:module.compare(data,duplicate)
    except ValueError:duplicate_rejected=True
    else:duplicate_rejected=False
    check('duplicate_prediction_rejected',duplicate_rejected)
    check('levenshtein_unicode',module.distance('カイオーガ','カイオー力')==1)
    result={'status':'passed','check_count':len(checks),'checked_source_images':456,'checked_region_records':585,
            'checked_export_hashes':592,'recognition_targets':len(active),'excluded_text_occluded_or_invisible_regions':len(excluded_ids),'restored_complete_text_regions':len(restored_ids),
            'checks':['scope membership and counts','text-visibility decisions restore complete text despite frame overlap','all source hashes','coordinate and visible bounds','source-linked exact-crop reuse','JSONL/CSV lossless roundtrip','local HTML links','export and crop digests','comparator correct input / one-character error / missing restored region / excluded-region output rejection / duplicate ID'],
            'comparator_fixture_check':{'input':'synthetic annotations copied for comparator-only validation; not an OCR run','evaluated_records':report['evaluated_records'],'withheld_records':len(report['withheld_fragment_records']),'entire_scope_verified':report['entire_scope_verified']},
            'ocr_engine_tested':False,'annotation_accuracy_measured':False,'human_review':'pending'}
    (HERE/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,ensure_ascii=True,indent=2))

if __name__=='__main__':main()
