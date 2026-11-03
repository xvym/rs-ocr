import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {JapaneseSourceMatcher,loadSourceMatcher,project,parseSource,resolveRegion,regionUnits} from './japanese_source_matcher.mjs';
import {read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log(`PASS ${name}`);};
const record=(qid,japanese,game='both')=>({qid,japanese,game,english:'source evidence'});
const mock=rows=>new JapaneseSourceMatcher(rows);
check('Source matching covers pinned Japanese independently of reviewed Chinese availability',()=>{
 const {matcher,records}=loadSourceMatcher(root);assert.equal(records.length,13479);
 const r=matcher.lookup('ここでは ポケモンの\nたいりょく かいふくを します');
 assert.ok(r.sourceQids.includes('rs.script.pkmn_center_nurse.gText_NurseJoy_Welcome'));
 assert.equal(r.translation,null);assert.equal(r.translationPublishable,false);
});
check('Whitespace projection preserves digit boundaries, width, case, punctuation and original offsets',()=>{
 assert.equal(project('あ　い\nう').key,'あいう');assert.equal(project('1 0').key,'1 0');
 assert.notEqual(project('1 0').key,project('10').key);assert.notEqual(project('１').key,project('1').key);
 assert.notEqual(project('O').key,project('0').key);assert.notEqual(project('！').key,project('!').key);
 assert.deepEqual(project('あ い').offsets,[0,2]);
});
check('Literal escaped brackets and backslashes are not dynamic slots',()=>{
 const p=parseSource('甲\\[PLAYER]\\\\乙');assert.deepEqual(p.slots,[]);assert.equal(p.pages[0][0],'甲[PLAYER]\\乙');
});
check('Clear-window boundaries never create adjacent-line matches',()=>{
 const m=mock([record('rs.script.a','最初の文章\\c最後の文章')]);
 assert.equal(m.lookup('最初の文章\n最後の文章').candidates.length,0);
 assert.ok(m.lookup('最後の文章').candidates.length);
});
check('Scrolling can retrieve both neighboring windows while preserving source offsets',()=>{
 const m=mock([record('rs.script.a','最初の文章\\n途中の文章\\r最後の文章')]);
 const a=m.lookup('最初の文章\n途中の文章'),b=m.lookup('途中の文章\n最後の文章');
 assert.equal(a.candidates[0].lineStart,0);assert.equal(b.candidates[0].lineStart,1);assert.equal(b.candidates[0].lineCount,2);
});
check('Partial-word prefixes are diagnostic hints and never resolve complete sources',()=>{
 const m=mock([record('rs.script.a','あしたのてんきははれです！')]),r=m.lookup('あしたのてんき');
 assert.equal(r.status,'fragment_only');assert.equal(r.resolvedJapanese,null);assert.equal(r.candidates.length,0);
 assert.equal(r.hints[0].notResolved,true);
});
check('Unknown glyphs block lookup instead of using source text to fill characters',()=>{
 const m=mock([record('rs.script.a','こんにちは！')]);assert.equal(m.lookup('こん�ちは！').status,'blocked');
});
check('Arbitrary OCR substitutions are rejected and do not invoke fuzzy correction',()=>{
 const m=mock([record('rs.script.a','こんにちは！')]);assert.equal(m.lookup('こんいちは！').candidates.length,0);
 assert.throws(()=>m.lookup('へラクロス',{alternatives:[{index:0,raw:'へ',candidates:['へ','ヘ'],font:2,distance:0}]}));
 assert.throws(()=>m.lookup('へラクロス',{alternatives:[{index:0,raw:'へ',candidates:['へ','ヘ'],font:3,distance:1}]}));
 assert.throws(()=>m.lookup('へラクロス',{alternatives:[{index:0,raw:'へ',candidates:['へ','ホ'],font:3,distance:0}]}));
});
check('Actual zero-distance font-3 alternatives find Heracross without rewriting raw OCR',()=>{
 const m=mock([record('rs.common.species_names.x','ヘラクロス')]);
 assert.equal(m.lookup('へラクロス').candidates.length,0);
 const r=m.lookup('へラクロス',{alternatives:[{index:0,raw:'へ',candidates:['へ','ヘ'],font:3,distance:0}]});
 assert.equal(r.rawOcr,'へラクロス');assert.equal(r.candidates[0].matchedJapanese,'ヘラクロス');
});
check('All competing source records remain even when one matches exactly',()=>{
 const m=mock([record('rs.script.a','こんにちは！'),record('rs.script.b','こんにちは！\\cつぎの文章です')]);
 assert.equal(m.lookup('こんにちは！').sourceQids.length,2);assert.equal(m.lookup('こんにちは！').resolvedJapanese,null);
});
check('Game filters retain both candidates when the actual game is unknown',()=>{
 const m=mock([record('rs.script.r','同じ文章です！','ruby'),record('rs.script.s','同じ文章です！','sapphire')]);
 assert.equal(m.lookup('同じ文章です！').sourceQids.length,2);assert.deepEqual(m.lookup('同じ文章です！',{game:'ruby'}).sourceQids,['rs.script.r']);
});
check('Explicit typed context distinguishes Ghost species and type without guessing from text',()=>{
 const {matcher}=loadSourceMatcher(root);
 assert.equal(matcher.lookup('ゴースト').status,'ambiguous');
 assert.deepEqual(matcher.lookup('ゴースト',{kind:'type'}).sourceQids,['rs.common.type_names.gTypeNames.7']);
 assert.deepEqual(matcher.lookup('ゴースト',{kind:'species'}).sourceQids,['rs.common.species_names.gSpeciesNames.93']);
});
check('Opaque buffers preserve actual captured values and never claim semantic approval',()=>{
 const m=mock([record('rs.script.a','[STR_VAR_1]を　ひきだしました！')]),r=m.lookup('ピカチュウを ひきだしました！');
 assert.equal(r.status,'template_candidate');assert.equal(r.candidates[0].bindings[0].raw,'ピカチュウ');
 assert.equal(r.candidates[0].bindings[0].semanticType,'unreviewed_callsite_buffer');assert.equal(r.candidates[0].bindings[0].approvedForTranslation,false);
 assert.equal(r.resolvedJapanese,null);
});
check('Repeated slots must contain the same current value',()=>{
 const m=mock([record('rs.script.a','[STR_VAR_1]と[STR_VAR_1]を　くらべます！')]);
 assert.ok(m.lookup('ピカチュウとピカチュウを くらべます！').candidates.length);
 assert.equal(m.lookup('ピカチュウとライチュウを くらべます！').candidates.length,0);
});
check('Internal name spaces remain significant for repeated-slot identity',()=>{
 const m=mock([record('rs.script.a','[PLAYER]と[PLAYER]を　くらべます！')]);
 assert.equal(m.lookup('あ いとあいを くらべます！').candidates.length,0);
});
check('Ambiguous variable boundaries retain every viable capture interpretation',()=>{
 const m=mock([record('rs.script.a','[STR_VAR_1]と[STR_VAR_2]を　くらべます！')]),r=m.lookup('ああといいとううを くらべます！');
 const interpretations=r.candidates.filter(c=>c.mode==='template_hypothesis');assert.equal(interpretations.length,2);
 assert.notEqual(interpretations[0].bindings[0].raw,interpretations[1].bindings[0].raw);
});
check('Current numeric values are captured afresh and never reused between calls',()=>{
 const m=mock([record('rs.script.a','のこり　[STR_VAR_1]えん　あります！')]);
 for(const value of ['017','18'])assert.equal(m.lookup(`のこり ${value}えん あります！`).candidates[0].bindings[0].raw,value);
});
check('Bare slots, adjacent opaque buffers and unsupported functions cannot consume arbitrary input',()=>{
 const m=mock([record('rs.script.a','[STR_VAR_1]'),record('rs.script.b','[PLAYER][RIVAL]の　パソコンを　つけました！'),record('rs.script.c','[UNREVIEWED]の　パソコンを　つけました！')]);
 assert.equal(m.lookup('ハルカの パソコンを つけました！').candidates.length,0);assert.equal(m.unsupported.length,1);
});
check('Trainer class/name source templates remain candidates alongside generic link templates',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('してんのうの カゲツは\nグラエナを くりだした！');
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_SentOutSingle1'));
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_SentOutSingle2'));
 assert.equal(r.status,'ambiguous');assert.equal(r.resolvedJapanese,null);
});
check('A player or explicit battle name cannot absorb an observed prose line',()=>{
 const {matcher}=loadSourceMatcher(root),raw='おとうさんの ことば‥‥\nハルカ！ こういうものには';
 const r=matcher.lookup(raw),cs=r.candidates.filter(c=>c.qid.endsWith('.gOtherText_DadsAdvice'));
 assert.ok(cs.length);assert.ok(cs.every(c=>c.bindings.find(b=>b.slot==='PLAYER')?.raw==='ハルカ'));
 for(const slot of ['PLAYER','RIVAL','B_TRAINER1_NAME','B_ATK_NAME_WITH_PREFIX']){
   const m=mock([record('rs.script.name',`[${slot}]の パソコンを つけました！`)]);
   assert.equal(m.lookup('前の文章\nハルカの パソコンを つけました！').candidates.length,0);
   const valid=m.lookup('あ いの パソコンを つけました！');assert.ok(valid.candidates.length);
   assert.equal(valid.candidates[0].bindings[0].raw,'あ い');assert.equal(valid.translationPublishable,false);
 }
});
check('Trainer classes use full source terms and do not split at an internal の',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('してんのうの カゲツが\nしょうぶを しかけてきた！');
 const cs=r.candidates.filter(c=>c.bindings.some(b=>b.slot==='B_TRAINER1_CLASS'));
 assert.ok(cs.length);for(const c of cs){
   const b=c.bindings.find(b=>b.slot==='B_TRAINER1_CLASS');assert.equal(b.raw,'してんのう');
   assert.equal(c.bindings.find(b=>b.slot==='B_TRAINER1_NAME').raw,'カゲツ');
   assert.ok(b.termSourceQids.length);assert.equal(b.approvedForTranslation,false);
 }
 // A compatible link-name interpretation remains unresolved, rather than
 // choosing a trainer script using the newly corrected lexical boundary.
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_SingleWantToBattle2'));
 assert.equal(r.status,'ambiguous');assert.equal(r.semanticResolution.status,'not_applicable');
});
check('Finite class evidence respects target game and missing terms fail closed',()=>{
 const rows=[record('rs.common.trainer_class_names.test','してんのう','ruby'),
   record('rs.common.battle_strings.test','[B_TRAINER1_CLASS]の [B_TRAINER1_NAME]が しょうぶです！')];
 const m=mock(rows),raw='してんのうの カゲツが しょうぶです！';
 assert.ok(m.lookup(raw,{game:'ruby'}).candidates.length);assert.ok(m.lookup(raw,{game:'both'}).candidates.length);
 assert.equal(m.lookup(raw,{game:'sapphire'}).candidates.length,0);
 assert.equal(mock(rows.slice(1)).lookup(raw).candidates.length,0);
});
check('Unreviewed multiline buffers and genuine multiple splits remain hypotheses',()=>{
 const m=mock([record('rs.script.a','[STR_VAR_1]を もらいました！')]);
 const r=m.lookup('前の文章\nアイテムを もらいました！');assert.ok(r.candidates.length);
 assert.equal(r.candidates[0].bindings[0].raw,'前の文章\nアイテム');
 assert.equal(r.candidates[0].bindings[0].retrievalConstraint,undefined);
 assert.equal(r.translationPublishable,false);
});
check('Experience messages no longer match the reviewed gift-item or starter-species buffers',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('カイオーガは\n1800 けいけんちを もらった！');
 assert.deepEqual(r.sourceQids,['rs.common.battle_strings.BattleText_GainExpPoints']);assert.equal(r.bindingAmbiguous,false);
 assert.equal(r.rawOcr,'カイオーガは\n1800 けいけんちを もらった！');assert.equal(r.translationPublishable,false);
 assert.equal(r.semanticResolution.meaning.experienceAmount,1800);
});
check('Source-scoped gift constraints retain actual item/species values and their provenance',()=>{
 const {matcher}=loadSourceMatcher(root);
 for(const [value,qid,kind] of [['すごいキズぐすり','rs.script.BattleTower_Lobby.BattleTower_Lobby_Text_19A506','item'],
   ['すごいキズぐすり','rs.script.barboach.UnknownString_81C432C','item'],
   ['キモリ','rs.script.LittlerootTown_ProfessorBirchsLab.LittlerootTown_ProfessorBirchsLab_Text_173D94','species']]){
   const r=matcher.lookup(`ハルカは\n${value}を もらった！`),cs=r.candidates.filter(c=>c.qid===qid);
   assert.ok(cs.length,qid);for(const c of cs){
     const b=c.bindings.find(b=>b.termKind===kind);assert.equal(b.raw,value);assert.ok(b.termSourceQids.length);
     assert.equal(b.constraintSourceQid,qid);assert.equal(b.approvedForTranslation,false);
   }
 }
});
check('A buffer type is never inferred globally from its number or suffix wording',()=>{
 const m=mock([record('rs.script.other','[PLAYER]は\\n[STR_VAR_1]を　もらった！')]);
 const r=m.lookup('ハルカは\n15 けいけんちを もらった！');assert.ok(r.candidates.length);
 assert.ok(r.candidates.every(c=>c.bindings.every(b=>b.termKind===undefined)));
 assert.equal(r.translationPublishable,false);
});
check('Typed Intimidate grammar resolves the ability/name boundary without choosing a generic buffer split',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('あいての グラエナの いかくで\nカイオーガの こうげきりょくが さがった！');
 assert.equal(r.bindingAmbiguous,false);assert.equal(r.translationPublishable,false);assert.equal(r.semanticResolution.status,'consistent');
 assert.equal(r.semanticResolution.meaning.abilityId,22);assert.equal(r.semanticResolution.meaning.actors.cause.nameRaw,'グラエナ');
});
check('Rendering functions are explicit retrieval hypotheses, never wildcard variables',()=>{
 const m=mock([record('rs.script.a','[COLOR RED]こんにちは！[PAUSE 15]'),record('rs.script.b','[CLEAR_TO 80]こんにちは！')]);
 const r=m.lookup('こんにちは！');assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].requiresPrintingReview,true);
 assert.deepEqual(r.candidates[0].controlsElided,['COLOR RED','PAUSE 15']);assert.equal(m.unsupported.length,1);
});
check('Observed overlapping windows narrow source identities within the same session only',()=>{
 const m=mock([record('rs.script.a','最初の文章\\n共通の文章\\r最後の文章'),record('rs.script.b','別の文章です\\n共通の文章\\r最後の文章')]);
 const previous=m.lookup('最初の文章\n共通の文章',{session:'A',contextKey:'dialogue-1',sequence:1}),raw='共通の文章\n最後の文章';
 assert.equal(m.lookup(raw).sourceQids.length,2);
 const same=m.lookup(raw,{session:'A',contextKey:'dialogue-1',sequence:2,previous});assert.equal(same.sourceQids.length,1);assert.equal(same.continuityApplied,true);
 assert.equal(m.lookup(raw,{session:'B',contextKey:'dialogue-1',sequence:2,previous}).sourceQids.length,2);
 assert.equal(m.lookup(raw,{session:'A',contextKey:'dialogue-2',sequence:2,previous}).sourceQids.length,2);
 assert.equal(m.lookup(raw,{session:'A',contextKey:'dialogue-1',sequence:3,previous}).sourceQids.length,2);
});
check('Forged previous candidate IDs cannot invent observed continuity',()=>{
 const m=mock([record('rs.script.a','最初の文章\\n共通の文章\\r最後の文章'),record('rs.script.b','別の文章です\\n共通の文章\\r最後の文章')]);
 const previous={rawOcr:'存在しない文章\n共通の文章',session:'A',contextKey:'dialogue-1',sequence:1,game:'both',kind:null,candidates:[{qid:'rs.script.a',page:0,lineStart:0}]};
 assert.equal(m.lookup('共通の文章\n最後の文章',{session:'A',contextKey:'dialogue-1',sequence:2,previous}).sourceQids.length,2);
});
check('Menu segmentation follows detected layout, while dialogue remains an intact window',()=>{
 assert.equal(regionUnits('たたかう バッグ\nポケモン にげる',['battle_action']).length,4);
 assert.equal(regionUnits('文章の 前半\n文章の 後半',['field_dialog']).length,1);
 assert.equal(regionUnits('甲 乙\n丙 丁',['battle_moves','field_dialog']).length,1);
});
check('Inventory quantity, display number and selection marker are preserved as separate visible fields',()=>{
 const [u]=regionUnits('No03みずのはどう × 01',['bag_list']);assert.equal(u.searchText,'みずのはどう');
 assert.ok(u.visibleFields.some(f=>f.value==='01'));assert.ok(u.visibleFields.some(f=>f.value==='03'));
 const [s]=regionUnits('マッハじてんしゃ SEL',['bag_list']);assert.equal(s.searchText,'マッハじてんしゃ');assert.equal(s.visibleFields[0].value,'SEL');
});
check('Price parsing is confined to shop rows and does not discard digits from ordinary text',()=>{
 assert.equal(regionUnits('ハイパーボール 1200円',['shop_list'])[0].searchText,'ハイパーボール');
 assert.equal(regionUnits('１０まんボルト',['battle_moves'])[0].searchText,'１０まんボルト');
 assert.equal(regionUnits('のこり 1200円',['field_dialog'])[0].searchText,'のこり 1200円');
});
check('Removed inventory fields cannot introduce character alternatives into the item name',()=>{
 const m=mock([record('rs.common.items.x','ハイパーボール')]);
 const r=resolveRegion(m,'ハイパーボール × 20',{typeCandidates:['bag_list'],alternatives:[{index:13,raw:'0',candidates:['0','O'],font:3,distance:0}]});
 assert.equal(r.units[0].result.sourceQids.length,1);
});
check('Inventory and shop interface actions are not excluded by the item-name filter',()=>{
 const {matcher}=loadSourceMatcher(root);
 for(const [text,type,qid] of [['バッグをとじる','bag_list','rs.common.strings.gOtherText_CloseBag'],['やめる','shop_list','rs.common.strings.gPCText_Cancel']]){
   const r=resolveRegion(matcher,text,{typeCandidates:[type]});assert.ok(r.units[0].result.sourceQids.includes(qid));assert.equal(r.units[0].kind,null);
 }
});
check('Battle menu options retain their combined source record and explicit grid coordinates',()=>{
 const {matcher}=loadSourceMatcher(root),qid='rs.common.battle_strings.BattleText_MenuOptions';
 const r=resolveRegion(matcher,'たたかう バッグ\nポケモン にげる',{typeCandidates:['battle_action']});
 assert.equal(r.allUnitsHaveSourceCandidates,true);assert.equal(r.units.length,4);
 for(const [i,u] of r.units.entries()){
   assert.deepEqual(u.result.sourceQids,[qid]);assert.equal(u.result.candidates[0].mode,'menu_option');
   assert.equal(u.result.candidates[0].sourceUnit.row,Math.floor(i/2));assert.equal(u.result.candidates[0].sourceUnit.column,i%2);
   assert.equal(u.result.resolvedJapanese,u.raw);assert.equal(u.result.menuParentContextApplied,true);
 }
 assert.equal(r.layoutEvidence[0].sourceQids[0],qid);
});
check('Run retains normal and Safari menu candidates without complete-menu context, and prose is not indexed as cells',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('にげる');
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_MenuOptions'));
 assert.ok(r.sourceQids.includes('rs.common.battle_strings.BattleText_MenuOptionsSafari'));assert.equal(r.status,'ambiguous');
 const m=mock([record('rs.script.prose','たたかう　　バッグ\\nポケモン　　にげる')]);
 assert.equal(m.lookup('にげる').candidates.length,0);
});
check('Short anchored PC-name and send-out templates are retrieved without admitting bare buffers',()=>{
 const {matcher}=loadSourceMatcher(root);
 const pc=matcher.lookup('ハルカのパソコン');assert.ok(pc.sourceQids.includes('rs.common.strings.gPCText_PlayersPC'));assert.equal(pc.candidates[0].bindings[0].raw,'ハルカ');
 const sent=matcher.lookup('ゆけっ！ ラグラージ！');assert.ok(sent.sourceQids.includes('rs.common.battle_strings.BattleText_SentOutSingle6'));assert.ok(sent.sourceQids.includes('rs.common.battle_strings.BattleText_SentOutSingle7'));
 assert.equal(mock([record('rs.script.empty','[STR_VAR_1]')]).lookup('任意の文字列です').candidates.length,0);
});
check('Digit notation projection finds the actual source while keeping leading zeroes and raw OCR',()=>{
 const {matcher}=loadSourceMatcher(root),raw='それぞれの ちからを つかさどる\n3びきの ポケモンが';
 const r=matcher.lookup(raw);assert.ok(r.sourceQids.includes('rs.script.PacifidlogTown_House1.PacifidlogTown_House1_Text_178F9F'));assert.equal(r.rawOcr,raw);assert.ok(r.candidates.some(c=>c.displayProjectionUsed));
 const m=mock([record('rs.script.machine','マシン０１です！')]);assert.ok(m.lookup('マシン01です！').candidates.length);assert.equal(m.lookup('マシン1です！').candidates.length,0);
 assert.equal(m.lookup('マシン0 1です！').candidates.length,0);assert.equal(project('ＰＰ',{display:true}).key,'PP');assert.equal(project('Ａ',{display:true}).key,'Ａ');
});
check('Adjacent player-name and finite honorific slots retain separate complete captures',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('オダマキ『おお ハルカちゃん！');
 const c=r.candidates.find(c=>c.qid==='rs.script.pokedex_rating.gBirchDexRatingText_ComeToShowMePokedex');assert.ok(c);
 assert.deepEqual(c.bindings.map(b=>[b.slot,b.raw]),[['PLAYER','ハルカ'],['KUN','ちゃん']]);
 const invalid=matcher.lookup('オダマキ『おお ハルカたち！');assert.ok(!invalid.sourceQids.includes(c.qid));
 assert.ok(c.bindings.every(b=>b.approvedForTranslation===false));
});
check('Native summary titles are separately identified from hash-verified original assets',()=>{
 const {matcher,nativeRecords,inputs}=loadSourceMatcher(root);assert.equal(nativeRecords.length,27);
 const r=matcher.lookup('パーソナル');assert.ok(r.sourceQids.includes('native.label.personal'));
 assert.equal(r.candidates.find(c=>c.qid==='native.label.personal').nativeEvidence.local,'src/main/resources/ocr/labels.json');
 assert.ok(inputs.some(f=>f.local==='src/main/resources/ocr/fonts.json'));assert.equal(r.translationPublishable,false);
});
check('Ability panels separate the original title, complete name and multiline description',()=>{
 const {matcher}=loadSourceMatcher(root),raw='とくせい\nもうか\nピンチに ほのおが つよくなる';
 const r=resolveRegion(matcher,raw,{typeCandidates:['summary_ability']});assert.equal(r.units.length,3);
 assert.ok(r.units[0].result.sourceQids.includes('native.label.ability'));
 assert.ok(r.units[1].result.sourceQids.some(q=>q.startsWith('rs.common.ability_names.')));
 assert.ok(r.units[2].result.sourceQids.includes('rs.common.ability_descriptions.gAbilityDescription_Blaze'));
 assert.equal(r.allUnitsHaveSourceCandidates,true);assert.equal(r.rawOcr,raw);
});
check('Move-panel PP values stay current and do not become part of move-name lookup',()=>{
 const {matcher}=loadSourceMatcher(root),raw='おぼえているわざ\nじめん マッドショット PP09/10\nもどる';
 const r=resolveRegion(matcher,raw,{typeCandidates:['summary_battle_moves']});const move=r.units.find(u=>u.kind==='move');
 assert.equal(move.searchText,'マッドショット');assert.ok(move.result.sourceQids.includes('rs.common.move_names.gMoveNames.341'));
 assert.equal(move.visibleFields[0].raw,' PP09/10');assert.equal(r.allUnitsHaveSourceCandidates,true);
 const broken=resolveRegion(matcher,'おぼえているわざ\nじめん マッドショット PP?/10',{typeCandidates:['summary_battle_moves']});
 assert.equal(broken.units[1].raw,'じめん マッドショット PP?/10');assert.equal(broken.units[1].visibleFields.length,0);
});
check('Summary stat, owner and experience fields preserve every current value',()=>{
 const stats=regionUnits('のうりょく\nHP 084/100 とくこう 062',['summary_stats']);
 assert.equal(stats.find(u=>u.searchText==='HP').visibleFields[0].raw,'084/100');assert.equal(stats.find(u=>u.searchText==='とくこう').visibleFields[0].raw,'062');
 const owner=regionUnits('パーソナル\nおや/ジーク IDNo00517\nタイプ/ほのお かくとう',['summary_personal']);
 assert.equal(owner.find(u=>u.searchText==='おや/').visibleFields[1].raw,'00517');assert.equal(owner.filter(u=>u.kind==='type').length,2);
 const exp=regionUnits('けいけんち\nレベルアップまで あと 02367',['summary_experience']);
 assert.equal(exp.find(u=>u.searchText==='あと').visibleFields[0].raw,'02367');
});
check('Ambiguous PC layout is split only with the full ordered source-backed menu sequence',()=>{
 const {matcher}=loadSourceMatcher(root),raw='ポケモンを つれていく\nポケモンを あずける\nボックスを せいりする\nさようなら';
 const types=['pc_pokemon_menu','save_summary'],r=resolveRegion(matcher,raw,{typeCandidates:types});
 assert.equal(r.units.length,4);assert.equal(r.layoutEvidence.length,1);assert.deepEqual(r.typeCandidates,types);assert.equal(r.allUnitsHaveSourceCandidates,true);
 const mixed=resolveRegion(matcher,raw.replace('さようなら','しゅじんこう ハルカ'),{typeCandidates:types});assert.equal(mixed.units.length,1);assert.equal(mixed.layoutEvidence.length,0);
});
check('Ribbon count overwrite is confined to its source and never turns every literal number into a slot',()=>{
 const {matcher}=loadSourceMatcher(root),r=matcher.lookup('げんざい 17こ');
 const c=r.candidates.find(c=>c.sourceForm==='ribbon_count_overwrite_hypothesis');assert.ok(c);assert.equal(c.bindings[0].raw,'17');
 assert.equal(c.sourceJapanese,'げんざい　００こ');assert.equal(c.mode,'template_hypothesis');
 const m=mock([record('rs.script.other','げんざい　００こ')]);assert.equal(m.lookup('げんざい 17こ').candidates.length,0);
 assert.ok(!matcher.lookup('げんざい あこ').candidates.some(c=>c.sourceForm==='ribbon_count_overwrite_hypothesis'));
});
check('Block level, identity and blender composition retain visible values without inventing names',()=>{
 const {matcher}=loadSourceMatcher(root);
 const block=resolveRegion(matcher,'あかいポロック Lv11',{typeCandidates:['block_list']});assert.equal(block.units[0].searchText,'あかいポロック');assert.equal(block.units[0].visibleFields[0].value,'11');
 const identity=resolveRegion(matcher,'ラグラージ ♂/Lv46',{typeCandidates:['condition_identity']});assert.equal(identity.units[0].searchText,'ラグラージ');assert.equal(identity.units[0].visibleFields[1].raw,'46');
 const blend=resolveRegion(matcher,'あかいポロック ができた！\nレベル11で なめらかさは21だ',{typeCandidates:['blender_message']});
 assert.equal(blend.allUnitsHaveSourceCandidates,true);assert.deepEqual(blend.units.flatMap(u=>u.visibleFields).map(f=>f.raw),['11','21']);
});
check('All decomposed fixed-set text has raw spans and no visible characters disappear',()=>{
 const compact=JSON.parse(read(path.join(root,'reports/japanese-source-matching/ocr-inputs.json')));
 for(const r of compact.inputs){
   const units=regionUnits(r.japanese,r.typeCandidates),covered=new Set();
   for(const u of units){assert.equal(u.raw,r.japanese.slice(u.start,u.end));for(let i=u.start;i<u.end;i++)covered.add(i);}
   for(let i=0;i<r.japanese.length;i++)if(!/[ \u3000\r\n]/.test(r.japanese[i]))assert.ok(covered.has(i),`${r.id}:${i}`);
 }
});
check('Matcher does not read answer files, review cases or screenshot identifiers',()=>{
 const text=read(path.join(root,'tools/japanese_source_matcher.mjs'));
 assert.ok(!/source-matching\/reference|acceptance\/reference|ground_truth|ocr-inputs|GBA-\d|NGC-\d/.test(text));
});
check('All actual OCR inputs and source-review judgments retain their bound evidence hashes',()=>{
 const manifest=JSON.parse(read(path.join(root,'reports/japanese-source-matching/run-manifest.json')));
 for(const f of [...manifest.inputs,...manifest.implementation])assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.local);
 for(const f of manifest.outputs)assert.equal(sha256(fs.readFileSync(path.join(root,'reports/japanese-source-matching',f.file))),f.sha256,f.file);
 const summary=JSON.parse(read(path.join(root,'reports/japanese-source-matching/summary.json')));
 assert.equal(summary.targetRegions,579);assert.equal(summary.unmappedAmbiguousGlyphs,0);assert.equal(summary.fullSetSourceAccuracy,null);
 assert.equal(summary.reviewedProbes.passed,27);assert.equal(summary.reviewedProbes.retrievedExpectedSources,29);
 assert.equal(summary.original769Comparison.total,769);assert.deepEqual(summary.original769Comparison.previousHitsNowIncomplete,[]);
 assert.ok(summary.original769Comparison.recoveredAllParts>=130);
});
check('Review HTML keeps all 579 regions and has a syntactically valid offline filter',()=>{
 const html=read(path.join(root,'reports/japanese-source-matching/review.html'));
 assert.equal((html.match(/<section /g)||[]).length,579);new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
});
check('Binding boundary audit preserves its baseline and reproduces all named reviews',()=>{
 const output='.tools/source-binding-audit-test';
 const run=spawnSync(process.execPath,['tools/audit_source_bindings.mjs',output],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const manifest=JSON.parse(read(path.join(root,'reports/japanese-source-matching/binding-audit-manifest.json')));
 for(const f of [...manifest.inputs,...manifest.implementation])assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.local);
 for(const f of [...manifest.outputs,{file:'binding-audit-manifest.json'}])assert.equal(sha256(fs.readFileSync(path.join(root,output,f.file))),sha256(fs.readFileSync(path.join(root,'reports/japanese-source-matching',f.file))),f.file);
 const {summary,comparisons}=JSON.parse(read(path.join(root,output,'binding-audit.json')));
 assert.equal(summary.previousBindingUnits,148);assert.equal(summary.previousAmbiguousUnits,31);
 assert.equal(summary.reviewedCases,13);assert.equal(summary.passedCases,13);assert.deepEqual(summary.lostAllSourceCandidates,[]);
 assert.equal(summary.removedInterpretations,138);assert.equal(summary.currentAmbiguousUnits,2);
 assert.equal(summary.ambiguousUnitsWithConsistentMeaning,2);assert.equal(summary.ambiguousUnitsNeedingMeaningReview,0);
 assert.equal(summary.sendOutReview.total,8);assert.equal(summary.sendOutReview.passed,8);
 assert.equal(summary.addedNativeExperienceInterpretations,9);
 assert.equal(summary.experienceReview.total,9);assert.equal(summary.experienceReview.passed,9);
 assert.equal(summary.observationReview.total,9);assert.equal(summary.observationReview.passed,9);
 assert.ok(comparisons.every(c=>c.removed.every(r=>r.reasons.length)));
});
check('Repeated full evaluation is byte-for-byte reproducible',()=>{
 const output='.tools/source-matching-test';fs.mkdirSync(path.join(root,output),{recursive:true});
 const run=spawnSync(process.execPath,['tools/evaluate_source_matching.mjs',output],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const manifest=JSON.parse(read(path.join(root,'reports/japanese-source-matching/run-manifest.json')));
 for(const f of [...manifest.outputs,{file:'run-manifest.json'}])assert.equal(sha256(fs.readFileSync(path.join(root,output,f.file))),sha256(fs.readFileSync(path.join(root,'reports/japanese-source-matching',f.file))),f.file);
});
const report={passed:true,total:checks.length,checks,scope:'source matcher behavior and reproducible diagnostics; not exhaustive source correctness or Chinese acceptance'};
fs.writeFileSync(path.join(root,'reports/japanese-source-matching/checks.json'),JSON.stringify(report,null,2)+'\n');
console.log(`${checks.length} source-matching checks passed`);
