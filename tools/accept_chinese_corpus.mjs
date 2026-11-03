import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,read,csv,parseCsv} from './corpus_common.mjs';
import {checkedJson,layoutKey,dataValues,displaySymbols,sameItems,StaticCorpusProbe} from './chinese_corpus_acceptance_common.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frozenDir=path.join(root,'corpus/acceptance');
const freeze=checkedJson(path.join(frozenDir,'freeze-manifest.json'));
for(const f of freeze.files)checkedFile(path.join(frozenDir,f.local),f.sha256);
function checkedFile(file,hash) {const bytes=fs.readFileSync(file);if(sha256(bytes)!==hash)throw Error(`Hash mismatch: ${file}`);return bytes;}
const reference=checkedJson(path.join(frozenDir,'reference.json'));
checkedFile(path.join(root,reference.policy.japaneseReference),reference.japaneseReferenceSha256);
const resourceDir=path.join(root,'outputs/corpus-mapping'),build=checkedJson(path.join(resourceDir,'build-manifest.json'));
for(const f of build.outputs)checkedFile(path.join(resourceDir,f.file),f.sha256);
const runtime=checkedJson(path.join(resourceDir,'runtime.json')),probe=new StaticCorpusProbe(runtime);
const judgmentFile=path.join(frozenDir,'semantic-judgments.json');
const judgments=fs.existsSync(judgmentFile)?checkedJson(judgmentFile):[];
const judgmentMap=new Map();
for(const j of judgments) {
  const key=sha256(Buffer.from(JSON.stringify({japanese:j.japanese,expectedChinese:j.expectedChinese,actualChinese:j.actualChinese})));
  if(key!==j.key||judgmentMap.has(key)||!['equivalent','incorrect'].includes(j.verdict)||j.method!=='model_output_review'||!j.reason)throw Error('Invalid or duplicate semantic judgment');
  judgmentMap.set(key,j);
}
const args=process.argv.slice(2);
if(args.some(a=>a.startsWith('--')&&a!=='--gate')||args.filter(a=>!a.startsWith('--')).length>1)throw Error('Usage: node tools/accept_chinese_corpus.mjs [output-directory] [--gate]');
const out=path.resolve(root,args.find(a=>!a.startsWith('--'))||'reports/chinese-corpus-acceptance');
fs.mkdirSync(out,{recursive:true});
const writeJson=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
const fraction=(n,d)=>({correct:n,total:d,rate:d?n/d:null});
const usedJudgments=new Set();
function resultFor(unit,game='both') {
  // The probe receives only Japanese and explicitly configured game. It never receives expected Chinese,
  // action, annotation IDs, or future frames. Truth is consulted only after the resource lookup.
  const actual=probe.lookup(unit.japanese,game),hasChinese=actual.chinese!==null;
  const valuesCorrect=sameItems(dataValues(unit.japanese),dataValues(actual.output));
  const symbolsCorrect=sameItems(displaySymbols(unit.japanese),displaySymbols(actual.output));
  const key=hasChinese?sha256(Buffer.from(JSON.stringify({japanese:unit.japanese,expectedChinese:unit.expectedChinese,actualChinese:actual.chinese}))):null;
  const judgment=key?judgmentMap.get(key):null;
  if(judgment)usedJudgments.add(key);
  let semantic=hasChinese?(actual.chinese===unit.expectedChinese?'strict_equal':judgment?.verdict||'pending_model_review'):'not_published';
  let passed=false;
  if(unit.action==='translate')passed=hasChinese&&['strict_equal','equivalent'].includes(semantic)&&valuesCorrect&&symbolsCorrect;
  else if(unit.action==='retain_name_or_translate') {
    const name=unit.requiredBindings?.[0]?.raw;
    const nameRecord=name?probe.lookup(name,game):null;
    // Raw retention is legal only if no approved complete name is available.
    passed=!nameRecord?.chinese&&actual.output===unit.japanese&&valuesCorrect&&symbolsCorrect;
    if(nameRecord?.chinese&&hasChinese)passed=valuesCorrect&&symbolsCorrect&&actual.output.includes(nameRecord.chinese);
    semantic=passed?'legal_name_retention':'name_lookup_or_retention_failed';
  } else {
    passed=!hasChinese&&actual.output===unit.japanese&&valuesCorrect&&symbolsCorrect;
    semantic=passed?'legal_raw_retention':'unexpected_translation';
  }
  const forbidden=unit.forbiddenIndependentContinuation;
  const premature=Boolean(forbidden&&hasChinese&&actual.output.includes(forbidden));
  if(premature)passed=false;
  return {...unit,game,actualChinese:actual.chinese,actualOutput:actual.output,resourceStatus:actual.status,sourceIds:actual.sources,
    strictSourceMatch:actual.exactMatch,semantic,judgmentKey:judgment?key:null,valuesCorrect,symbolsCorrect,prematureIndependentUnit:premature,passed,
    missingReason:hasChinese?null:unit.context?'typed_context_not_exported':unit.requiredBindings?.length?'name_or_dynamic_template_unavailable':dataValues(unit.japanese).length?'numeric_or_composite_template_unavailable':unit.japanese.includes('\n')?'visible_window_unavailable':'static_unit_unavailable'};
}
const unitResults=[],regionResults=[];
for(const r of reference.regions) {
  if(r.action==='exclude_no_output') {
    // No detector/translator exists in this harness: do not turn an oracle mask into an executed test.
    regionResults.push({...r,status:'not_executed_no_chinese_pipeline',passed:null});continue;
  }
  const units=r.units.map(u=>({...resultFor(u),regionId:r.id,imageId:r.imageId,platform:r.platform,regionType:r.regionType}));
  unitResults.push(...units);
  regionResults.push({...r,units,status:units.every(u=>u.passed)?'passed':'failed',passed:units.every(u=>u.passed)});
}
const scenarios=reference.scenarios.map(s=>resultFor({...s,expectedChinese:s.expectedChinese||s.japanese,requiredBindings:s.requiredBindings||[]},s.game));
for(const key of judgmentMap.keys())if(!usedJudgments.has(key))throw Error(`Unused/stale semantic judgment: ${key}`);
const translationUnits=unitResults.filter(u=>u.action==='translate'),published=translationUnits.filter(u=>u.actualChinese!==null);
const legal=unitResults.filter(u=>u.action!=='translate');
function summarize(items) {
  const t=items.filter(u=>u.action==='translate'),p=t.filter(u=>u.actualChinese!==null),raw=items.filter(u=>u.action!=='translate');
  return {units:items.length,translationCoverage:fraction(p.length,t.length),correctTranslationCoverage:fraction(t.filter(u=>u.passed).length,t.length),
    publishedSemanticAccuracy:fraction(p.filter(u=>['strict_equal','equivalent'].includes(u.semantic)).length,p.length),
    pendingSemanticReviews:p.filter(u=>u.semantic==='pending_model_review').length,legalRawRetention:fraction(raw.filter(u=>u.passed).length,raw.length)};
}
const by=(items,key)=>Object.fromEntries([...new Set(items.map(u=>u[key]))].sort().map(value=>[value,summarize(items.filter(u=>u[key]===value))]));
const valueUnits=unitResults.filter(u=>dataValues(u.japanese).length),symbolUnits=unitResults.filter(u=>displaySymbols(u.japanese).length);
const translatedValueUnits=valueUnits.filter(u=>u.actualChinese!==null),fallbackValueUnits=valueUnits.filter(u=>u.actualChinese===null);
const summary={schemaVersion:1,date:'2026-11-03',policyId:reference.id,scope:'current formal static resource pack; offline full-unit availability probe; not S7 application output',
  gatePassed:translationUnits.every(u=>u.passed)&&legal.every(u=>u.passed),
  finalA6Passed:false,finalA6Status:'not_executed_S7_S8_evidence_missing',
  referenceSha256:sha256(fs.readFileSync(path.join(frozenDir,'reference.json'))),freezeManifestSha256:sha256(fs.readFileSync(path.join(frozenDir,'freeze-manifest.json'))),
  corpusBuildManifestSha256:sha256(fs.readFileSync(path.join(resourceDir,'build-manifest.json'))),runtimeSha256:sha256(fs.readFileSync(path.join(resourceDir,'runtime.json'))),
  runtimeRecords:runtime.records.length,reference:reference.summary,
  fixedSet:{...summarize(unitResults),strictSourceMatches:translationUnits.filter(u=>u.strictSourceMatch&&u.actualChinese!==null).length,
    strictChineseMatches:published.filter(u=>u.semantic==='strict_equal').length,outputBoundEquivalentMatches:published.filter(u=>u.semantic==='equivalent').length,
    incorrectPublishedTranslations:published.filter(u=>u.semantic==='incorrect').length,
    completeRegions:fraction(regionResults.filter(r=>r.passed===true).length,579),
    completeImages:fraction(reference.regions.filter(r=>r.action!=='exclude_no_output').map(r=>r.imageId).filter((x,i,a)=>a.indexOf(x)===i)
      .filter(id=>regionResults.filter(r=>r.imageId===id&&r.action!=='exclude_no_output').every(r=>r.passed)).length,
      new Set(reference.regions.filter(r=>r.action!=='exclude_no_output').map(r=>r.imageId)).size)},
  valueRetention:{allValues:fraction(valueUnits.filter(u=>u.valuesCorrect).length,valueUnits.length),
    valueOccurrences:unitResults.reduce((n,u)=>n+dataValues(u.japanese).length,0),
    translatedUnits:fraction(translatedValueUnits.filter(u=>u.valuesCorrect).length,translatedValueUnits.length),
    rawFallbackUnits:fraction(fallbackValueUnits.filter(u=>u.valuesCorrect).length,fallbackValueUnits.length),
    symbols:fraction(symbolUnits.filter(u=>u.symbolsCorrect).length,symbolUnits.length),
    limitation:'Raw fallback preserves source numbers by construction; this does not validate dynamic value binding or Chinese rendering.'},
  byPlatform:by(unitResults,'platform'),byRegionType:by(unitResults,'regionType'),
  supplementalScenarios:{...summarize(scenarios),passed:scenarios.filter(s=>s.passed).length,total:scenarios.length,byCategory:by(scenarios,'category'),
    participatesInFixedSetGate:false,scope:'constructed resource probes; not verified Japanese script coverage or the fixed-set denominator'},
  excludedChineseOutputChecks:{required:11,executed:0,status:'not_executed_no_chinese_pipeline'},
  negativeChineseOutputChecks:{required:reference.scopeNegativeImages.length,executed:0,status:'not_executed_no_chinese_pipeline'},
  imageGameAttribution:'unknown; no fabricated per-game screenshot acceptance rates',
  unexecutedRequirements:reference.policy.notExecutedByLibraryHarness,
  annotationIndependence:reference.policy.independence,
  thresholds:reference.policy.thresholds};
