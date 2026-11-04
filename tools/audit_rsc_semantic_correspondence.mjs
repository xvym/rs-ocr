import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,read,parseCsv,parseRsc,parseDictionary,sourceBytes,hex,csv} from './corpus_common.mjs';
import {reconstruct} from './corpus_source.mjs';
import {verifyManifest} from './rsc_translation_policy.mjs';
import {normalized,stripControls,decodeSource,createRanker} from './rsc_semantic_retrieval.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'reports/rsc-semantic-audit');
fs.mkdirSync(out,{recursive:true});verifyManifest(root,'outputs/corpus-mapping');
const inputs=[],input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
const repository=JSON.parse(input('.tools/rsc-semantic/manifest.json'));
if(repository.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17')throw Error('Wrong pinned RSC tree');
const files=repository.files.map(f=>({...f,text:input(f.local)}));
for(const f of files)if(inputs.find(i=>i.local===f.local).sha256!==f.sha256)throw Error('Changed RSC file '+f.path);
const sourceManifest=JSON.parse(input('corpus/sources.json'));
const records=parseCsv(input('outputs/corpus-mapping/records.csv')),candidates=parseCsv(input('outputs/corpus-mapping/candidates.csv'));
const gaps=parseCsv(input('outputs/corpus-mapping/gaps.csv')).filter(g=>g.reason!=='japanese_absent');
const imports=parseCsv(input('outputs/corpus-mapping/rsc-import.csv'));
const importedAddresses=new Map(imports.map(r=>[r.game+':'+Number(r.recordedAddress),Number(r.address)]));
const recordMap=new Map(records.map(r=>[r.qid,r])),missingIds=new Set(gaps.map(g=>g.qid));
const archive=sourceManifest.sources.find(s=>s.path==='source archive'),sourceRoot=path.join(root,'.tools/corpus-source',`pokeruby-${archive.commit}`);
const tree=JSON.parse(input('.tools/corpus-source/tree.json'));
if(tree.archiveSha256!==archive.sha256)throw Error('Source archive mismatch');
for(const f of tree.files)if(sha256(fs.readFileSync(path.join(sourceRoot,f.path)))!==f.sha256)throw Error('Changed source '+f.path);
const engines=new Map(['ruby','sapphire'].map(game=>{const sym=sourceManifest.sources.find(s=>path.basename(s.local)===`poke${game}_rev2.sym`);input(sym.local);return [game,reconstruct(sourceRoot,path.join(root,sym.local),game)];}));
for(const e of engines.values())if(e.errors.length)throw Error('Source reconstruction errors');
const documents=[],witnessToDoc=new Map(),dedup=new Map(),parseErrors=[];
const primaryIds=new Map(sourceManifest.sources.map(s=>[s.path,s.id]));
for(const file of files){
  if(!file.path.endsWith('.txt'))continue;
  // English-to-Japanese dictionaries are not evidence for Chinese availability.
  if(/英-日/.test(file.path))continue;
  const game=file.path.includes('红宝石')?'ruby':file.path.includes('蓝宝石')?'sapphire':null;
  const primary=/汉化总文本\(JP\)\.txt$/.test(file.path)&&!file.path.includes('繁中');
  let rows=[];
  try{
    if(/地址=/.test(file.text))rows=parseRsc(file.text).map(r=>{
      const address=importedAddresses.get(game+':'+r.address)??r.address;
      return {index:r.index,chinese:r.chinese,english:game?decodeSource(sourceBytes(engines.get(game).memory,address),engines.get(game)):null,address:hex(address),kind:'rsc_address'};
    });
    else rows=parseDictionary(file.text).map(r=>({...r,index:r.line,kind:'dictionary'}));
  }catch(error){parseErrors.push({path:file.path,error:error.message});continue;}
  for(const r of rows){
    const key=[game,r.english||'',r.chinese].join('\0'),witness={path:file.path,blobSha1:file.sha,fileSha256:file.sha256,index:r.index,address:r.address||null,sourceId:primaryIds.get(file.path)||null,primary};
    let d=dedup.get(key);
    if(!d){d={id:`rsc-doc-${String(documents.length+1).padStart(6,'0')}`,game,english:r.english||'',chinese:r.chinese,kind:r.kind,witnesses:[],japaneseSources:[]};dedup.set(key,d);documents.push(d);}
    d.witnesses.push(witness);
    if(witness.sourceId)witnessToDoc.set(witness.sourceId+':'+r.index,d);
  }
}
for(const c of candidates){const d=witnessToDoc.get(c.sourceId+':'+c.sourceLine);if(!d||d.chinese!==c.chinese)continue;const r=recordMap.get(c.qid);d.japaneseSources.push({qid:r.qid,japanese:r.japanese,english:r.english,game:c.game});}
const englishIndex=new Map(),japaneseIndex=new Map(),docIndex=new Map(documents.map(d=>[d.id,d]));
const add=(map,key,d)=>{if(!key)return;const list=map.get(key)||new Set();list.add(d.id);map.set(key,list);};
for(const d of documents){add(englishIndex,normalized(d.english),d);for(const r of d.japaneseSources)add(japaneseIndex,normalized(r.japanese),d);}
const rank=createRanker(documents),results=[];
const summaryOnly=d=>({id:d.id,game:d.game,english:d.english,chinese:d.chinese,witnesses:d.witnesses,japaneseSources:d.japaneseSources.slice(0,8)});
for(const r of records.filter(r=>missingIds.has(r.qid))){
  const gameResults=[];
  for(const gap of gaps.filter(g=>g.qid===r.qid)){
    const compatible=d=>!d.game||d.game===gap.game;
    const exactEnglish=[...(englishIndex.get(normalized(r.english))||[])].map(id=>docIndex.get(id)).filter(compatible);
    const exactJapanese=[...(japaneseIndex.get(normalized(r.japanese))||[])].map(id=>docIndex.get(id)).filter(compatible);
    const bilingual=exactJapanese.filter(d=>d.japaneseSources.some(s=>normalized(s.japanese)===normalized(r.japanese)&&normalized(s.english)===normalized(r.english)&&s.english));
    const group=r.qid.split('.')[2],plain=stripControls(r.japanese).replace(/[\s\u3000]/g,'');
    let classification=bilingual.length?'bilingual_duplicate_found':exactEnglish.length?'english_whole_candidate_found':exactJapanese.length?'japanese_whole_candidate_found':'not_found_by_whole_retrieval';
    if(/[\u2800-\u28ff]/.test(r.japanese))classification='braille_requires_decoding';
    else if(!/[\p{L}\p{N}]/u.test(plain)||/^[？?ー\-]+$/.test(plain))classification='control_symbol_or_placeholder';
    else if(/debug_menu|sound_check_menu/.test(group))classification='debug_or_sound_test';
    const hitIds=new Set([...bilingual,...exactEnglish,...exactJapanese].map(d=>d.id));
    const ranked=rank(r.english,{game:gap.game,limit:5}).filter(hit=>!hitIds.has(hit.document.id));
    const found=[...hitIds].map(id=>summaryOnly(docIndex.get(id)));
    gameResults.push({game:gap.game,originalGap:gap.reason,classification,bilingualIds:bilingual.map(d=>d.id),exactEnglishIds:exactEnglish.map(d=>d.id),exactJapaneseIds:exactJapanese.map(d=>d.id),
      candidates:found,ranked:ranked.map(hit=>({score:Number(hit.score.toFixed(4)),...summaryOnly(hit.document)})),semanticConfirmed:false,
      upstreamEasyChatOmission:group.startsWith('easy_chat_group_')});
  }
  results.push({qid:r.qid,japanese:r.japanese,english:r.english,group:r.qid.startsWith('rs.script.')?'script':r.qid.split('.')[2],games:gameResults});
}
const count=rows=>Object.fromEntries([...new Set(rows.map(r=>r.classification))].sort().map(k=>[k,rows.filter(r=>r.classification===k).length]));
const referencedDocuments=new Map();
for(const r of results)for(const g of r.games){
  g.candidates=g.candidates.map(d=>{referencedDocuments.set(d.id,d);return d.id;});
  g.ranked=g.ranked.map(({score,...d})=>{referencedDocuments.set(d.id,d);return {id:d.id,score};});
}
const allGames=results.flatMap(r=>r.games),summary={schemaVersion:1,sourceCommit:repository.commit,repositoryTextFiles:files.length,indexedProjectTextEntries:documents.length,parseErrors,
  missingUniqueQids:results.length,missingGamePairs:allGames.length,perGamePairRetrieval:count(allGames),uniqueQidsByRetrieval:count(results.map(r=>({classification:r.games[0].classification}))),
  actualUpstreamMissingConfirmed:null,method:'Whole Japanese/English duplicate retrieval plus English full-text ranking, followed by separately recorded model semantic review; no embedding model, translation generation or automatic publication.',
  limitation:'Ranked candidates and duplicate wording are retrieval evidence, not semantic equivalence. Absence from retrieval never proves absence from the project. Easy Chat omission is a project-level documented limitation; reusable words elsewhere are checked separately.'};
const write=(file,data)=>fs.writeFileSync(path.join(out,file),JSON.stringify(data,null,2)+'\n');
write('retrieval.json',{summary,records:results});write('retrieval-summary.json',summary);write('source-manifest.json',repository);
write('retrieval-documents.json',[...referencedDocuments.values()]);
fs.writeFileSync(path.join(out,'worklist.csv'),csv(results.flatMap(r=>r.games.map(g=>({qid:r.qid,game:g.game,japanese:r.japanese,english:r.english,classification:g.classification,wholeCandidateCount:g.candidates.length,rankedCandidateCount:g.ranked.length}))),['qid','game','japanese','english','classification','wholeCandidateCount','rankedCandidateCount']));
fs.writeFileSync(path.join(root,'.tools/rsc-semantic/index.json'),JSON.stringify(documents));
write('run-manifest.json',{inputs,implementation:['tools/audit_rsc_semantic_correspondence.mjs','tools/rsc_semantic_retrieval.mjs','tools/corpus_common.mjs','tools/corpus_source.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),outputs:['retrieval.json','retrieval-documents.json','retrieval-summary.json','source-manifest.json','worklist.csv'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));
