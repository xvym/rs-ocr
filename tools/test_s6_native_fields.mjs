import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {validateNativeFields} from './s6_native_fields.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),json=p=>JSON.parse(fs.readFileSync(path.join(root,p))),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const pack=json('outputs/s6-corpus/visible-windows.json').nativeFields,{visibleProbe:probe}=loadS6Probe(root);
const lookup=(raw,type)=>probe.lookupUnit({raw,searchText:raw,kind:null},{type});
check('Met locations use the existing print sequence with original complete location terms and the original Met suffix',()=>{
 for(const [jp,zh] of [['101ばん どうろ','101号道路'],['104ばん どうろ','104号道路'],['118ばん どうろ','118号道路']]){
  const r=lookup(jp+'で であった','summary_memo');assert.equal(r.output,zh+'相遇。');assert.equal(r.nativeField,'memo_met_location');assert.ok(r.citations.every(c=>c.candidateId.startsWith('original-entry:')));
 }
});
check('Unknown locations, shortened location names and appended independent clauses stay raw without prior-location reuse',()=>{
 lookup('101ばん どうろで であった','summary_memo');for(const raw of ['102ばん どうろで であった','101ばんで であった','で であった','101ばん どうろで であった\nまたね'])assert.equal(lookup(raw,'summary_memo').chinese,null,raw);
});
check('Ribbon counts overwrite only the two original trailing zeroes with each current observed count and digit width',()=>{
 for(const value of ['1','2','99','５','１２']){const r=lookup('げんざい '+value+'こ','summary_ribbon');assert.equal(r.output,'奖章数: '+value);assert.equal(r.nativeValuesByGame.ruby.raw,value);assert.ok(r.citations.every(c=>c.quote==='奖章数: 00'));}
});
check('Zero, padded, signed, separated and out-of-range ribbon counts cannot acquire a guessed original format',()=>{
 for(const value of ['0','00','01','100','-1','1 2','1.5'])assert.equal(lookup('げんざい '+value+'こ','summary_ribbon').chinese,null,value);
 assert.equal(lookup('げんざい 1こ','summary_memo').chinese,null);
});
check('Remaining experience follows the original numeric-only caller while preserving currently observed digit widths',()=>{
 for(const value of ['0','2367','５','１２３４']){const r=lookup('あと '+value,'summary_experience');assert.equal(r.output,value);assert.equal(r.nativeValuesByGame.ruby.raw,value);assert.equal(r.citations.length,0);}
 for(const value of ['001','-1','1 2','1,000','1.5','１ ２'])assert.equal(lookup('あと '+value,'summary_experience').chinese,null,value);
});
check('Met levels use only the original marker, current visible level and source comma without adding Chinese connector text',()=>{
 for(const value of ['1','5','26','100','５','１００']){const r=lookup('Lv'+value+'のとき','summary_memo');assert.equal(r.output,'Lv'+value+',');assert.equal(r.nativeField,'memo_met_level');assert.equal(r.nativeValuesByGame.ruby.raw,value);assert.equal(r.citations.length,0);}
 for(const value of ['0','101','05','-1','1 2'])assert.equal(lookup('Lv'+value+'のとき','summary_memo').chinese,null,value);
 assert.equal(lookup('のとき','summary_memo').chinese,null);
});
check('All frozen native-field occurrences retain raw numeric evidence and reproduce their separately frozen original-format expectations',()=>{
 const reference=json('corpus/visible-windows/reference.json');let count=0;
 for(const region of reference.regions)for(const u of region.units.filter(u=>u.nativeField)){const r=probe.lookupUnit(u,{type:region.typeCandidates[0]});assert.equal(r.output,u.expectedOutput);assert.deepEqual(r.nativeValuesByGame,u.expectedNativeValuesByGame);assert.deepEqual(r.visibleFields,u.visibleFields);count++;}
 assert.equal(count,14);assert.equal(pack.fields.length,4);assert.ok(!('cases' in pack));
});
check('Changed original words, punctuation, source digests or unapproved printing operations reject the native pack',()=>{
 for(const change of [p=>p.fields[0].citations[0].quote+='x',p=>p.fields[0].source.japanese+='x',p=>p.fields[0].operation='new_chinese_template',p=>p.fields.find(f=>f.id==='memo_met_level').source.english='时',p=>p.sourceEntries[0].originalChinese+='x',p=>p.sources[0].commit='other']){const p=structuredClone(pack);change(p);assert.throws(()=>validateNativeFields(p));}
 assert.equal(pack.generatedChineseTemplates,0);
});
fs.writeFileSync(path.join(root,'reports/s6-visible-windows/native-field-checks.json'),JSON.stringify({passed:true,scope:'Existing original print callers, source literals and current numeric/location values',checks},null,2)+'\n');
console.log(`${checks.length} native-field checks passed`);
