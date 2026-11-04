import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSourceMatcher,resolveRegion,project} from './japanese_source_matcher.mjs';
import {read,sha256,csv} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);if(args.length>1||args.some(a=>a.startsWith('--')))throw Error('Usage: node tools/evaluate_source_matching.mjs [output-directory]');
const out=path.resolve(root,args[0]||'reports/japanese-source-matching');fs.mkdirSync(out,{recursive:true});
const json=local=>JSON.parse(read(path.join(root,local))),hash=local=>sha256(fs.readFileSync(path.join(root,local)));
const frozen=json('corpus/source-matching/freeze-manifest.json');
for(const f of frozen.files)if(hash(f.local)!==f.sha256)throw Error(`Changed source-matching baseline: ${f.local}`);
const compact=json('reports/japanese-source-matching/ocr-inputs.json'),japanese=json('reports/s3-acceptance/reference.json'),predictions=json('reports/s3-acceptance/predictions.json');
if(compact.referenceSha256!==hash('reports/s3-acceptance/reference.json')||compact.predictionsSha256!==hash('reports/s3-acceptance/predictions.json'))throw Error('Frozen S3 evidence changed');
if(compact.inputs.length!==579||new Set(compact.inputs.map(r=>r.id)).size!==579)throw Error('Incomplete OCR input');
const {matcher,records,nativeRecords,battleTemplates,inputs}=loadSourceMatcher(root),review=json('corpus/source-matching/reference.json');
if(review.judgmentsSha256!==hash('corpus/source-matching/review-cases.mjs'))throw Error('Stale source review');
for(const f of review.inputs)if(hash(f.local)!==f.sha256)throw Error('Changed source-review input');
for(const c of review.cases)for(const e of c.sourceEvidence)if(records.find(r=>r.qid===e.qid)?.japanese!==e.japanese||sha256(Buffer.from(e.japanese))!==e.japaneseSha256)throw Error('Stale source judgment');
const regions=compact.inputs.map(r=>{
  const p=predictions.regions.find(p=>p.instance_id===r.id),ref=japanese.regions.find(x=>x.instance_id===r.id);
  if(!p||p.text!==r.japanese||!ref?.recognition_in_scope||r.sourceSha256!==ref.source_sha256||r.source!==ref.source)throw Error(`Invalid actual input ${r.id}`);
  const result=resolveRegion(matcher,r.japanese,{typeCandidates:r.typeCandidates,alternatives:r.alternatives});
  return {...r,result};
});
const reviewed=review.cases.map(c=>{
  const result=matcher.lookup(c.input.japanese,c.input),got=new Set(result.sourceQids||[]);
  const missing=c.expectedSourceQids.filter(q=>!got.has(q)),unexpected=c.completeCandidateSet?[...got].filter(q=>!c.expectedSourceQids.includes(q)):null;
  return {...c,result,missingExpectedSources:missing,unexpectedSources:unexpected,passed:missing.length===0&&(!unexpected||unexpected.length===0)};
});
const battleReview=json('corpus/battle-matching/review-reference.json');
if(battleReview.judgmentsSha256!==hash('corpus/battle-matching/review-cases.mjs')||battleReview.ocrInputsSha256!==hash('reports/japanese-source-matching/ocr-inputs.json'))throw Error('Battle judgments changed');
const reviewedBattle=battleReview.cases.map(c=>{
  const r=regions.find(r=>r.id===c.regionId);if(!r||r.japanese!==c.japanese||sha256(Buffer.from(c.japanese))!==c.japaneseSha256)throw Error('Battle OCR evidence changed');
  for(const e of c.sourceEvidence)if(records.find(r=>r.qid===e.qid)?.japanese!==e.japanese||sha256(Buffer.from(e.japanese))!==e.sha256)throw Error('Battle source evidence changed');
  const result=r.result.units.length===1?r.result.units[0].result:null,semantic=result?.semanticResolution,meaning=semantic?.meaning;
  const missing=c.expectedSourceQids.filter(q=>!result?.sourceQids.includes(q));
  const unexpected=(result?.sourceQids||[]).filter(q=>!c.expectedSourceQids.includes(q));
  const passed=semantic?.status==='consistent'&&meaning?.event===c.event&&meaning.actors.subject?.raw===c.subject&&missing.length===0&&unexpected.length===0&&
    (c.event==='move_use'?meaning.moveId===c.moveId:meaning.stat===c.stat&&meaning.delta===c.delta);
  return {...c,passed,missingSources:missing,unexpectedSources:unexpected,semanticResolution:semantic};
});
const units=regions.flatMap(r=>r.result.units.map((u,i)=>({...u,id:`${r.id}:S${i+1}`,regionId:r.id,platform:r.platform})));
const prior=json('reports/japanese-source-matching/baseline-v1.json');
if(hash('reports/japanese-source-matching/baseline-v1.json')!=='7bf01341b180da0b7ddeb6719afaf43ea1282f2ca3c5fd1830658e988ace8ebe')throw Error('Original 769-unit measurement was modified');
if(prior.regions.length!==579||prior.summary.unitWithCandidate!==600||prior.summary.units!==769)throw Error('Unexpected original source-matching baseline');
const comparisons=prior.regions.flatMap(old=>{
  const current=regions.find(r=>r.id===old.id);if(!current||current.japanese!==old.japanese)throw Error('Original OCR comparison changed');
  return old.units.map((u,index)=>{
    const parts=current.result.units.filter(p=>p.start<u.end&&p.end>u.start);
    return {id:`${old.id}:S${index+1}`,raw:u.raw,previousHadCandidate:u.sourceQids.length>0,
      currentAnyPartHasCandidate:parts.some(p=>p.result.candidates.length>0),currentAllPartsHaveCandidates:parts.length>0&&parts.every(p=>p.result.candidates.length>0),
      currentParts:parts.map(p=>({raw:p.raw,searchText:p.searchText,status:p.result.status,sourceQids:p.result.sourceQids}))};
  });
});
const countBy=(list,key)=>Object.fromEntries([...new Set(list.map(key))].sort().map(k=>[k,list.filter(x=>key(x)===k).length]));
const fullSources=new Map();
for(const r of records){const k=project(r.japanese).key;fullSources.set(k,true);}
const exact=new Set(records.filter(r=>r.japanese&&r.japanese!=='[NULL]').map(r=>r.japanese));
const worklist=units.map(u=>{
  const hits=u.result.candidates,hasChinese=hits.some(c=>c.chinese.hasCandidate),hasReviewed=hits.some(c=>c.chinese.hasReviewedStaticRecord);
  return {id:u.id,regionId:u.regionId,platform:u.platform,raw:u.raw,searchText:u.searchText,status:u.result.status,sourceCount:new Set(hits.map(c=>c.qid)).size,
    sourceQids:JSON.stringify([...new Set(hits.map(c=>c.qid))]),hasChineseCandidate:hasChinese,hasReviewedSource:hasReviewed,
    nextAction:!hits.length?u.result.status==='fragment_only'?'review_partial_visible_window':u.result.status==='blocked'?'review_input_or_alternative_limit':'investigate_source_or_composition':
      u.result.semanticResolution.status==='conflict'?'resolve_battle_semantic_conflict':u.result.semanticResolution.status==='consistent'?'review_structured_battle_meaning_and_chinese':
      u.result.status==='ambiguous'?'review_source_ambiguity':hits.some(c=>c.mode==='template_hypothesis')?'review_slot_callsite_and_semantic_unit':!hasChinese?'build_chinese_correspondence':!hasReviewed?'review_existing_chinese_candidate':'review_visible_semantic_unit_before_integration'};
});
const summary={schemaVersion:1,scope:'Offline source candidate retrieval on actual archived OCR; no Chinese publication or real-time integration',
 sourceRecords:records.length,nativeLabelRecords:nativeRecords.length,unsupportedSourceRecords:matcher.unsupported.length,images:japanese.images.length,targetRegions:regions.length,
 excludedRegionsNotFed:japanese.regions.filter(r=>!r.recognition_in_scope).length,scopeNegativeImagesNotFed:japanese.images.filter(i=>i.scope_negative_approved).length,
 strictFullRegionExactSourceHits:regions.filter(r=>exact.has(r.japanese)).length,
 regionWithAnyCandidate:regions.filter(r=>r.result.units.some(u=>u.result.candidates.length)).length,
 regionWithCandidatesForAllUnits:regions.filter(r=>r.result.allUnitsHaveSourceCandidates).length,
 units:units.length,unitStrictWholeSourceHits:units.filter(u=>exact.has(u.searchText)).length,
 unitWhitespaceOnlyWholeSourceHits:units.filter(u=>fullSources.has(project(u.searchText).key)).length,
 unitWithCandidate:units.filter(u=>u.result.candidates.length).length,unitStatuses:countBy(units,u=>u.result.status),
 unitsWithChineseCandidate:worklist.filter(w=>w.hasChineseCandidate).length,unitsWithReviewedSource:worklist.filter(w=>w.hasReviewedSource).length,
 nextActions:countBy(worklist,w=>w.nextAction),unitsWithCapturedSlots:units.filter(u=>u.result.candidates.some(c=>c.bindings.length)).length,
 unitsWithAmbiguousBindings:units.filter(u=>u.result.bindingAmbiguous).length,bindingSearchTruncatedUnits:units.filter(u=>u.result.bindingSearchComplete===false).length,
 ocrAlternativeRegions:regions.filter(r=>r.alternatives.length).length,unmappedAmbiguousGlyphs:regions.reduce((n,r)=>n+r.unmappedAmbiguousGlyphs,0),
 reviewedProbes:{total:reviewed.length,passed:reviewed.filter(c=>c.passed).length,
   expectedSourceOccurrences:reviewed.reduce((n,c)=>n+c.expectedSourceQids.length,0),retrievedExpectedSources:reviewed.reduce((n,c)=>n+c.expectedSourceQids.length-c.missingExpectedSources.length,0),
   exhaustiveCandidateSetCases:reviewed.filter(c=>c.completeCandidateSet).length,allPassed:reviewed.every(c=>c.passed),
   independence:review.independence},
 battleMatching:{templates:battleTemplates.summary,semanticStatuses:countBy(units,u=>u.result.semanticResolution.status),
   reviewedFixedCases:{total:reviewedBattle.length,passed:reviewedBattle.filter(c=>c.passed).length,
     statChanges:{total:reviewedBattle.filter(c=>c.event==='stat_change').length,passed:reviewedBattle.filter(c=>c.event==='stat_change'&&c.passed).length},
     moveUses:{total:reviewedBattle.filter(c=>c.event==='move_use').length,passed:reviewedBattle.filter(c=>c.event==='move_use'&&c.passed).length},
     method:battleReview.method,blind:battleReview.blind,limitation:battleReview.limitation}},
 fullSetSourceAccuracy:null,fullSetAccuracyStatus:'not_claimed_without_exhaustive_source_judgments',
 original769Comparison:{total:comparisons.length,previousWithCandidate:600,
   currentWithAnyCandidateEvidence:comparisons.filter(c=>c.currentAnyPartHasCandidate).length,currentAllPartsHaveCandidates:comparisons.filter(c=>c.currentAllPartsHaveCandidates).length,
   recoveredAllParts:comparisons.filter(c=>!c.previousHadCandidate&&c.currentAllPartsHaveCandidates).length,
   remainingWithoutCompleteCandidateEvidence:comparisons.filter(c=>!c.currentAllPartsHaveCandidates).length,
   previousHitsNowIncomplete:comparisons.filter(c=>c.previousHadCandidate&&!c.currentAllPartsHaveCandidates).map(c=>c.id),
   note:'Original OCR spans retained. A decomposed span counts complete only when every emitted text component has source candidates; captured fields remain unapproved.'},
 chineseCoverageBaselineUnchanged:'Historical model-authored Chinese gates withdrawn; source candidates do not approve translations',
 limitations:['Candidate presence is not source correctness or Chinese coverage.','Template capture is syntactic evidence, not verified buffer meaning or identity.','Source-record and visible-window identity do not define publishable Chinese semantic units.','No fuzzy edit-distance correction or unseen future content is used.','Version attribution remains unknown for each screenshot.','Full-set exhaustive source judgments, Japanese automatic wrapping/call-sites, and live continuity remain incomplete.']};
