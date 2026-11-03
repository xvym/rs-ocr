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
check('Native experience composition binds the recipient and current amount in both wording forms',()=>{
 for(const amount of [0,15,1956,99999])for(const boosted of [false,true]){
   const raw=`ポチは${boosted?' おおめに':''}\n${amount} けいけんちを もらった！`,r=lookup(raw),m=r.semanticResolution.meaning;
   assert.equal(r.semanticResolution.status,'consistent');assert.equal(m.event,'experience_gain');
   assert.equal(m.experienceAmount,amount);assert.equal(m.boostedWording,boosted);assert.equal(m.actors.subject.raw,'ポチ');
   assert.deepEqual(r.sourceQids,['rs.common.battle_strings.BattleText_GainExpPoints']);assert.equal(r.translation,null);
   assert.equal(m.actors.subject.identityInferred,false);assert.equal(m.actors.subject.speciesInferred,false);
   assert.equal(r.candidates[0].generation.japaneseBufferBlockVerified,true);
 }
});
check('Experience numbers preserve observed width and reject fabricated, padded or incomplete values',()=>{
 const r=lookup('ポチは\n１５ けいけんちを もらった！');assert.equal(r.semanticResolution.status,'consistent');
 assert.equal(r.semanticResolution.meaning.experienceAmount,15);
 assert.equal(r.candidates[0].bindings.find(b=>b.slot==='B_BUFF2').raw,'１５');
 for(const amount of ['-15','+15','15.0','1 5','1\n5','00015','100000','１５００００','�','15円','']){
   assert.ok(!lookup(`ポチは\n${amount} けいけんちを もらった！`).candidates.some(c=>c.modelId?.startsWith('experience:')),amount);
 }
 for(const raw of ['ポチは 15 けいけんちを もらった！','ポチは\n15 けいけんちを もらっ','前の文章\nポチは\n15 けいけんちを もらった！'])
   assert.ok(!lookup(raw).candidates.some(c=>c.modelId?.startsWith('experience:')));
});
check('Experience source and displayed-value judgments cover all nine archived cases',()=>{
 const review=JSON.parse(read(path.join(root,'reports/japanese-source-matching/experience-review.json')));
 assert.equal(review.summary.total,9);assert.equal(review.summary.passed,9);assert.equal(review.summary.nativeBufferCases,64);
 assert.ok(review.cases.every(c=>c.passed));
 const evidence=JSON.parse(read(path.join(root,'reports/battle-source-matching/experience-evidence.json')));
 assert.equal(evidence.roms.length,2);for(const rom of evidence.roms){
   assert.equal(rom.checks.length,32);assert.ok(rom.checks.every(c=>c.passed));
   assert.deepEqual(rom.sources.map(s=>s.stringId),[13,329,330]);
 }
});
check('Experience lookup cannot reuse an earlier recipient or amount',()=>{
 const first=meaning('ポチは\n15 けいけんちを もらった！'),next=meaning('タマは おおめに\n20 けいけんちを もらった！');
 assert.equal(first.experienceAmount,15);assert.equal(next.experienceAmount,20);
 assert.equal(next.actors.subject.raw,'タマ');assert.equal(next.boostedWording,true);
});
check('Eight send-out windows retain the separately reviewed current actors and source sets',()=>{
 const review=JSON.parse(read(path.join(root,'reports/japanese-source-matching/send-out-review.json')));
 assert.equal(review.summary.total,8);assert.equal(review.summary.passed,8);assert.ok(review.cases.every(c=>c.passed));
 assert.equal(review.summary.scriptIdentityAmbiguousCases,2);assert.equal(review.summary.sourceWindowAmbiguousCases,2);
 for(const c of review.cases){const r=lookup(c.japanese);assert.equal(r.semanticResolution.status,'consistent');
   assert.equal(r.semanticResolution.meaning.event,c.event);assert.equal(r.semanticResolution.meaning.actors.trainer.raw,c.trainer);
   assert.equal(r.semanticResolution.meaning.actors.subject.raw,c.subject);assert.equal(r.translationPublishable,false);
 }
});
check('Single and double source identities remain while the current send-out meaning agrees',()=>{
 const raw='してんのうの カゲツは\nグラエナを くりだした！',r=lookup(raw);
 assert.equal(r.sourceQids.length,7);assert.equal(r.status,'ambiguous');assert.equal(r.bindingAmbiguous,true);
 assert.equal(r.semanticResolution.status,'consistent');
 const double=r.candidates.filter(c=>c.qid.endsWith('.BattleText_SentOutDouble3'));
 assert.deepEqual(double.map(c=>c.lineStart),[0,1]);assert.ok(double.every(c=>c.lineCount===1&&c.sourceWindow.lineCount===1));
 assert.equal(raw.split('\n').length,2); // source row and observed reflow differ
 assert.ok(r.candidates.every(c=>!c.generation.scriptIdentityInferred&&!c.generation.futureUnitIncluded));
 for(const a of Object.values(r.semanticResolution.meaning.actors)){assert.equal(a.identityInferred,false);assert.equal(a.speciesInferred,false);}
 assert.equal(r.resolvedJapanese,null);
 double[0].sourceWindow.page=99;
 assert.ok(lookup(raw).candidates.every(c=>c.sourceWindow.page===0));
});
check('Send-out intent cannot expose the later clear-window question or imply completion',()=>{
 const r=lookup('してんのうの フヨウは\nジュペッタを くりだそうと している');
 assert.equal(r.semanticResolution.meaning.event,'send_out_intent');assert.equal(r.semanticResolution.meaning.actors.trainer.raw,'してんのうの フヨウ');
 assert.ok(r.candidates.every(c=>c.page===0&&c.sourceWindow.page===0));
 const question=lookup('ハルカも ポケモンを\nいれかえますか？');
 assert.ok(question.candidates.some(c=>c.qid.endsWith('.BattleText_WillSwitch')&&c.page===1&&c.mode==='template_hypothesis'));
 assert.equal(question.semanticResolution.status,'not_applicable');assert.equal(question.translation,null);
});
check('Only reviewed windows are replaced; a full double clause remains an unreviewed source form',()=>{
 const raw='ポチは タマを くりだした！\nミケは クロを くりだした！',r=lookup(raw);
 assert.ok(r.candidates.some(c=>c.qid.endsWith('.BattleText_SentOutDouble3')&&c.mode==='template_hypothesis'&&c.lineCount===2));
 assert.equal(r.semanticResolution.status,'not_applicable');assert.equal(r.translationPublishable,false);
 const one=meaning('タマを くりだした！');assert.equal(one.event,'send_out');assert.equal(one.actors.subject.raw,'タマ');
 assert.equal(one.actors.trainer,undefined); // no unseen trainer name is invented
});
check('Window actors preserve complete display labels and reject swallowed clauses or unknown glyphs',()=>{
 const trainer='ア'.repeat(20),r=lookup(`${trainer}は\nポチを くりだした！`);
 assert.equal(r.semanticResolution.status,'consistent');assert.equal(r.semanticResolution.meaning.actors.trainer.raw,trainer);
 for(const raw of ['前の文章\nポチは\nタマを くりだした！','ポチは\nタマを くりだした！\n別の文章','ポチは\n�を くりだした！','ポチは\nタマを くりだそうと してい'])
   assert.ok(!lookup(raw).candidates.some(c=>c.generation?.sourceWindowReviewed),raw);
 const next=meaning('ミケは\nクロを くりだした！');assert.equal(next.actors.trainer.raw,'ミケ');assert.equal(next.actors.subject.raw,'クロ');
});
check('Nine observation cases preserve every separately reviewed current source and value',()=>{
 const review=JSON.parse(read(path.join(root,'reports/japanese-source-matching/observation-review.json')));
 assert.equal(review.cases.length,9);assert.ok(review.cases.every(c=>c.passed));
 for(const c of review.cases){const r=matcher.lookup(c.japanese);assert.equal(r.semanticResolution.status,'consistent');assert.deepEqual([...r.sourceQids].sort(),[...c.sources].sort());assert.equal(r.semanticResolution.meaning.actors.subject.raw,c.subject);}
});
check('Typed observations reject prose in copied names and malformed amounts',()=>{
 for(const raw of ['あ！ やせいの\n前の文\nケムッソが とびだしてきた！','ハルカは しょうきんとして\n４９O０円 てにいれた！','カイオーガの たいりょくが\n1 7 かいふくした','カイオーガの たいりょくが\n1000 かいふくした'])
   assert.ok(!matcher.lookup(raw).candidates.some(c=>c.generation?.sourceWindowReviewed),raw);
 const r=matcher.lookup('ハルカは しょうきんとして\n５１００円 てにいれた！');
 assert.equal(r.semanticResolution.meaning.moneyAmount,5100);assert.equal(r.candidates[0].bindings.find(b=>b.semanticType==='displayed_decimal_number').raw,'５１００');
});
check('Item use keeps compatible first pages and cannot infer a later repel or flute effect',()=>{
 const r=matcher.lookup('ハルカは\nスーパーボールを つかった！');
 assert.equal(r.sourceQids.length,4);assert.equal(r.semanticResolution.meaning.event,'item_use');
 assert.ok(r.candidates.every(c=>!c.sourceWindow||c.sourceWindow.page===0));
 const ui=matcher.lookup('カイオーガの たいりょくが\n17 かいふくした',{kind:'ui'});assert.equal(ui.semanticResolution.status,'consistent');
 assert.notEqual(lookup('カイオーガの たいりょくが\n17 かいふくした').semanticResolution.status,'consistent');
 const field=matcher.lookup('ポチ は\nいあいぎりを つかった！',{kind:'dialogue'});assert.equal(field.semanticResolution.meaning.moveId,15);
 assert.ok(!matcher.lookup('ポチ は\nねむるを つかった！',{kind:'dialogue'}).candidates.some(c=>c.generation?.sourceWindowReviewed));
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
 assert.equal(battleTemplates.summary.releaseChinese,false);assert.equal(battleTemplates.variants.length,435);
 assert.equal(battleTemplates.summary.sendOutWindowModels,15);assert.equal(battleTemplates.summary.sendOutSourceRecords,8);
 assert.equal(battleTemplates.summary.observationWindowModels,22);assert.equal(battleTemplates.summary.observationSourceRecords,11);
});
const report={passed:true,total:checks.length,checks,scope:'bounded battle matching, separately authored fixed-case judgments, negative cases and deterministic generation; not Chinese/live acceptance'};
fs.writeFileSync(path.join(root,'reports/battle-source-matching/checks.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${checks.length} battle-source checks passed`);
