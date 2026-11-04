import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha256,read} from './corpus_common.mjs';
import {S6CorpusProbe,loadS6Probe} from './s6_corpus_probe.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{pack,probe,manifest}=loadS6Probe(root),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const lookup=(raw,context)=>probe.lookup(raw,context),cn=(raw,context)=>lookup(raw,context).chinese;
check('S6 runtime is self-contained without ROM, upstream caches, fonts or answers',()=>{
 const out=path.join(root,'.tools/s6-handoff-test'),dir=path.join(out,'outputs/s6-corpus');fs.mkdirSync(dir,{recursive:true});
 for(const f of [...manifest.outputs.map(f=>f.file),'build-manifest.json'])fs.copyFileSync(path.join(root,'outputs/s6-corpus',f),path.join(dir,f));
 const {probe:standalone}=loadS6Probe(out);
 assert.equal(standalone.lookup('ピカチュウの\n１０まんボルト！').chinese,'皮卡丘使出了十万伏特！');
 assert.equal(standalone.lookup('カイオーガの たいりょくが\n17 かいふくした').chinese,'盖欧卡的体力恢复了17点。');
 const file=path.join(dir,'runtime.json');fs.appendFileSync(file,' ');assert.throws(()=>loadS6Probe(out),/Changed S6 artifact/);fs.copyFileSync(path.join(root,'outputs/s6-corpus/runtime.json'),file);
});
check('Source and implementation identities are recorded; frozen answers never enter the resource build',()=>{
 for(const f of [...manifest.inputs,...manifest.implementation])assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256,f.local);
 assert.ok(!manifest.inputs.some(f=>/acceptance\/reference|output-judgments|ground_truth|ocr-inputs/.test(f.local)));
 assert.ok(!/GBA-\d{3}|NGC-\d{3}|expectedChinese/.test(JSON.stringify(pack)));
});
check('Typed full lexical names, raw unknown names and no partial names obey the saved name policy',()=>{
 assert.equal(probe.name('ピカチュウ'),'皮卡丘');assert.equal(probe.name('ピカチュ'),'ピカチュ');assert.equal(probe.name('ジーク'),'ジーク');
 assert.equal(probe.name('マコト'),'マコト');assert.equal(probe.name('あいての ポチ',{prefixDisplay:true}),'あいての ポチ');
 assert.equal(probe.name('あいての ピカチュウ',{prefixDisplay:true}),'对手的皮卡丘');
 assert.equal(probe.name('してんのうの カゲツ',{trainer:true}),'四天王 花月');
});
check('Species, elemental types, status and word-picker types cannot force a global homograph winner',()=>{
 assert.equal(cn('ゴースト'),null);assert.equal(cn('ゴースト',{kind:'species'}),'鬼斯通');assert.equal(cn('ゴースト',{kind:'type'}),'幽灵');
 assert.equal(cn('どく',{kind:'type'}),'毒');assert.equal(cn('どく',{kind:'status'}),'中毒');
 assert.equal(cn('ゴースト',{type:'easy_chat'}),'幽灵');assert.equal(cn('あなたが',{type:'easy_chat'}),'你');assert.equal(cn('あなたが'),null);
 assert.equal(cn('あいて',{type:'battle_message'}),null);assert.equal(cn('あいて',{type:'easy_chat'}),'对手');
});
check('All 354 native move forms have reviewed full-move Chinese and preserve unknown complete actors',()=>{
 const forms=pack.templates.filter(t=>t.id.startsWith('availability-move:'));assert.equal(forms.length,354);
 for(const t of forms){const raw=t.japanese.replace('[name]','ポチ'),r=lookup(raw);assert.equal(r.chinese,t.chinese.replace('{name}','ポチ'),t.id);}
 assert.equal(cn('ピカチュウの １０まんボルト！'),'皮卡丘使出了十万伏特！');
 assert.equal(cn('ピカチュウの １０まんボル'),null);assert.equal(cn('�の １０まんボルト！'),null);
});
check('Bindings keep raw current amounts and do not reuse a prior observation',()=>{
 assert.equal(cn('カイオーガの たいりょくが\n１７ かいふくした'),'盖欧卡的体力恢复了１７点。');
 assert.equal(cn('ラグラージの たいりょくが\n18 かいふくした'),'巨沼怪的体力恢复了18点。');
 assert.equal(cn('ラグラージの たいりょくが\n1 8 かいふくした'),null);
 assert.equal(cn('ポチは しょうきんとして\n4900円 てにいれた！'),'ポチ获得了4900元奖金！');
});
check('Same-rank substantive outputs and incomplete searches fail closed',()=>{
 const altered=structuredClone(pack);altered.units.push({id:'test-conflict',game:'ruby',japanese:'テスト',chinese:'甲'},{id:'test-conflict2',game:'ruby',japanese:'テスト',chinese:'乙'});
 assert.equal(new S6CorpusProbe(altered).lookup('テスト',{game:'ruby'}).status,'substantive_resource_conflict');
 assert.equal(new S6CorpusProbe(altered).lookup('テスト',{game:'sapphire'}).chinese,null);
});
check('Repeated slots are checked on a separate synthetic grammar, without shipping fabricated game sentences',()=>{
 const test={...pack,units:[],lexicon:[],templates:[{id:'test-only',japanese:'[name]は [name]に あいさつした！',chinese:'{name}向{name}打招呼！',slots:{name:{type:'name',maxCharacters:5}}}]};
 const p=new S6CorpusProbe(test);assert.equal(p.lookup('ポチは ポチに あいさつした！').chinese,'ポチ向ポチ打招呼！');
 assert.equal(p.lookup('ポチは タマに あいさつした！').chinese,null);
 assert.equal(p.lookup('ポチは ポ\nチに あいさつした！').chinese,null);
});
check('Japanese local player length uses native five-character evidence; ordinary display nicknames keep their own bound',()=>{
 assert.equal(cn('アイウエオは\nパソコンの スイッチを いれた！'),'アイウエオ打开了电脑！');
 assert.equal(cn('アイウエオカは\nパソコンの スイッチを いれた！'),null);
 assert.equal(cn('「オダマキ はかせの いえ」'),'“小田卷博士的家”');
 assert.equal(pack.nameEvidence.limits.localJapanesePokemonNamingUI,5);
});
check('Every fixed Japanese tower greeting is source-bound and translated only as the complete current two-line unit',()=>{
 const units=pack.units.filter(u=>u.nativeReference);assert.equal(units.length,100);
 for(const u of units){assert.equal(cn(u.japanese),u.chinese,u.id);const first=u.japanese.split('\n')[0];if(first!=='‥‥‥ クスクス')assert.notEqual(cn(first),u.chinese,u.id);}
 const native=JSON.parse(read(path.join(root,'reports/s6-corpus/easy-chat-native-evidence.json')));
 assert.equal(native.greetings.length,200);assert.ok(native.greetings.every(g=>g.printing.passed));
 assert.ok(native.roms.every(r=>r.declaredStressCases[0].wordsPerRow===2&&r.declaredStressCases[1].wordsPerRow===3));
});
check('Offline common meanings never include the next clear page or localized parent-text expansion',()=>{
 assert.equal(cn('ハギ『ムロタウン か'),'哈奇：“武斗镇啊。”');
 assert.equal(cn('よっしゃ！ いくぞ ピーコちゃん！'),'好！出发吧，小皮！');
 assert.equal(cn('ハギ『ムロタウン'),null);
 const common=cn('はかせは つくえのうえで けんきゅうを\nするよりも じっさいに そとへ とびだして\nたいけんする タイプのひと なんです！');
 assert.ok(common.includes('亲自跑到外面'));assert.ok(!common.includes('不在这里'));
});
check('All unresolved whole source records remain outside the published unit approval',()=>{
 assert.ok(pack.summary.inventoryStatuses.unreviewed_chinese_candidate>0);
 assert.equal(pack.summary.homographDecisions.unresolved_person_name_localization,24);
 const qid='rs.script.LittlerootTown.LittlerootTown_Text_16ACEB',unreviewed=pack.sourceRecords.find(r=>r.qid===qid);
 assert.ok(unreviewed);assert.ok(!pack.units.some(u=>u.qid===qid&&u.method==='model_reviewed'));
 assert.equal(cn(unreviewed.japanese.replaceAll('\\n','\n').replaceAll('\\r','\n')),null);
});
check('TV literal pages use explicit dialogue context while all 170 pending variable pages stay unpublished',()=>{
 assert.equal(pack.summary.tvPublishedLiteralPages,229);assert.equal(pack.summary.tvPendingVariablePages,170);
 assert.equal(cn('なるほど！',{type:'field_dialog'}),'原来如此！');
 assert.ok(!pack.templates.some(t=>t.id==='tv-page-86-0')); // nickname spelling fragments need dedicated rules
 const result=cn('なるほど！',{type:'field_dialog'});assert.ok(!result.includes('テレビ'));
});
check('Frozen Chinese gate passes separately from unavailable live/negative/excluded Chinese evidence',()=>{
 const r=JSON.parse(read(path.join(root,'reports/s6-acceptance/summary.json')));
 assert.equal(r.available,770);assert.equal(r.semanticCorrect,770);assert.equal(r.pendingSemanticGroups,0);assert.equal(r.gatePassed,true);
 assert.deepEqual(r.legalRetention,{passed:8,total:8});assert.equal(r.blind,false);
 assert.equal(r.excludedChinesePipeline,'not_executed_in_S6');assert.equal(r.negativeChinesePipeline,'not_executed_in_S6');
 const s=JSON.parse(read(path.join(root,'reports/s6-acceptance/evaluation.json'))).scenarios.filter(s=>!s.passed);
 assert.equal(s.length,2);assert.ok(s.every(s=>s.japanese.includes('かいふくのくすり')));
});
check('Rebuild is byte-for-byte identical and the frozen original baseline remains 25/770',()=>{
 const out='.tools/s6-rebuild-test',r=spawnSync(process.execPath,['tools/build_s6_corpus.mjs',out],{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 for(const f of [...manifest.outputs.map(f=>f.file),'build-manifest.json'])assert.equal(sha256(fs.readFileSync(path.join(root,out,f))),sha256(fs.readFileSync(path.join(root,'outputs/s6-corpus',f))),f);
 const baseline=JSON.parse(read(path.join(root,'reports/chinese-corpus-acceptance/summary.json')));assert.deepEqual(baseline.fixedSet.translationCoverage,{correct:25,total:770,rate:25/770});assert.equal(baseline.gatePassed,false);
});
fs.writeFileSync(path.join(root,'reports/s6-corpus/checks.json'),JSON.stringify({passed:true,total:checks.length,checks,scope:'S6 resource behavior, evidence identity, deterministic rebuild and offline handoff; no S7 Java/live or S8 whole-game acceptance'},null,2)+'\n');
console.log(checks.length+' S6 checks passed');
