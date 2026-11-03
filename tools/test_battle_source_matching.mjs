import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadSourceMatcher,project} from './japanese_source_matcher.mjs';
import {BattleSourceMatcher,battleMeaningConsensus} from './battle_source_matcher.mjs';
import {read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log(`PASS ${name}`);};
const {matcher,battleTemplates,records,nativeRecords}=loadSourceMatcher(root);
const lookup=raw=>matcher.lookup(raw,{kind:'battle'});
const meaning=raw=>{const r=lookup(raw);assert.equal(r.semanticResolution.status,'consistent',raw);return r.semanticResolution.meaning;};
const noBattleMeaning=raw=>{const r=lookup(raw);assert.equal(r.candidates.some(c=>c.mode==='battle_composed'),false,raw);assert.notEqual(r.semanticResolution.status,'consistent',raw);};

check('All 28 ordinary forms retain the seven actual stat names and four exact changes',()=>{
 const stats=[['こうげきりょく','attack'],['ぼうぎょりょく','defense'],['すばやさ','speed'],['とくこう','special_attack'],['とくぼう','special_defense'],['めいちゅうりつ','accuracy'],['かいひりつ','evasion']];
 const changes=[['あがった！',1],['ぐーんと あがった！',2],['さがった！',-1],['がくっと さがった！',-2]];
 for(const [text,stat] of stats)for(const [change,delta] of changes)for(const actor of ['ピカチュウ','ポチ','あいての ポチ','やせいの ポチ']){
   const m=meaning(`${actor}の\n${text}が ${change}`);assert.equal(m.event,'stat_change');assert.equal(m.stat,stat);assert.equal(m.delta,delta);assert.equal(m.actors.subject.raw,actor);
 }
});
check('Ordinary changes reject unknown stats, HP, wrong direction modifiers and missing punctuation',()=>{
 for(const raw of ['ピカチュウの\nたいりょくが あがった！','ピカチュウの\nつよさが あがった！','ピカチュウの\nとくこうが ぐーんと さがった！','ピカチュウの\nとくこうが がくっと あがった！','ピカチュウの\nとくこうが あがった'])noBattleMeaning(raw);
});
check('Source-mandated line boundaries stop names swallowing a different battle clause',()=>{
 noBattleMeaning('アの あめふらしで\nイの こうげきりょくが さがった！');
 noBattleMeaning('ピカチュウの とくこうが あがった！');
 noBattleMeaning('ア\nイの とくこうが あがった！');
});
check('Full-input anchors reject appended independent text and incomplete prefixes',()=>{
 for(const raw of ['ピカチュウの\nとくこうが あがった！バッグ','ピカチュウの\nとくこうが','カイオーガは\nめいそ','しかし あいての グラ'])noBattleMeaning(raw);
});
check('Nicknames need not be species names, and actor display never infers species or identity',()=>{
 const m=meaning('あいての ポチの\nすばやさが さがった！');assert.equal(m.actors.subject.nameRaw,'ポチ');assert.equal(m.actors.subject.prefixRaw,'あいての ');
 assert.equal(m.actors.subject.identityInferred,false);assert.equal(m.actors.subject.speciesInferred,false);
 const self=meaning('あいてのの\nすばやさが さがった！');assert.equal(self.actors.subject.raw,'あいての');
 noBattleMeaning('アイウエオカキクケコサの\nすばやさが さがった！');
 assert.equal(lookup('ピカ�ュウの\nすばやさが さがった！').status,'blocked');
});
check('Same observed stat meaning preserves attacking and defending source records',()=>{
 const r=lookup('カイオーガの\nとくこうが あがった！');assert.equal(r.sourceQids.length,2);assert.equal(r.status,'ambiguous');
 assert.equal(r.semanticResolution.status,'consistent');assert.equal(r.resolvedJapanese,null);assert.equal(r.translationPublishable,false);assert.equal(r.translation,null);
});
check('All 354 move forms agree with the independently executed Japanese selector evidence',()=>{
 const e=JSON.parse(read(path.join(root,'reports/battle-source-matching/japanese-evidence.json'))),byId=new Map(records.map(r=>[r.qid,r]));
 for(let id=1;id<=354;id++){
   const found=e.groups.findIndex(group=>group.includes(id)),group=found<0?4:found;
   const move=byId.get(`rs.common.move_names.gMoveNames.${id}`).japanese,suffix=byId.get('rs.common.battle_strings.'+e.suffixSourcesByGroup[group]).japanese;
   const raw='ポチ'+e.particleTextsByGroup[group]+'\n'+move+suffix;
   const r=lookup(raw),candidate=r.candidates.find(c=>c.mode==='battle_composed'&&c.meaning.event==='move_use'&&c.meaning.moveId===id);
   assert.ok(candidate,raw);assert.equal(candidate.meaning.actors.subject.raw,'ポチ');
   const wrongParticle=e.particleTextsByGroup[group]==='は'?'の':'は';noBattleMeaning('ポチ'+wrongParticle+'\n'+move+suffix);
 }
});
check('Move grammar rejects legal move names paired with another move category’s suffix',()=>{
 for(const raw of ['カイオーガは\nめいそう！','ラグラージの\nマッドショットを した！','カイオーガの\nめいそうを した！','ポチの\nしらないわざ！'])noBattleMeaning(raw);
 assert.equal(meaning('カイオーガは\nめいそうを した！').moveId,347);
 assert.equal(meaning('やせいの ケムッソの\nいとをはく こうげき！').moveId,81);
});
check('A legitimate extra source such as Wish keeps observed meaning unresolved rather than forcing the move template',()=>{
 const r=lookup('ポチは\nねがいごとを した！');
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_OpponentUsedMove'));
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_WishMade'));
 assert.equal(r.semanticResolution.status,'incomplete');assert.equal(r.semanticResolution.meaning,null);assert.equal(r.translation,null);
});
check('An item-use slot cannot accept an arbitrary known move name',()=>{
 const move=lookup('ポチは\nつるぎのまいを つかった！');assert.equal(move.semanticResolution.status,'consistent');
 assert.equal(move.semanticResolution.meaning.event,'move_use');assert.ok(!move.sourceQids.includes('rs.common.battle_strings.BattleText_Used1'));
 const item=meaning('ハルカは\nすごいキズぐすりを つかった！');assert.equal(item.event,'item_use');assert.equal(item.itemId,21);
});
check('Capabilities and actual source context constrain related stat messages',()=>{
 const cap=meaning('ピカチュウの\nとくこうは もうあがらない！');assert.equal(cap.event,'stat_limit');assert.equal(cap.limit,'upper');assert.equal(cap.stat,'special_attack');
 assert.equal(meaning('ピカチュウの\nすばやさは もうさがらない！').limit,'lower');
 assert.equal(meaning('ピカチュウの のうりょくは\nもうあがらない！').event,'stat_limit');
 noBattleMeaning('ピカチュウの\nつよさは もうあがらない！');
});
check('Related ability names are finite and remain consistent with their call-site family',()=>{
 assert.equal(meaning('テッカニンは かそくで\nすばやさが あがった！').abilityId,3);
 const intimidate=meaning('あいての グラエナの いかくで\nカイオーガの こうげきりょくが さがった！');
 assert.equal(intimidate.abilityId,22);assert.equal(intimidate.actors.cause.raw,'あいての グラエナ');assert.equal(intimidate.actors.subject.raw,'カイオーガ');
 noBattleMeaning('テッカニンは あめふらしで\nすばやさが あがった！');
 noBattleMeaning('あいての グラエナの あめふらしで\nカイオーガの こうげきりょくが さがった！');
});
check('Copy/reset messages preserve two, repeated or zero actors without inventing game state',()=>{
 const copy=meaning('ピカチュウは ライチュウの\nほじょこうかを コピーした！');assert.equal(copy.event,'stat_changes_copied');
 assert.equal(copy.actors.subject.raw,'ピカチュウ');assert.equal(copy.actors.copied_from.raw,'ライチュウ');
 assert.equal(meaning('ポチは ポチの\nほじょこうかを コピーした！').actors.copied_from.raw,'ポチ');
 const reset=meaning('すべての ステータスが\nもとに もどった！');assert.equal(reset.event,'stat_changes_reset');assert.deepEqual(reset.actors,{});
});
check('Meaning conflicts and unknown candidate meanings never choose the first result',()=>{
 const c=(qid,delta)=>({qid,meaning:{event:'stat_change',stat:'speed',delta,actors:{subject:{raw:'ポチ'}}}});
 assert.equal(battleMeaningConsensus([c('a',1),c('b',1)]).status,'consistent');
 assert.equal(battleMeaningConsensus([c('a',1),c('b',-1)]).status,'conflict');
 assert.equal(battleMeaningConsensus([c('a',1),{qid:'untyped'}]).status,'incomplete');
 assert.equal(battleMeaningConsensus([c('a',1)],{searchComplete:false}).status,'incomplete');
});
check('Japanese width projection and proven glyph alternatives preserve the original actor value',()=>{
 const raw='へラクロスの\nすばやさが さがった！',r=matcher.lookup(raw,{kind:'battle',alternatives:[{index:0,raw:'へ',candidates:['へ','ヘ'],font:3,distance:0}]});
 assert.equal(r.rawOcr,raw);assert.equal(r.semanticResolution.status,'consistent');assert.equal(r.semanticResolution.meaning.actors.subject.raw,'へラクロス');
 const m=meaning('ポチの\n10まんボルト！');assert.equal(m.moveId,85);
});
check('The 32 original battle gaps have separately bound source and observed-meaning judgments',()=>{
 const reviewed=JSON.parse(read(path.join(root,'reports/japanese-source-matching/battle-review.json')));
 assert.equal(reviewed.length,32);assert.ok(reviewed.every(c=>c.passed));assert.equal(reviewed.filter(c=>c.event==='stat_change').length,8);assert.equal(reviewed.filter(c=>c.event==='move_use').length,24);
 const summary=JSON.parse(read(path.join(root,'reports/japanese-source-matching/summary.json')));
 assert.equal(summary.original769Comparison.currentAllPartsHaveCandidates,766);assert.equal(summary.original769Comparison.remainingWithoutCompleteCandidateEvidence,3);
 assert.equal(summary.battleMatching.reviewedFixedCases.blind,false);assert.equal(summary.fullSetSourceAccuracy,null);
});
check('Only Japanese evidence, source records and rules enter template generation',()=>{
 const builder=read(path.join(root,'tools/build_battle_source_templates.mjs'));
 assert.ok(!/review-reference|review-cases|ground_truth|ocr-inputs|GBA-\d|NGC-\d/.test(builder));
 const forged=structuredClone(battleTemplates);forged.sources[0].japanese+='誤';
 assert.throws(()=>new BattleSourceMatcher(forged,{records:[...records,...nativeRecords],project}),/Stale battle source/);
});
check('Offline rebuilding is byte-for-byte identical and generated templates never contain ROM bytes',()=>{
 const out='.tools/battle-template-rebuild',run=spawnSync(process.execPath,['tools/build_battle_source_templates.mjs',out],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 for(const file of ['templates.json','templates.csv','build-manifest.json'])assert.equal(sha256(fs.readFileSync(path.join(root,out,file))),sha256(fs.readFileSync(path.join(root,'outputs/battle-source-matching',file))));
 assert.equal(battleTemplates.summary.releaseChinese,false);assert.equal(battleTemplates.variants.length,396);
});
const report={passed:true,total:checks.length,checks,scope:'bounded battle matching, separately authored fixed-case judgments, negative cases and deterministic generation; not Chinese/live acceptance'};
fs.writeFileSync(path.join(root,'reports/battle-source-matching/checks.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${checks.length} battle-source checks passed`);
