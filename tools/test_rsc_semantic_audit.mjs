import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseRsc,parseDictionary} from './corpus_common.mjs';
import {verifyManifest} from './rsc_translation_policy.mjs';
import {normalized} from './rsc_semantic_retrieval.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(root,'reports/rsc-semantic-audit');
const json=file=>JSON.parse(read(path.join(directory,file))),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const retrieval=json('retrieval.json'),review=json('semantic-review.json'),summary=json('summary.json');
check('All 1772 missing qids and 3539 applicable game gaps are accounted for once',()=>{
 assert.equal(retrieval.records.length,1772);assert.equal(new Set(retrieval.records.map(r=>r.qid)).size,1772);
 assert.equal(retrieval.records.flatMap(r=>r.games).length,3539);
 assert.equal(Object.values(summary.semanticReview.counts).reduce((a,b)=>a+b,0),1772);
});
check('Pinned repository text inventory is complete and every downloaded byte matches its manifest',()=>{
 const source=json('source-manifest.json');assert.equal(source.commit,'f513cf437acca23d1a5882650ee3b148dc463a17');assert.equal(source.files.length,35);
 for(const f of source.files)assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.path);
 assert.deepEqual(summary.parseErrors,[]);
});
check('Every quoted Chinese character is an unchanged range of a real original source entry',()=>{
 const files=new Map();
 for(const f of json('source-manifest.json').files){
  if(!f.path.endsWith('.txt')||/英-日/.test(f.path))continue;
  const text=read(path.join(root,f.local));
  files.set(f.path,/地址=/.test(text)?new Map(parseRsc(text).map(r=>[r.index,r.chinese])):new Map(parseDictionary(text).map(r=>[r.line,r.chinese])));
 }
 let references=0;
 for(const r of review.reviews)for(const game of r.sourceReferences)for(const c of game.candidates){
  assert.ok(!c.game||c.game===game.game,'Cross-game reference');
  assert.ok(c.witnesses.length);
  for(const w of c.witnesses){
   const raw=files.get(w.path)?.get(w.index);assert.equal(typeof raw,'string',w.path+':'+w.index);
   assert.equal(sha256(Buffer.from(raw)),c.originalChineseSha256);
   assert.equal(raw.slice(...c.chineseSpan),c.chinese);references++;
  }
 }
 assert.ok(references>300);
});
check('All confirmed findings have their own applicable per-game source witnesses',()=>{
 for(const r of review.reviews.filter(r=>['original_correspondence_found','original_source_span_found'].includes(r.verdict))){
  const original=retrieval.records.find(s=>s.qid===r.qid);
  assert.equal(r.sourceTextSha256,sha256(Buffer.from(original.japanese+'\0'+original.english)));
  assert.deepEqual(r.sourceReferences.map(g=>g.game),original.games.map(g=>g.game));
  for(const g of r.sourceReferences)assert.ok(g.candidates.length,r.qid+':'+g.game);
 }
});
check('Semantic homonyms and English localization mismatches cannot count as confirmed matches',()=>{
 const ids=[
 'rs.common.easy_chat_group_voices.gEasyChatGroupWords_Voices.46',
 'rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.19',
 'rs.common.easy_chat_group_people.gEasyChatGroupWords_People.4',
 'rs.common.easy_chat_group_people.gEasyChatGroupWords_People.28',
 'rs.common.strings.gDefaultBoyName1^S','rs.common.strings2.gOtherText_Terminator2'];
 for(const qid of ids)assert.equal(review.reviews.find(r=>r.qid===qid).verdict,'not_confirmed',qid);
});
check('Braille stays meaningful pending text rather than being discarded as punctuation',()=>{
 const rows=retrieval.records.filter(r=>/[\u2800-\u28ff]/.test(r.japanese));assert.equal(rows.length,22);
 for(const r of rows)assert.ok(r.games.every(g=>g.classification==='braille_requires_decoding'));
});
check('Original semantic queries retrieve saving messages without relying on address or original English',()=>{
 for(const index of [4,5]){
  const qid=`rs.common.strings2.gSystemText_LoadingError.${index}`,row=review.reviews.find(r=>r.qid===qid);
  assert.equal(row.english,'');assert.equal(row.classification,'model_semantic_query');assert.equal(row.verdict,'original_correspondence_found');
 }
 const button=review.reviews.find(r=>r.qid==='rs.common.strings2.gSystemText_LoadingError.1');assert.equal(button.verdict,'original_source_span_found');
});
check('Search normalization preserves negation and numeric differences; it never licenses a match alone',()=>{
 assert.notEqual(normalized('did learn'),normalized('did not learn'));
 assert.notEqual(normalized('$50'),normalized('$500'));
 assert.equal(normalized('FRESH WATER[CLEAR_TO 72]$200'),normalized('FRESH WATER ¥200'));
 assert.equal(summary.actualUpstreamMissingConfirmed,null);
});
check('Both retrieval and semantic-review manifests reproduce their current inputs and outputs',()=>{
 for(const file of ['run-manifest.json','semantic-review-manifest.json']){
  const manifest=json(file);for(const f of manifest.inputs)assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.local);
  for(const f of Array.isArray(manifest.implementation)?manifest.implementation:[manifest.implementation])assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.local);
  for(const f of manifest.outputs)assert.equal(sha256(fs.readFileSync(path.join(directory,f.file))),f.sha256,f.file);
 }
});
check('Runtime and base RSC-only packages remain unchanged and verifiable',()=>{
 verifyManifest(root,'outputs/corpus-mapping');verifyManifest(root,'outputs/s6-corpus');
 assert.equal(summary.semanticReview.runtimePackageChanged,false);
});
fs.writeFileSync(path.join(directory,'checks.json'),JSON.stringify({passed:true,scope:'Source quotations, review integrity and separation from runtime; not independent semantic acceptance',checks},null,2)+'\n');
console.log(`${checks.length} audit checks passed`);
