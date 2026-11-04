import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {read,sha256,csv} from './corpus_common.mjs';
import {POLICY,verifyManifest} from './rsc_translation_policy.mjs';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {loadSourceMatcher,resolveRegion} from './japanese_source_matcher.mjs';
import {verifyFiles,VISIBLE_POLICY} from './s6_visible_windows.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
let outputDirectory='reports/s6-visible-windows',gate=false;
for(let i=0;i<args.length;i++){if(args[i]==='--gate')gate=true;else if(args[i]==='--out'&&args[i+1]&&!args[i+1].startsWith('--'))outputDirectory=args[++i];else throw Error('Usage: node tools/evaluate_visible_windows.mjs [--gate] [--out directory]');}
const out=path.resolve(root,outputDirectory),json=local=>JSON.parse(read(path.join(root,local))),hash=local=>sha256(fs.readFileSync(path.join(root,local)));
const frozen=json('corpus/visible-windows/freeze-manifest.json');verifyFiles(root,[...frozen.inputs,...frozen.implementation]);
if(frozen.policyId!==VISIBLE_POLICY||hash('corpus/visible-windows/reference.json')!==frozen.outputs.find(f=>f.file==='reference.json')?.sha256)throw Error('Changed visible-window reference');
verifyManifest(root,'outputs/corpus-mapping');verifyManifest(root,'outputs/s6-corpus');
const reference=json('corpus/visible-windows/reference.json'),{visibleProbe}=loadS6Probe(root),{matcher,inputs:sourceInputs}=loadSourceMatcher(root),ocr=json('reports/japanese-source-matching/ocr-inputs.json');
for(const image of reference.images)if(hash(image.source)!==image.sourceSha256)throw Error('Changed registered screenshot '+image.source);
const inputMap=new Map(ocr.inputs.map(r=>[r.id,r])),failures=[],rows=[],regionResults=[];
const countBy=(list,key)=>Object.fromEntries([...new Set(list.map(key))].sort().map(k=>[k,list.filter(x=>key(x)===k).length]));
for(const ref of reference.regions){
  const input=inputMap.get(ref.id);if(!input||input.japanese!==ref.japanese||input.sourceSha256!==ref.sourceSha256||hash(input.source)!==ref.sourceSha256)throw Error('Changed actual Japanese/image input '+ref.id);
  const actual=resolveRegion(matcher,input.japanese,{typeCandidates:input.typeCandidates,alternatives:input.alternatives});
  if(actual.units.length!==ref.units.length)throw Error('Visible segmentation changed '+ref.id);
  const units=ref.units.map((expected,i)=>{
    const unit=actual.units[i];if(unit.raw!==expected.raw||unit.searchText!==expected.searchText||unit.start!==expected.start||unit.end!==expected.end||JSON.stringify(unit.visibleFields||[])!==JSON.stringify(expected.visibleFields))throw Error('Visible fields changed '+expected.id);
    const result=visibleProbe.lookupUnit(unit,{type:ref.typeCandidates[0]});
    const gameChecks=['ruby','sapphire'].map(game=>{
      const value=visibleProbe.lookupUnit(unit,{type:ref.typeCandidates[0],game}),chinese=expected.expectedChineseByGame[game],at=unit.raw.indexOf(unit.searchText);
      const output=chinese===null?unit.raw:expected.outputMode==='whole_unit'?chinese:unit.raw.slice(0,at)+chinese+unit.raw.slice(at+unit.searchText.length);
      return {game,passed:value.chinese===chinese&&value.output===output&&isDeepStrictEqual(value.bindingsByGame?.[game]||null,expected.expectedBindingsByGame?.[game]||null)&&isDeepStrictEqual(value.nativeValuesByGame?.[game]||null,expected.expectedNativeValuesByGame?.[game]||null)};
    });
    const expectedIds=expected.expectedChinese===null?[]:expected.citations.map(c=>c.candidateId).sort();
    const expectedBindings=expected.expectedChinese===null?null:expected.expectedBindingsByGame||null;
    const passed=result.chinese===expected.expectedChinese&&result.output===expected.expectedOutput&&isDeepStrictEqual(result.visibleFields,expected.visibleFields)&&isDeepStrictEqual(result.bindingsByGame||null,expectedBindings)&&isDeepStrictEqual(result.nativeValuesByGame||null,expected.expectedNativeValuesByGame||null)&&(result.originalWordingSelection||null)===(expected.unknownGameSelection||null)&&JSON.stringify(result.citations.map(c=>c.candidateId).sort())===JSON.stringify(expectedIds)&&gameChecks.every(c=>c.passed);
    if(!passed)failures.push(expected.id);
    const row={id:expected.id,regionId:ref.id,platform:ref.platform,type:ref.typeCandidates[0],inFirstEdition:ref.inFirstEdition,raw:expected.raw,searchText:expected.searchText,disposition:expected.disposition,reasonCode:result.reason,output:result.output,chinese:result.chinese,sourceQids:JSON.stringify([...new Set(expected.sourceCandidates.map(c=>c.qid))]),citationIds:JSON.stringify(expectedIds),passed};rows.push(row);
    return {...row,start:unit.start,end:unit.end,visibleFields:result.visibleFields,citations:result.citations,bindingsByGame:result.bindingsByGame||null,nativeValuesByGame:result.nativeValuesByGame||null,nativeField:expected.nativeField||null,semanticUnit:expected.semanticUnit||null,variableFamily:expected.variableFamily||null,sourceCandidates:expected.sourceCandidates,gameChecks};
  });
  let cursor=0,output='';for(const u of units){output+=input.japanese.slice(cursor,u.start)+u.output;cursor=u.end;}output+=input.japanese.slice(cursor);
  regionResults.push({id:ref.id,source:ref.source,sourceSha256:ref.sourceSha256,platform:ref.platform,typeCandidates:ref.typeCandidates,logicalBox:ref.logicalBox,japanese:input.japanese,inFirstEdition:ref.inFirstEdition,output,units});
}
const scoped=rows.filter(r=>r.inFirstEdition),approved=scoped.filter(r=>r.chinese!==null),retained=scoped.filter(r=>r.chinese===null);
const variableReview=json('corpus/visible-windows/variable-bindings.json'),variableFixtureIds=new Set(variableReview.priorVariableCaseIds||[...variableReview.cases,...variableReview.retainedCases].map(c=>c.decisionId));
const fixtureByUnit=new Map(reference.regions.flatMap(r=>r.units.map(u=>[u.id,u])));
const variableAudit={scope:'All earlier variable_printing_unverified cases, reviewed by original template and binding family',uniqueCases:variableFixtureIds.size,occurrences:rows.filter(r=>variableFixtureIds.has(fixtureByUnit.get(r.id).decisionId)).length,
  families:variableReview.families.map(f=>({id:f.id,qid:f.qid,window:f.window,bindings:f.bindings,citations:f.citations})),
  cases:[...variableFixtureIds].map(id=>{const occurrences=rows.filter(r=>fixtureByUnit.get(r.id).decisionId===id);return {decisionId:id,family:variableReview.cases.find(c=>c.decisionId===id)?.family||null,occurrences:occurrences.map(r=>({id:r.id,raw:r.raw,chinese:r.chinese,output:r.output,reason:r.reasonCode,passed:r.passed})),reviewedRetention:variableReview.retainedCases.find(c=>c.decisionId===id)||null};})};
