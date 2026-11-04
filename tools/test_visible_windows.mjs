import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {read,sha256} from './corpus_common.mjs';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {loadVisibleReview,compileVisibleWindows,validateVisibleWindows,S6VisibleWindowProbe,verifyFiles,renderOriginalQuote} from './s6_visible_windows.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),json=p=>JSON.parse(read(path.join(root,p))),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const reference=json('corpus/visible-windows/reference.json'),compiled=json('outputs/s6-corpus/visible-windows.json'),{visibleProbe}=loadS6Probe(root),summary=json('reports/s6-visible-windows/summary.json');
const fixtures=reference.regions.flatMap(r=>r.units.map(u=>({...u,type:r.typeCandidates[0],regionId:r.id})));
const fixture=id=>fixtures.find(u=>u.decisionId===id);
const lookup=(id,overrides={})=>{const f=fixture(id);return visibleProbe.lookupUnit({...f,...overrides},{type:f.type});};
check('Every S3 target and non-whitespace character has a complete visible-unit disposition, with explicit Spec scope',()=>{
 const loaded=loadVisibleReview(root);assert.equal(loaded.regions.length,579);assert.equal(fixtures.length,1133);assert.equal(new Set(fixtures.map(f=>f.id)).size,1133);
 assert.equal(reference.regions.filter(r=>r.inFirstEdition).length,489);assert.equal(fixtures.filter(f=>f.disposition==='outside_first_edition').length,350);
 assert.equal(reference.excludedRegions.length,11);assert.equal(reference.images.filter(i=>i.scopeNegative).length,5);
 assert.equal(summary.firstEditionUnits,783);assert.equal(summary.originalChineseUnits,772);assert.equal(summary.retainedJapaneseUnits,11);assert.equal(summary.retainedByDesignUnits,4);assert.equal(summary.unresolvedRetainedUnits,7);assert.equal(summary.originalFormatOnlyUnits,8);
});
check('Every reviewed quote is re-extracted from pinned RSC bytes and the compiled index is reproducible',()=>{
 const rebuilt=compileVisibleWindows(root);assert.deepEqual(rebuilt,compiled);assert.equal(rebuilt.rules.filter(r=>r.disposition==='original_rsc_span').length,270);
 for(const c of rebuilt.rules.flatMap(r=>r.citations))assert.equal(sha256(Buffer.from(c.quote)),c.quoteSha256);
});
check('Nurse greeting, recovery explanation and question never expose later independent pages',()=>{
 const first=lookup('W004'),next=lookup('W005'),question=lookup('W006');assert.equal(first.chinese,fixture('W004').expectedChinese);assert.equal(next.chinese,fixture('W005').expectedChinese);assert.equal(question.chinese,fixture('W006').expectedChinese);
 assert.ok(!first.output.includes(next.chinese));assert.ok(!first.output.includes(question.chinese));assert.notEqual(first.citations[0].span[0],next.citations[0].span[0]);
});
check('Bookshelf heading and the two overlapping title windows select their actual original ranges',()=>{
 assert.ok(lookup('W009').citations.every(c=>c.span[1]<fixture('W010').citations[0].span[1]));
 const a=lookup('W010'),b=lookup('W011');assert.notEqual(a.chinese,b.chinese);assert.ok(a.citations.every(c=>c.sourceLine===4184));assert.ok(b.citations.every(c=>c.sourceLine===4184));
});
check('Battle menu cells and PP exclude palette, coordinate and unrelated-cell controls',()=>{
 for(const id of ['W171','W172','W173','W174','W500']){const result=lookup(id);assert.equal(result.chinese,fixture(id).expectedChinese);assert.ok(!/[\[\]\\]/.test(result.chinese));}
 assert.equal(new Set(['W171','W172','W173','W174'].map(id=>lookup(id).chinese)).size,4);
 assert.throws(()=>renderOriginalQuote('[buffer1]'));assert.throws(()=>renderOriginalQuote('\\v\\h00'));assert.throws(()=>renderOriginalQuote('[等待按键]'));
});
check('Unidentified actors, unseen required rank and unlocated titles keep current Japanese',()=>{
 for(const id of ['W234','W251','W371','W387']){const f=fixture(id),result=lookup(id);assert.equal(result.output,f.raw,id);assert.equal(result.chinese,null,id);assert.equal(result.citations.length,0);}
});
check('Unique original sources publish unchanged RSC wording despite localization or entity differences',()=>{
 const expected={W214:'看，是不是很整洁？\n这些房子是浮在水上的！',W454:'向尾喵：喵？',W468:'万物皆靠大海生存，\n即便是在陆地上安家也一样。'};
 assert.equal(compiled.semanticDifferenceFallback,false);
 for(const [id,text] of Object.entries(expected))for(const game of ['ruby','sapphire','both']){
  const f=fixture(id),r=visibleProbe.lookupUnit(f,{type:f.type,game});assert.equal(r.chinese,text);assert.equal(r.output,text);assert.ok(r.citations.length);
 }
 assert.equal(fixtures.filter(f=>f.decisionId==='W214').length,2);
 assert.ok(!lookup('W214').output.includes('出生'));assert.ok(!lookup('W468').output.includes('尘土'));
 const changed=structuredClone(compiled);changed.rules.find(r=>r.id==='W214').reasonCode='original_semantic_difference';assert.throws(()=>validateVisibleWindows(changed),/Semantic differences/);
});
check('Quantities, display numbers, prices, stats, trainer IDs and new current values are copied verbatim',()=>{
 for(const id of ['W030','W064','W074','W087','W106','W380','W397','W398','W404','W463','W464','W465','W466','W500']){
  const f=fixture(id),raw=f.raw.replace(/[0-9]/g,'9'),result=lookup(id,{raw});assert.notEqual(result.chinese,null,id);
  const at=raw.indexOf(f.searchText);assert.equal(result.output,raw.slice(0,at)+f.expectedChinese+raw.slice(at+f.searchText.length));
 }
 assert.deepEqual(lookup('W380').visibleFields,fixture('W380').visibleFields);
});
check('No prefix, unknown glyph, wrong layout or unmatched window can acquire a translation',()=>{
 const f=fixture('W074');for(const searchText of [f.searchText.slice(0,-1),'�'+f.searchText,f.searchText+'x'])assert.equal(visibleProbe.lookupUnit({raw:searchText,searchText,kind:f.kind},{type:f.type}).chinese,null);
 assert.equal(visibleProbe.lookupUnit(f,{type:'battle_message'}).chinese,null);
 const result=visibleProbe.lookupUnit({raw:'unknown name 001',searchText:'unknown name',kind:null},{type:'bag_list'});assert.equal(result.output,'unknown name 001');
 assert.equal(lookup('W074',{raw:'not the queried word'}).chinese,null);
});
check('Cross-version witnesses are required and unapproved game conflicts cannot pick a first result',()=>{
 const changed=structuredClone(compiled),rule=changed.rules.find(r=>r.id==='W004');rule.citations=rule.citations.filter(c=>c.game==='ruby');
 const p=new S6VisibleWindowProbe(changed),f=fixture('W004');assert.equal(p.lookupUnit(f,{type:f.type}).chinese,null);assert.equal(p.lookupUnit(f,{type:f.type,game:'sapphire'}).chinese,null);assert.notEqual(p.lookupUnit(f,{type:f.type,game:'ruby'}).chinese,null);
});
check('Changed original Chinese, invalid ranges, injected controls, duplicate rules and forged source identities are rejected',()=>{
 const mutations=[p=>p.rules.find(r=>r.citations.length).citations[0].quote+='x',p=>p.rules.find(r=>r.citations.length).citations[0].span[1]++,p=>p.sourceEntries[0].originalChinese+='x',p=>p.sources[0].commit='changed',p=>p.rules.push(p.rules[0]),p=>p.rules.find(r=>r.citations.length).citations[0].game='invalid'];
 for(const mutate of mutations){const p=structuredClone(compiled);mutate(p);assert.throws(()=>validateVisibleWindows(p));}
});
check('Frozen reference and evaluation manifests bind current sources, decisions and implementations without old model gold',()=>{
 const frozen=json('corpus/visible-windows/freeze-manifest.json'),run=json('reports/s6-visible-windows/run-manifest.json');
 for(const [manifest,directory] of [[frozen,'corpus/visible-windows'],[run,'reports/s6-visible-windows']]){
  verifyFiles(root,[...manifest.inputs,...manifest.implementation]);for(const f of manifest.outputs)assert.equal(sha256(fs.readFileSync(path.join(root,directory,f.file))),f.sha256);
 }
 assert.equal(summary.baselineGatePassed,true);assert.equal(summary.fullFirstEditionChineseGatePassed,false);assert.equal(summary.S6Complete,false);assert.equal(summary.independentReview,false);
});
check('Isolated S6 handoff loads original citations without upstream files or the reference',()=>{
 const {manifest}=loadS6Probe(root),base=path.join(root,'.tools/visible-window-handoff'),directory=path.join(base,'outputs/s6-corpus');fs.mkdirSync(directory,{recursive:true});
 for(const file of [...manifest.outputs.map(f=>f.file),'build-manifest.json'])fs.copyFileSync(path.join(root,'outputs/s6-corpus',file),path.join(directory,file));
 const p=loadS6Probe(base).visibleProbe,f=fixture('W004');assert.equal(p.lookupUnit(f,{type:f.type}).chinese,f.expectedChinese);
});
check('Repeated full actual-input evaluation reproduces the fixed baseline and all review data',()=>{
 const output='.tools/visible-window-evaluation';execFileSync(process.execPath,['tools/evaluate_visible_windows.mjs','--gate','--out',output],{cwd:root,maxBuffer:1024*1024});
 const manifest=json('reports/s6-visible-windows/run-manifest.json');
 // Review URLs are relative to the output directory, so compare semantic JSON/CSV and manifests by their declared evidence.
 for(const file of ['summary.json','evaluation.json','units.csv','remaining.csv','variable-binding-audit.json'])assert.equal(sha256(fs.readFileSync(path.join(root,output,file))),sha256(fs.readFileSync(path.join(root,'reports/s6-visible-windows',file))),file);
 const html=read(path.join(root,'reports/s6-visible-windows/review.html'));assert.equal((html.match(/<article /g)||[]).length,579);new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g))assert.ok(fs.existsSync(path.resolve(root,'reports/s6-visible-windows',match[1])),match[1]);
});
fs.writeFileSync(path.join(root,'reports/s6-visible-windows/checks.json'),JSON.stringify({passed:true,scope:'Original source, visible-range, value-preservation, fallback, frozen baseline and handoff checks; not full first-edition or independent/live acceptance',checks},null,2)+'\n');
console.log(`${checks.length} visible-window checks passed`);
