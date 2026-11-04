import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {sha256,read,applyReview} from './corpus_common.mjs';
import {S6CorpusProbe,loadS6Probe} from './s6_corpus_probe.mjs';
import {verifyManifest,displayOriginal} from './rsc_translation_policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{pack,probe,manifest}=loadS6Probe(root),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
check('Every published Chinese value has an exact pinned RSC witness',()=>{
 const byId=new Map(pack.candidates.map(c=>[c.id,c])),allowed=new Set(pack.rscSources.map(s=>s.id));
 for(const r of [...pack.lexicon,...pack.units])assert.ok(r.candidateIds.some(id=>{const c=byId.get(id);return c&&c.qid===r.qid&&c.game===r.game&&c.chinese===r.chinese&&allowed.has(c.sourceId);}));
});
check('Changing retained Chinese is rejected even with model or human approval',()=>{
 const row=pack.lexicon[0],changed=structuredClone(pack);changed.lexicon[0].chinese+='\u0000';assert.throws(()=>new S6CorpusProbe(changed),/not an original RSC candidate/);
 const r={qid:row.qid,japanese:row.japanese,english:''},cs=pack.candidates.filter(c=>c.qid===row.qid&&c.game===row.game);
 const review={...r,game:row.game,chinese:row.chinese,originalChinese:row.chinese,originalCandidates:[...new Set(cs.map(c=>c.chinese))],reason:'test',method:'human_reviewed'};
 for(const action of ['correct','supplement','unify'])assert.throws(()=>applyReview({...review,action},r,cs),/RSC-only/);
 assert.throws(()=>applyReview({...review,action:'retain',chinese:row.chinese+'\u0000'},r,cs),/changes text/);
});
check('Historical model corpus and new event/composition payloads are rejected',()=>{
 const old=JSON.parse(read(path.join(root,'archive/model-translations/outputs/s6-corpus/runtime.json')));
 assert.throws(()=>new S6CorpusProbe(old),/legacy model corpus/);
 for(const field of ['templates','events','compositionPolicy','namePolicy'])assert.throws(()=>new S6CorpusProbe({...pack,[field]:[]}),/legacy model corpus/);
});
check('Typed complete original names work and homographs do not get a global winner',()=>{
 assert.equal(probe.lookup('ピカチュウ',{kind:'species'}).chinese,'皮卡丘');
 assert.equal(probe.lookup('ピカチュ').chinese,null);
 assert.equal(probe.lookup('ゴースト').chinese,null);
 assert.equal(probe.lookup('ゴースト',{kind:'species'}).chinese,'鬼斯通');
 assert.equal(probe.name('ポチ'),'ポチ');
});
check('Former generated sentences and prefix composition fall back to Japanese',()=>{
 for(const raw of ['ピカチュウの\n１０まんボルト！','あいての ピカチュウ','カイオーガの たいりょくが\n17 かいふくした']){
  const hit=probe.lookup(raw);assert.equal(hit.chinese,null);assert.equal(hit.output,raw);
 }
});
check('Unverified original controls and placeholders cannot be silently rewritten',()=>{
 for(const text of ['a\\nb','a[PLAYER]','a{PLAYER}'])assert.equal(displayOriginal(text),null);
 const row=pack.units.find(r=>displayOriginal(r.chinese)===null);assert.ok(row);
 const single=new S6CorpusProbe({...pack,lexicon:[],units:[row]});assert.equal(single.lookup(row.japanese,{game:row.game}).output,row.japanese);
});
check('Build inputs and hashes are current and exclude historical model payloads',()=>{
 verifyManifest(root,'outputs/corpus-mapping');verifyManifest(root,'outputs/s6-corpus');
 for(const f of [...manifest.inputs,...manifest.implementation])assert.doesNotMatch(f.local,/archive\/|corpus\/s6\/|corpus\/acceptance\/|output-judgments/);
 assert.equal(pack.summary.generatedChineseRecords,0);
});
check('Standalone handoff loads without upstream data and detects artifact tampering',()=>{
 const dir=path.join(root,'.tools/rsc-only-handoff/outputs/s6-corpus');fs.mkdirSync(dir,{recursive:true});
 for(const f of [...manifest.outputs.map(f=>f.file),'build-manifest.json'])fs.copyFileSync(path.join(root,'outputs/s6-corpus',f),path.join(dir,f));
 const standalone=loadS6Probe(path.join(root,'.tools/rsc-only-handoff'));
 assert.equal(standalone.probe.lookup('ピカチュウ',{kind:'species'}).chinese,'皮卡丘');
 fs.appendFileSync(path.join(dir,'runtime.json'),' ');assert.throws(()=>loadS6Probe(path.join(root,'.tools/rsc-only-handoff')),/Changed S6 artifact/);
});
check('Source-only rebuild is byte-for-byte reproducible',()=>{
 const rebuilt='.tools/rsc-only-rebuild';execFileSync(process.execPath,['tools/build_s6_corpus.mjs',rebuilt],{cwd:root,maxBuffer:1024*1024});
 for(const f of [...manifest.outputs.map(f=>f.file),'build-manifest.json'])assert.equal(sha256(fs.readFileSync(path.join(root,rebuilt,f))),sha256(fs.readFileSync(path.join(root,'outputs/s6-corpus',f))),f);
});
check('Legacy model semantic gate refuses to report a current pass',()=>{
 for(const file of ['evaluate_s6_corpus.mjs','accept_chinese_corpus.mjs']){
  const run=spawnSync(process.execPath,['tools/'+file,'--gate'],{cwd:root,encoding:'utf8'});
  assert.notEqual(run.status,0);assert.match(run.stderr,/withdrawn/);
 }
 const run=spawnSync(process.execPath,['tools/freeze_chinese_corpus_acceptance.mjs'],{cwd:root,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/withdrawn/);
});
fs.mkdirSync(path.join(root,'reports/s6-corpus'),{recursive:true});
fs.writeFileSync(path.join(root,'reports/s6-corpus/checks.json'),JSON.stringify({passed:true,scope:'RSC-only origin and fallback checks, not Chinese semantic accuracy',checks},null,2)+'\n');
console.log(`${checks.length} checks passed`);