variableAudit.originalTemplateOutputOccurrences=variableAudit.cases.flatMap(c=>c.occurrences).filter(o=>o.chinese!==null).length;
variableAudit.retainedOccurrences=variableAudit.occurrences-variableAudit.originalTemplateOutputOccurrences;
const summary={schemaVersion:1,policyId:VISIBLE_POLICY,translationPolicy:POLICY,sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,baselineGatePassed:failures.length===0,approvedOutputChecksPassed:approved.every(r=>r.passed),fallbackChecksPassed:rows.filter(r=>r.chinese===null).every(r=>r.passed),
  images:reference.images.length,targetRegions:reference.regions.length,units:rows.length,firstEditionRegions:reference.regions.filter(r=>r.inFirstEdition).length,firstEditionUnits:scoped.length,
  originalChineseUnits:approved.length,originalOutputMetric:'Original RSC wording or verified existing native format; numeric-only fields are not Chinese text.',originalFormatOnlyUnits:approved.filter(r=>/^[\s0-9０-９Lv,]+$/.test(r.chinese)).length,retainedJapaneseUnits:retained.length,retainedByDesignUnits:retained.filter(r=>r.reasonCode==='invariant_raw_label').length,unresolvedRetainedUnits:retained.filter(r=>r.reasonCode!=='invariant_raw_label').length,outsideFirstEditionRegions:reference.regions.filter(r=>!r.inFirstEdition).length,outsideFirstEditionUnits:rows.length-scoped.length,
  uniqueReviewedDecisions:new Set(reference.regions.flatMap(r=>r.units).map(u=>u.decisionId)).size,
  fullyOriginalChineseRegions:regionResults.filter(r=>r.inFirstEdition&&r.units.every(u=>u.chinese!==null)).length,
  perPlatform:countBy(scoped,r=>r.platform),byType:[...new Set(scoped.map(r=>r.type))].sort().map(type=>({type,units:scoped.filter(r=>r.type===type).length,originalChinese:approved.filter(r=>r.type===type).length,retainedJapanese:retained.filter(r=>r.type===type).length})),
  fallbackReasons:countBy(retained,r=>r.reasonCode),excludedRegionsRegistered:reference.excludedRegions.length,scopeNegativeImagesRegistered:reference.images.filter(i=>i.scopeNegative).length,
  excludedAndNegativeChineseOutputs:'not_executed_in_S6; retained S3 visibility evidence, S7/S8 application checks pending',
  gameChecks:scoped.length*2,gameAttribution:'Each fixture is checked against both original-source versions; screenshot version attribution is unknown, not per-version hardware evidence.',
  generatedChineseRecords:0,rewrittenChineseRecords:0,approvedOriginalTemplateFamilies:variableReview.families.length,semanticUnitPlans:json('corpus/visible-windows/semantic-units.json').plans.length,originalPrintRecipes:json('corpus/visible-windows/native-fields.json').fields.length,generatedChineseTemplates:0,variableBindingAudit:{uniqueCases:variableAudit.uniqueCases,occurrences:variableAudit.occurrences,originalTemplateOutputOccurrences:variableAudit.originalTemplateOutputOccurrences,retainedOccurrences:variableAudit.retainedOccurrences},fullFirstEditionChineseGatePassed:false,S6Complete:false,independentReview:false,blind:false,
  requiredPageEvidenceGaps:reference.requiredPageEvidenceGaps,failures,
  scope:'Source-linked fixed visible-window output and conservative fallback contract. Deferred Japanese is separately counted and is not Chinese coverage or final semantic/product acceptance.'};
