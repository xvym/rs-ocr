import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseCsv} from './corpus_common.mjs';
import {checkedJson,layoutKey,visibleValues,dataValues,displaySymbols,validateExpectedValues,StaticCorpusProbe} from './chinese_corpus_acceptance_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),frozen=path.join(root,'corpus/acceptance'),report=path.join(root,'reports/chinese-corpus-acceptance');
const reference=checkedJson(path.join(frozen,'reference.json')),evaluation=checkedJson(path.join(report,'evaluation.json')),summary=evaluation.summary;
const runtime=checkedJson(path.join(root,'outputs/corpus-mapping/runtime.json')),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log(`PASS ${name}`);};
check('Frozen answer files and original S3 Japanese reference retain their hashes',()=>{
  const manifest=checkedJson(path.join(frozen,'freeze-manifest.json'));
  for(const f of manifest.files)assert.equal(sha256(fs.readFileSync(path.join(frozen,f.local))),f.sha256);
  checkedJson(path.join(root,reference.policy.japaneseReference),reference.japaneseReferenceSha256);
  assert.throws(()=>checkedJson(path.join(frozen,'reference.json'),'0'.repeat(64)));
});
check('All 579 targets, 11 exclusions and 5 scope-negative images remain represented',()=>{
  assert.equal(reference.regions.length,590);assert.equal(reference.summary.targetRegions,579);
  assert.equal(reference.regions.filter(r=>r.action==='exclude_no_output').length,11);
  assert.equal(reference.scopeNegativeImages.length,5);
  assert.equal(new Set(reference.regions.map(r=>r.id)).size,590);
  assert.ok(reference.regions.every(r=>r.game===null));
});
check('Source-based semantic segmentation preserves dialogue windows and separates menu/grid items',()=>{
  const get=id=>reference.regions.find(r=>r.id===id);
  assert.equal(get('GBA-001-R01').units.length,1);
  assert.equal(get('GBA-018-R02').units.length,8);
  assert.equal(get('GBA-090-R04').units.length,4);
  assert.equal(get('GBA-027-R03').units.length,6);
  assert.equal(get('GBA-304-R06').units.length,1);
  assert.equal(reference.summary.units,778);assert.equal(reference.summary.translationUnits,770);
});
check('Only explicit truncations and pure name/value identities use legal raw retention',()=>{
  const raw=reference.regions.filter(r=>r.action!=='translate'&&r.action!=='exclude_no_output');
  assert.equal(raw.length,8);
  assert.deepEqual(raw.filter(r=>r.action==='retain_incomplete').map(r=>r.id).sort(),['GBA-079-R03','GBA-153-R03','GBA-175-R03','GBA-256-R01']);
  assert.ok(raw.filter(r=>r.action==='retain_name_or_translate').every(r=>r.regionType==='condition_identity'));
});
check('Independent Chinese expectations preserve numeric strings, leading zeros and displayed symbols',()=>{
  for(const r of reference.regions)for(const u of r.units)validateExpectedValues(u.japanese,u.expectedChinese,u.id);
  assert.deepEqual(dataValues('No03みずのはどう × 01'),['03','01']);
  assert.deepEqual(displaySymbols('HP 5/6 PP3/4 ♂ × 1 SEL EXP'),['HP','PP','♂','×','SEL','EXP']);
  assert.throws(()=>validateExpectedValues('HP 17/18','HP 18/18','wrong-current-value'));
  assert.throws(()=>validateExpectedValues('No03 × 1','No3 × 1','lost-leading-zero'));
});
check('Move-name digits are not confused with current PP or HP values',()=>{
  const text='10まんボルト PP15/15';
  assert.equal(visibleValues(text)[0].role,'lexical_move_name');assert.deepEqual(dataValues(text),['15','15']);
  validateExpectedValues(text,'十万伏特 PP15/15','move-name');
});
check('Layout projection never merges distinct numeric chunks or normalizes unknown glyphs',()=>{
  assert.equal(layoutKey('あめが　ふりはじめた！'),'あめがふりはじめた！');
  assert.notEqual(layoutKey('1 0'),layoutKey('10'));
  assert.notEqual(layoutKey('ＰＰ'),layoutKey('PP'));
  assert.notEqual(layoutKey('0'),layoutKey('O'));
});
check('Static probe requires complete Japanese values and does not predict a future prefix',()=>{
  const probe=new StaticCorpusProbe(runtime);
  assert.equal(probe.lookup('ピカチュウ').chinese,'皮卡丘');
  assert.equal(probe.lookup('ピカチュ').chinese,null);
  assert.equal(probe.lookup('こうかは ばつ').chinese,null);
  assert.equal(probe.lookup('ピカ�').chinese,null);
});
check('Conflicting normalized sources and unknown game keep all candidates without selecting the first',()=>{
  const probe=new StaticCorpusProbe({records:[
    {id:'r',game:'ruby',japanese:'甲 乙',chinese:'第一义'},
    {id:'s',game:'sapphire',japanese:'甲乙',chinese:'第二义'},
  ]});
  const both=probe.lookup('甲乙');assert.equal(both.chinese,null);assert.deepEqual(both.sources,['r','s']);
  assert.equal(probe.lookup('甲乙','ruby').chinese,'第一义');
  assert.equal(probe.lookup('甲乙','sapphire').chinese,'第二义');
});
check('Equal outputs retain duplicate provenance rather than discarding sources',()=>{
  const probe=new StaticCorpusProbe({records:[{id:'a',game:'ruby',japanese:'はい',chinese:'是'},{id:'b',game:'sapphire',japanese:'はい',chinese:'是'}]});
  assert.equal(probe.lookup('はい').chinese,'是');assert.deepEqual(probe.lookup('はい').sources,['a','b']);
});
check('A static numeric example cannot leak a previous value into a new input',()=>{
  const probe=new StaticCorpusProbe({records:[{id:'one',game:'ruby',japanese:'HP 17',chinese:'体力17'}]});
  assert.equal(probe.lookup('HP 17').chinese,'体力17');
  assert.equal(probe.lookup('HP 18').chinese,null);assert.equal(probe.lookup('HP 18').output,'HP 18');
});
check('Every available translation is supported by the formal pack, not a candidate or expected answer',()=>{
  const units=evaluation.regions.flatMap(r=>r.units).filter(u=>u.actualChinese!==null&&u.actualChinese!==undefined);
  assert.equal(units.length,25);
  const byId=new Map(runtime.records.map(r=>[r.id,r]));
  for(const u of units)for(const id of u.sourceIds) {
    const r=byId.get(id);assert.ok(r);assert.equal(layoutKey(r.japanese),layoutKey(u.japanese));assert.equal(r.chinese,u.actualChinese);
  }
  const predictions=checkedJson(path.join(report,'predictions.json'));
  assert.ok(predictions.units.every(u=>!Object.hasOwn(u,'expectedChinese')));
});
check('Output-bound semantic review accepts synonyms without changing the frozen answer',()=>{
  const judgments=checkedJson(path.join(frozen,'semantic-judgments.json'));
  assert.equal(judgments.length,4);
  for(const j of judgments)assert.equal(j.key,sha256(Buffer.from(JSON.stringify({japanese:j.japanese,expectedChinese:j.expectedChinese,actualChinese:j.actualChinese}))));
  assert.equal(summary.fixedSet.strictChineseMatches,12);assert.equal(summary.fixedSet.outputBoundEquivalentMatches,13);
  assert.equal(summary.fixedSet.pendingSemanticReviews,0);assert.equal(summary.fixedSet.publishedSemanticAccuracy.total,25);
});
check('Missing Chinese remains in the denominator and 100 percent on published items cannot pass coverage',()=>{
  const units=evaluation.regions.flatMap(r=>r.units),required=units.filter(u=>u.action==='translate');
  assert.equal(required.length,770);assert.equal(required.filter(u=>u.actualChinese===null).length,745);
  assert.equal(summary.fixedSet.publishedSemanticAccuracy.rate,1);assert.equal(summary.gatePassed,false);
  assert.equal(summary.fixedSet.translationCoverage.total,770);assert.ok(summary.fixedSet.translationCoverage.rate<0.04);
  const gaps=parseCsv(read(path.join(report,'coverage-gaps.csv')));assert.equal(gaps.length,745);
  assert.equal(Object.values(summary.byPlatform).reduce((n,p)=>n+p.translationCoverage.total,0),770);
});
check('Unexecuted pipeline, numeric binding and real-time behavior are not mislabeled as passed',()=>{
  assert.equal(summary.excludedChineseOutputChecks.executed,0);assert.equal(summary.negativeChineseOutputChecks.executed,0);
  assert.equal(summary.valueRetention.translatedUnits.total,0);assert.equal(summary.valueRetention.translatedUnits.rate,null);
  assert.equal(summary.finalA6Passed,false);assert.ok(summary.unexecutedRequirements.includes('完整中文延迟'));
  assert.equal(summary.annotationIndependence.blindIndependentAnnotator,false);
});
check('Supplemental contexts, slots, versions and observed-only semantic windows are retained',()=>{
  assert.equal(evaluation.scenarios.length,23);assert.equal(summary.supplementalScenarios.passed,9);
  assert.equal(summary.supplementalScenarios.participatesInFixedSetGate,false);
  assert.ok(evaluation.scenarios.filter(s=>['repeated_slot','numeric_binding','version','typed_homograph'].includes(s.category)).every(s=>!s.passed));
  assert.equal(evaluation.scenarios.find(s=>s.id==='ghost-unknown-context').passed,true);
  assert.equal(evaluation.scenarios.find(s=>s.id==='visible-only-rain-unit').prematureIndependentUnit,false);
});
check('Acceptance artifacts match their recorded resource and implementation hashes',()=>{
  const m=checkedJson(path.join(report,'run-manifest.json'));
  for(const f of m.implementation)assert.equal(sha256(fs.readFileSync(path.join(root,f.local))),f.sha256);
  for(const f of m.outputs)assert.equal(sha256(fs.readFileSync(path.join(report,f.file))),f.sha256);
  assert.equal(m.referenceSha256,sha256(fs.readFileSync(path.join(frozen,'reference.json'))));
  assert.equal(m.runtimeSha256,sha256(fs.readFileSync(path.join(root,'outputs/corpus-mapping/runtime.json'))));
});
check('Re-running the gate is deterministic and exits with failure for the incomplete library',()=>{
  const output='.tools/chinese-acceptance-test';
  const run=spawnSync(process.execPath,['tools/accept_chinese_corpus.mjs',output,'--gate'],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,2,run.stderr);
  const m=checkedJson(path.join(report,'run-manifest.json'));
  for(const f of [...m.outputs,{file:'run-manifest.json'}])assert.equal(sha256(fs.readFileSync(path.join(root,output,f.file))),sha256(fs.readFileSync(path.join(report,f.file))),f.file);
});
fs.writeFileSync(path.join(report,'checks.json'),JSON.stringify({passed:true,total:checks.length,checks,acceptanceGatePassed:summary.gatePassed,
  distinction:'Harness and evidence checks pass; the Chinese library coverage acceptance fails.'},null,2)+'\n');
console.log(`${checks.length} harness checks passed; Chinese library gate: FAILED as expected`);
