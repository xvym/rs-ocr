import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseCsv,parseRsc,parseDictionary,csv,termKey} from './corpus_common.mjs';
import {verifyManifest} from './rsc_translation_policy.mjs';
import {validateRscCorrespondenceIndex,loadOriginalRscEntries,validateReverseCorrespondenceReview} from './rsc_correspondence_index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'reports/rsc-reverse-mapping');
fs.mkdirSync(out,{recursive:true});
verifyManifest(root,'outputs/corpus-mapping');verifyManifest(root,'outputs/s6-corpus');
const inputs=[],input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
const sources=JSON.parse(input('corpus/sources.json')).sources;
const rows=parseCsv(input('outputs/corpus-mapping/rsc-import.csv'));
const candidates=parseCsv(input('outputs/corpus-mapping/candidates.csv'));
const records=parseCsv(input('outputs/corpus-mapping/records.csv'));
const recordMap=new Map(records.map(r=>[r.qid,r]));
const correspondenceIndex=validateRscCorrespondenceIndex(JSON.parse(input('outputs/corpus-mapping/correspondences.json')),records);
const originals=loadOriginalRscEntries(root,rows);
const reverseReview=validateReverseCorrespondenceReview(JSON.parse(input('corpus/rsc-reverse-reviews.json')),{records,originals,sourceManifestSha256:sha256(fs.readFileSync(path.join(root,'corpus/sources.json')))});
const reviews=JSON.parse(input('reports/rsc-semantic-audit/semantic-review.json')).reviews;
const sourceById=new Map(sources.map(s=>[s.id,s]));
const key=(sourceId,index)=>sourceId+':'+index;
const rawByKey=new Map(rows.map(r=>[key(r.sourceId,r.index),r]));
const valid=r=>r&&r.japanese&&r.japanese!=='[NULL]';
const formal=new Map(),semantic=new Map(),partial=new Map();
const indexedReviewed=new Map(),indexedFragments=new Map(),indexedParents=new Map(),indexSources=new Map(correspondenceIndex.sourceEntries.map(r=>[r.id,r]));
const add=(map,k,qid)=>{const set=map.get(k)||new Set();set.add(qid);map.set(k,set);};
for(const link of correspondenceIndex.links){
 const source=indexSources.get(link.sourceEntryId),k=key(source.sourceId,source.sourceLine),original=rawByKey.get(k);if(!original)continue;
 if(original.chinese!==source.originalChinese||original.game!==link.game)throw Error('Changed indexed RSC source');
 add(link.relation==='pokedex_parent'?indexedParents:link.relation==='reviewed_source_fragment'?indexedFragments:indexedReviewed,k,link.qid);
}
for(const c of candidates){
 const r=recordMap.get(c.qid);if(!valid(r)||!(r.game==='both'||r.game===c.game))throw Error('Invalid Japanese candidate '+c.id);
 if(c.kind!=='rsc_address')continue;
 const k=key(c.sourceId,c.sourceLine),original=rawByKey.get(k);
 if(!original||original.chinese!==c.chinese||original.game!==c.game)throw Error('Unbound original RSC candidate '+c.id);
 add(formal,k,c.qid);
}
for(const review of reviews){
 const r=recordMap.get(review.qid);if(!valid(r)||r.japanese!==review.japanese)throw Error('Stale semantic review');
 const destination=['original_correspondence_found','original_source_span_found'].includes(review.verdict)?semantic:review.verdict==='partial_original_segments'?partial:null;
 if(!destination)continue;
 for(const group of review.sourceReferences)for(const c of group.candidates)for(const w of c.witnesses){
  const k=key(w.sourceId,w.index),original=rawByKey.get(k);if(!original)continue;
  if(original.game!==group.game||sha256(Buffer.from(original.chinese))!==c.originalChineseSha256||original.chinese.slice(...c.chineseSpan)!==c.chinese)throw Error('Changed semantic source quotation');
  add(destination,k,review.qid);
 }
}
const entries=rows.map(r=>{
 const k=key(r.sourceId,r.index),formalQids=[...(formal.get(k)||[])],semanticQids=[...(semantic.get(k)||[])],partialQids=[...(partial.get(k)||[])];
 const indexedReviewedQids=[...(indexedReviewed.get(k)||[])],indexedFragmentQids=[...(indexedFragments.get(k)||[])],indexedParentQids=[...(indexedParents.get(k)||[])];
 let status=formalQids.length?'indexed_japanese_candidate':indexedReviewedQids.length?'indexed_reviewed_correspondence':indexedFragmentQids.length?'indexed_reviewed_fragment':indexedParentQids.length?'indexed_pokedex_parent':semanticQids.length?'reviewed_correspondence_not_indexed':'unresolved';
 let parentJapanese=null,paginationRecord=null;
 const match=r.sourceSymbol.match(/^DexDescription_(.+)_2$/);
 if(['unresolved','indexed_pokedex_parent'].includes(status)&&match&&match[1]!=='Dummy'){
  const prefix=`rs.common.pokedex_entries^${r.game==='ruby'?'R':'S'}.DexDescription_${match[1]}`;
  const parent=recordMap.get(prefix+'_1'),second=recordMap.get(prefix+'_2');
  if(valid(parent)&&second?.japanese==='[NULL]'&&second.english&&parent.game===r.game){
   if(status!=='indexed_pokedex_parent')status='pokedex_parent_japanese_located';parentJapanese={qid:parent.qid,japanese:parent.japanese,english:parent.english};
   paginationRecord={qid:second.qid,japanese:second.japanese,english:second.english};
  }
 }
 return {game:r.game,sourceId:r.sourceId,index:Number(r.index),recordedAddress:r.recordedAddress,address:r.address,sourceSymbol:r.sourceSymbol,sourceFile:r.sourceFile,chinese:r.chinese,
  status,formalQids,indexedReviewedQids,indexedFragmentQids,indexedParentQids,semanticQids,partialQids,parentJapanese,paginationRecord};
});
const perGame={};
for(const game of ['ruby','sapphire']){
 const list=entries.filter(r=>r.game===game),remaining=list.filter(r=>r.status==='unresolved'),groups={};
 for(const r of remaining)groups[r.sourceFile]=(groups[r.sourceFile]||0)+1;
 perGame[game]={total:list.length,indexedJapaneseCandidates:list.filter(r=>r.status==='indexed_japanese_candidate').length,
  indexedReviewedCorrespondences:list.filter(r=>r.status==='indexed_reviewed_correspondence').length,
  indexedReviewedFragments:list.filter(r=>r.status==='indexed_reviewed_fragment').length,
  indexedPokedexParentRecords:list.filter(r=>r.status==='indexed_pokedex_parent').length,
  notIndexed:list.filter(r=>!r.status.startsWith('indexed_')).length,
  additionalReviewedCorrespondences:list.filter(r=>r.status==='reviewed_correspondence_not_indexed').length,
  additionalPokedexParentRecords:list.filter(r=>r.status==='pokedex_parent_japanese_located').length,
  remainingWithoutConfirmedOrParentLink:remaining.length,remainingSourceGroups:groups,
  note:'Parent location is structural evidence only: Chinese page-to-Japanese-span equivalence is not approved.'};
 if(list.length!==9805||perGame[game].indexedJapaneseCandidates+perGame[game].indexedReviewedCorrespondences+perGame[game].indexedReviewedFragments+perGame[game].indexedPokedexParentRecords+perGame[game].additionalReviewedCorrespondences+perGame[game].additionalPokedexParentRecords+remaining.length!==9805)throw Error('Incomplete reverse inventory');
 if(perGame[game].additionalPokedexParentRecords+perGame[game].indexedPokedexParentRecords!==386)throw Error('Unexpected Pokedex pagination inventory');
 if(!remaining.some(r=>r.sourceSymbol==='DexDescription_Dummy_2'))throw Error('Dummy description must not be silently paired');
}
const dictionarySummary=[];
for(const s of sources.filter(s=>/^corpus-/.test(s.id)&&s.repository==='UWorldGX/pkmn_rs_chn_rsc')){
 const text=input(s.local);if(sha256(fs.readFileSync(path.join(root,s.local)))!==s.sha256)throw Error('Changed dictionary');
 const ds=parseDictionary(text),baseline=new Set(candidates.filter(c=>c.sourceId===s.id).map(c=>Number(c.sourceLine)));
 const indexed=new Set(correspondenceIndex.links.filter(l=>l.relation!=='pokedex_parent').map(l=>indexSources.get(l.sourceEntryId)).filter(e=>e.sourceId===s.id).map(e=>e.sourceLine));
 const linked=new Set([...baseline,...indexed]);
 dictionarySummary.push({sourceId:s.id,path:s.path,total:ds.length,addressOrTypedBaselineRows:baseline.size,additionalCorrespondenceRows:[...indexed].filter(n=>!baseline.has(n)).length,indexedRows:linked.size,notIndexedRows:ds.filter(d=>!linked.has(d.line)).length,
  note:'Dictionary rows include aliases and entries outside the RS name tables; unlinked rows are not automatically missing RS translations.'});
}
// Also inventory every textual translation database in the fixed project tree.
// Alternate language/naming branches share addresses; that gives only structural
// Japanese candidates and never approves the branch's Chinese semantics.
const repository=JSON.parse(input('reports/rsc-semantic-audit/source-manifest.json'));
const addressEntries=new Map(entries.map(r=>[r.game+':'+r.recordedAddress.toLowerCase(),r]));
for(const r of entries)addressEntries.set(r.game+':'+r.address.toLowerCase(),r);
const fileSummary=[];
const dictionaryKind=file=>/宝可梦名称/.test(file)?'species_names':/技能名称/.test(file)?'move_names':/特性名称/.test(file)?'ability_names':/道具名称/.test(file)?'items':null;
for(const f of repository.files){
 const text=input(f.local);if(inputs.at(-1).sha256!==f.sha256)throw Error('Changed project text '+f.path);
 if(!f.path.endsWith('.txt')){fileSummary.push({path:f.path,kind:'documentation_or_page',entries:0});continue;}
 if(/英-日/.test(f.path)){fileSummary.push({path:f.path,kind:'english_japanese_dictionary_not_chinese',entries:0});continue;}
 if(/地址=/.test(text)){
  const ds=parseRsc(text),game=f.path.includes('红宝石')?'ruby':f.path.includes('蓝宝石')?'sapphire':null;
  const structural=ds.map(d=>addressEntries.get(game+':0x'+d.address.toString(16)));
  fileSummary.push({path:f.path,kind:'rsc_address_text',game,entries:ds.length,
   sameAddressIndexedJapanese:structural.filter(d=>d?.status==='indexed_japanese_candidate').length,
   sameAddressReviewedJapanese:structural.filter(d=>['indexed_reviewed_correspondence','reviewed_correspondence_not_indexed'].includes(d?.status)).length,
   sameAddressReviewedFragment:structural.filter(d=>d?.status==='indexed_reviewed_fragment').length,
   sameAddressPokedexParent:structural.filter(d=>['indexed_pokedex_parent','pokedex_parent_japanese_located'].includes(d?.status)).length,
   sameAddressStillUnresolved:structural.filter(d=>d?.status==='unresolved').length,
   outsidePrimaryAddressInventory:structural.filter(d=>!d).length});
 }else{
  const ds=parseDictionary(text),kind=dictionaryKind(f.path),known=new Set(records.filter(r=>valid(r)&&r.qid.split('.')[2]===kind).map(r=>termKey(r.english)));
  fileSummary.push({path:f.path,kind:ds.length?'translation_dictionary':'other_text',entries:ds.length,
   typedEnglishIdentityCandidates:kind?ds.filter(d=>known.has(termKey(d.english))).length:null});
 }
}
const reviewCases=reverseReview.cases.map(c=>{
 const entry=originals.entries.get(key(c.sourceId,c.sourceLine)),r=recordMap.get(c.qid);
 const links=correspondenceIndex.links.filter(l=>l.sourceEntryId===entry.id&&l.evidence.reviewLocal==='corpus/rsc-reverse-reviews.json');
 if(c.verdict==='confirmed'&&(links.length!==1||links[0].qid!==c.qid||JSON.stringify(links[0].chineseSpan)!==JSON.stringify(c.chineseSpan)||JSON.stringify(links[0].japaneseSpan)!==JSON.stringify(c.japaneseSpan)))throw Error('Reverse review not faithfully indexed '+entry.id);
 if(c.verdict==='deferred'&&links.length)throw Error('Deferred reverse source was indexed '+entry.id);
 return {...c,originalChinese:entry.originalChinese,quotedChinese:c.chineseSpan?entry.originalChinese.slice(...c.chineseSpan):null,
  sourceJapanese:r?.japanese??null,quotedJapanese:c.japaneseSpan?r.japanese.slice(...c.japaneseSpan):null,sourceEnglish:r?.english??null};
});
const summary={schemaVersion:3,direction:'original_RSC_record_to_Japanese_source',translationPolicy:'rsc-original-only-v1',perGame,dictionaries:dictionarySummary,correspondenceIndex:correspondenceIndex.summary,
 reverseReview:{baseline:reverseReview.baseline,cases:reviewCases.length,confirmedRecords:reviewCases.filter(c=>c.relation==='reviewed_correspondence').length,confirmedFragments:reviewCases.filter(c=>c.relation==='reviewed_source_fragment').length,deferred:reviewCases.filter(c=>c.verdict==='deferred').length,sameSourceJapaneseNull:reviewCases.filter(c=>c.verdict==='deferred'&&c.sourceJapanese==='[NULL]').length},
 projectFiles:repository.files.length,translationDatabaseFiles:fileSummary.filter(f=>['rsc_address_text','translation_dictionary'].includes(f.kind)).length,
 countsAreSourceEntriesNotUniqueSentences:true,semanticApprovalOfAllIndexedCandidates:false,wholeProjectSemanticReverseReviewComplete:false,
 translationPublicationChanged:false,formalCorrespondenceIndexPresent:true,boundary:'Formal candidate links, indexed reviewed correspondences and indexed Pokedex parent-record locations are distinct evidence levels. Alternate branches only inherit structural address hypotheses, not semantic approval.'};
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
write('summary.json',summary);write('project-files.json',fileSummary);write('source-review.json',{scope:reverseReview.scope,publicationApproved:false,cases:reviewCases});
write('not-indexed.json',{summary,records:entries.filter(r=>!r.status.startsWith('indexed_'))});
const simple=r=>({...r,formalQids:r.formalQids.join('|'),indexedReviewedQids:r.indexedReviewedQids.join('|'),indexedFragmentQids:r.indexedFragmentQids.join('|'),indexedParentQids:r.indexedParentQids.join('|'),semanticQids:r.semanticQids.join('|'),partialQids:r.partialQids.join('|'),parentQid:r.parentJapanese?.qid||''});
const columns=['game','sourceId','index','address','sourceSymbol','sourceFile','chinese','status','formalQids','indexedReviewedQids','indexedFragmentQids','indexedParentQids','semanticQids','partialQids','parentQid'];
fs.writeFileSync(path.join(out,'not-indexed.csv'),csv(entries.filter(r=>!r.status.startsWith('indexed_')).map(simple),columns));
fs.writeFileSync(path.join(out,'remaining.csv'),csv(entries.filter(r=>r.status==='unresolved').map(simple),columns));
const checks=[{name:'Both primary totals have exactly 9805 entries and disjoint complete evidence-level partitions',passed:true},
 {name:'Every formal link has nonempty applicable Japanese and exactly preserves original RSC Chinese',passed:true},
 {name:'Reviewed extra links preserve per-game original hashes and quotation ranges',passed:true},
 {name:'Each game has 386 non-dummy second pages with existing whole Japanese parents and NULL second Japanese fields',passed:true},
 {name:'Dummy second-page text stays unresolved; whole-page semantics are not inferred',passed:true},
 {name:'All pinned dictionary and project text hashes match; original-only runtime manifests verify',passed:true}];
write('checks.json',{passed:true,checks,scope:'Reverse inventory and source/parent identities, not independent semantic acceptance'});
const outputs=['summary.json','project-files.json','source-review.json','not-indexed.json','not-indexed.csv','remaining.csv','checks.json'];
write('run-manifest.json',{inputs,implementation:['tools/audit_rsc_reverse_mapping.mjs','tools/corpus_common.mjs','tools/rsc_translation_policy.mjs','tools/rsc_correspondence_index.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
 outputs:outputs.map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));
