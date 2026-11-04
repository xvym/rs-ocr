import fs from 'node:fs';
import path from 'node:path';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {loadOriginalRscEntries} from './rsc_correspondence_index.mjs';
import {loadSourceMatcher,parseSource,project} from './japanese_source_matcher.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
const digest=s=>sha256(Buffer.from(s));
export const semanticKey=text=>project(text,{display:true}).key;
const display=text=>text.replace(/\\([nlp])/g,(_,c)=>c==='p'?'\n\n':'\n');
const literal=text=>typeof text==='string'&&text.length&&!/[\[\]{}\uE000\uE001]/.test(text)&&!/\\(?![nlp])/.test(text);
export function compileSemanticUnits(root,review,regions){
 const selection=JSON.parse(read(path.join(root,'corpus/visible-windows/semantic-units.json')));
 if(selection.schemaVersion!==1||selection.translationPolicy!==POLICY)throw Error('Original semantic alignment required');
 const {records,nativeRecords}=loadSourceMatcher(root),sourceMap=new Map([...records,...nativeRecords].map(r=>[r.qid,r]));
 const original=loadOriginalRscEntries(root,parseCsv(read(path.join(root,'outputs/corpus-mapping/rsc-import.csv'))));
 const candidates=new Map(parseCsv(read(path.join(root,'outputs/corpus-mapping/candidates.csv'))).map(c=>[c.id,c])),entries=new Map();
 const ids=new Set(),plans=selection.plans.map(p=>{
  const source=sourceMap.get(p.qid);if(ids.has(p.id)||!source||digest(source.japanese)!==p.japaneseSha256||digest(source.english)!==p.englishSha256)throw Error('Changed semantic source '+p.id);ids.add(p.id);
  const parsed=parseSource(source.japanese),parts=p.parts.map(part=>{
   const lines=parsed.pages[part.page];if(!lines||!Number.isSafeInteger(part.lineStart)||part.lineStart<0||!Number.isSafeInteger(part.lineCount)||part.lineCount<1||part.lineStart+part.lineCount>lines.length)throw Error('Invalid semantic source range');
   return {...part,text:lines.slice(part.lineStart,part.lineStart+part.lineCount).join('\n')};
  });
  const citations=p.citations.map(c=>{
   const e=original.entries.get(`${c.sourceId}:${c.sourceLine}`),[a,b]=c.span||[],candidate=candidates.get(c.candidateId);
   if(!e||e.game!=='both'&&e.game!==c.game||!['ruby','sapphire'].includes(c.game)||e.originalChineseSha256!==c.sourceChineseSha256||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>e.originalChinese.length)throw Error('Changed original semantic witness');
   if(c.candidateId!==`original-entry:${e.id}`&&(!candidate||candidate.sourceId!==c.sourceId||Number(candidate.sourceLine)!==c.sourceLine||candidate.qid!==c.qid||candidate.game!==c.game||candidate.chinese!==e.originalChinese))throw Error('Unpinned semantic candidate');
   const quote=e.originalChinese.slice(a,b);if(digest(quote)!==c.quoteSha256||!literal(quote))throw Error('Changed or dynamic semantic quote');entries.set(e.id,e);
   return {...c,sourceEntryId:e.id,quote};
  });
  if(!['ruby','sapphire'].every(game=>citations.some(c=>c.game===game)))throw Error('Missing game semantic witness');
  return {...p,sourceJapanese:source.japanese,sourceEnglish:source.english,parts,citations};
 });
 const byCase=new Map(selection.cases.map(c=>[c.key,c]));if(byCase.size!==selection.cases.length)throw Error('Duplicate semantic case');
 const units=regions.flatMap(r=>r.units);
 for(const d of review.decisions.filter(d=>d.disposition==='original_rsc_semantic')){
  const c=byCase.get(d.key),p=plans.find(p=>p.id===d.semanticUnit);if(!c||c.decisionId!==d.id||c.plan!==p?.id||p.type!==d.type||p.kind!==d.kind)throw Error('Missing reviewed semantic decision '+d.id);
  for(const u of units.filter(u=>u.key===d.key))if(!p.anchors.some(a=>a.japanese===(p.outputMode==='whole_unit'?u.raw:u.searchText)))throw Error('Changed semantic anchor '+d.id);
 }
 if(selection.cases.length!==review.decisions.filter(d=>d.disposition==='original_rsc_semantic').length)throw Error('Unused semantic fixture');
 const pack={schemaVersion:1,translationPolicy:POLICY,scope:'original_RSC_semantic_units_and_reviewed_identifying_windows',sources:original.sources,sourceEntries:[...entries.values()],plans,generatedChineseRecords:0,rewrittenChineseRecords:0};
 validateSemanticUnits(pack);return pack;
}
export function validateSemanticUnits(pack){
 if(pack.schemaVersion!==1||pack.translationPolicy!==POLICY||pack.generatedChineseRecords!==0||pack.rewrittenChineseRecords!==0||pack.sources?.length!==6)throw Error('Original-only semantic pack required');
 const sources=new Map(pack.sources.map(s=>[s.id,s])),entries=new Map();
 for(const s of sources.values())if(s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17')throw Error('Changed semantic repository');
 for(const e of pack.sourceEntries){const s=sources.get(e.sourceId);if(!s||s.path!==e.sourcePath||s.sha256!==e.sourceSha256||digest(e.originalChinese)!==e.originalChineseSha256||entries.has(e.id))throw Error('Changed semantic original');entries.set(e.id,e);}
 const ids=new Set();for(const p of pack.plans){
  if(ids.has(p.id)||digest(p.sourceJapanese)!==p.japaneseSha256||digest(p.sourceEnglish)!==p.englishSha256||!['search_text','whole_unit'].includes(p.outputMode)||!p.anchors.length||!p.reason)throw Error('Invalid semantic plan');ids.add(p.id);
  const parsed=parseSource(p.sourceJapanese);
  for(const part of p.parts)if(!Number.isSafeInteger(part.page)||part.page<0||!Number.isSafeInteger(part.lineStart)||part.lineStart<0||!Number.isSafeInteger(part.lineCount)||part.lineCount<1||part.lineStart+part.lineCount>(parsed.pages[part.page]?.length??0)||parsed.pages[part.page].slice(part.lineStart,part.lineStart+part.lineCount).join('\n')!==part.text)throw Error('Changed Japanese semantic range');
  for(const a of p.anchors){
   const key=semanticKey(a.japanese),present=p.parts.some(part=>semanticKey(part.text).includes(key));
   if(digest(a.japanese)!==a.sha256||!key||[...key].length!==a.minimumRecognizedCharacters||!present&&!(p.relationship==='reviewed_original_layout_equivalence'&&p.parts.some(part=>key.includes(semanticKey(part.text)))))throw Error('Invalid semantic identifying anchor');
  }
  for(const c of p.citations){const e=entries.get(c.sourceEntryId),[a,b]=c.span||[];
   if(!e||!['ruby','sapphire'].includes(c.game)||e.game!=='both'&&e.game!==c.game||e.id!==`${c.sourceId}:${c.sourceLine}`||e.originalChineseSha256!==c.sourceChineseSha256||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>e.originalChinese.length||e.originalChinese.slice(a,b)!==c.quote||digest(c.quote)!==c.quoteSha256||!literal(c.quote))throw Error('Changed semantic quote range');
  }
 }
 return pack;
}
export class OriginalSemanticProbe{
 constructor(pack){this.pack=structuredClone(validateSemanticUnits(pack));this.index=new Map();for(const p of this.pack.plans)for(const a of p.anchors){const key=JSON.stringify([p.type,p.kind,semanticKey(a.japanese)]),list=this.index.get(key)||[];if(!list.some(r=>r.id===p.id))list.push(p);this.index.set(key,list);}}
 lookup(unit,{type,game='both'}={}){
  if(!['both','ruby','sapphire'].includes(game)||typeof unit.raw!=='string'||typeof unit.searchText!=='string'||/[\[\]{}\\�\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(unit.raw))return null;
  const plans=[...new Map([unit.raw,unit.searchText].flatMap(text=>(this.index.get(JSON.stringify([type,unit.kind??null,semanticKey(text)]))||[]).filter(p=>semanticKey(p.outputMode==='whole_unit'?unit.raw:unit.searchText)===semanticKey(text))).map(p=>[p.id,p])).values()];if(!plans.length)return null;
  const outputs=[];for(const p of plans){const citations=p.citations.filter(c=>game==='both'||c.game===game);if(!citations.length||game==='both'&&!['ruby','sapphire'].every(g=>citations.some(c=>c.game===g)))continue;for(const c of citations)outputs.push({plan:p,citation:c,chinese:display(c.quote)});}
  if(!outputs.length||new Set(outputs.map(o=>o.chinese)).size!==1)return {chinese:null,reason:'original_semantic_output_conflict'};
  const first=outputs[0];return {chinese:first.chinese,planId:first.plan.id,outputMode:first.plan.outputMode,citations:outputs.map(o=>o.citation),reason:'reviewed_original_semantic_unit'};
 }
}
