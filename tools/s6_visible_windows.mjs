import fs from 'node:fs';
import path from 'node:path';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {loadOriginalRscEntries} from './rsc_correspondence_index.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
import {compileVariableBindings,validateVariableBindings,OriginalVariableProbe} from './s6_variable_bindings.mjs';
import {compileSemanticUnits,validateSemanticUnits,OriginalSemanticProbe} from './s6_semantic_units.mjs';
import {compileNativeFields,validateNativeFields,OriginalNativeFieldProbe} from './s6_native_fields.mjs';

export const VISIBLE_POLICY='s6-original-rsc-visible-windows-v1';
export const textHash=text=>sha256(Buffer.from(text));
export const windowKey=(type,searchText,kind=null)=>textHash(JSON.stringify([type,searchText,kind]));
export const visibleImplementations=['tools/s6_visible_windows.mjs','tools/s6_variable_bindings.mjs','tools/s6_semantic_units.mjs','tools/s6_native_fields.mjs','tools/freeze_visible_window_reference.mjs'];
const json=(root,local)=>JSON.parse(read(path.join(root,local)));
export function verifyFiles(root,files){
  for(const f of files){if(/(^|[\\/])archive[\\/]/.test(f.local)||sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error('Changed visible-window evidence '+f.local);}
}
export function loadVisibleReview(root){
  const policy=json(root,'corpus/visible-windows/policy.json'),review=json(root,'corpus/visible-windows/decisions.json');
  if(policy.id!==VISIBLE_POLICY||policy.translationPolicy!==POLICY||policy.semanticDifferenceFallback!==false||review.translationPolicy!==POLICY||review.schemaVersion!==1||review.blind!==false||review.humanReview!==false)throw Error('Source-linked original RSC review required');
  verifyFiles(root,review.sourceInputs);
  const inputs=json(root,'reports/japanese-source-matching/ocr-inputs.json'),diagnostics=json(root,'reports/japanese-source-matching/results.json'),s3=json(root,'reports/s3-acceptance/reference.json');
  if(inputs.inputs.length!==579||diagnostics.regions.length!==579||new Set(inputs.inputs.map(r=>r.id)).size!==579)throw Error('Incomplete visible-window inventory');
  if(inputs.referenceSha256!==sha256(fs.readFileSync(path.join(root,'reports/s3-acceptance/reference.json'))))throw Error('Changed S3 reference');
  const byId=new Map(inputs.inputs.map(r=>[r.id,r])),decisions=new Map();
  for(const d of review.decisions){
    if(d.reasonCode==='original_semantic_difference')throw Error('Semantic differences cannot veto a unique original RSC source');
    if(d.key!==windowKey(d.type,d.searchText,d.kind)||decisions.has(d.key)||!d.reason||!d.reasonCode||!['original_rsc_span','original_rsc_template','original_rsc_semantic','original_rsc_native_field','retain_japanese','outside_first_edition'].includes(d.disposition))throw Error('Invalid or duplicate visible-window decision');
    if(!policy.scopeIncludedTypes.includes(d.type)&&!Object.hasOwn(policy.scopeExclusions,d.type)||(d.disposition==='outside_first_edition')!==Object.hasOwn(policy.scopeExclusions,d.type))throw Error('Scope decision disagrees with Spec-bound policy');
    if((d.disposition==='original_rsc_span')!==Boolean(d.citations.length))throw Error('Unreviewed or missing Chinese citation');
    decisions.set(d.key,d);
  }
  const seen=new Set(),used=new Set(),regions=diagnostics.regions.map(r=>{
    const input=byId.get(r.id),reference=s3.regions.find(x=>x.instance_id===r.id);
    if(seen.has(r.id)||!input||!reference?.recognition_in_scope||input.japanese!==r.japanese||input.sourceSha256!==r.sourceSha256||input.source!==r.source||JSON.stringify(input.typeCandidates)!==JSON.stringify(r.typeCandidates)||reference.source_sha256!==r.sourceSha256)throw Error('Changed target region '+r.id);seen.add(r.id);
    const occupied=new Set();
    const units=r.result.units.map((u,i)=>{
      if(!Number.isSafeInteger(u.start)||!Number.isSafeInteger(u.end)||u.start<0||u.end<=u.start||u.end>r.japanese.length||u.raw!==r.japanese.slice(u.start,u.end))throw Error('Invalid raw unit range '+r.id);
      for(let j=u.start;j<u.end;j++){if(occupied.has(j))throw Error('Overlapping visible units');occupied.add(j);}
      const key=windowKey(r.typeCandidates[0],u.searchText,u.kind??null),decision=decisions.get(key);if(!decision)throw Error('Unreviewed visible unit '+r.id);used.add(key);
      return {...u,id:`${r.id}:S${i+1}`,key,decision};
    });
    for(let i=0;i<r.japanese.length;i++)if(!/[ \u3000\r\n]/.test(r.japanese[i])&&!occupied.has(i))throw Error('Dropped visible character '+r.id);
    return {...input,units};
  });
  if(used.size!==decisions.size)throw Error('Unused/stale visible review');
  return {policy,review,regions,s3,decisions};
}
// These are display operations on an already reviewed contiguous citation.
// Unknown control sequences, placeholders and text-generation payloads fail closed.
export function renderOriginalQuote(quote){
  if(typeof quote!=='string'||!quote.length||/[\[\]{}\uE000\uE001\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(quote)||/\\(?![nlp])/.test(quote))throw Error('Unapproved original printing sequence');
  return quote.replace(/\\([nlp])/g,(_,code)=>code==='p'?'\n\n':'\n');
}
export function compileVisibleWindows(root){
  const {policy,review,regions}=loadVisibleReview(root);
  const candidates=new Map(parseCsv(read(path.join(root,'outputs/corpus-mapping/candidates.csv'))).map(c=>[c.id,c])),originals=loadOriginalRscEntries(root);
  const witnesses=new Map();
  const rules=review.decisions.map(d=>{
    const observed=regions.flatMap(r=>r.units).find(u=>u.key===d.key),sourceCandidates=observed.result.candidates;
    const citations=d.citations.map(c=>{
      const candidate=candidates.get(c.candidateId),entry=originals.entries.get(`${c.sourceId}:${c.sourceLine}`);
      if(!candidate||candidate.qid!==c.qid||candidate.qid!==d.sourceQid||candidate.game!==c.game||candidate.sourceId!==c.sourceId||Number(candidate.sourceLine)!==c.sourceLine||!entry||candidate.chinese!==entry.originalChinese||textHash(entry.originalChinese)!==c.sourceChineseSha256||!sourceCandidates.some(s=>s.qid===c.qid&&!s.bindings.length))throw Error('Changed or inapplicable original citation '+d.id);
      const [start,end]=c.span||[];
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>entry.originalChinese.length)throw Error('Invalid original quote range '+d.id);
      const quote=entry.originalChinese.slice(start,end);if(textHash(quote)!==c.quoteSha256)throw Error('Changed original quote '+d.id);renderOriginalQuote(quote);
      const source=sourceCandidates.find(s=>s.qid===c.qid);
      witnesses.set(entry.id,entry);
      return {...c,sourceEntryId:entry.id,quote,sourceJapanese:source.sourceJapanese,sourceJapaneseSha256:textHash(source.sourceJapanese),sourceEnglish:source.sourceEnglish,
        japaneseWindow:{page:source.page,lineStart:source.lineStart,lineCount:source.lineCount,mode:source.mode,matchedJapanese:observed.searchText},
        selectionMethod:'source_record_and_visible_range_alignment'};
    });
    if(citations.length&&(!citations.some(c=>c.game==='ruby')||!citations.some(c=>c.game==='sapphire')))throw Error('Both games require original witnesses '+d.id);
    return {id:d.id,key:d.key,type:d.type,searchText:d.searchText,kind:d.kind,disposition:d.disposition,reasonCode:d.reasonCode,reason:d.reason,...(d.variableFamily?{variableFamily:d.variableFamily}:{}),...(d.semanticUnit?{semanticUnit:d.semanticUnit}:{}),...(d.nativeField?{nativeField:d.nativeField}:{}),citations};
  });
  const compiled={schemaVersion:1,policyId:VISIBLE_POLICY,translationPolicy:POLICY,sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,scope:'reviewed_fixed_visible_windows_not_full_S6_or_S7',generatedChineseRecords:0,rewrittenChineseRecords:0,
    sources:originals.sources,sourceEntries:[...witnesses.values()].sort((a,b)=>a.id.localeCompare(b.id)),rules,
    variableBindings:compileVariableBindings(root,review,regions),semanticUnits:compileSemanticUnits(root,review,regions),nativeFields:compileNativeFields(root,review),limitations:policy.requiredPageEvidenceGaps,reviewMethod:review.method,independentReview:false};
  validateVisibleWindows(compiled);return compiled;
}
export function validateVisibleWindows(pack){
  if(pack.schemaVersion!==1||pack.policyId!==VISIBLE_POLICY||pack.translationPolicy!==POLICY||pack.sourceSelection!=='unique_original_rsc_text'||pack.semanticDifferenceFallback!==false||pack.generatedChineseRecords!==0||pack.rewrittenChineseRecords!==0||pack.sources?.length!==6||['templates','events','compositionPolicy'].some(k=>k in pack))throw Error('Original-only visible-window pack required');
  validateVariableBindings(pack.variableBindings);
  validateSemanticUnits(pack.semanticUnits);
  validateNativeFields(pack.nativeFields);
  const sources=new Map(pack.sources.map(s=>[s.id,s]));
  for(const s of sources.values())if(s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17')throw Error('Changed original repository identity');
  const entries=new Map();
  for(const e of pack.sourceEntries){const s=sources.get(e.sourceId);if(entries.has(e.id)||e.id!==`${e.sourceId}:${e.sourceLine}`||!s||e.sourcePath!==s.path||e.sourceSha256!==s.sha256||textHash(e.originalChinese)!==e.originalChineseSha256)throw Error('Changed original visible witness');entries.set(e.id,e);}
  const keys=new Set(),ids=new Set();
  for(const r of pack.rules){
    if(r.reasonCode==='original_semantic_difference')throw Error('Semantic differences cannot veto a unique original RSC source');
    if(keys.has(r.key)||ids.has(r.id)||r.key!==windowKey(r.type,r.searchText,r.kind)||!r.reason||!['original_rsc_span','original_rsc_template','original_rsc_semantic','original_rsc_native_field','retain_japanese','outside_first_edition'].includes(r.disposition)||(r.disposition==='original_rsc_span')!==Boolean(r.citations.length))throw Error('Changed visible rule');keys.add(r.key);ids.add(r.id);
    if(r.disposition==='original_rsc_template'&&!pack.variableBindings.contracts.some(f=>f.id===r.variableFamily&&f.type===r.type))throw Error('Missing reviewed variable family');
    if(r.disposition==='original_rsc_semantic'&&!pack.semanticUnits.plans.some(p=>p.id===r.semanticUnit&&p.type===r.type))throw Error('Missing reviewed semantic unit');
    if(r.disposition==='original_rsc_native_field'&&!pack.nativeFields.fields.some(f=>f.id===r.nativeField&&f.type===r.type))throw Error('Missing original native field');
    for(const c of r.citations){const e=entries.get(c.sourceEntryId),[start,end]=c.span||[];
      if(!e||!['ruby','sapphire'].includes(c.game)||e.game!=='both'&&e.game!==c.game||e.id!==`${c.sourceId}:${c.sourceLine}`||e.originalChineseSha256!==c.sourceChineseSha256||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>e.originalChinese.length||e.originalChinese.slice(start,end)!==c.quote||textHash(c.quote)!==c.quoteSha256||textHash(c.sourceJapanese)!==c.sourceJapaneseSha256||c.japaneseWindow.matchedJapanese!==r.searchText)throw Error('Changed visible Chinese source range');
      renderOriginalQuote(c.quote);
    }
  }
  return pack;
}
export class S6VisibleWindowProbe{
  constructor(pack){this.pack=structuredClone(validateVisibleWindows(pack));this.rules=new Map(this.pack.rules.map(r=>[r.key,r]));this.variables=new OriginalVariableProbe(this.pack.variableBindings);this.semantic=new OriginalSemanticProbe(this.pack.semanticUnits);this.native=new OriginalNativeFieldProbe(this.pack.nativeFields);}
  lookupUnit(unit,{type,game='both'}={}){
    const raw=unit.raw;
    const fallback=(reason,ruleId=null)=>({chinese:null,output:raw,status:'retained_japanese',reason,ruleId,citations:[],visibleFields:structuredClone(unit.visibleFields||[])});
    if(typeof raw!=='string'||typeof unit.searchText!=='string'||!['ruby','sapphire','both'].includes(game)||raw.includes('�')||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(raw))return fallback('invalid_or_unknown_input');
    if(!unit.searchText||!raw.includes(unit.searchText))return fallback('invalid_visible_field_boundary');
    const rule=this.rules.get(windowKey(type,unit.searchText,unit.kind??null));
    const native=this.native.lookup(unit,{type,game});
    if(native)return {chinese:native.chinese,output:native.chinese,status:'original_rsc_native_field',reason:'reviewed_original_native_printing',ruleId:rule?.id??null,nativeField:native.fieldId,nativeValuesByGame:native.byGame,citations:native.citations,visibleFields:structuredClone(unit.visibleFields||[])};
    const meaning=this.semantic.lookup(unit,{type,game});
    if(meaning){
      if(meaning.chinese===null||rule?.disposition==='original_rsc_semantic'&&meaning.planId!==rule.semanticUnit)return fallback(meaning.reason,rule?.id??null);
      const start=raw.indexOf(unit.searchText);if(start<0)return fallback('invalid_visible_field_boundary',rule?.id??null);
      return {chinese:meaning.chinese,output:meaning.outputMode==='whole_unit'?meaning.chinese:raw.slice(0,start)+meaning.chinese+raw.slice(start+unit.searchText.length),status:'original_rsc_semantic_unit',reason:meaning.reason,ruleId:rule?.id??null,semanticUnit:meaning.planId,citations:meaning.citations,visibleFields:structuredClone(unit.visibleFields||[])};
    }
    if(!rule||rule.disposition==='original_rsc_template'){
      const bound=this.variables.lookup(unit.searchText,{type,game,kind:unit.kind??null});
      if(!bound||bound.chinese===null||rule&&bound.familyId!==rule.variableFamily)return fallback(bound?.reason||(rule?'current_variable_binding_not_verified':'no_reviewed_visible_window'),rule?.id??null);
      const start=raw.indexOf(unit.searchText);if(start<0||raw.indexOf(unit.searchText,start+unit.searchText.length)!==-1)return fallback('invalid_visible_field_boundary',rule?.id??null);
      return {chinese:bound.chinese,output:raw.slice(0,start)+bound.chinese+raw.slice(start+unit.searchText.length),status:'original_rsc_bound_template',reason:'reviewed_original_template_binding',ruleId:rule?.id??null,familyId:bound.familyId,
        citations:bound.languages.flatMap(l=>l.citations),bindingsByGame:Object.fromEntries(bound.languages.map(l=>[l.game,l.bindings])),...(bound.originalWordingSelection?{originalWordingSelection:bound.originalWordingSelection}:{}),visibleFields:structuredClone(unit.visibleFields||[])};
    }
    if(rule.disposition!=='original_rsc_span')return fallback(rule.reasonCode,rule.id);
    const citations=rule.citations.filter(c=>game==='both'||c.game===game);
    if(!citations.length||game==='both'&&(!citations.some(c=>c.game==='ruby')||!citations.some(c=>c.game==='sapphire')))return fallback('applicable_original_source_missing',rule.id);
    const outputs=[...new Set(citations.map(c=>renderOriginalQuote(c.quote)))];
    if(outputs.length!==1)return fallback('original_game_or_wording_conflict',rule.id);
    const start=raw.indexOf(unit.searchText);if(start<0||raw.indexOf(unit.searchText,start+unit.searchText.length)!==-1)return fallback('invalid_visible_field_boundary',rule.id);
    return {chinese:outputs[0],output:raw.slice(0,start)+outputs[0]+raw.slice(start+unit.searchText.length),status:'original_rsc_visible_span',reason:rule.reasonCode,ruleId:rule.id,citations:structuredClone(citations),visibleFields:structuredClone(unit.visibleFields||[])};
  }
}
