import fs from 'node:fs';
import path from 'node:path';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {JapaneseSourceMatcher,project} from './japanese_source_matcher.mjs';
import {loadOriginalRscEntries} from './rsc_correspondence_index.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
const digest=s=>sha256(Buffer.from(s));
export const ORIGINAL_VARIABLE_TOKEN=/\[[^\]]+\]|\\v\\h[0-9A-Fa-f]{2}/g;
const literal=text=>text.replace(/\\([nlp])/g,(_,c)=>c==='p'?'\n\n':'\n');
const knownSelectors=new Set(['capture','lexical_capture','meaning_term','model_component','normal_experience_empty']);
const variableToken=token=>/^\[(?:玩家|对手|占位符|buffer[123]|LegendPokemon[12]|Team[12]|Version)\]$/.test(token)||/^\\v\\h[0-9A-Fa-f]{2}$/.test(token)&&Number.parseInt(token.slice(-2),16)<=0x2A;
export function validateTemplateTokens(quote,bindings){
 const tokens=[...quote.matchAll(ORIGINAL_VARIABLE_TOKEN)].map(m=>m[0]);
 if(!tokens.length||tokens.some(t=>!variableToken(t)||!Object.hasOwn(bindings,t))||Object.keys(bindings).some(t=>!tokens.includes(t)))throw Error('Missing or unapproved original template token binding');
 const rest=quote.replace(ORIGINAL_VARIABLE_TOKEN,'');if(/[\[\]{}\uE000\uE001]/.test(rest)||/\\(?![nlp])/.test(rest))throw Error('Unreviewed template printing control');
 for(const b of Object.values(bindings))if(!knownSelectors.has(b.from)||b.from==='capture'&&!['actor','player','number','honorific','display_term'].includes(b.category))throw Error('Unapproved variable selector');
}
export function renderBoundOriginal(quote,values){
 validateTemplateTokens(quote,Object.fromEntries(Object.keys(values).map(t=>[t,{from:'capture',category:'actor'}])));
 // Tokenize the original first. Captured text is appended literally and is never
 // interpreted as another placeholder, escape, regular expression or replacement.
 let out='',at=0;for(const m of quote.matchAll(ORIGINAL_VARIABLE_TOKEN)){out+=literal(quote.slice(at,m.index))+values[m[0]];at=m.index+m[0].length;}return out+literal(quote.slice(at));
}
export function compileVariableBindings(root,review,regions){
 const json=local=>JSON.parse(read(path.join(root,local))),selection=json('corpus/visible-windows/variable-bindings.json');
 if(selection.schemaVersion!==1||selection.translationPolicy!==POLICY)throw Error('Original RSC variable binding review required');
 for(const f of selection.inputs)if(/(^|[\\/])archive[\\/]/.test(f.local)||sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error('Changed variable evidence '+f.local);
 const records=parseCsv(read(path.join(root,'outputs/corpus-mapping/records.csv'))),byQid=new Map(records.map(r=>[r.qid,r]));
 const candidates=parseCsv(read(path.join(root,'outputs/corpus-mapping/candidates.csv'))),byId=new Map(candidates.map(c=>[c.id,c]));
 const originals=loadOriginalRscEntries(root,parseCsv(read(path.join(root,'outputs/corpus-mapping/rsc-import.csv')))),sourceEntries=new Map();
 function citation(c){
  const original=byId.get(c.candidateId),entry=originals.entries.get(`${c.sourceId}:${c.sourceLine}`),[start,end]=c.span||[];
  const direct=entry&&c.origin==='reviewed_original_entry'&&c.candidateId===`original-entry:${entry.id}`&&c.sourceSymbol===entry.sourceSymbol&&c.sourceSymbol===c.qid.split('.').at(-1);
  if(!entry||entry.game!=='both'&&entry.game!==c.game||!direct&&(!original||original.qid!==c.qid||original.game!==c.game||original.sourceId!==c.sourceId||Number(original.sourceLine)!==c.sourceLine||entry.originalChinese!==original.chinese)||entry.originalChineseSha256!==c.sourceChineseSha256||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>entry.originalChinese.length)throw Error('Invalid original variable citation');
  const quote=entry.originalChinese.slice(start,end);if(digest(quote)!==c.quoteSha256)throw Error('Changed original variable quotation');sourceEntries.set(entry.id,entry);
  return {...c,sourceEntryId:entry.id,quote};
 }
 const kindFor={species_names:'species',move_names:'move',items:'item',ability_names:'ability',trainer_class_names:'trainer_class'};
 const groups=new Map();for(const c of candidates){const k=`${c.qid}:${c.game}`,list=groups.get(k)||[];list.push(c);groups.set(k,list);}
 const componentQids=new Set(json('outputs/battle-source-matching/templates.json').variants.filter(v=>v.family==='ordinary_stat_change'&&Math.abs(v.meaning.delta)===1).flatMap(v=>v.componentSources));
 const terms=[];
 for(const list of groups.values()){
  const r=byQid.get(list[0].qid),kind=kindFor[r.qid.split('.')[2]]||(/\.OtherText_(Normal|Super|Hyper|Master)$/.test(r.qid)?'contest_rank':/\.gExpandedPlaceholder_(Aqua|Magma)$/.test(r.qid)?'team':componentQids.has(r.qid)?'original_component':null);if(!kind)continue;
  const dictionaries=list.filter(c=>c.kind===kind),choices=dictionaries.length?dictionaries:list,texts=[...new Set(choices.map(c=>c.chinese))];
  if(texts.length!==1||!texts[0]||/[\\\[\]{}]/.test(texts[0]))continue;
  terms.push({qid:r.qid,game:list[0].game,kind,japanese:r.japanese,chinese:texts[0],citations:choices.map(c=>citation({candidateId:c.id,qid:c.qid,game:c.game,sourceId:c.sourceId,sourceLine:Number(c.sourceLine),sourceChineseSha256:digest(c.chinese),span:[0,c.chinese.length],quoteSha256:digest(c.chinese)}))});
 }
 const familyIds=new Set(),contracts=selection.families.map(f=>{
  const record=byQid.get(f.qid);if(familyIds.has(f.id)||!record||digest(record.japanese)!==f.sourceJapaneseSha256||digest(record.english)!==f.sourceEnglishSha256)throw Error('Stale variable source '+f.id);familyIds.add(f.id);
  const citations=f.citations.map(c=>{if(c.qid!==f.qid)throw Error('Wrong template source');return citation(c);});
  if(!['ruby','sapphire'].every(g=>citations.some(c=>c.game===g)))throw Error('Both template versions required');
  for(const c of citations)validateTemplateTokens(c.quote,f.bindings);
  if(f.equivalentWording&&(record.game!=='both'||!['ruby','sapphire'].includes(f.equivalentWording.selection)||f.equivalentWording.scope!=='same_observed_event_no_version_fact'||!f.equivalentWording.reason))throw Error('Unreviewed original wording equivalence');
  for(const b of Object.values(f.bindings))if(b.from==='normal_experience_empty'){
   const normal=byQid.get('rs.common.battle_strings.BattleText_Terminator'),native=json('reports/battle-source-matching/experience-evidence.json');
   if(normal?.english!==''||normal.japanese!=='は\\n'||native.normalComponent!=='BattleText_Terminator'||f.conditions?.boostedWording!==false)throw Error('Normal experience modifier is not verified empty');
  }
  return {...f,sourceJapanese:record.japanese,sourceEnglish:record.english,citations};
 });
 const byKey=new Map(selection.cases.map(c=>[c.key,c]));if(byKey.size!==selection.cases.length)throw Error('Duplicate variable fixture');
 for(const d of review.decisions.filter(d=>d.disposition==='original_rsc_template')){
  const c=byKey.get(d.key),f=contracts.find(f=>f.id===d.variableFamily);if(!c||c.decisionId!==d.id||c.family!==f?.id)throw Error('Missing reviewed variable case '+d.id);
  for(const u of regions.flatMap(r=>r.units).filter(u=>u.key===d.key))if(!u.result.candidates.some(s=>s.qid===f.qid&&(f.windows||[f.window]).some(w=>s.page===w.page&&s.lineStart===w.lineStart&&s.lineCount===w.lineCount)))throw Error('Missing complete observed source '+d.id);
 }
 if(selection.cases.length!==review.decisions.filter(d=>d.disposition==='original_rsc_template').length)throw Error('Unused variable fixture');
 const battleTemplates=json('outputs/battle-source-matching/templates.json'),sourceMap=new Map(battleTemplates.sources.map(r=>[r.qid,r]));
 for(const c of contracts)sourceMap.set(c.qid,byQid.get(c.qid));
 const pack={schemaVersion:1,translationPolicy:POLICY,scope:'source_scoped_original_RSC_placeholder_binding',sources:originals.sources,sourceEntries:[...sourceEntries.values()],contracts,terms,
  matcherRecords:[...sourceMap.values()],battleTemplates,generatedTemplates:0,rewrittenTemplates:0,reviewSha256:sha256(fs.readFileSync(path.join(root,'corpus/visible-windows/variable-bindings.json'))),
  namePolicy:'Copy the complete currently observed name/actor label; do not infer species, player identity, earlier values or hidden text.'};
 validateVariableBindings(pack);return pack;
}
export function validateVariableBindings(pack){
 if(pack.schemaVersion!==1||pack.translationPolicy!==POLICY||pack.generatedTemplates!==0||pack.rewrittenTemplates!==0||pack.sources?.length!==6)throw Error('Original-only variable pack required');
 const sources=new Map(pack.sources.map(s=>[s.id,s])),entries=new Map(),records=new Map(pack.matcherRecords.map(r=>[r.qid,r]));
 for(const s of sources.values())if(s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17')throw Error('Changed variable repository');
 for(const e of pack.sourceEntries){const s=sources.get(e.sourceId);if(entries.has(e.id)||!s||s.sha256!==e.sourceSha256||s.path!==e.sourcePath||digest(e.originalChinese)!==e.originalChineseSha256)throw Error('Changed variable source witness');entries.set(e.id,e);}
 function validateCitation(c){const e=entries.get(c.sourceEntryId),[a,b]=c.span||[];if(!e||!['ruby','sapphire'].includes(c.game)||e.game!=='both'&&e.game!==c.game||e.sourceId!==c.sourceId||e.sourceLine!==c.sourceLine||e.originalChineseSha256!==c.sourceChineseSha256||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b>e.originalChinese.length||e.originalChinese.slice(a,b)!==c.quote||digest(c.quote)!==c.quoteSha256)throw Error('Changed variable citation');}
 const ids=new Set();for(const f of pack.contracts){const r=records.get(f.qid);if(ids.has(f.id)||!r||digest(r.japanese)!==f.sourceJapaneseSha256||digest(r.english)!==f.sourceEnglishSha256||r.japanese!==f.sourceJapanese||(f.windows||[f.window]).some(w=>!Number.isSafeInteger(w.page)||w.page<0||!Number.isSafeInteger(w.lineStart)||w.lineStart<0||!Number.isSafeInteger(w.lineCount)||w.lineCount<1))throw Error('Invalid variable contract');ids.add(f.id);for(const c of f.citations){validateCitation(c);if(c.qid!==f.qid)throw Error('Wrong template citation');validateTemplateTokens(c.quote,f.bindings);}
  if(f.equivalentWording&&(r.game!=='both'||f.equivalentWording.event!=='wild_encounter'||!['ruby','sapphire'].includes(f.equivalentWording.selection)||f.equivalentWording.scope!=='same_observed_event_no_version_fact'||!f.equivalentWording.reason))throw Error('Unreviewed original wording equivalence');
 }
 for(const t of pack.terms){if(!t.chinese||/[\\\[\]{}]/.test(t.chinese)||!t.citations.length)throw Error('Invalid original bound term');for(const c of t.citations){validateCitation(c);if(c.qid!==t.qid||c.game!==t.game||c.quote!==t.chinese)throw Error('Wrong bound term witness');}}
 return pack;
}
export class OriginalVariableProbe{
 constructor(pack){this.pack=structuredClone(validateVariableBindings(pack));this.matcher=new JapaneseSourceMatcher(this.pack.matcherRecords,{battleTemplates:this.pack.battleTemplates});this.allowed=new Set([...this.pack.battleTemplates.actor.allowedCharacters,' ','　']);}
 term(qid,game,kind=null){const values=this.pack.terms.filter(t=>t.qid===qid&&t.game===game&&(!kind||t.kind===kind));return new Set(values.map(t=>t.chinese)).size===1?{value:values[0].chinese,citations:values.flatMap(t=>t.citations)}:null;}
 value(spec,c,raw,game){
  if(spec.from==='capture'||spec.from==='lexical_capture'){
   const matches=c.bindings.filter(b=>b.slot===spec.slot);if(!matches.length||new Set(matches.map(b=>JSON.stringify([b.raw,b.start,b.end]))).size!==1)return null;
   const b=matches[0];if(!Number.isSafeInteger(b.start)||!Number.isSafeInteger(b.end)||b.start<0||b.end<=b.start||b.end>raw.length||raw.slice(b.start,b.end)!==b.raw||/[\r\n\[\]{}\\�]/.test(b.raw))return null;
   if(spec.from==='lexical_capture'){
    const key=project(b.raw,{display:true}).key,terms=this.pack.terms.filter(t=>t.kind===spec.kind&&t.game===game&&project(t.japanese,{display:true}).key===key&&(!spec.allowedQids||spec.allowedQids.includes(t.qid)));
    if(new Set(terms.map(t=>t.chinese)).size!==1)return null;
    return {value:terms[0].chinese,raw:b.raw,start:b.start,end:b.end,sourceSlot:b.slot,citations:terms.flatMap(t=>t.citations)};
   }
   const length=[...b.raw.replace(/[ \u3000]/g,'')].length;
   if(spec.category==='number'){if(!/^[0-9０-９]{1,5}$/.test(b.raw))return null;}
   else if(spec.category==='honorific'){if(!['くん','ちゃん'].includes(b.raw))return null;}
   else {
    const projected=project(b.raw,{display:true}).key,prefix=spec.category==='actor'?this.pack.battleTemplates.actor.prefixes.find(p=>projected.startsWith(project(p.text,{display:true}).key)):null;
    const nameLength=length-(prefix?project(prefix.text,{display:true}).key.length:0),limit=spec.category==='player'?5:spec.category==='display_term'?16:10;
    if(!length||nameLength<1||nameLength>limit||[...b.raw].some(ch=>!this.allowed.has(ch)))return null;
   }
   return {value:b.raw,raw:b.raw,start:b.start,end:b.end,sourceSlot:b.slot,citations:[]};
  }
  if(spec.from==='meaning_term'){const qid=c.meaning?.[spec.field];return qid?this.term(qid,game,spec.kind):null;}
  if(spec.from==='model_component'){
   if(c.meaning?.event!=='stat_change'||Math.abs(c.meaning.delta)!==1)return null;
   const model=this.pack.battleTemplates.variants.find(m=>m.id===c.modelId);return model?.componentSources.length===2?this.term(model.componentSources[spec.index],game,'original_component'):null;
  }
  if(spec.from==='normal_experience_empty')return c.meaning?.event==='experience_gain'&&c.meaning.boostedWording===false?{value:'',citations:[],evidence:'native_normal_component_and_empty_English_modifier'}:null;
  return null;
 }
 lookup(searchText,{type,game='both',kind=null}={}){
  if(typeof searchText!=='string'||searchText.length>512||!['both','ruby','sapphire'].includes(game)||/[\[\]{}\\�\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(searchText))return null;
  const rules=this.pack.contracts.filter(f=>f.type===type);if(!rules.length)return null;
  const found=this.matcher.lookup(searchText,{game,kind});if(!found.bindingSearchComplete)return null;
  const results=[];let versionConflict=null;
  for(const f of rules)for(const c of found.candidates){
   if(c.qid!==f.qid||!(f.windows||[f.window]).some(w=>c.page===w.page&&c.lineStart===w.lineStart&&c.lineCount===w.lineCount)||!c.bindingSearchComplete||Object.entries(f.conditions||{}).some(([k,v])=>c.meaning?.[k]!==v)||f.equivalentWording&&c.meaning?.event!==f.equivalentWording.event)continue;
   const languages=[];let blocked=false;
   for(const g of game==='both'?['ruby','sapphire']:[game]){
    const citations=f.citations.filter(c=>c.game===g),bindings={};if(!citations.length){blocked=true;break;}
    for(const [token,spec] of Object.entries(f.bindings)){const value=this.value(spec,c,searchText,g);if(!value){blocked=true;break;}bindings[token]=value;}if(blocked)break;
    const outputs=[...new Set(citations.map(q=>renderBoundOriginal(q.quote,Object.fromEntries(Object.entries(bindings).map(([t,b])=>[t,b.value])))))];if(outputs.length!==1){blocked=true;break;}
    languages.push({game:g,output:outputs[0],bindings,citations});
   }
   if(!blocked){if(new Set(languages.map(l=>l.output)).size===1)results.push({familyId:f.id,chinese:languages[0].output,languages});else if(game==='both'&&f.equivalentWording){const chosen=languages.find(l=>l.game===f.equivalentWording.selection);results.push({familyId:f.id,chinese:chosen.output,languages,originalWordingSelection:chosen.game});}else versionConflict={familyId:f.id,chinese:null,reason:'original_game_or_wording_conflict'};}
  }
  if(!results.length||new Set(results.map(r=>r.chinese)).size!==1)return versionConflict;
  // Equivalent candidates may represent different scripts/roles. Preserve their
  // evidence without choosing a global actor identity or caching any value.
  const unique=new Map(results.map(r=>[JSON.stringify(r),r]));return {...results[0],alternatives:[...unique.values()]};
 }
}
