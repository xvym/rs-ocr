import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read,parseCsv,sha256} from './corpus_common.mjs';
import {compileSourceRecords,validateSourceRecords,sourcePrint} from './source_records.mjs';
const records=parseCsv(read('outputs/corpus-mapping/records.csv')),candidates=parseCsv(read('outputs/corpus-mapping/candidates.csv'));
const pack=JSON.parse(read('outputs/s6-corpus/runtime.json')),registration=JSON.parse(read('outputs/s6-corpus/source-registration.json'));
validateSourceRecords(pack.sourceRecords,records,candidates,registration.contexts);
assert.equal(registration.inventory.length,25410);
const pairs=new Set(registration.inventory.map(r=>r.qid+':'+r.game));assert.equal(pairs.size,25410);
assert.deepEqual(compileSourceRecords(records,candidates,[...pack.lexicon,...pack.units],registration.contexts),registration);
for(const game of ['ruby','sapphire']){
 const abilities=records.filter(r=>r.qid.startsWith('rs.common.ability_descriptions.'));
 assert.equal(abilities.length,78);
 for(const r of abilities)assert.ok([...pack.units,...pack.sourceRecords].some(p=>p.qid===r.qid&&p.game===game));
}
const qid='rs.script.fixture.complete';
const r={qid,japanese:'ぜんぶの\\nもじです',game:'both'},c={id:'original',qid,game:'ruby',chinese:'全部\\n文字。'};
const compiled=compileSourceRecords([r],[c]).records[0];assert.equal(compiled.matchText,'ぜんぶの\nもじです');assert.equal(compiled.chinese,c.chinese);assert.equal(compiled.outputText,'全部\n文字。');
assert.equal(compileSourceRecords([{...r,japanese:'[STR_VAR_1]のもじです'}],[c]).inventory[0].status,'unverified_variable_binding');
assert.equal(compileSourceRecords([r],[c,{...c,id:'other',chinese:'另一个原文'}]).inventory[0].status,'conflicting_original_candidates');
assert.equal(compileSourceRecords([{...r,qid:'rs.common.pokedex_entries^R.Dex_1'}],[{...c,qid:'rs.common.pokedex_entries^R.Dex_1'}]).inventory[0].status,'pokedex_page_alignment_required');
assert.equal(sourcePrint('原文[未知控制]','zh').reason,'unsupported_printing_control');
for(const field of ['outputText','matchText','chinese']){
 const changed=structuredClone(compiled);changed[field]+='额外文字';assert.throws(()=>validateSourceRecords([changed],[r],[c]));
}
const report={passed:true,inventoryRecords:pairs.size,registeredSourceRecords:pack.sourceRecords.length,allAbilityDescriptionsRegistered:true,originalChineseUnchanged:true,unknownBuffersAndControlsBlocked:true,conflictsAndPokedexPageAlignmentPreserved:true,reproducible:true,manifestSha256:sha256(fs.readFileSync('outputs/s6-corpus/build-manifest.json'))};
fs.mkdirSync('reports/runtime-registration',{recursive:true});fs.writeFileSync('reports/runtime-registration/source-checks.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