writeJson('predictions.json',{schemaVersion:1,referenceSha256:summary.referenceSha256,runtimeSha256:summary.runtimeSha256,
  units:unitResults.map(u=>({id:u.id,japanese:u.japanese,actualChinese:u.actualChinese,actualOutput:u.actualOutput,sourceIds:u.sourceIds,resourceStatus:u.resourceStatus})),
  scenarios:scenarios.map(s=>({id:s.id,japanese:s.japanese,actualChinese:s.actualChinese,actualOutput:s.actualOutput,sourceIds:s.sourceIds,resourceStatus:s.resourceStatus}))});
writeJson('evaluation.json',{summary,regions:regionResults,scenarios,scopeNegativeImages:reference.scopeNegativeImages.map(i=>({...i,status:'not_executed_no_chinese_pipeline'}))});
writeJson('summary.json',summary);
const columns=['id','regionId','imageId','platform','regionType','action','japanese','expectedChinese','actualChinese','actualOutput','resourceStatus','semantic','passed','missingReason'];
fs.writeFileSync(path.join(out,'units.csv'),csv(unitResults,columns));
fs.writeFileSync(path.join(out,'coverage-gaps.csv'),csv(translationUnits.filter(u=>u.actualChinese===null),columns));
fs.writeFileSync(path.join(out,'scenarios.csv'),csv(scenarios,['id','category','game','action','japanese','expectedChinese','actualChinese','actualOutput','semantic','passed','missingReason']));
const pending=new Map();
for(const u of [...unitResults,...scenarios].filter(u=>u.semantic==='pending_model_review')) {
  const key=sha256(Buffer.from(JSON.stringify({japanese:u.japanese,expectedChinese:u.expectedChinese,actualChinese:u.actualChinese})));
  const entry=pending.get(key)||{key,japanese:u.japanese,expectedChinese:u.expectedChinese,actualChinese:u.actualChinese,ids:[]};entry.ids.push(u.id);pending.set(key,entry);
}
writeJson('pending-semantic-review.json',[...pending.values()]);
// Secondary source discovery is diagnostic only; it cannot promote a candidate to published Chinese.
const sourceRecords=parseCsv(read(path.join(resourceDir,'records.csv'))),sourceCandidates=parseCsv(read(path.join(resourceDir,'candidates.csv')));
const sourceByLayout=new Map();
for(const r of sourceRecords){const key=layoutKey(r.japanese),list=sourceByLayout.get(key)||[];list.push(r.qid);sourceByLayout.set(key,list);}
const candidateQids=new Set(sourceCandidates.map(c=>c.qid));
const diagnostics=translationUnits.filter(u=>u.actualChinese===null).map(u=>{
  const qids=sourceByLayout.get(layoutKey(u.japanese))||[];
  return {id:u.id,regionType:u.regionType,japanese:u.japanese,reason:u.missingReason,exactSourceQids:qids,
    hasUnpublishedChineseCandidate:qids.some(qid=>candidateQids.has(qid))};
});
writeJson('gap-diagnostics.json',diagnostics);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=regionResults.map(r=>`<tr data-status="${r.status}"><td>${escape(r.id)}<br>${escape(r.regionType)}<br>${escape(r.status)}</td><td><pre>${escape(r.japanese)}</pre><a href="../../${escape(r.source)}">原图</a></td><td><pre>${escape(r.expectedChinese??'不应输出（本轮未执行中文管线检查）')}</pre></td><td><pre>${escape(r.units.map(u=>u.actualChinese??`[原文回退] ${u.japanese}`).join('\n'))}</pre></td><td>${r.units.map(u=>escape(`${u.id}: ${u.semantic}`)).join('<br>')}</td></tr>`).join('\n');
fs.writeFileSync(path.join(out,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>中文库固定集验收</title><style>body{font:15px system-ui;margin:24px;color:#172235}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd3dc;padding:10px;vertical-align:top}pre{font:inherit;white-space:pre-wrap;min-width:170px}input,select{font:inherit;padding:8px;margin:12px}</style><h1>中文库固定集验收：${summary.gatePassed?'通过':'未通过'}</h1><p>579目标，${published.length}/${translationUnits.length}单元有静态中文；库级可用性，不是已集成应用。合法原文保留另计；排除/负样本中文管线尚未执行。</p><input id="query" placeholder="搜索编号、日文或中文"><select id="status"><option value="">全部</option><option>failed</option><option>passed</option><option>not_executed_no_chinese_pipeline</option></select><table><thead><tr><th>目标</th><th>冻结日文</th><th>另编中文预期</th><th>当前静态包/原文回退</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table><script>const q=document.querySelector('#query'),s=document.querySelector('#status');function filter(){for(const row of document.querySelectorAll('tbody tr'))row.hidden=!(row.textContent.includes(q.value)&&(!s.value||row.dataset.status===s.value))}q.oninput=s.onchange=filter;</script></html>`);
writeJson('run-manifest.json',{schemaVersion:1,referenceSha256:summary.referenceSha256,runtimeSha256:summary.runtimeSha256,
  implementation:['tools/accept_chinese_corpus.mjs','tools/chinese_corpus_acceptance_common.mjs','tools/corpus_common.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
  semanticJudgmentsSha256:fs.existsSync(judgmentFile)?sha256(fs.readFileSync(judgmentFile)):null,
  outputs:['predictions.json','evaluation.json','summary.json','units.csv','coverage-gaps.csv','scenarios.csv','pending-semantic-review.json','gap-diagnostics.json','review.html'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify({gatePassed:summary.gatePassed,fixedSet:summary.fixedSet,scenarios:{passed:summary.supplementalScenarios.passed,total:scenarios.length},pendingSemanticGroups:pending.size},null,2));
if(process.argv.includes('--gate')&&!summary.gatePassed)process.exitCode=2;
