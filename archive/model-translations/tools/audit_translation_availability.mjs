import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {sha256,parseCsv,csv} from './corpus_common.mjs';
import {JapaneseSourceMatcher,project,regionUnits} from './japanese_source_matcher.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'reports/model-translation-audit'),inputs=[];
function bytes(local){const b=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(b)});return b;}
const cache=new Map();function json(local){if(!cache.has(local))cache.set(local,JSON.parse(bytes(local).toString('utf8').replace(/^\uFEFF/,'')));return cache.get(local);}
const audit=json('reports/model-translation-audit/summary.json'),items=json('reports/model-translation-audit/unique-translations.json');
assert.equal(items.length,audit.directlyAuthored.uniquePairs);
const corpusManifest=json('outputs/corpus-mapping/build-manifest.json');
function corpusCsv(file){const b=bytes('outputs/corpus-mapping/'+file);assert.equal(sha256(b),corpusManifest.outputs.find(f=>f.file===file).sha256);return parseCsv(b.toString('utf8'));}
const records=corpusCsv('records.csv'),candidates=corpusCsv('candidates.csv'),imports=corpusCsv('rsc-import.csv');
const sourceManifest=json('corpus/sources.json');for(const s of sourceManifest.sources.filter(s=>s.repository==='UWorldGX/pkmn_rs_chn_rsc'))assert.equal(sha256(bytes(s.local)),s.sha256);
const s6Manifest=json('outputs/s6-corpus/build-manifest.json'),runtimeBytes=bytes('outputs/s6-corpus/runtime.json');assert.equal(sha256(runtimeBytes),s6Manifest.outputs.find(f=>f.file==='runtime.json').sha256);
const pack=JSON.parse(runtimeBytes.toString('utf8')),matcher=new JapaneseSourceMatcher(pack.sourceRecords,{battleTemplates:pack.sourceTemplates});
const key=s=>project(s,{display:true}).key;
const byQid=new Map();for(const c of candidates){const xs=byQid.get(c.qid)||[];xs.push(c);byQid.set(c.qid,xs);}
const byJapanese=new Map();for(const r of records){const k=key(r.japanese);if(!k||r.japanese==='[NULL]')continue;const xs=byJapanese.get(k)||[];xs.push(r.qid);byJapanese.set(k,xs);}
const getParent=loc=>{const parts=loc.pointer.slice(1).split('/');let r=json(loc.file);for(const part of parts.slice(0,-1))r=r[part];return r;};
function candidateState(qids,game='both'){
  const cs=[...new Map(qids.flatMap(q=>(byQid.get(q)||[]).filter(c=>game==='both'||c.game===game)).map(c=>[c.id,c])).values()];
  const usable=cs.filter(c=>c.chinese.replace(/\[(?:延时|等待|提示音|音乐|调色板|擦除|文本色|背景色|阴影色|字景色|日文|英文)[^\]]*\]/g,'').replace(/\\[nlpcr]/g,'').trim().length);
  return {cs,usable};
}
function eventSources(event){
  const name=event.replace(/_(?:without_trainer|boosted)$/,'').replace(/^stat_limit_(upper|lower)$/,'stat_limit').replace(/^stat_change_cause$/,'stat_change');
  return [...new Set(pack.sourceTemplates.variants.filter(v=>v.meaning?.event===name).flatMap(v=>v.sourceQids))];
}
const matcherKinds=new Set(['species','move','move_description','type','ability','item','item_description','ability_description','nature','battle','dialogue','ui','native_label']);
const lookupCache=new Map();function resolve(raw,kind=null){if(!matcherKinds.has(kind))kind=null;const k=JSON.stringify([raw,kind]);if(!lookupCache.has(k))lookupCache.set(k,matcher.lookup(raw,{kind}));return lookupCache.get(k);}
function originalItem(raw,kind=null){
  const exact=byJapanese.get(key(raw))||[],direct=candidateState(exact);
  if(direct.usable.length)return {supported:true,qids:exact,cs:direct.usable,method:'same_complete_Japanese_record',unapproved:false};
  const r=resolve(raw,kind),qids=r.sourceQids||[],found=candidateState(qids);
  const reliable=r.semanticResolution?.status==='consistent'||r.candidates?.length&&r.candidates.every(c=>c.mode!=='template_hypothesis'&&c.mode!=='fragment_hint');
  return {supported:Boolean(reliable&&found.usable.length),qids,cs:found.usable,method:'source_matcher_current_source_candidate',unapproved:!reliable};
}
const results=[];
for(const item of items){
  const evidence=[],unresolved=[],contexts=[];let hasGameResource=false;
  for(const loc of item.locations){
    if(!loc.file.endsWith('.json'))continue;
    const parent=getParent(loc);
    if(loc.file==='corpus/acceptance/reference.json'){
      if(parent.action==='translate')contexts.push({raw:parent.japanese,type:parent.type||parent.regionType||null,kind:null});
      continue;
    }
    if(loc.file==='corpus/acceptance/scenarios.json'){
      if(!parent.id.startsWith('same-slot-repeated-'))contexts.push({raw:parent.japanese,type:parent.regionType||null,kind:parent.context?.kind||null});
      else unresolved.push({reason:'synthetic_unverified_game_sentence',id:parent.id});
      continue;
    }
    if(loc.file==='corpus/s6/event-translations.json'){
      if(loc.pointer.startsWith('/formats/')){hasGameResource=true;const qids=eventSources(loc.pointer.split('/').at(-1)),found=candidateState(qids);if(found.usable.length)evidence.push({method:'reviewed_event_family_source',qids,candidates:found.usable});else unresolved.push({reason:'event_family_link_unresolved',qids});}
      continue;
    }
    if(!loc.file.startsWith('corpus/'))continue;
    if(!parent.chinese)continue;
    hasGameResource=true;
    // A six-word native greeting cannot inherit a whole-sentence Chinese
    // translation just because some individual component words have candidates.
    if(parent.nativeReference){unresolved.push({reason:'native_composed_sentence_has_no_verified_whole_RSC_link',reference:parent.nativeReference});continue;}
    const qids=[...new Set([...(parent.qid?.startsWith('rs.')?[parent.qid]:[]),...(parent.sourceEvidence||[]).map(e=>e.qid),...(parent.sourceQids||[])])];
    const found=candidateState(qids,loc.game||'both');
    if(found.usable.length)evidence.push({method:'saved_source_record_link',qids,candidates:found.usable});
    else unresolved.push({reason:found.cs.length?'linked_entry_empty_or_controls_only':'no_verified_RSC_candidate_for_saved_source',qids,candidateIds:found.cs.map(c=>c.id)});
    // Additional identical Japanese entries can reveal a Chinese term whose
    // bridge was missing at the original qid; never infer from Chinese overlap.
    const exact=originalItem(parent.japanese,parent.kind||null);
    if(exact.supported)evidence.push({method:exact.method,qids:exact.qids,candidates:exact.cs});
  }
  // Expected complete regions can contain several independently translated
  // labels. Require every emitted language component to have source candidates.
  for(const context of contexts){
    const pieces=context.type?regionUnits(context.raw,[context.type]):[{searchText:context.raw,kind:context.kind}],checks=[];
    for(const piece of pieces){checks.push(originalItem(piece.searchText,context.kind||piece.kind||null));}
    if(checks.length&&checks.every(c=>c.supported))evidence.push({method:'all_current_region_components_have_RSC_sources',qids:[...new Set(checks.flatMap(c=>c.qids))],candidates:checks.flatMap(c=>c.cs)});
    else unresolved.push({reason:'not_all_region_components_have_verified_RSC_links',components:pieces.map((p,i)=>({japanese:p.searchText,supported:checks[i].supported,qids:checks[i].qids,unapproved:checks[i].unapproved}))});
  }
  const cs=[...new Map(evidence.flatMap(e=>e.candidates).map(c=>[c.id,c])).values()];
  let status=cs.length?'existing_RSC_source_translation_candidate':hasGameResource||contexts.length?'unresolved_not_proven_missing':'not_an_original_game_translation_unit';
  // Empty candidate fields or absence of an address bridge do not establish
  // absence from the original project; no automatic "missing" promotion.
  results.push({...item,status,rscCandidates:cs.map(c=>({id:c.id,qid:c.qid,game:c.game,chinese:c.chinese,kind:c.kind,sourceId:c.sourceId,sourceLine:c.sourceLine,address:c.address})),evidence:evidence.map(({candidates,...e})=>e),unresolved});
}
const statuses=Object.fromEntries([...new Set(results.map(r=>r.status))].map(s=>[s,results.filter(r=>r.status===s).length]));
const resources=results.filter(r=>r.categories.includes('model_authored_resource'));
const resourceStatuses=Object.fromEntries([...new Set(resources.map(r=>r.status))].map(s=>[s,resources.filter(r=>r.status===s).length]));
assert.equal(Object.values(statuses).reduce((n,c)=>n+c,0),items.length);
const summary={schemaVersion:1,snapshot:audit.snapshot,denominator:items.length,statuses,resourceOnly:{denominator:resources.length,statuses:resourceStatuses},confirmedMissing:0,
 confirmedMissingMeaning:'No item has yet been established absent/untranslated in the original project by a verified original location or complete source audit. This is not a finding that the project has zero missing translations.',
 existingMeaning:'An explicit corresponding original source record/template or complete identical Japanese term has nonempty RSC translation candidates in at least one applicable game. Some are a full parent page/script, and a few contain only quoted variables. This does not approve every visible subwindow, establish per-game completeness, or prove identical Japanese/English semantics.',
 missingBoundary:'No candidate/bridge, empty internal substring, untranslated native composition, or lack of standalone wording is not sufficient proof that the RSC project has no translation.',
 baseline:{rscImportedRows:imports.length,originalCandidateRows:candidates.length,pinnedRSCCommit:'f513cf437acca23d1a5882650ee3b148dc463a17'},
 nonApplicable:'Only fragments, explicitly unverified constructed scenarios, and test grammars without an original game translation unit; not missing game text.'};
