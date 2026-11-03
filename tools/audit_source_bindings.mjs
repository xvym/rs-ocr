import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256,csv,parseCsv} from './corpus_common.mjs';
import {project} from './japanese_source_matcher.mjs';
import {cases} from '../corpus/source-matching/binding-review-cases.mjs';
import {cases as experienceCases,sourceJapanese as experienceSourceJapanese} from '../corpus/source-matching/experience-review-cases.mjs';
import {cases as sendOutCases} from '../corpus/source-matching/send-out-review-cases.mjs';
import {cases as observationCases} from '../corpus/source-matching/observation-review-cases.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(root,process.argv[2]||'reports/japanese-source-matching');
fs.mkdirSync(output,{recursive:true});
const inputs=[];
const input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
const baselineLocal='reports/japanese-source-matching/binding-baseline-v1.json',baseline=JSON.parse(input(baselineLocal));
if(inputs.at(-1).sha256!=='590b30e41ade1bc19c09a5b326a24979fbfa6b1e07bf6bdfd7f0ec5c524a4cb6')throw Error('Changed binding baseline');
const ocrLocal='reports/japanese-source-matching/ocr-inputs.json',ocr=JSON.parse(input(ocrLocal));
if(inputs.at(-1).sha256!==baseline.inputs.find(f=>f.local===ocrLocal).sha256)throw Error('Changed OCR baseline');
const current=JSON.parse(input('reports/japanese-source-matching/results.json'));
const sourceRecords=parseCsv(input('outputs/corpus-mapping/records.csv'));
input('corpus/source-matching/binding-review-cases.mjs');
input('corpus/source-matching/experience-review-cases.mjs');
input('corpus/source-matching/send-out-review-cases.mjs');
input('corpus/source-matching/observation-review-cases.mjs');
const sendOutPack=JSON.parse(input('outputs/battle-source-matching/templates.json'));
const sendOutModels=sendOutPack.variants.filter(v=>v.sourceWindow);
const slotRules=JSON.parse(input('corpus/source-matching/typed-slot-rules.json'));
const nativeExperience=JSON.parse(input('reports/battle-source-matching/experience-evidence.json'));
const typedTerms=slotRules.rules.map(rule=>{
  const record=sourceRecords.find(r=>r.qid===rule.qid);
  if(!record||sha256(Buffer.from(record.japanese))!==rule.japaneseSha256||sha256(Buffer.from(record.english))!==rule.englishSha256)throw Error('Stale lexical slot rule');
  const prefix=rule.kind==='item'?'rs.common.items.gItems.':rule.kind==='species'?'rs.common.species_names.gSpeciesNames.':null;
  if(!prefix)throw Error('Unknown lexical term type');
  return {...rule,terms:new Set(sourceRecords.filter(r=>r.qid.startsWith(prefix)&&r.japanese&&r.japanese!=='[NULL]'&&!/[\[\\]/.test(r.japanese)).map(r=>project(r.japanese,{display:true}).key))};
});
const classRecords=sourceRecords.filter(r=>r.qid.startsWith('rs.common.trainer_class_names.')&&r.japanese&&r.japanese!=='[NULL]');
const classes=new Set(classRecords.map(r=>project(r.japanese,{display:true}).key));
const nameSlot=/^(?:PLAYER|RIVAL)$|^B_.*_NAME(?:_WITH_PREFIX)?$/;
const signature=c=>JSON.stringify([c.qid,c.page,c.lineStart,c.lineCount,c.bindings.map(b=>[b.slot,b.raw,b.start,b.end])]);
const currentUnit=before=>{
  const region=current.regions.find(r=>r.id===before.regionId),unit=region?.result.units[Number(before.id.split(':S')[1])-1];
  if(!unit||unit.searchText!==before.raw||!ocr.inputs.some(r=>r.id===region.id&&r.japanese===region.japanese))throw Error(`Changed binding input ${before.id}`);
  return unit;
};
const comparisons=baseline.cases.map(before=>{
  const unit=currentUnit(before),after=unit.result.candidates.filter(c=>c.bindings.length),kept=new Set(after.map(signature));
  const removed=before.candidates.filter(c=>!kept.has(signature(c))).map(c=>{
    const reasons=c.bindings.flatMap(b=>{
      const typed=typedTerms.find(t=>t.qid===c.qid&&t.slot===b.slot);
      const window=sendOutModels.find(m=>m.sourceQids.includes(c.qid)&&m.sourceWindow.page===c.page&&m.sourceWindow.lineStart===c.lineStart&&m.sourceWindow.lineCount===c.lineCount);
      const actor=window?.parts.find(p=>p.type==='actor'&&p.slot===b.slot);
      const numeric=window?.parts.find(p=>p.type==='number'&&p.slot===b.slot);
      const finite=window?.parts.find(p=>p.type==='choice'&&p.slot===b.slot);
      return nameSlot.test(b.slot)&&/[\r\n]/.test(b.raw)?['name_crosses_observed_line']:
        /^B_TRAINER[12]_CLASS$/.test(b.slot)&&(!classes.has(project(b.raw,{display:true}).key)||/[\r\n]/.test(b.raw))?['not_complete_trainer_class_term']:
        typed&&(!typed.terms.has(project(b.raw,{display:true}).key)||(typed.singleLine&&/[\r\n]/.test(b.raw)))?['not_complete_qid_typed_term']:
        actor&&/[\r\n]/.test(b.raw)?['reviewed_window_actor_crosses_observed_line']:
        numeric&&(!/^(?:0|[1-9][0-9]*)$/.test(b.normalized)||b.normalized.length>numeric.maxDigits||! /^[0-9０-９]+$/.test(b.raw))?['not_reviewed_decimal_buffer']:
        finite&&(!finite.choices.some(t=>project(t.text,{display:true}).key===b.normalized)||/[\r\n]/.test(b.raw))?['not_reviewed_finite_buffer']:[];
    });
    if(!reasons.length)throw Error(`Unexplained binding removal ${before.id}`);
    return {...c,reasons:[...new Set(reasons)]};
  });
  const added=after.filter(c=>!before.candidates.some(p=>signature(p)===signature(c)));
  if(added.some(c=>c.qid!=='rs.common.battle_strings.BattleText_GainExpPoints'||!c.generation?.japaneseBufferBlockVerified))throw Error(`Unexpected added binding ${before.id}`);
  return {id:before.id,regionId:before.regionId,raw:before.raw,beforeAmbiguous:before.bindingAmbiguous,afterAmbiguous:unit.result.bindingAmbiguous,
    semanticStatus:unit.result.semanticResolution.status,
    beforeCandidates:before.candidates.length,afterCandidates:after.length,removed,added,
    remainingCandidates:after.map(c=>({qid:c.qid,page:c.page,lineStart:c.lineStart,lineCount:c.lineCount,bindings:c.bindings}))};
});
const reviewed=cases.map(c=>{
  const region=current.regions.find(r=>r.id===c.regionId);
  if(region?.japanese!==c.japanese)throw Error(`Changed reviewed text ${c.regionId}`);
  const candidates=region.result.units.flatMap(u=>u.result.candidates);
  const checked=candidates.filter(h=>c.player?h.bindings.some(b=>b.slot==='PLAYER'):h.bindings.some(b=>/^B_TRAINER[12]_CLASS$/.test(b.slot)));
  const target=checked.filter(h=>h.qid.endsWith('.'+c.source));
  const matches=h=>c.player?h.bindings.find(b=>b.slot==='PLAYER')?.raw===c.player:
    h.bindings.find(b=>b.slot==='B_TRAINER1_CLASS')?.raw===c.trainerClass&&h.bindings.find(b=>b.slot==='B_TRAINER1_NAME')?.raw===c.name;
  const sourceEvidence=[...new Set(checked.map(h=>h.qid))].map(qid=>{
    const r=sourceRecords.find(r=>r.qid===qid);if(!r)throw Error('Missing reviewed source');
    return {qid,japanese:r.japanese,sha256:sha256(Buffer.from(r.japanese))};
  });
  return {...c,inputSha256:sha256(Buffer.from(c.japanese)),checkedCandidateCount:checked.length,unreviewedCandidateCount:candidates.length-checked.length,sourceEvidence,
    passed:target.length>0&&checked.length>0&&checked.every(matches)&&target.every(matches)};
});
const experienceReviewed=experienceCases.map(c=>{
  const region=current.regions.find(r=>r.id===c.regionId);
  if(region?.japanese!==c.japanese||region.result.units.length!==1)throw Error('Changed experience OCR judgment');
  const result=region.result.units[0].result,semantic=result.semanticResolution,meaning=semantic.meaning;
  const passed=result.sourceQids.length===1&&result.sourceQids[0]==='rs.common.battle_strings.BattleText_GainExpPoints'&&
    result.candidates.every(h=>h.sourceJapanese===experienceSourceJapanese&&h.generation?.japaneseBufferBlockVerified)&&
    semantic.status==='consistent'&&meaning?.event==='experience_gain'&&meaning.experienceAmount===c.amount&&
    meaning.boostedWording===false&&meaning.actors.subject.raw===c.subject&&!result.translationPublishable;
  return {...c,inputSha256:sha256(Buffer.from(c.japanese)),sourceJapanese:experienceSourceJapanese,
    sourceSha256:sha256(Buffer.from(experienceSourceJapanese)),sourceQids:result.sourceQids,semanticResolution:semantic,passed};
});
const sendOutReviewed=sendOutCases.map(c=>{
  const region=current.regions.find(r=>r.id===c.regionId);
  if(region?.japanese!==c.japanese||region.result.units.length!==1)throw Error('Changed send-out OCR judgment');
  const result=region.result.units[0].result,semantic=result.semanticResolution,meaning=semantic.meaning;
  const expected=c.sources.map(s=>'rs.common.battle_strings.'+s).sort();
  const windows=result.candidates.map(h=>({qid:h.qid,page:h.page,lineStart:h.lineStart,lineCount:h.lineCount,bindings:h.bindings}));
  const sourceEvidence=expected.map(qid=>{const r=sourceRecords.find(r=>r.qid===qid);if(!r)throw Error('Missing send-out source');return {qid,japanese:r.japanese,sha256:sha256(Buffer.from(r.japanese))};});
  const doubleRows=result.candidates.filter(h=>h.qid.endsWith('.BattleText_SentOutDouble3'));
  const passed=JSON.stringify([...result.sourceQids].sort())===JSON.stringify(expected)&&
    result.candidates.every(h=>h.sourceWindow&&h.generation?.sourceWindowReviewed&&!h.generation.scriptIdentityInferred&&!h.generation.futureUnitIncluded)&&
    (c.event!=='send_out'||JSON.stringify(doubleRows.map(h=>h.lineStart).sort())==='[0,1]')&&
    semantic.status==='consistent'&&meaning?.event===c.event&&meaning.actors.trainer?.raw===c.trainer&&meaning.actors.subject?.raw===c.subject&&
    !result.translationPublishable;
  return {...c,inputSha256:sha256(Buffer.from(c.japanese)),sourceEvidence,sourceQids:result.sourceQids,windows,
    bindingAmbiguous:result.bindingAmbiguous,semanticResolution:semantic,passed};
});
const observationReviewed=observationCases.map(c=>{
  const region=current.regions.find(r=>r.id===c.regionId);
  if(region?.japanese!==c.japanese||region.result.units.length!==1)throw Error('Changed observation OCR judgment');
  const result=region.result.units[0].result,semantic=result.semanticResolution,m=semantic.meaning;
  const sourceEvidence=c.sources.map(qid=>{const r=sourceRecords.find(r=>r.qid===qid);if(!r)throw Error('Missing observation source');return {qid,japanese:r.japanese,sha256:sha256(Buffer.from(r.japanese))};});
  const passed=JSON.stringify([...result.sourceQids].sort())===JSON.stringify([...c.sources].sort())&&semantic.status==='consistent'&&m.event===c.event&&m.actors.subject.raw===c.subject&&
    (!c.amountField||m[c.amountField]===c.amount)&&(!c.itemId||m.itemId===c.itemId)&&(!c.moveId||m.moveId===c.moveId)&&!result.translationPublishable;
  return {...c,sourceEvidence,sourceQids:result.sourceQids,semanticResolution:semantic,passed};
});
const summary={schemaVersion:1,scope:'Lexical boundaries, native experience composition and reviewed current send-out/encounter/capture/money/recovery/use windows; not exhaustive source identities, native call-site execution or translation approval',
  previousBindingUnits:baseline.cases.length,previousAmbiguousUnits:baseline.cases.filter(c=>c.bindingAmbiguous).length,
  currentAmbiguousUnits:comparisons.filter(c=>c.afterAmbiguous).length,
  ambiguousUnitsWithConsistentMeaning:comparisons.filter(c=>c.afterAmbiguous&&c.semanticStatus==='consistent').length,
  ambiguousUnitsNeedingMeaningReview:comparisons.filter(c=>c.afterAmbiguous&&c.semanticStatus!=='consistent').length,
  changedUnits:comparisons.filter(c=>c.removed.length).length,removedInterpretations:comparisons.reduce((n,c)=>n+c.removed.length,0),
  addedNativeExperienceInterpretations:comparisons.reduce((n,c)=>n+c.added.length,0),
  lostAllSourceCandidates:comparisons.filter(c=>!currentUnit(c).result.candidates.length).map(c=>c.id),
  reviewedCases:reviewed.length,passedCases:reviewed.filter(c=>c.passed).length,
  experienceReview:{total:experienceReviewed.length,passed:experienceReviewed.filter(c=>c.passed).length,nativeBufferCases:nativeExperience.roms.reduce((n,r)=>n+r.checks.length,0)},
  sendOutReview:{total:sendOutReviewed.length,passed:sendOutReviewed.filter(c=>c.passed).length,scriptIdentityAmbiguousCases:sendOutReviewed.filter(c=>c.sourceQids.length>1).length,
    sourceWindowAmbiguousCases:sendOutReviewed.filter(c=>c.bindingAmbiguous).length,method:'separate model review of current Japanese action clauses and complete candidate/window set; not native script execution or Chinese approval'},
  observationReview:{total:observationReviewed.length,passed:observationReviewed.filter(c=>c.passed).length,method:'Separate non-blind model review of visible Japanese meaning and all candidate sources; no later flute/repel clause or caller identity inferred'},
  independence:'Model reviewed visible text and pinned sources; same model as implementation, non-blind, not human or independent-person acceptance',
  remaining:'Opaque buffers, multi-window/source ambiguity and full name constraints remain unapproved. No nickname length or identity learning is established.'};
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
save('binding-audit.json',{summary,reviewedCases:reviewed,experienceReviewedCases:experienceReviewed,sendOutReviewedCases:sendOutReviewed,observationReviewedCases:observationReviewed,comparisons,trainerClassEvidence:classRecords.map(r=>({qid:r.qid,japanese:r.japanese,game:r.game}))});
save('experience-review.json',{summary:summary.experienceReview,cases:experienceReviewed});
save('send-out-review.json',{summary:summary.sendOutReview,cases:sendOutReviewed});
save('observation-review.json',{summary:summary.observationReview,cases:observationReviewed});
const worklist=comparisons.filter(c=>c.afterAmbiguous).map(c=>({id:c.id,raw:c.raw,candidateCount:c.afterCandidates,semanticStatus:c.semanticStatus,
  nextAction:c.semanticStatus==='consistent'?'retain_source_window_identity_ambiguity_meaning_consistent':'review_per_source_windows_and_buffer_callsites',candidates:JSON.stringify(c.remainingCandidates)}));
const columns=['id','raw','candidateCount','semanticStatus','nextAction','candidates'];
fs.writeFileSync(path.join(output,'binding-worklist.csv'),csv(worklist,columns));
fs.writeFileSync(path.join(output,'semantic-binding-worklist.csv'),csv(worklist.filter(c=>c.semanticStatus!=='consistent'),columns));
save('binding-audit-manifest.json',{schemaVersion:1,inputs,implementation:['tools/audit_source_bindings.mjs','tools/japanese_source_matcher.mjs','tools/corpus_common.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
  outputs:['binding-audit.json','binding-worklist.csv','semantic-binding-worklist.csv','experience-review.json','send-out-review.json','observation-review.json'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(output,file)))}))});
console.log(JSON.stringify(summary,null,2));
if(summary.passedCases!==summary.reviewedCases||summary.experienceReview.passed!==summary.experienceReview.total||summary.sendOutReview.passed!==summary.sendOutReview.total||summary.observationReview.passed!==summary.observationReview.total||summary.lostAllSourceCandidates.length)process.exitCode=2;
