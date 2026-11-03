import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseCsv,csv} from './corpus_common.mjs';
import {loadSourceMatcher,project} from './japanese_source_matcher.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]||'outputs/s6-corpus');fs.mkdirSync(out,{recursive:true});
const inputs=[];
const input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
const base=JSON.parse(input('outputs/corpus-mapping/build-manifest.json'));
for(const f of base.outputs)if(sha256(fs.readFileSync(path.join(root,'outputs/corpus-mapping',f.file)))!==f.sha256)throw Error(`Changed base corpus ${f.file}`);
const records=parseCsv(input('outputs/corpus-mapping/records.csv')),candidates=parseCsv(input('outputs/corpus-mapping/candidates.csv'));
const sourceLinks=parseCsv(input('outputs/corpus-mapping/source-links.csv'));
const {nativeRecords,battleTemplates,inputs:sourceInputs}=loadSourceMatcher(root);inputs.push(...sourceInputs);
const byId=new Map([...records,...nativeRecords].map(r=>[r.qid,r]));
const oldRuntime=JSON.parse(input('outputs/corpus-mapping/runtime.json'));
const lexical=JSON.parse(input('corpus/s6/lexicon-reviews.json')).records;
const persons=JSON.parse(input('corpus/s6/person-reviews.json')).records;
const easyChat=JSON.parse(input('corpus/s6/easy-chat-reviews.json')).records;
const homographs=JSON.parse(input('corpus/s6/homograph-reviews.json'));
const tv=JSON.parse(input('corpus/s6/tv-page-reviews.json'));
const originalConflicts=JSON.parse(input('outputs/corpus-mapping/conflicts.json'));
if(homographs.records.length!==originalConflicts.length)throw Error('Incomplete homograph audit');
for(const h of homographs.records){
  const c=originalConflicts.find(c=>c.game===h.game&&c.japanese===h.japanese);
  if(!c||h.method!=='model_reviewed'||sha256(Buffer.from(h.japanese))!==h.japaneseSha256||['qids','translations','candidateIds'].some(k=>JSON.stringify(c[k])!==JSON.stringify(h[k])))throw Error('Stale homograph decision');
}
const towerUnits=JSON.parse(input('corpus/s6/tower-phrase-reviews.json')).records;
const easyNativeLocal='reports/s6-corpus/easy-chat-native-evidence.json',easyNativeBytes=input(easyNativeLocal),easyNative=JSON.parse(easyNativeBytes);
for(const u of towerUnits){
  const rows=easyNative.greetings.filter(g=>g.trainerIndex===u.nativeReference.trainerIndex);
  if(u.nativeReference.local!==easyNativeLocal||u.nativeReference.sha256!==sha256(Buffer.from(easyNativeBytes))||rows.length!==2||new Set(rows.map(r=>r.gameCode)).size!==2||rows.some(r=>!r.printing.passed||r.printing.wordsPerRow!==3)||JSON.stringify(rows[0].words)!==JSON.stringify(rows[1].words))throw Error('Stale native greeting evidence');
  const japanese=[0,3].map(i=>rows[0].words.slice(i,i+3).map(w=>w.japanese).filter(Boolean).join(' ')).join('\n');
  if(u.japanese!==japanese)throw Error('Changed native greeting content');
}
const units=[...JSON.parse(input('corpus/s6/visible-unit-reviews.json')).records,...towerUnits,...homographs.units,...tv.units];
const templates=[...JSON.parse(input('corpus/s6/template-reviews.json')).records,...homographs.templates];
const policy=JSON.parse(input('corpus/s6/name-policy.json'));
const events=JSON.parse(input('corpus/s6/event-translations.json'));
const compositionPolicy=JSON.parse(input('corpus/s6/composition-policy.json'));
const nameEvidence=JSON.parse(input('reports/s6-corpus/japanese-name-evidence.json'));
for(const [e,implementation] of [[nameEvidence,'tools/verify_japanese_names.py'],[easyNative,'tools/verify_easy_chat.py']]){
  if(e.implementationSha256!==sha256(fs.readFileSync(path.join(root,implementation))))throw Error('Stale native verifier evidence; rerun '+implementation);
  for(const f of e.sourceInputs){if(sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error('Stale native source '+f.local);inputs.push(f);}
}
if(nameEvidence.roms.length!==2||nameEvidence.limits.localJapanesePlayer!==5)throw Error('Missing Japanese name evidence');
for(const r of templates)for(const s of Object.values(r.slots))if(s.role==='local_player_or_fixed_pc_owner'&&s.maxCharacters!==nameEvidence.limits.localJapanesePlayer)throw Error('Player name limit mismatch');
function verifyEvidence(e){
  const r=byId.get(e.qid);if(!r||r.japanese!==e.japanese||sha256(Buffer.from(r.japanese))!==e.japaneseSha256)throw Error(`Changed unit source ${e.qid}`);
  if(e.english!==undefined&&((r.english||'')!==e.english||sha256(Buffer.from(r.english||''))!==e.englishSha256))throw Error('Changed English evidence');
}
for(const r of [...lexical,...persons,...easyChat]){
  if(!r.chinese||r.method!=='model_reviewed')throw Error('Unapproved lexical decision');
  if(r.sourceEvidence){r.sourceEvidence.forEach(verifyEvidence);continue;}
  const source=byId.get(r.qid),cs=candidates.filter(c=>c.qid===r.qid&&c.game===r.game);
  if(!source||source.japanese!==r.japanese||source.english!==r.english||sha256(Buffer.from(source.japanese))!==r.japaneseSha256||sha256(Buffer.from(source.english))!==r.englishSha256)throw Error(`Stale lexical source ${r.qid}`);
  if(JSON.stringify([...new Set(cs.map(c=>c.chinese))].sort())!==JSON.stringify([...r.originalCandidates].sort())||JSON.stringify(cs.map(c=>c.id))!==JSON.stringify(r.candidateIds))throw Error(`Stale lexical candidates ${r.qid}`);
}
for(const r of [...units,...templates]){
  if(!r.sourceEvidence?.length||r.method!=='model_reviewed'||!r.reason||typeof r.chinese!=='string')throw Error('Unapproved semantic unit');
  r.sourceEvidence.forEach(verifyEvidence);
  if(r.slots){
    const jp=[...r.japanese.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);
    const cn=[...r.chinese.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]);
    if(!jp.length||jp.some(s=>!r.slots[s])||cn.some(s=>!jp.includes(s))||jp.some(s=>!cn.includes(s)&&!r.slots[s].omitApproved))throw Error(`Invalid semantic template ${r.id}`);
  }
}
for(const r of tv.records)r.sourceEvidence.forEach(verifyEvidence);
for(const r of tv.pendingTemplates){
  r.sourceEvidence.forEach(verifyEvidence);
  if(r.method!=='model_reviewed_text_pending_binding')throw Error('TV pending page cannot be published');
}
const lexicon=[...lexical,...persons,...easyChat];
for(const [japanese,chinese] of Object.entries(compositionPolicy.conditionTerms))for(const game of ['ruby','sapphire']){
  const native=nativeRecords.find(r=>r.japanese===japanese);if(!native)throw Error('Missing native condition term');
  lexicon.push({qid:native.qid,game,kind:'condition',japanese,chinese,method:'model_reviewed_condition_label',sourceEvidence:[{qid:native.qid,japanese,japaneseSha256:sha256(Buffer.from(japanese))}]});
}
// PokeBlock colors are complete typed labels, not translated arbitrary substrings.
const blockTranslations={'あかい':'红色','あおい':'蓝色','ももいろ':'粉色','みどりの':'绿色','きいろ':'黄色','むらさき':'紫色','こんいろ':'藏青色','ちゃいろ':'茶色','そらいろ':'天蓝色','きみどり':'黄绿色','はいいろ':'灰色','くろい':'黑色','しろい':'白色','きんいろ':'金色'};
for(const r of records.filter(r=>r.qid.startsWith('rs.common.strings.ContestStatsText_')&&r.japanese.endsWith('ポロック'))){
  const prefix=r.japanese.slice(0,-4);if(!blockTranslations[prefix])continue;
  for(const game of ['ruby','sapphire'])lexicon.push({qid:r.qid,game,kind:'block',japanese:r.japanese,chinese:blockTranslations[prefix]+'方块',method:'model_reviewed_color_label',sourceEvidence:[{qid:r.qid,japanese:r.japanese,japaneseSha256:sha256(Buffer.from(r.japanese))}]});
}
const superseded=new Set(units.map(u=>project(u.japanese,{display:true}).key));
const staticUnits=oldRuntime.records.filter(r=>!superseded.has(project(r.japanese,{display:true}).key)).map(r=>({...r,method:r.reviewMethod,scope:'reviewed_complete_static_record'}));
const frozen=JSON.parse(input('reports/s3-acceptance/freeze-manifest.json'));
const fontLocal='src/main/resources/ocr/fonts.json',fontBytes=fs.readFileSync(path.join(root,fontLocal));if(sha256(fontBytes)!==frozen.files[fontLocal])throw Error('Changed native glyphs');
inputs.push({local:fontLocal,sha256:sha256(fontBytes)});
const fonts=JSON.parse(fontBytes),allowedNameCharacters=[...new Set(fonts.glyphs.filter(g=>g.font===3&&g.text.length===1&&!/[ \u3000\r\n�]/.test(g.text)).map(g=>g.text))].sort().join('');
const reviewedQids=new Set([...lexicon,...staticUnits,...units.flatMap(u=>u.sourceEvidence.map(e=>({...e,game:u.game||'both'}))),...templates.flatMap(u=>u.sourceEvidence.map(e=>({...e,game:u.game||'both'})))].flatMap(r=>['ruby','sapphire'].filter(game=>!r.game||r.game==='both'||r.game===game).map(game=>r.qid+'\0'+game)));
const candidateKeys=new Set(candidates.map(c=>c.qid+'\0'+c.game));
const inventory=records.flatMap(r=>['ruby','sapphire'].filter(game=>r.game==='both'||r.game===game).map(game=>({qid:r.qid,game,japanese:r.japanese,
  status:!r.japanese||r.japanese==='[NULL]'?'no_japanese_record':/^[？ー]+$/.test(r.japanese)?'unused_placeholder':reviewedQids.has(r.qid+'\0'+game)?'has_reviewed_unit_or_term_not_whole_record_approval':candidateKeys.has(r.qid+'\0'+game)?'unreviewed_chinese_candidate':'missing_chinese_correspondence'})));