fs.writeFileSync(path.join(out,'rsc-availability-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(out,'rsc-availability-details.json'),JSON.stringify(results,null,2)+'\n');
fs.writeFileSync(path.join(out,'rsc-availability.csv'),csv(results.map(r=>({id:r.id,status:r.status,categories:r.categories.join('|'),sourceText:r.sourceText,chinese:r.chinese,candidateCount:r.rscCandidates.length,originalChinese:[...new Set(r.rscCandidates.map(c=>c.chinese))].join('\n---\n'),qids:[...new Set(r.evidence.flatMap(e=>e.qids))].join('|'),reason:r.unresolved.map(u=>u.reason).join('|')})),['id','status','categories','sourceText','chinese','candidateCount','originalChinese','qids','reason']));
fs.writeFileSync(path.join(out,'rsc-availability-readme.txt'),`原汉化对应情况\n\n全量去重条目：${items.length}\n已有对应源段/完整词条的原汉化候选：${statuses.existing_RSC_source_translation_candidate||0}\n对应关系尚未查明（含组合/部分对应不足）：${statuses.unresolved_not_proven_missing||0}\n不适用于原作缺译判断的格式片段/构造测试：${statuses.not_an_original_game_translation_unit||0}\n\n仅看翻译资源：${resources.length}项；有对应源段候选${resourceStatuses.existing_RSC_source_translation_candidate||0}项；尚未核明${resourceStatuses.unresolved_not_proven_missing||0}项。\n\n没有任何条目被本审计自动判成“原项目确实缺译”。这不表示原项目缺译数为0，而是当前缺少能够证明原项目相应位置确实未译的逐项核验。没有匹配到候选、地址桥接不完整或组合句没有整句索引，都不等于原项目没有翻译。\n已有候选也不保证当前可见片段可以直接复用：部分候选是整段源文，含日英本地化差异，或者只有引用变量。需另外审查窗口、变量和语义；至少一作有候选不能证明两作均齐备。\n\n原始来源：固定RSC提交f513cf437acca23d1a5882650ee3b148dc463a17；两作总文本19610条导入记录及其名称词典。输入哈希逐项核验。\nrsc-availability.csv逐项列出当前模型译文、原汉化候选、qid及待核原因。JSON明细保留证据链。\n`);
fs.writeFileSync(path.join(out,'rsc-availability-manifest.json'),JSON.stringify({schemaVersion:1,inputs:[...new Map(inputs.map(i=>[i.local,i])).values()],implementation:['tools/audit_translation_availability.mjs','tools/japanese_source_matcher.mjs','tools/japanese_source_layout.mjs','tools/battle_source_matcher.mjs','tools/corpus_common.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),outputs:['rsc-availability-summary.json','rsc-availability-details.json','rsc-availability.csv','rsc-availability-readme.txt'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
