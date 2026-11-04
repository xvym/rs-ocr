import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {validateSemanticUnits} from './s6_semantic_units.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),json=p=>JSON.parse(fs.readFileSync(path.join(root,p))),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const reference=json('corpus/visible-windows/reference.json'),pack=json('outputs/s6-corpus/visible-windows.json').semanticUnits,{visibleProbe:probe}=loadS6Probe(root);
const fixtures=reference.regions.flatMap(r=>r.units.map(u=>({...u,type:r.typeCandidates[0]}))),fixture=id=>fixtures.find(f=>f.decisionId===id);
const lookup=(id,raw=null)=>{const f=fixture(id);return probe.lookupUnit(raw===null?f:{raw,searchText:raw,kind:f.kind},{type:f.type});};
check('Gym combination first and scrolling windows identify the same complete unchanged original semantic unit',()=>{
 const first=lookup('W002'),scroll=lookup('W003');assert.equal(first.chinese,fixture('W002').expectedChinese);assert.equal(scroll.chinese,first.chinese);assert.equal(first.semanticUnit,'gym_combination');
 assert.ok(first.chinese.includes('他们的组合技攻击非常出色'));assert.equal(first.citations.length,2);
 for(const c of first.citations)assert.equal(c.quote.replaceAll('\\n','\n').replaceAll('\\l','\n').replaceAll('\\p','\n\n'),first.chinese);
});
check('Wrapping, spaces and carriage returns do not change an already reviewed identifying window',()=>{
 const f=fixture('W002'),expected=lookup('W002').chinese;
 for(const raw of [f.raw.replaceAll(' ', '　'),f.raw.replace('\n','\r\n'),f.raw.replaceAll(' ','\n'),' '+f.raw+' '])assert.equal(lookup('W002',raw).chinese,expected);
});
check('Scrolling and clear-window boundaries do not split reviewed same-sentence or dependent semantic units',()=>{
 for(const ids of [['W116','W117'],['W125','W126'],['W127','W128'],['W140','W141'],['W143','W144'],['W185','W186'],['W188','W189','W190'],['W192','W193'],['W203','W204'],['W208','W209'],['W210','W211'],['W212','W213'],['W216','W217'],['W218','W219','W220'],['W225','W226'],['W227','W228'],['W265','W266'],['W267','W268'],['W270','W271'],['W319','W320'],['W328','W329'],['W368','W369'],['W374','W375','W376'],['W451','W452','W453'],['W478','W479']]){
  const outputs=ids.map(id=>lookup(id).chinese);assert.ok(outputs.every(Boolean),ids.join(','));assert.equal(new Set(outputs).size,1,ids.join(','));
 }
 const regi=pack.plans.find(p=>p.id===lookup('W218').semanticUnit);assert.ok(new Set(regi.parts.map(p=>p.page)).size>1);
});
check('One identified unit cannot publish the next independent invitation, room instruction, recollection or diagnosis',()=>{
 assert.ok(!lookup('W225').chinese.includes(lookup('W227').chinese));assert.ok(!lookup('W310').chinese.includes('下一个房间'));assert.ok(lookup('W311').chinese.includes('下一个房间'));
 assert.ok(!lookup('W446').chinese.includes('电池'));assert.ok(!lookup('W218').chinese.includes('小时候'));assert.ok(!lookup('W332').chinese.includes('获胜'));
 const ball=pack.plans.find(p=>p.id===lookup('W116').semanticUnit);assert.ok(ball.parts.every(p=>p.page===0));assert.ok(!lookup('W116').chinese.includes('水属性'));
});
check('Source-backed functional localization and reviewed partial anchors no longer count as missing translations',()=>{
 for(const id of ['W072','W102','W162','W319'])assert.equal(lookup(id).chinese,fixture(id).expectedChinese);
 for(const id of ['W002','W162','W319'])assert.equal(lookup(id,fixture(id).raw.slice(0,4)).chinese,null);
});
check('Unknown glyphs, arbitrary short prefixes, unknown actor fragments and incompatible layouts cannot select a semantic unit',()=>{
 for(const raw of ['この まちの','なんといっても','しかし あいての グラ','あいて','�'+fixture('W002').raw,fixture('W002').raw+'x'])assert.equal(lookup('W002',raw).chinese,null,raw);
 const f=fixture('W002');assert.equal(probe.lookupUnit(f,{type:'battle_message'}).chinese,null);assert.equal(probe.lookupUnit({...f,raw:'unrelated'},{type:f.type}).chinese,null);assert.equal(probe.lookupUnit({...f,searchText:'の'},{type:f.type}).chinese,null);
});
check('Native label and grammar equivalence consumes the correct complete visible unit without leaving Japanese prefixes',()=>{
 for(const id of ['W379','W384','W396','W403','W462','W547'])assert.equal(lookup(id).chinese,fixture(id).expectedChinese);
 assert.equal(lookup('W389').output,'性格，');assert.equal(lookup('W501').output,'属性/');assert.equal(lookup('W389','ほかのせいかく').chinese,null);
});
check('Rolling advice and concern templates require current names and honorifics and never reuse another frame',()=>{
 for(const ids of [['W093','W096'],['W152','W153']]){const values=ids.map(id=>lookup(id).chinese);assert.equal(new Set(values).size,1);for(const id of ids){const raw=fixture(id).raw.replace('ハルカ','ユウキ'),r=lookup(id,raw);assert.ok(r.chinese.includes('ユウキ'));assert.ok(!r.chinese.includes('ハルカ'));assert.equal(lookup(id,raw.replace('ユウキ','')).chinese,null);}}
 assert.equal(lookup('W153',fixture('W153').raw.replace('ちゃん','せんせい')).chinese,null);
});
check('Contest rank comes only from the currently visible rank and its unchanged original term',()=>{
 assert.equal(lookup('W371').chinese,null);assert.equal(lookup('W372').chinese,lookup('W373').chinese);
 for(const [jp,zh] of [['ノーマル','普通'],['スーパー','超级'],['ハイパー','高级'],['マスター','大师']]){const r=lookup('W372',fixture('W372').raw.replace('マスター',jp));assert.ok(r.chinese.includes(zh+'级别'));assert.ok(!r.chinese.includes('你好'));}
 assert.equal(lookup('W373',fixture('W373').raw.replace('マスター','???')).chinese,null);
});
check('Prize money can use the verified original entry even when the old candidate bridge was missing',()=>{
 const f=fixture('W263'),r=lookup('W263',f.raw.replace('ハルカ','ユウキ').replace('4900','５１００'));assert.equal(r.output,'作为奖励，\nユウキ获得了$５１００！');assert.ok(r.citations.every(c=>c.sourceLine===6946&&c.candidateId.startsWith('original-entry:')));
 assert.equal(lookup('W263',f.raw.replace('4900','49 00')).chinese,null);assert.equal(lookup('W263').chinese,fixture('W263').expectedChinese);
});
check('Organization stems select original complete team terms and never leak the following Wailmer or boat paragraph',()=>{
 for(const [jp,zh] of [['アクア','海洋队'],['マグマ','熔岩队']]){const r=lookup('W474',fixture('W474').raw.replace('アクア',jp));assert.equal(r.chinese,'有人帮我们把\n'+zh+'赶走了！');assert.ok(!r.chinese.includes('船'));}
 assert.equal(lookup('W474',fixture('W474').raw.replace('アクア','ロケット')).chinese,null);
});
check('Changed Japanese ranges, anchor digests, original spans and source identities reject the semantic pack',()=>{
 for(const change of [p=>p.plans[0].parts[0].text+='x',p=>p.plans[0].anchors[0].japanese+='x',p=>p.plans[0].citations[0].span[1]--,p=>p.sourceEntries[0].originalChinese+='x',p=>p.sources[0].commit='other',p=>p.plans.push(p.plans[0])]){const p=structuredClone(pack);change(p);assert.throws(()=>validateSemanticUnits(p));}
 assert.equal(pack.generatedChineseRecords,0);assert.equal(pack.rewrittenChineseRecords,0);assert.ok(!('cases' in pack));
});
fs.writeFileSync(path.join(root,'reports/s6-visible-windows/semantic-unit-checks.json'),JSON.stringify({passed:true,scope:'Original semantic units, control boundaries, identifying anchors, rolling windows and current variable isolation',checks},null,2)+'\n');
console.log(`${checks.length} semantic-unit checks passed`);