const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
save('summary.json',summary);save('results.json',{summary,regions,reviewedProbes:reviewed,reviewedBattleCases:reviewedBattle});save('unsupported-sources.json',matcher.unsupported);save('baseline-comparison.json',comparisons);save('battle-review.json',reviewedBattle);
fs.writeFileSync(path.join(out,'worklist.csv'),csv(worklist,['id','regionId','platform','raw','searchText','status','sourceCount','sourceQids','hasChineseCandidate','hasReviewedSource','nextAction']));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=regions.map(r=>`<section data-search="${esc(r.id+' '+r.japanese+' '+r.result.units.map(u=>u.result.status).join(' '))}"><h2>${esc(r.id)} · ${esc(r.typeCandidates.join(' / '))}</h2><pre>${esc(r.japanese)}</pre>${r.result.units.map(u=>`<details><summary>${esc(u.raw)} — ${esc(u.result.status)} (${u.result.candidates.length})</summary>${u.visibleFields.length?`<pre>可见字段 ${esc(JSON.stringify(u.visibleFields))}</pre>`:''}${u.result.candidates.map(c=>`<article><code>${esc(c.qid)}</code><p>${esc(c.mode)} · 第${c.page+1}段／第${c.lineStart+1}行 · ${esc(c.chinese.status)}</p><pre>${esc(c.sourceJapanese)}</pre>${c.bindings.length?`<pre>${esc(JSON.stringify(c.bindings,null,2))}</pre>`:''}</article>`).join('')}${u.result.hints.map(h=>`<article>片段线索：<code>${esc(h.qid)}</code><pre>${esc(h.sourceJapanese)}</pre></article>`).join('')}</details>`).join('')}</section>`).join('');
fs.writeFileSync(path.join(out,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>日文来源匹配诊断</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:32px auto;padding:0 20px;background:#f4f6f8;color:#18212b}header,section{background:white;padding:20px;margin:18px 0;border-radius:10px}input{width:90%;padding:12px;font:inherit}h1{font-size:26px}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border-top:1px solid #ddd;padding:12px 0}article{border-left:3px solid #678ba6;padding:4px 16px;margin:12px 0}code{overflow-wrap:anywhere}summary{cursor:pointer}</style><header><h1>日文来源匹配 · 离线诊断</h1><p>579 个实际 OCR 区域；${summary.unitWithCandidate}/${summary.units} 个检索单元有候选。候选命中不代表来源正确或中文可发布。已核对探针 ${summary.reviewedProbes.passed}/${summary.reviewedProbes.total}；全量来源准确率尚未验收。</p><input id="search" placeholder="筛选区域编号、日文或状态" aria-label="筛选诊断记录"><p id="count">579 个区域</p></header><main>${cards}</main><script>document.querySelector('#search').addEventListener('input',e=>{let n=0;for(const s of document.querySelectorAll('section')){s.hidden=!s.dataset.search.toLowerCase().includes(e.target.value.toLowerCase());if(!s.hidden)n++}document.querySelector('#count').textContent=n+' 个区域'})</script></html>`);
const implementations=['tools/japanese_source_matcher.mjs','tools/japanese_source_layout.mjs','tools/battle_source_matcher.mjs','tools/build_battle_source_templates.mjs','tools/verify_battle_printing.py','tools/freeze_battle_source_review.mjs','tools/test_battle_source_matching.mjs','tools/corpus_common.mjs','tools/resolve_japanese.mjs','tools/evaluate_source_matching.mjs','tools/freeze_source_matching_inputs.mjs','tools/freeze_source_matching_review.mjs','tools/freeze_source_matching_baseline.mjs','tools/test_source_matching.mjs'];
save('run-manifest.json',{schemaVersion:1,inputs:[...inputs,...['corpus/battle-matching/review-reference.json','corpus/battle-matching/review-cases.mjs','corpus/source-matching/freeze-manifest.json','reports/japanese-source-matching/baseline-v1.json','reports/japanese-source-matching/ocr-inputs.json','corpus/source-matching/reference.json','reports/s3-acceptance/predictions.json','reports/s3-acceptance/reference.json'].map(local=>({local,sha256:hash(local)}))],
 implementation:implementations.map(local=>({local,sha256:hash(local)})),outputs:['summary.json','results.json','battle-review.json','baseline-comparison.json','worklist.csv','review.html','unsupported-sources.json'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));
if(!summary.reviewedProbes.allPassed||reviewedBattle.some(c=>!c.passed))process.exitCode=2;