fs.mkdirSync(out,{recursive:true});const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
save('summary.json',summary);save('evaluation.json',{summary,regions:regionResults});
save('variable-binding-audit.json',variableAudit);
fs.writeFileSync(path.join(out,'units.csv'),csv(rows,['id','regionId','platform','type','inFirstEdition','raw','searchText','disposition','reasonCode','output','chinese','sourceQids','citationIds','passed']));
fs.writeFileSync(path.join(out,'remaining.csv'),csv(retained,['id','regionId','platform','type','raw','reasonCode','sourceQids']));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const relative=p=>path.relative(out,path.join(root,p)).split(path.sep).join('/');
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>S6 原 RSC 可见窗口基线</title><style>body{font:16px system-ui;margin:24px;background:#f5f7fa;color:#182132}header{position:sticky;top:0;background:#f5f7fa;padding:12px;z-index:1}article{background:white;margin:18px 0;padding:18px;border:1px solid #d8dfe8;border-radius:10px}img{max-width:560px;max-height:300px}pre{white-space:pre-wrap;overflow-wrap:anywhere}td{vertical-align:top;padding:10px;border-top:1px solid #ddd}table{width:100%;border-collapse:collapse}code{font-size:12px}.muted{color:#526179}select,input{padding:8px;margin:4px}</style><header><h1>原 RSC 可见窗口基线</h1><p>首版 '+scoped.length+' 单元：原译文 '+approved.length+'，保留日文 '+retained.length+'。范围外 '+(rows.length-scoped.length)+'。同一模型非盲复核；完整 S6 与实际应用尚未通过。</p><input id="q" aria-label="搜索" placeholder="搜索原文、中文或编号"><select id="mode" aria-label="筛选"><option value="all">全部区域</option><option value="pending">首版含保留日文</option><option value="ready">首版全部引用原中文</option><option value="outside">首版范围外</option></select></header>'+regionResults.map(r=>'<article data-mode="'+(!r.inFirstEdition?'outside':r.units.every(u=>u.chinese!==null)?'ready':'pending')+'"><h2>'+esc(r.id)+' · '+esc(r.typeCandidates.join('/'))+'</h2><a href="'+esc(relative(r.source))+'"><img loading="lazy" alt="'+esc(r.id)+' 原始截图" src="'+esc(relative(r.source))+'"></a><table><tr><th>可见日文</th><th>原中文引用／日文回退</th><th>来源及判断</th></tr>'+r.units.map(u=>'<tr><td><pre>'+esc(u.raw)+'</pre></td><td><pre>'+esc(u.output)+'</pre><span class="muted">'+esc(u.disposition)+'</span></td><td>'+esc(u.reasonCode)+u.citations.map(c=>'<p><code>'+esc(c.qid)+'<br>'+esc(c.sourceId)+':'+c.sourceLine+' ['+c.span.join(', ')+') · '+esc(c.game)+'</code><pre>'+esc(c.quote)+'</pre></p>').join('')+'</td></tr>').join('')+'</table></article>').join('')+'<script>const q=document.querySelector("#q"),m=document.querySelector("#mode");function filter(){for(const a of document.querySelectorAll("article"))a.hidden=!(m.value==="all"||a.dataset.mode===m.value)||!a.textContent.toLowerCase().includes(q.value.toLowerCase())}q.addEventListener("input",filter);m.addEventListener("change",filter);</script></html>';
fs.writeFileSync(path.join(out,'review.html'),html);
const impl=['tools/evaluate_visible_windows.mjs','tools/s6_visible_windows.mjs','tools/s6_variable_bindings.mjs','tools/s6_semantic_units.mjs','tools/s6_native_fields.mjs','tools/s6_corpus_probe.mjs','tools/japanese_source_matcher.mjs','tools/japanese_source_layout.mjs'];
save('run-manifest.json',{schemaVersion:1,policyId:VISIBLE_POLICY,translationPolicy:POLICY,inputs:[...new Set(['corpus/visible-windows/freeze-manifest.json','corpus/visible-windows/reference.json','corpus/visible-windows/variable-bindings.json','outputs/s6-corpus/build-manifest.json',...sourceInputs.map(f=>f.local)])].map(local=>({local,sha256:hash(local)})),implementation:impl.map(local=>({local,sha256:hash(local)})),outputs:['summary.json','evaluation.json','units.csv','remaining.csv','variable-binding-audit.json','review.html'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));if(gate&&!summary.baselineGatePassed)process.exitCode=1;
