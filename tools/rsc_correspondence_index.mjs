import fs from 'node:fs';
import path from 'node:path';
import {read,sha256,parseRsc,parseDictionary} from './corpus_common.mjs';
import {POLICY,loadPolicy} from './rsc_translation_policy.mjs';
const REVIEWED=new Set(['reviewed_correspondence','reviewed_original_span','reviewed_source_fragment']);
const digest=text=>sha256(Buffer.from(text));
const sourceKey=(id,line)=>`${id}:${line}`;
const applicable=(r,game)=>r.game==='both'||r.game===game;
const validSpan=(span,text)=>Array.isArray(span)&&span.length===2&&span.every(Number.isSafeInteger)&&span[0]>=0&&span[1]>span[0]&&span[1]<=text.length;
// A source fragment is a reviewed range, never approval to render its parent
// record, concatenate adjacent records, or fill an unseen variable.
export function validateReverseCorrespondenceReview(review,{records,originals,sourceManifestSha256}){
  if(review.schemaVersion!==1||review.translationPolicy!==POLICY||review.sourceManifestSha256!==sourceManifestSha256||review.publicationApproved!==false)throw Error('Stale reverse correspondence review');
  const recordMap=new Map(records.map(r=>[r.qid,r])),seen=new Set();
  for(const c of review.cases){
    const key=sourceKey(c.sourceId,c.sourceLine),entry=originals.entries.get(key),r=recordMap.get(c.qid);
    if(seen.has(key)||!entry||entry.game!==c.game||entry.sourceSymbol!==c.sourceSymbol||entry.originalChineseSha256!==c.originalChineseSha256||!c.reason||['chinese','translation','japanese','english'].some(k=>k in c))throw Error('Changed reverse source review '+key);
    seen.add(key);
    if(c.qid!==null&&(!r||!applicable(r,c.game)||digest(r.japanese)!==c.japaneseSha256||digest(r.english)!==c.englishSha256))throw Error('Changed reverse Japanese review '+key);
    if(c.verdict==='deferred'){
      if(c.relation!==null||c.chineseSpan!==null||c.japaneseSpan!==null||c.japaneseFragmentSha256!==null)throw Error('Deferred reverse source cannot select a range');
      continue;
    }
    if(c.verdict!=='confirmed'||!r?.japanese||r.japanese==='[NULL]'||!['reviewed_correspondence','reviewed_source_fragment'].includes(c.relation)||!validSpan(c.chineseSpan,entry.originalChinese))throw Error('Invalid confirmed reverse source '+key);
    if(c.relation==='reviewed_source_fragment'?!validSpan(c.japaneseSpan,r.japanese)||digest(r.japanese.slice(...c.japaneseSpan))!==c.japaneseFragmentSha256:c.japaneseSpan!==null||c.japaneseFragmentSha256!==null)throw Error('Invalid reverse Japanese range '+key);
  }
  for(const game of ['ruby','sapphire'])if(review.cases.filter(c=>c.game===game).length!==review.baseline[game])throw Error('Incomplete reverse review cohort');
  return review;
}
export function loadOriginalRscEntries(root,rscRows=[]){
  const {sources}=loadPolicy(root),entries=new Map(),metadata=new Map(rscRows.map(r=>[sourceKey(r.sourceId,r.index),r]));
  for(const s of sources){
    const bytes=fs.readFileSync(path.join(root,s.local));if(sha256(bytes)!==s.sha256)throw Error('Changed original RSC source '+s.path);
    const text=bytes.toString('utf8').replace(/^\uFEFF/,''),addressTable=/地址=/.test(text);
    const game=s.id==='upstream-5'?'ruby':s.id==='upstream-6'?'sapphire':'both';
    const rows=addressTable?parseRsc(text).map(r=>({...r,sourceLine:r.index})):parseDictionary(text).map(r=>({...r,sourceLine:r.line}));
    for(const r of rows){
      const id=sourceKey(s.id,r.sourceLine),m=metadata.get(id);
      if(m&&m.chinese!==r.chinese)throw Error('Changed imported Chinese '+id);
      entries.set(id,{id,sourceId:s.id,sourceLine:r.sourceLine,locatorType:addressTable?'entry_number':'file_line',game,
        sourcePath:s.path,sourceSha256:s.sha256,originalChinese:r.chinese,originalChineseSha256:digest(r.chinese),
        recordedAddress:m?.recordedAddress||'',address:m?.address||'',sourceSymbol:m?.sourceSymbol||'',sourceFile:m?.sourceFile||'',english:r.english||''});
    }
  }
  return {sources,entries};
}
function mapsFor(links){
  const qids=new Map(),japanese=new Map(),sources=new Map();
  const add=(m,k,v)=>{const list=m.get(k)||[];list.push(v);m.set(k,list);};
  for(const link of links){add(qids,`${link.qid}:${link.game}`,link.id);add(japanese,link.japanese,link.id);add(sources,link.sourceEntryId,link.id);}
  const object=map=>Object.fromEntries([...map].sort(([a],[b])=>a<b?-1:a>b?1:0));
  return {byQidGame:object(qids),byJapanese:object(japanese),bySource:object(sources)};
}
export function compileRscCorrespondences({selection,records,rscRows,originals,sourceManifestSha256}){
  if(selection.schemaVersion!==1||selection.translationPolicy!==POLICY||selection.sourceManifestSha256!==sourceManifestSha256||selection.publicationApproved!==false)throw Error('Stale correspondence selection or policy');
  const recordMap=new Map(records.map(r=>[r.qid,r])),links=[],used=new Set(),sourcesUsed=new Set();
  const add=(r,game,entry,span,relation,evidence,japaneseSpan=null)=>{
    if(!r?.japanese||r.japanese==='[NULL]'||!applicable(r,game)||!applicable(entry,game))throw Error('Invalid correspondence game or Japanese source');
    if(!Array.isArray(span)||span.length!==2||!span.every(Number.isSafeInteger)||span[0]<0||span[1]<=span[0]||span[1]>entry.originalChinese.length)throw Error('Invalid original Chinese range');
    if(relation==='reviewed_source_fragment'?!validSpan(japaneseSpan,r.japanese):japaneseSpan!==null)throw Error('Invalid correspondence Japanese range');
    const key=JSON.stringify([r.qid,game,entry.id,span,relation,...(japaneseSpan?[japaneseSpan]:[])]);if(used.has(key))throw Error('Duplicate correspondence selection');used.add(key);sourcesUsed.add(entry.id);
    links.push({id:'association-'+digest(key).slice(0,24),qid:r.qid,game,japanese:r.japanese,english:r.english,
      japaneseSha256:digest(r.japanese),englishSha256:digest(r.english),sourceEntryId:entry.id,chinese:entry.originalChinese.slice(...span),chineseSpan:span,
      relation,matchExtent:relation==='pokedex_parent'?'parent_record_only':relation==='reviewed_original_span'?'original_chinese_span':relation==='reviewed_source_fragment'?'reviewed_source_fragment':'record_correspondence',
      japaneseSpan,...(japaneseSpan?{japaneseFragmentSha256:digest(r.japanese.slice(...japaneseSpan))}:{}),publicationApproved:false,evidence});
  };
  for(const s of selection.links){
    const r=recordMap.get(s.qid),entry=originals.entries.get(sourceKey(s.sourceId,s.sourceLine));
    if(!REVIEWED.has(s.relation)||!r||digest(r.japanese)!==s.japaneseSha256||digest(r.english)!==s.englishSha256||!entry||entry.originalChineseSha256!==s.originalChineseSha256)throw Error('Stale reviewed correspondence '+s.qid);
    const origin=s.originReview||selection.originReview;
    if(s.relation==='reviewed_source_fragment'&&(!validSpan(s.japaneseSpan,r.japanese)||digest(r.japanese.slice(...s.japaneseSpan))!==s.japaneseFragmentSha256))throw Error('Changed selected Japanese fragment');
    add(r,s.game,entry,s.chineseSpan,s.relation,{method:'non_blind_model_semantic_comparison',reviewLocal:origin.local,reviewSha256:origin.sha256,reason:s.reason},s.japaneseSpan??null);
  }
  if(selection.includePokedexParents){
    for(const row of rscRows){
      const match=row.sourceSymbol.match(/^DexDescription_(.+)_2$/);if(!match||match[1]==='Dummy')continue;
      const stem=`rs.common.pokedex_entries^${row.game==='ruby'?'R':'S'}.DexDescription_${match[1]}`;
      const parent=recordMap.get(stem+'_1'),page=recordMap.get(stem+'_2'),entry=originals.entries.get(sourceKey(row.sourceId,row.index));
      if(!parent?.japanese||parent.japanese==='[NULL]'||!page||page.japanese!=='[NULL]'||!page.english||!entry)throw Error('Changed Pokedex pagination source '+row.sourceSymbol);
      add(parent,row.game,entry,[0,entry.originalChinese.length],'pokedex_parent',{method:'same_species_and_game_parent_record',pageQid:page.qid,pageJapanese:page.japanese,
        pageEnglishSha256:digest(page.english),sourceSymbol:row.sourceSymbol,limitation:'Chinese page-to-Japanese visible range is unapproved.'});
    }
  }
  links.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const reviewed=links.filter(r=>REVIEWED.has(r.relation)),parents=links.filter(r=>r.relation==='pokedex_parent');
  const summary={links:links.length,reviewedLinks:reviewed.length,reviewedJapaneseQids:new Set(reviewed.map(r=>r.qid)).size,
    reviewedGamePairs:new Set(reviewed.map(r=>r.qid+':'+r.game)).size,reviewedFragmentLinks:reviewed.filter(r=>r.relation==='reviewed_source_fragment').length,structuralParentLinks:parents.length,
    sourceEntries:sourcesUsed.size,publicationApprovedLinks:0};
  const index={schemaVersion:1,translationPolicy:POLICY,scope:'source_correspondence_index_not_runtime_translation',sourceManifestSha256,
    sources:originals.sources,sourceEntries:[...sourcesUsed].sort().map(id=>originals.entries.get(id)),links,...mapsFor(links),summary};
  validateRscCorrespondenceIndex(index,records);return index;
}
export function validateRscCorrespondenceIndex(index,records=null){
  if(index.schemaVersion!==1||index.translationPolicy!==POLICY||index.scope!=='source_correspondence_index_not_runtime_translation')throw Error('Original-only correspondence index required');
  if(index.sources?.length!==6||index.sources.some(s=>s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17'))throw Error('Pinned RSC correspondence sources required');
  const sources=new Map(index.sources.map(s=>[s.id,s])),entries=new Map(),ids=new Set(),recordMap=records?new Map(records.map(r=>[r.qid,r])):null;
  for(const e of index.sourceEntries){const s=sources.get(e.sourceId);if(entries.has(e.id)||e.id!==sourceKey(e.sourceId,e.sourceLine)||!s||s.path!==e.sourcePath||s.sha256!==e.sourceSha256||digest(e.originalChinese)!==e.originalChineseSha256)throw Error('Changed correspondence source entry');entries.set(e.id,e);}
  for(const link of index.links){
    const e=entries.get(link.sourceEntryId),r=recordMap?.get(link.qid);
    if(ids.has(link.id)||!e||!applicable(e,link.game)||!['ruby','sapphire'].includes(link.game)||link.publicationApproved!==false||!link.japanese||link.japanese==='[NULL]')throw Error('Invalid correspondence metadata');ids.add(link.id);
    if(link.relation==='reviewed_source_fragment'?!validSpan(link.japaneseSpan,link.japanese)||link.matchExtent!=='reviewed_source_fragment'||digest(link.japanese.slice(...link.japaneseSpan))!==link.japaneseFragmentSha256:link.japaneseSpan!==null)throw Error('Invalid correspondence Japanese range');
    if(digest(link.japanese)!==link.japaneseSha256||digest(link.english)!==link.englishSha256||recordMap&&(!r||r.japanese!==link.japanese||r.english!==link.english||!applicable(r,link.game)))throw Error('Changed correspondence Japanese source');
    const span=link.chineseSpan;
    if(!Array.isArray(span)||span.length!==2||!span.every(Number.isSafeInteger)||span[0]<0||span[1]<=span[0]||span[1]>e.originalChinese.length||e.originalChinese.slice(...span)!==link.chinese)throw Error('Changed correspondence Chinese range');
    if(link.relation==='pokedex_parent'){
      if(link.matchExtent!=='parent_record_only'||!link.qid.endsWith('_1')||link.evidence.pageQid!==link.qid.slice(0,-1)+'2'||link.evidence.pageJapanese!=='[NULL]'||/DexDescription_Dummy_/.test(link.qid))throw Error('Invalid structural-only Pokedex link');
    }else if(!REVIEWED.has(link.relation))throw Error('Unreviewed correspondence relation');
  }
  for(const [name,expected] of Object.entries(mapsFor(index.links)))if(JSON.stringify(index[name])!==JSON.stringify(expected))throw Error('Changed correspondence lookup map '+name);
  return index;
}
export function queryRscCorrespondences(index,{qid=null,japanese=null,sourceId=null,sourceLine=null,game='both'}={}){
  if(!['ruby','sapphire','both'].includes(game))throw Error('Invalid correspondence game');
  let ids;
  if(sourceId!==null&&sourceLine!==null)ids=index.bySource[sourceKey(sourceId,sourceLine)]||[];
  else if(qid!==null)ids=game==='both'?['ruby','sapphire'].flatMap(g=>index.byQidGame[`${qid}:${g}`]||[]):index.byQidGame[`${qid}:${game}`]||[];
  else if(japanese!==null)ids=index.byJapanese[japanese]||[];
  else throw Error('Provide a qid, exact Japanese, or original source locator');
  const lookup=new Map(index.links.map(r=>[r.id,r])),entries=new Map(index.sourceEntries.map(r=>[r.id,r]));
  return ids.map(id=>lookup.get(id)).filter(r=>game==='both'||r.game===game).map(r=>({...r,source:entries.get(r.sourceEntryId)}));
}
export function loadRscCorrespondenceIndex(root){
  const directory=path.join(root,'outputs/corpus-mapping'),manifest=JSON.parse(read(path.join(directory,'build-manifest.json'))),local='correspondences.json',bytes=fs.readFileSync(path.join(directory,local));
  if(sha256(bytes)!==manifest.outputs.find(f=>f.file===local)?.sha256)throw Error('Changed correspondence index artifact');
  return validateRscCorrespondenceIndex(JSON.parse(bytes.toString('utf8')));
}
