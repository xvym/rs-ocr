import fs from 'node:fs';
import path from 'node:path';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {loadOriginalRscEntries} from './rsc_correspondence_index.mjs';
import {parseSource,project} from './japanese_source_matcher.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
const digest=s=>sha256(Buffer.from(s)),key=s=>project(s,{display:true}).key;
const operations=new Set(['original_location_then_literal','overwrite_original_final_two_zeroes','print_current_unsigned_value_only','original_level_marker_value_comma']);
export function compileNativeFields(root,review){
 const data=JSON.parse(read(path.join(root,'corpus/visible-windows/native-fields.json'))),records=new Map(parseCsv(read(path.join(root,'outputs/corpus-mapping/records.csv'))).map(r=>[r.qid,r]));
 const original=loadOriginalRscEntries(root,parseCsv(read(path.join(root,'outputs/corpus-mapping/rsc-import.csv')))),entries=new Map();
 const archive=JSON.parse(read(path.join(root,'corpus/sources.json'))).sources.find(s=>s.id==='upstream-7');
 const source=definition=>{const r=records.get(definition.qid);if(!r||digest(r.japanese)!==definition.japaneseSha256||digest(r.english)!==definition.englishSha256)throw Error('Changed original field source');return {...definition,japanese:r.japanese,english:r.english};};
 const cite=c=>{const e=original.entries.get(`${c.sourceId}:${c.sourceLine}`),[a,b]=c.span||[];if(!e||c.candidateId!==`original-entry:${e.id}`||e.originalChineseSha256!==c.sourceChineseSha256||!['ruby','sapphire'].includes(c.game)||e.game!=='both'&&e.game!==c.game||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>e.originalChinese.length)throw Error('Invalid native original citation');const quote=e.originalChinese.slice(a,b);if(digest(quote)!==c.quoteSha256||/[\\\[\]{}]/.test(quote))throw Error('Changed field literal');entries.set(e.id,e);return {...c,sourceEntryId:e.id,quote};};
 const fields=data.fields.map(f=>{
  const evidence=f.sourceEvidence,bytes=fs.readFileSync(path.join(root,evidence.local)),program=bytes.toString('utf8');if(evidence.sourceArchiveSha256!==archive.sha256||sha256(bytes)!==evidence.sha256||f.requiredCode.some(code=>!program.includes(code)))throw Error('Unverified original print caller');
  for(const e of f.additionalEvidence||[]){const bytes=fs.readFileSync(path.join(root,e.local));if(e.sourceArchiveSha256!==archive.sha256||sha256(bytes)!==e.sha256||e.requiredText.some(text=>!bytes.toString('utf8').includes(text)))throw Error('Unverified original print literal');}
  return {...f,source:source(f.source),citations:f.citations.map(cite),...(f.locations?{locations:f.locations.map(l=>({...source(l),citations:l.citations.map(cite)}))}:{})};
 });
 const byKey=new Map(data.cases.map(c=>[c.key,c]));if(byKey.size!==data.cases.length)throw Error('Duplicate field fixture');
 for(const d of review.decisions.filter(d=>d.disposition==='original_rsc_native_field')){const c=byKey.get(d.key);if(!c||c.decisionId!==d.id||c.field!==d.nativeField||!fields.some(f=>f.id===d.nativeField&&f.type===d.type))throw Error('Missing reviewed field recipe');}
 if(data.cases.length!==review.decisions.filter(d=>d.disposition==='original_rsc_native_field').length)throw Error('Unused native field case');
 const pack={schemaVersion:1,translationPolicy:POLICY,scope:'existing_original_print_callers_current_visible_fields',sources:original.sources,sourceEntries:[...entries.values()],fields,generatedChineseTemplates:0};validateNativeFields(pack);return pack;
}
export function validateNativeFields(pack){
 if(pack.schemaVersion!==1||pack.translationPolicy!==POLICY||pack.sources?.length!==6||pack.generatedChineseTemplates!==0)throw Error('Original native recipe required');
 const sources=new Map(pack.sources.map(s=>[s.id,s])),entries=new Map();for(const s of sources.values())if(s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17')throw Error('Changed native repository');
 for(const e of pack.sourceEntries){const s=sources.get(e.sourceId);if(!s||s.sha256!==e.sourceSha256||s.path!==e.sourcePath||digest(e.originalChinese)!==e.originalChineseSha256||entries.has(e.id))throw Error('Changed native witness');entries.set(e.id,e);}
 const ids=new Set();for(const f of pack.fields){
  if(ids.has(f.id)||!operations.has(f.operation)||digest(f.source.japanese)!==f.source.japaneseSha256||digest(f.source.english)!==f.source.englishSha256||!f.sourceEvidence.sha256||!f.requiredCode.length)throw Error('Changed original print recipe');ids.add(f.id);
  for(const l of f.locations||[])if(digest(l.japanese)!==l.japaneseSha256||digest(l.english)!==l.englishSha256)throw Error('Changed original location');
  for(const c of [...f.citations,...(f.locations||[]).flatMap(l=>l.citations)]){const e=entries.get(c.sourceEntryId),[a,b]=c.span||[];if(!e||!['ruby','sapphire'].includes(c.game)||e.game!=='both'&&e.game!==c.game||e.id!==`${c.sourceId}:${c.sourceLine}`||c.sourceChineseSha256!==e.originalChineseSha256||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>e.originalChinese.length||e.originalChinese.slice(a,b)!==c.quote||digest(c.quote)!==c.quoteSha256||/[\\\[\]{}]/.test(c.quote))throw Error('Changed original field literal');}
  if(f.operation==='print_current_unsigned_value_only'&&f.citations.length||f.operation==='overwrite_original_final_two_zeroes'&&f.citations.some(c=>!c.quote.endsWith('00')))throw Error('Not an original numeric format');
  if(f.operation==='original_level_marker_value_comma'&&(f.source.qid!=='rs.common.strings2.gOtherText_Comma'||f.source.english!==','||f.citations.length||!f.additionalEvidence?.length||!f.requiredCode.includes('*dest++ = CHAR_LV;')||!f.requiredCode.includes('dest = StringCopy(dest, gOtherText_Comma);')))throw Error('Not the original level print sequence');
 }
 return pack;
}
export class OriginalNativeFieldProbe{
 constructor(pack){this.pack=structuredClone(validateNativeFields(pack));}
 lookup(unit,{type,game='both'}={}){
  if(typeof unit.raw!=='string'||!['ruby','sapphire','both'].includes(game)||/[\[\]{}\\�\r\n]/.test(unit.raw))return null;
  const projection=project(unit.raw,{display:true}),results=[];
  for(const f of this.pack.fields.filter(f=>f.type===type)){
   let raw,location;
   const parsed=parseSource(f.source.japanese);if(parsed.pages.length!==1||parsed.unsupported.length)continue;const source=parsed.pages[0].join('\n');
   if(f.operation==='original_location_then_literal'){
    const token='\uE000STR_VAR_1\uE001',at=source.indexOf(token);if(at<0)continue;const prefix=key(source.slice(0,at)),suffix=key(source.slice(at+token.length));
    if(!projection.key.startsWith(prefix)||!projection.key.endsWith(suffix)||projection.key.length<=prefix.length+suffix.length)continue;
    raw=unit.raw.slice(projection.offsets[prefix.length],projection.offsets[projection.key.length-suffix.length-1]+1);
    location=f.locations.find(l=>key(l.japanese)===key(raw));if(!location)continue;
   }else if(f.operation==='overwrite_original_final_two_zeroes'){
    const pattern=key(source),at=pattern.indexOf('00');if(at<0||!projection.key.startsWith(pattern.slice(0,at))||!projection.key.endsWith(pattern.slice(at+2)))continue;
    const end=projection.key.length-(pattern.length-at-2),value=projection.key.slice(at,end);if(!/^[1-9][0-9]?$/.test(value))continue;
    raw=unit.raw.slice(projection.offsets[at],projection.offsets[end-1]+1);if(!/^[0-9０-９]+$/.test(raw))continue;
   }else if(f.operation==='original_level_marker_value_comma'){
    const suffix=key(source),value=projection.key.slice(2,-suffix.length);if(!projection.key.startsWith('Lv')||!projection.key.endsWith(suffix)||!/^(?:[1-9][0-9]?|100)$/.test(value))continue;
    raw=unit.raw.slice(projection.offsets[2],projection.offsets[2+value.length-1]+1);if(!/^[0-9０-９]+$/.test(raw))continue;
   }else{
    const prefix=key(source);if(!projection.key.startsWith(prefix))continue;const value=projection.key.slice(prefix.length);if(!/^(?:0|[1-9][0-9]{0,9})$/.test(value))continue;
    raw=unit.raw.slice(projection.offsets[prefix.length],projection.offsets.at(-1)+1);if(!/^[0-9０-９]+$/.test(raw))continue;
   }
   const byGame={},citations=[];let blocked=false;
   for(const g of game==='both'?['ruby','sapphire']:[game]){
    const quote=f.citations.filter(c=>c.game===g),place=location?.citations.filter(c=>c.game===g)||[];
    if(!['print_current_unsigned_value_only','original_level_marker_value_comma'].includes(f.operation)&&new Set(quote.map(c=>c.quote)).size!==1||location&&new Set(place.map(c=>c.quote)).size!==1){blocked=true;break;}
    const value=location?place[0].quote:raw;
    const output=f.operation==='original_location_then_literal'?value+quote[0].quote:f.operation==='overwrite_original_final_two_zeroes'?quote[0].quote.slice(0,-2)+value:f.operation==='original_level_marker_value_comma'?'Lv'+value+f.source.english:value;
    byGame[g]={output,value,raw,citations:place};citations.push(...place,...quote);
   }
   if(!blocked&&new Set(Object.values(byGame).map(v=>v.output)).size===1)results.push({chinese:Object.values(byGame)[0].output,fieldId:f.id,byGame,citations});
  }
  if(!results.length||new Set(results.map(r=>r.chinese)).size!==1)return null;return results[0];
 }
}
