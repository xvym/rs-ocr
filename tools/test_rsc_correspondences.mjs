import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {loadOriginalRscEntries,compileRscCorrespondences,validateRscCorrespondenceIndex,loadRscCorrespondenceIndex,queryRscCorrespondences,validateReverseCorrespondenceReview} from './rsc_correspondence_index.mjs';
import {loadS6Probe} from './s6_corpus_probe.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const index=loadRscCorrespondenceIndex(root),records=parseCsv(read(path.join(root,'outputs/corpus-mapping/records.csv'))),rscRows=parseCsv(read(path.join(root,'outputs/corpus-mapping/rsc-import.csv')));
const selection=JSON.parse(read(path.join(root,'corpus/correspondence-selections.json'))),originals=loadOriginalRscEntries(root,rscRows),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const compile=s=>compileRscCorrespondences({selection:s,records,rscRows,originals,sourceManifestSha256:sha256(fs.readFileSync(path.join(root,'corpus/sources.json')))});
check('All confirmed selections are indexed with separate reviewed and parent-only evidence levels',()=>{
 assert.equal(index.summary.reviewedJapaneseQids,222);assert.equal(index.summary.reviewedGamePairs,441);assert.equal(index.summary.reviewedLinks,501);assert.equal(index.summary.reviewedFragmentLinks,18);
 assert.equal(index.summary.structuralParentLinks,772);assert.equal(index.links.length,1273);assert.equal(index.summary.publicationApprovedLinks,0);
 assert.equal(index.links.filter(r=>r.relation==='pokedex_parent'&&r.game==='ruby').length,386);
 assert.equal(index.links.filter(r=>r.relation==='pokedex_parent'&&r.game==='sapphire').length,386);
 assert.ok(index.links.every(r=>r.publicationApproved===false));
});
check('Every indexed Chinese value and quoted range comes directly from the pinned original text',()=>{
 for(const entry of index.sourceEntries){const raw=originals.entries.get(entry.id);assert.ok(raw);assert.equal(entry.originalChinese,raw.originalChinese);assert.equal(entry.originalChineseSha256,raw.originalChineseSha256);}
 for(const link of index.links){const raw=originals.entries.get(link.sourceEntryId);assert.equal(link.chinese,raw.originalChinese.slice(...link.chineseSpan));}
 assert.ok(!('chinese' in selection.links[0]),'Selections store source locators and hashes, never authored Chinese');
});
check('Japanese, qid and original-source lookups round-trip to identical link identities',()=>{
 const qid='rs.common.strings2.gSystemText_LoadingError.4';
 const byQid=queryRscCorrespondences(index,{qid,game:'ruby'}),byJapanese=queryRscCorrespondences(index,{japanese:'セーブできませんでした',game:'ruby'});
 assert.equal(byQid.length,1);assert.deepEqual(byQid.map(r=>r.id),byJapanese.map(r=>r.id));
 const byOriginal=queryRscCorrespondences(index,{sourceId:'upstream-5',sourceLine:9538,game:'ruby'});
 assert.ok(byOriginal.some(r=>r.id===byQid[0].id));
 assert.equal(queryRscCorrespondences(index,{sourceId:'upstream-5',sourceLine:9538,game:'sapphire'}).length,0);
 assert.equal(queryRscCorrespondences(index,{japanese:'セーブできません',game:'ruby'}).length,0);
});
check('The reviewed A-button display range never brings the unobserved save-completed prefix with it',()=>{
 const matches=queryRscCorrespondences(index,{qid:'rs.common.strings2.gSystemText_LoadingError.1',game:'ruby'});
 assert.equal(matches.length,1);const hit=matches[0];assert.equal(hit.relation,'reviewed_original_span');
 assert.deepEqual(hit.chineseSpan,[15,20]);assert.equal(hit.chinese,hit.source.originalChinese.slice(15,20));assert.notEqual(hit.chinese,hit.source.originalChinese);
});
check('Pokedex second pages point to existing whole Japanese parents and never create NULL Japanese or inferred spans',()=>{
 const hits=queryRscCorrespondences(index,{sourceId:'upstream-5',sourceLine:5051,game:'ruby'});
 assert.equal(hits.length,1);assert.equal(hits[0].qid,'rs.common.pokedex_entries^R.DexDescription_Bulbasaur_1');
 assert.equal(hits[0].relation,'pokedex_parent');assert.equal(hits[0].japaneseSpan,null);assert.equal(hits[0].evidence.pageJapanese,'[NULL]');
 assert.equal(queryRscCorrespondences(index,{sourceId:'upstream-5',sourceLine:5049,game:'ruby'}).length,0);
 assert.equal(queryRscCorrespondences(index,{qid:'rs.common.pokedex_entries^R.DexDescription_Bulbasaur_2',game:'ruby'}).length,0);
});
check('Stale Japanese, changed original Chinese, invalid ranges, cross-game links and approval flags fail closed',()=>{
 const mutate=fn=>{const data=structuredClone(selection);fn(data);assert.throws(()=>compile(data));};
 mutate(s=>{s.links[0].japaneseSha256='0'.repeat(64);});
 mutate(s=>{s.links[0].originalChineseSha256='0'.repeat(64);});
 mutate(s=>{s.links[0].chineseSpan=[0,999999];});
 mutate(s=>{s.links[0].game='sapphire';});
 mutate(s=>{s.publicationApproved=true;});
 mutate(s=>{s.links.push(s.links[0]);});
});
check('Changed index maps or Chinese cannot bypass validation; rejected semantic homonyms stay out',()=>{
 const changed=structuredClone(index);changed.links[0].chinese+='\u0000';assert.throws(()=>validateRscCorrespondenceIndex(changed));
 const maps=structuredClone(index);maps.byJapanese['セーブできませんでした']=[];assert.throws(()=>validateRscCorrespondenceIndex(maps),/lookup map/);
 for(const qid of ['rs.common.easy_chat_group_voices.gEasyChatGroupWords_Voices.46','rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.19'])assert.equal(queryRscCorrespondences(index,{qid}).length,0);
});
check('Established command-line queries expose associations without silently approving new translations',()=>{
 const run=args=>JSON.parse(execFileSync(process.execPath,['tools/query_corpus.mjs',...args],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
 const hit=run(['--qid','rs.common.strings2.gSystemText_LoadingError.4','--game','ruby']);
 assert.equal(hit.status,'indexed_correspondence_pending_publication');assert.equal(hit.translation,null);assert.equal(hit.correspondences.length,1);
 const parent=run(['--source-id','upstream-5','--source-line','5051']);assert.equal(parent.status,'indexed_parent_pending_window_review');assert.equal(parent.translation,null);
 const dummy=run(['--source-id','upstream-5','--source-line','5049']);assert.equal(dummy.status,'source_without_indexed_japanese');assert.ok(dummy.originalSource);assert.equal(dummy.records.length,0);assert.equal(dummy.translation,null);
 const wrongGame=run(['--source-id','upstream-5','--source-line','5051','--game','sapphire']);assert.equal(wrongGame.status,'source_game_mismatch');assert.equal(wrongGame.correspondences.length,0);assert.equal(wrongGame.translation,null);
 const invalid=spawnSync(process.execPath,['tools/query_corpus.mjs','--source-id','upstream-5'],{cwd:root,encoding:'utf8'});assert.notEqual(invalid.status,0);
});
check('The correspondence compiler is reproducible and rebuilds the exact saved index',()=>{
 assert.equal(JSON.stringify(compile(selection)),JSON.stringify(index));
});
check('Reverse review preserves its frozen cohort, deferred decisions and separate review provenance',()=>{
 const review=JSON.parse(read(path.join(root,'corpus/rsc-reverse-reviews.json'))),context={records,originals,sourceManifestSha256:selection.sourceManifestSha256};
 validateReverseCorrespondenceReview(review,context);assert.equal(review.cases.length,115);
 assert.equal(review.cases.filter(c=>c.verdict==='confirmed').length,53);assert.equal(review.cases.filter(c=>c.verdict==='deferred').length,62);
 const links=index.links.filter(l=>l.evidence.reviewLocal==='corpus/rsc-reverse-reviews.json');assert.equal(links.length,53);
 for(const c of review.cases.filter(c=>c.verdict==='deferred'))assert.ok(!links.some(l=>l.sourceEntryId===`${c.sourceId}:${c.sourceLine}`));
 const changed=structuredClone(review);changed.cases.pop();assert.throws(()=>validateReverseCorrespondenceReview(changed,context),/cohort/);
 const authored=structuredClone(review);authored.cases[1].chinese='injected';assert.throws(()=>validateReverseCorrespondenceReview(authored,context),/source review/);
 const nullSource=structuredClone(review);Object.assign(nullSource.cases[0],{verdict:'confirmed',relation:'reviewed_correspondence',chineseSpan:[0,1]});assert.throws(()=>validateReverseCorrespondenceReview(nullSource,context),/confirmed/);
 assert.ok(index.links.filter(l=>l.evidence.reviewLocal!=='corpus/rsc-reverse-reviews.json'&&l.relation!=='pokedex_parent').every(l=>l.evidence.reviewSha256===selection.originReview.sha256));
});
check('Reviewed Japanese fragments isolate units, interjections and mutually exclusive move-learning branches',()=>{
 const hit=line=>queryRscCorrespondences(index,{sourceId:'upstream-5',sourceLine:line,game:'ruby'})[0];
 const weight=hit(8798);assert.equal(weight.japanese.slice(...weight.japaneseSpan),'ｋｇ');assert.equal(weight.chinese,'千克');assert.equal(weight.matchExtent,'reviewed_source_fragment');
 const response=hit(8909);assert.equal(response.japanese.slice(...response.japaneseSpan),'なんにも　はんのう　しない');assert.equal(response.chinese,'一点反应都没有。');assert.ok(!response.chinese.includes('不！'));
 const learned=hit(9702),declined=hit(9703);assert.equal(learned.qid,declined.qid);assert.ok(learned.japaneseSpan[1]<declined.japaneseSpan[0]);
 assert.ok(!learned.japanese.slice(...learned.japaneseSpan).includes('おぼえず'));assert.ok(declined.japanese.slice(...declined.japaneseSpan).includes('おぼえず'));
 const changed=structuredClone(index),fragment=changed.links.find(l=>l.sourceEntryId==='upstream-5:9703');fragment.japaneseSpan=[0,fragment.japanese.length];assert.throws(()=>validateRscCorrespondenceIndex(changed),/Japanese range/);
 const selected=structuredClone(selection),s=selected.links.find(l=>l.sourceId==='upstream-5'&&l.sourceLine===9703);s.japaneseSpan=[0,learned.japanese.length];assert.throws(()=>compile(selected),/fragment/);
});
check('Partial source links stay out of whole-record coverage and cannot publish a translation',()=>{
 const qid='rs.common.strings2.gOtherText_ForgotOrDidNotLearnMove',gaps=parseCsv(read(path.join(root,'outputs/corpus-mapping/correspondence-gaps.csv'))),inventory=parseCsv(read(path.join(root,'outputs/s6-corpus/source-inventory.csv')));
 for(const game of ['ruby','sapphire']){
  assert.ok(gaps.some(g=>g.qid===qid&&g.game===game));const row=inventory.find(r=>r.qid===qid&&r.game===game);
  assert.equal(row.reviewedSourceFragment,'true');assert.equal(row.reviewedCorrespondence,'false');assert.equal(row.staticPublished,'false');
 }
 const result=JSON.parse(execFileSync(process.execPath,['tools/query_corpus.mjs','--source-id','upstream-5','--source-line','9703'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
 assert.equal(result.status,'indexed_fragment_pending_window_review');assert.equal(result.translation,null);
});
check('S6 handoff retains the index without publishing it and loads without upstream files',()=>{
 const loaded=loadS6Probe(root);assert.equal(JSON.stringify(loaded.correspondenceIndex),JSON.stringify(index));
 assert.equal(loaded.probe.lookup('セーブできませんでした').chinese,null);
 const base=path.join(root,'.tools/correspondence-handoff'),directory=path.join(base,'outputs/s6-corpus');fs.mkdirSync(directory,{recursive:true});
 for(const file of [...loaded.manifest.outputs.map(f=>f.file),'build-manifest.json'])fs.copyFileSync(path.join(root,'outputs/s6-corpus',file),path.join(directory,file));
 const standalone=loadS6Probe(base);assert.equal(standalone.correspondenceIndex.links.length,index.links.length);
 assert.equal(queryRscCorrespondences(standalone.correspondenceIndex,{qid:'rs.common.strings2.gSystemText_LoadingError.4'}).length,2);
});
const out=path.join(root,'reports/rsc-correspondence-index');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({passed:true,scope:'Confirmed source indexing, original quotations, structural boundaries and handoff; not Chinese runtime acceptance',checks},null,2)+'\n');
console.log(`${checks.length} correspondence checks passed`);
