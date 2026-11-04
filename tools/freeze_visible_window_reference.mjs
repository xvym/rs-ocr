import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256} from './corpus_common.mjs';
import {loadVisibleReview,compileVisibleWindows,visibleImplementations,textHash,VISIBLE_POLICY} from './s6_visible_windows.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length!==2)throw Error('Usage: node tools/freeze_visible_window_reference.mjs');
const {policy,review,regions,s3}=loadVisibleReview(root),compiled=compileVisibleWindows(root),rules=new Map(compiled.rules.map(r=>[r.key,r]));
const variableReview=JSON.parse(read(path.join(root,'corpus/visible-windows/variable-bindings.json'))),variableCases=new Map(variableReview.cases.map(c=>[c.key,c]));
const nativeReview=JSON.parse(read(path.join(root,'corpus/visible-windows/native-fields.json')));
function expectedNative(unit,decision){
 const c=nativeReview.cases.find(c=>c.key===unit.key),snapshot=c?.expected.find(e=>e.id===unit.id),field=compiled.nativeFields.fields.find(f=>f.id===c?.field);
 if(!snapshot||field?.id!==decision.nativeField||!unit.raw.includes(snapshot.raw))throw Error('Changed original field expectation');
 const byGame={},citations=[];
 for(const game of ['ruby','sapphire']){
  const quote=field.citations.filter(c=>c.game===game),location=field.locations?.find(l=>l.qid===snapshot.locationQid),place=location?.citations.filter(c=>c.game===game)||[];
  const value=location?place[0].quote:snapshot.raw;
   const output=field.operation==='original_location_then_literal'?value+quote[0].quote:field.operation==='overwrite_original_final_two_zeroes'?quote[0].quote.slice(0,-2)+value:field.operation==='original_level_marker_value_comma'?'Lv'+value+field.source.english:value;
  byGame[game]={output,value,raw:snapshot.raw,citations:place};citations.push(...place,...quote);
 }
 return {fieldId:field.id,citations,expectedChineseByGame:Object.fromEntries(Object.entries(byGame).map(([g,v])=>[g,v.output])),expectedNativeValuesByGame:byGame};
}
function expectedTemplate(unit,decision){
 const fixture=variableCases.get(unit.key),family=compiled.variableBindings.contracts.find(f=>f.id===fixture?.family);
 if(!fixture||family?.id!==decision.variableFamily)throw Error('Missing original-template expectation');
 const source=unit.result.candidates.find(c=>c.qid===family.qid&&c.page===fixture.sourceMatch.page&&c.lineStart===fixture.sourceMatch.lineStart&&c.lineCount===fixture.sourceMatch.lineCount),byGame={};
 if(!source)throw Error('Missing expected source window');
 for(const game of ['ruby','sapphire']){
  const bindings={};
  for(const [token,expected] of Object.entries(fixture.expectedValues)){
   let value;
   if(expected.qid){
    const terms=compiled.variableBindings.terms.filter(t=>t.qid===expected.qid&&t.game===game&&t.kind===expected.kind);if(new Set(terms.map(t=>t.chinese)).size!==1)throw Error('Missing original expected variable term');
    value={value:terms[0].chinese,citations:terms.flatMap(t=>t.citations)};
    if(expected.sourceSlot){const b=source.bindings.find(b=>b.slot===expected.sourceSlot);if(!b||b.raw!==expected.raw)throw Error('Changed expected lexical capture');value={...value,raw:b.raw,start:b.start,end:b.end,sourceSlot:b.slot};}
   }else if(expected.empty)value={value:'',citations:[],evidence:'native_normal_component_and_empty_English_modifier'};
   else {const b=source.bindings.find(b=>b.slot===expected.sourceSlot);if(!b||b.raw!==expected.raw||b.start!==expected.start||b.end!==expected.end||unit.searchText.slice(b.start,b.end)!==b.raw)throw Error('Changed expected current capture');value={value:b.raw,raw:b.raw,start:b.start,end:b.end,sourceSlot:b.slot,citations:[]};}
   bindings[token]=value;
  }
  // This reference path substitutes the separately reviewed fixture values in
  // original source text. It never queries the runtime variable matcher/probe.
  const texts=family.citations.filter(c=>c.game===game).map(c=>c.quote.replace(/\[[^\]]+\]|\\v\\h[0-9A-Fa-f]{2}/g,token=>{if(!bindings[token])throw Error('Missing expected original slot');return bindings[token].value;}).replaceAll('\\n','\n').replaceAll('\\l','\n').replaceAll('\\p','\n\n'));
  if(new Set(texts).size!==1)throw Error('Unresolved expected original template wording');byGame[game]={chinese:texts[0],bindings};
 }
 return {familyId:family.id,citations:family.citations,unknownGameSelection:family.equivalentWording?.selection||null,expectedChineseByGame:Object.fromEntries(Object.entries(byGame).map(([g,v])=>[g,v.chinese])),expectedBindingsByGame:Object.fromEntries(Object.entries(byGame).map(([g,v])=>[g,v.bindings]))};
}
// Expected Chinese is reconstructed from reviewed original-source ranges, never
// from S6CorpusProbe, S6VisibleWindowProbe, predictions or historical model gold.
const reference={schemaVersion:1,policyId:VISIBLE_POLICY,translationPolicy:POLICY,method:review.method,blind:false,humanReview:false,independentReview:false,
  images:s3.images.map(i=>({imageId:i.image_id||i.id,source:i.source,sourceSha256:i.sha256||i.source_sha256,scopeNegative:Boolean(i.scope_negative_approved)})),
  excludedRegions:s3.regions.filter(r=>!r.recognition_in_scope).map(r=>({id:r.instance_id,source:r.source,sourceSha256:r.source_sha256,reason:r.recognition_exclusion_reason,visibilityEvidence:r.target_text_visibility_reason})),
  regions:regions.map(r=>({id:r.id,imageId:r.imageId,platform:r.platform,source:r.source,sourceSha256:r.sourceSha256,logicalBox:r.logicalBox,japanese:r.japanese,typeCandidates:r.typeCandidates,
    gameAttribution:'not_confirmed',inFirstEdition:!Object.hasOwn(policy.scopeExclusions,r.typeCandidates[0]),
    units:r.units.map(u=>{
      const d=u.decision,rule=rules.get(u.key),template=d.disposition==='original_rsc_template'?expectedTemplate(u,d):null,semantic=d.disposition==='original_rsc_semantic'?compiled.semanticUnits.plans.find(p=>p.id===d.semanticUnit):null,native=d.disposition==='original_rsc_native_field'?expectedNative(u,d):null,expectedChineseByGame=template?.expectedChineseByGame||native?.expectedChineseByGame||{};
      const citations=semantic?.citations||template?.citations||native?.citations||rule.citations,outputMode=native?'whole_unit':semantic?.outputMode||'search_text';
      if(!template&&!native)for(const game of ['ruby','sapphire']){const quotes=citations.filter(c=>c.game===game).map(c=>c.quote);const values=[...new Set(quotes)];if(values.length>1)throw Error('Unresolved reference wording '+d.id);expectedChineseByGame[game]=values.length?values[0].replaceAll('\\n','\n').replaceAll('\\l','\n').replaceAll('\\p','\n\n'):null;}
      const values=Object.values(expectedChineseByGame),expectedChinese=template?.unknownGameSelection?expectedChineseByGame[template.unknownGameSelection]:values.every(v=>v===values[0])?values[0]:null;
      const at=u.raw.indexOf(u.searchText);if(expectedChinese!==null&&at<0)throw Error('Reference field boundary');
      return {id:u.id,key:u.key,decisionId:d.id,raw:u.raw,start:u.start,end:u.end,searchText:u.searchText,kind:u.kind??null,visibleFields:u.visibleFields||[],disposition:d.disposition,reasonCode:d.reasonCode,reason:d.reason,
        expectedChinese,expectedChineseByGame,outputMode,expectedOutput:expectedChinese===null?u.raw:outputMode==='whole_unit'?expectedChinese:u.raw.slice(0,at)+expectedChinese+u.raw.slice(at+u.searchText.length),
        citations,...(semantic?{semanticUnit:semantic.id}:{}),...(native?{nativeField:native.fieldId,expectedNativeValuesByGame:native.expectedNativeValuesByGame}:{}),...(template?{variableFamily:template.familyId,expectedBindingsByGame:template.expectedBindingsByGame,unknownGameSelection:template.unknownGameSelection}:{}),sourceCandidates:u.result.candidates.map(c=>({qid:c.qid,sourceJapanese:c.sourceJapanese,sourceEnglish:c.sourceEnglish,mode:c.mode,page:c.page,lineStart:c.lineStart,lineCount:c.lineCount,bindings:c.bindings,meaning:c.meaning||null})),
        sourceHints:u.result.hints||[]};
    })})),
  requiredPageEvidenceGaps:policy.requiredPageEvidenceGaps,
  limitation:review.limitation};
const out=path.join(root,'corpus/visible-windows');
fs.writeFileSync(path.join(out,'reference.json'),JSON.stringify(reference,null,2)+'\n');
 const inputs=['corpus/visible-windows/policy.json','corpus/visible-windows/decisions.json','corpus/visible-windows/variable-bindings.json','corpus/visible-windows/semantic-units.json','corpus/visible-windows/native-fields.json','reports/s3-acceptance/reference.json',...nativeReview.fields.flatMap(f=>[f.sourceEvidence.local,...(f.additionalEvidence||[]).map(e=>e.local)]),...variableReview.inputs.map(f=>f.local),...review.sourceInputs.map(f=>f.local)];
const manifest={schemaVersion:1,policyId:VISIBLE_POLICY,translationPolicy:POLICY,
  inputs:[...new Set(inputs)].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
  implementation:visibleImplementations.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
  outputs:[{file:'reference.json',sha256:sha256(fs.readFileSync(path.join(out,'reference.json')))}]};
fs.writeFileSync(path.join(out,'freeze-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({regions:reference.regions.length,units:reference.regions.reduce((n,r)=>n+r.units.length,0),excludedRegions:reference.excludedRegions.length,referenceSha256:textHash(read(path.join(out,'reference.json')))}));
