import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseAligned,parseRsc,parseDictionary,parseCsv,csv,toSourceEnglish,sourceBytes,applyReview,read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checks=[];
function check(name,fn) {fn();checks.push({name,passed:true});console.log(`PASS ${name}`);}
const data=file=>path.join(root,'outputs/corpus-mapping',file);
const records=parseCsv(read(data('records.csv'))),candidates=parseCsv(read(data('candidates.csv')));
const rsc=parseCsv(read(data('rsc-import.csv'))),links=parseCsv(read(data('source-links.csv')));
const runtime=JSON.parse(read(data('runtime.json'))).records,summary=JSON.parse(read(data('summary.json')));
check('Aligned import preserves blank and NULL records',()=>{
  const rows=parseAligned('a\nb\nc\n','甲\n\n[NULL]\n','A\nB\nC\n');
  assert.equal(rows.length,3);assert.equal(rows[1].japanese,'');assert.equal(rows[2].japanese,'[NULL]');assert.equal(rows[2].english,'C');
  assert.equal(parseAligned('a\nb\n','甲\n\n','A\nB\n')[1].japanese,'');
});
check('Alignment rejects unequal counts, missing qids and duplicate qids',()=>{
  assert.throws(()=>parseAligned('a\nb\n','甲\n','A\nB\n'));
  assert.throws(()=>parseAligned('a\na\n','甲\n乙\n','A\nB\n'));
  assert.throws(()=>parseAligned('a\n\n','甲\n乙\n','A\nB\n'));
});
check('Version-specific records retain separate games',()=>{
  const rows=parseAligned('rs.common.dex^R.x\nrs.common.dex^S.x\n','甲\n乙\n','A\nB\n');
  assert.deepEqual(rows.map(x=>x.game),['ruby','sapphire']);
  assert.equal(records.filter(r=>r.game==='ruby').length,774);assert.equal(records.filter(r=>r.game==='sapphire').length,774);
});
check('CSV preserves punctuation, actual line breaks, and literal control escapes',()=>{
  const rows=[{a:'日文,"甲"',b:'一行\n二行\\n[PLAYER]'}];
  assert.deepEqual(parseCsv(csv(rows,['a','b'])),rows);
});
check('RSC imports full content independently of declared byte count',()=>{
  const row=parseRsc('{\n 地址=0x123\n 字节数=1\n 文本=长文本\\p第二页\n}\n')[0];
  assert.equal(row.declaredBytes,1);assert.equal(row.chinese,'长文本\\p第二页');
  assert.throws(()=>parseRsc('地址=0x123\n 字节数=1\n 文本=broken'));
  const tm=rsc.find(r=>r.game==='ruby'&&r.chinese==='招式学习器01');
  assert.equal(tm.declaredBytes,'12');assert.equal(tm.actualBytes,'4');
});
check('Dictionary parser keeps whole source terms and original line provenance',()=>{
  const rows=parseDictionary('{\n 原文=Quick Attack\n 译文=电光一闪\n}\n');
  assert.equal(rows[0].english,'Quick Attack');assert.equal(rows[0].line,1);
});
check('Corpus controls remain distinct and literal brackets are not variables',()=>{
  assert.equal(toSourceEnglish('[PLAYER]\\nA\\rB\\cC'),'{'+'PLAYER}\\nA\\lB\\pC');
  assert.equal(toSourceEnglish('\\[PLAYER]'),'[PLAYER]');
  assert.throws(()=>toSourceEnglish('[BROKEN'));
});
check('Source terminator handling does not stop inside sound/control arguments',()=>{
  const bytes=[0xFC,0x10,0xFF,0x01,0xBB,0xFF];
  assert.deepEqual([...sourceBytes(new Map(bytes.map((v,i)=>[i,v])),0)],bytes.slice(0,-1));
  assert.equal(sourceBytes(new Map([[0,0xFC],[1,0xFE]]),0),null);
});
check('Both known address corrections preserve original addresses',()=>{
  const rain=rsc.find(r=>r.game==='ruby'&&r.recordedAddress==='0x3CAE94');
  assert.equal(rain.address,'0x3CAEB0');assert.equal(rain.sourceSymbol,'ContestString_MoveRainDance');
  const doll=rsc.find(r=>r.game==='ruby'&&r.recordedAddress==='0x3EC2761');
  assert.equal(doll.address,'0x3EC261');assert.equal(doll.sourceSymbol,'gDecorations[92]+1');
  assert.ok(Number(doll.offsetWithinSymbol)>0);
  assert.equal(rsc.length,19610);
});
check('Legacy qid to rev2 source requires exact English evidence',()=>{
  const link=links.find(r=>r.game==='ruby'&&r.qid==='rs.script.PetalburgCity.PetalburgCity_Text_16433E');
  assert.equal(link.address,'0x16435E');assert.equal(link.sourceSymbol,'PetalburgCity_Text_WhereIsWally');
  assert.equal(link.evidence,'symbol_or_rev0_alias_and_exact_english_bytes');
});
check('RS species internal IDs are not replaced with National Dex numbers',()=>{
  assert.equal(records.find(r=>r.qid==='rs.common.species_names.gSpeciesNames.252').japanese,'？');
  assert.equal(records.find(r=>r.qid==='rs.common.species_names.gSpeciesNames.277').japanese,'キモリ');
});
check('Reviews are bound to Japanese, English and complete original candidate set',()=>{
  const record={qid:'q',japanese:'はい',english:'YES'};
  const cs=[{qid:'q',game:'ruby',chinese:'是'}];
  const review={game:'ruby',japanese:'はい',english:'YES',originalChinese:'是',originalCandidates:['是'],chinese:'是',action:'retain',method:'model_reviewed',reason:'Checked'};
  applyReview(review,record,cs);
  assert.throws(()=>applyReview({...review,japanese:'いいえ'},record,cs));
  assert.throws(()=>applyReview({...review,originalCandidates:[]},record,cs));
  assert.throws(()=>applyReview({...review,action:'supplement'},record,cs));
});
const query=(ja,game='ruby')=>JSON.parse(execFileSync(process.execPath,['tools/query_corpus.mjs','--japanese',ja,'--game',game],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
check('Exact complete term query publishes reviewed names and refuses prefixes',()=>{
  assert.equal(query('ピカチュウ').translation,'皮卡丘');
  assert.equal(query('ピカチュ').status,'no_record');
});
check('Reviewed complete battle sentence is usable without predicting an unfinished prefix',()=>{
  const hit=query('こうかは　ばつぐんだ！');
  assert.ok(hit.translation!==null);assert.ok(hit.candidates.some(c=>c.chinese===hit.translation));
  assert.equal(query('こうかは　ばつ').status,'no_record');
});
check('Real homographs keep species/type and type/status meanings separate',()=>{
  const ghost=query('ゴースト');
  assert.equal(ghost.translation,null);assert.equal(ghost.status,'context_required');
  assert.ok(ghost.candidates.some(c=>c.chinese==='鬼斯通'));assert.ok(ghost.candidates.some(c=>c.chinese==='幽灵'));
  assert.equal(query('どく').translation,null);assert.equal(query('こおり').translation,null);
});
check('Unreviewed dialogue and dynamic templates cannot enter static runtime resources',()=>{
  const dialogue=records[0];assert.equal(query(dialogue.japanese).translation,null);
  assert.ok(runtime.length>0);
  for(const r of runtime) {
    assert.doesNotMatch(r.japanese,/\[|\\[nrc]/);assert.equal(r.reviewMethod,'rsc_original_retained');
    assert.ok(!['ゴースト','どく','こおり','ノーマル'].includes(r.japanese));
  }
});
check('Coverage accounts for every eligible source record in each game',()=>{
  const gaps=parseCsv(read(data('gaps.csv')));
  for(const game of ['ruby','sapphire']) {
    const unique=new Set(candidates.filter(c=>c.game===game).map(c=>c.qid));
    const missing=gaps.filter(g=>g.game===game);
    assert.equal(new Set(missing.map(g=>g.qid)).size,missing.length);
    assert.equal(unique.size+missing.length,summary.perGame[game].eligibleSourceRecords);
    assert.ok(missing.every(g=>!unique.has(g.qid)));
  }
});
check('Generated outputs and pinned sources match the build manifest',()=>{
  const manifest=JSON.parse(read(data('build-manifest.json')));
  for(const s of manifest.inputs)assert.equal(sha256(fs.readFileSync(path.join(root,s.local))),s.sha256);
  for(const s of manifest.implementation)assert.equal(sha256(fs.readFileSync(path.join(root,s.local))),s.sha256);
  for(const s of manifest.outputs)assert.equal(sha256(fs.readFileSync(data(s.file))),s.sha256);
});
check('Offline rebuild is byte-for-byte reproducible',()=>{
  const rebuilt='.tools/corpus-rebuild';
  execFileSync(process.execPath,['tools/build_corpus.mjs',rebuilt],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
  for(const file of fs.readdirSync(path.join(root,rebuilt))) {
    assert.equal(sha256(fs.readFileSync(path.join(root,rebuilt,file))),sha256(fs.readFileSync(data(file))),file);
  }
});
const report=path.join(root,'reports/corpus-mapping');fs.mkdirSync(report,{recursive:true});
fs.writeFileSync(path.join(report,'checks.json'),JSON.stringify({passed:true,checks,scope:'corpus construction, source integrity and conservative static publication; not final Chinese acceptance'},null,2)+'\n');
console.log(`${checks.length} checks passed`);
