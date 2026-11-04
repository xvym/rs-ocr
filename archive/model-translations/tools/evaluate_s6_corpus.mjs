import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,read,csv} from './corpus_common.mjs';
import {dataValues,displaySymbols,sameItems} from './chinese_corpus_acceptance_common.mjs';
import {loadS6Probe} from './s6_corpus_probe.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const out=path.resolve(root,args.find(a=>a!=='--gate')||'reports/s6-acceptance');fs.mkdirSync(out,{recursive:true});
const hash=local=>sha256(fs.readFileSync(path.join(root,local))),json=local=>JSON.parse(read(path.join(root,local)));
const frozen=json('corpus/acceptance/freeze-manifest.json');for(const f of frozen.files)if(hash('corpus/acceptance/'+f.local)!==f.sha256)throw Error('Changed frozen Chinese reference');
const reference=json('corpus/acceptance/reference.json'),{probe,pack,manifest}=loadS6Probe(root);
const judgmentLocal='corpus/s6/output-judgments.json',judgments=fs.existsSync(path.join(root,judgmentLocal))?json(judgmentLocal):[];
const judgmentMap=new Map(),usedJudgments=new Set();for(const j of judgments){const key=sha256(Buffer.from(JSON.stringify({japanese:j.japanese,expectedChinese:j.expectedChinese,actualChinese:j.actualChinese})));if(key!==j.key||!['equivalent','incorrect'].includes(j.verdict)||!j.reason||j.method!=='model_output_review'||judgmentMap.has(key))throw Error('Invalid output judgment');judgmentMap.set(key,j);}
const pending=new Map(),results=[];
function evaluate(u,regionType,game='both'){
  const actual=probe.lookup(u.japanese,{game,type:regionType,kind:u.context?.kind||null}),hasChinese=actual.chinese!==null;
  const valuesCorrect=sameItems(dataValues(u.japanese),dataValues(actual.output));
  // Approved lexical names can introduce PP/HP in Chinese (e.g. PP Up). All
  // actually observed symbols still have to survive; field values are not made up.
  const before=displaySymbols(u.japanese),after=displaySymbols(actual.output),remaining=[...after];
  const symbolsCorrect=before.every(s=>{const at=remaining.indexOf(s);if(at<0)return false;remaining.splice(at,1);return true;});
  const binding=hasChinese?{japanese:u.japanese,expectedChinese:u.expectedChinese,actualChinese:actual.chinese}:null;
  const key=binding?sha256(Buffer.from(JSON.stringify(binding))):null,j=key?judgmentMap.get(key):null;
  if(j)usedJudgments.add(key);
  let semantic=hasChinese?(u.expectedChinese===actual.chinese?'strict_equal':j?.verdict||'pending_review'):'not_available';
  let passed=false;
  if(u.action==='translate')passed=hasChinese&&['strict_equal','equivalent'].includes(semantic)&&valuesCorrect&&symbolsCorrect;
  else if(u.action==='retain_name_or_translate'){
    const name=u.requiredBindings?.[0]?.raw,translated=name?probe.name(name,{game}):name;
    passed=valuesCorrect&&symbolsCorrect&&(!hasChinese?actual.output===u.japanese&&translated===name:translated!==name&&actual.output.includes(translated));semantic=passed?'legal_name_handling':'name_handling_failed';
  } else {passed=!hasChinese&&actual.output===u.japanese&&valuesCorrect&&symbolsCorrect;semantic=passed?'legal_raw_retention':'unexpected_translation';}
  if(semantic==='pending_review'){const entry=pending.get(key)||{key,...binding,ids:[]};entry.ids.push(u.id);pending.set(key,entry);}
  return {...u,regionType,actualChinese:actual.chinese,actualOutput:actual.output,resourceStatus:actual.status,sourceIds:actual.sources,semantic,valuesCorrect,symbolsCorrect,passed};
}
const regions=reference.regions.filter(r=>r.action!=='exclude_no_output').map(r=>{
  const units=r.units.map(u=>({...evaluate(u,r.regionType),regionId:r.id,platform:r.platform}));results.push(...units);return {id:r.id,regionType:r.regionType,units,passed:units.every(u=>u.passed)};
});
const translated=results.filter(r=>r.action==='translate'),available=translated.filter(r=>r.actualChinese!==null),legal=results.filter(r=>r.action!=='translate');
const scenarios=reference.scenarios.map(s=>evaluate({...s,expectedChinese:s.expectedChinese||s.japanese},s.regionType||null,s.game));
if([...judgmentMap.keys()].some(k=>!usedJudgments.has(k)))throw Error('Stale unused output judgment; re-review changed outputs');
const summary={schemaVersion:1,stage:'S6_library_only',targetRegions:regions.length,totalTranslationUnits:translated.length,available:available.length,
  semanticCorrect:available.filter(r=>r.passed).length,pendingSemanticGroups:pending.size,coverage:available.length/translated.length,
  legalRetention:{passed:legal.filter(r=>r.passed).length,total:legal.length},regionsPassed:regions.filter(r=>r.passed).length,
  valuesCorrect:results.every(r=>r.valuesCorrect),symbolsCorrect:results.every(r=>r.symbolsCorrect),
  gatePassed:translated.length===770&&translated.every(r=>r.passed)&&legal.every(r=>r.passed),
  supplementalScenarios:{passed:scenarios.filter(s=>s.passed).length,total:scenarios.length,notAllAreVerifiedOriginalTemplates:true},
  excludedChinesePipeline:'not_executed_in_S6',negativeChinesePipeline:'not_executed_in_S6',
  blind:false,method:'Frozen independent Chinese expectations against new reviewed S6 resources; output-bound semantic judgments; same implementing model, non-blind',
  resourceSummary:pack.summary,referenceSha256:hash('corpus/acceptance/reference.json'),runtimeSha256:hash('outputs/s6-corpus/runtime.json')};
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
save('summary.json',summary);save('evaluation.json',{summary,regions,units:results,scenarios});save('pending-semantic-review.json',[...pending.values()]);
fs.writeFileSync(path.join(out,'gaps.csv'),csv(translated.filter(r=>!r.passed),['id','regionId','regionType','japanese','expectedChinese','actualChinese','semantic','resourceStatus','valuesCorrect','symbolsCorrect']));
save('run-manifest.json',{schemaVersion:1,inputs:[{local:'corpus/acceptance/reference.json',sha256:summary.referenceSha256},{local:'outputs/s6-corpus/build-manifest.json',sha256:hash('outputs/s6-corpus/build-manifest.json')},...(fs.existsSync(path.join(root,judgmentLocal))?[{local:judgmentLocal,sha256:hash(judgmentLocal)}]:[])],
  implementation:['tools/evaluate_s6_corpus.mjs','tools/s6_corpus_probe.mjs','tools/chinese_corpus_acceptance_common.mjs'].map(local=>({local,sha256:hash(local)})),outputs:['summary.json','evaluation.json','pending-semantic-review.json','gaps.csv'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary));if(args.includes('--gate')&&!summary.gatePassed)process.exitCode=2;