const summary={schemaVersion:1,stage:'S6',lexicalRecords:lexicon.length,visibleUnits:units.length,completeStaticRecords:staticUnits.length,templates:templates.length,
  homographDecisions:Object.fromEntries([...new Set(homographs.records.map(r=>r.status))].map(s=>[s,homographs.records.filter(r=>r.status===s).length])),
  tvTextReviews:tv.records.length,tvPublishedLiteralPages:tv.units.length,tvPendingVariablePages:tv.pendingTemplates.length,tvNonPublishedPlaceholders:tv.nonPublishedPlaceholders.length,
  sourceRecords:records.length,perGameInventory:inventory.length,inventoryStatuses:Object.fromEntries([...new Set(inventory.map(r=>r.status))].map(s=>[s,inventory.filter(r=>r.status===s).length])),
  boundary:'Reviewable corpus and offline availability probe; not S7 desktop/live integration or S8 whole-game acceptance. Inventory is explicit about unreviewed whole records.'};
const pack={schemaVersion:2,id:'rs-s6-reviewed-corpus-v2',lexicon,units:[...units,...staticUnits].map(r=>({...r,game:r.game||'both'})),templates,namePolicy:policy,events,compositionPolicy,nameEvidence,allowedNameCharacters,
  sourceRecords:[...records,...nativeRecords],sourceTemplates:battleTemplates,summary};
const save=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
save('runtime.json',pack);save('summary.json',summary);
save('provenance.json',{schemaVersion:1,sourceManifest:JSON.parse(input('corpus/sources.json')),records,candidates,sourceLinks,originalConflicts,homographDecisions:homographs.records,
  boundary:'Original Japanese/English correspondence, US revision 1.2 address bridge and Chinese meaning review are separate. A source/address/candidate hit is never translation approval. Native tables contain extracted text and evidence hashes, not ROM bytes.'});
fs.writeFileSync(path.join(out,'source-inventory.csv'),csv(inventory,['qid','game','japanese','status']));
const implementations=['tools/build_s6_corpus.mjs','tools/s6_corpus_probe.mjs','tools/japanese_source_matcher.mjs','tools/battle_source_matcher.mjs','tools/japanese_source_layout.mjs','tools/corpus_common.mjs','tools/verify_japanese_names.py','tools/verify_easy_chat.py'];
save('build-manifest.json',{schemaVersion:1,inputs,implementation:implementations.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),outputs:['runtime.json','summary.json','source-inventory.csv','provenance.json'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary));
