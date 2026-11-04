import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read} from './corpus_common.mjs';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {S6VisibleWindowProbe} from './s6_visible_windows.mjs';
import {validateVariableBindings,renderBoundOriginal} from './s6_variable_bindings.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),json=p=>JSON.parse(read(path.join(root,p))),checks=[];
const check=(name,fn)=>{fn();checks.push({name,passed:true});console.log('PASS '+name);};
const reference=json('corpus/visible-windows/reference.json'),compiled=json('outputs/s6-corpus/visible-windows.json'),pack=compiled.variableBindings,{visibleProbe:probe}=loadS6Probe(root);
const fixtures=reference.regions.flatMap(r=>r.units.map(u=>({...u,type:r.typeCandidates[0]}))),fixture=id=>fixtures.find(u=>u.decisionId===id);
function lookup(raw,type='field_dialog',game='both'){return probe.lookupUnit({raw,searchText:raw,kind:null},{type,game});}
function changed(id,from,to){const f=fixture(id);return lookup(f.searchText.replaceAll(from,to),f.type);}
const pcQuote=pack.contracts.find(f=>f.id==='pc_boot').citations.find(c=>c.game==='ruby').quote;
check('PC boot uses the unchanged original PLAYER template and the current visible name without identity setup',()=>{
 const f=fixture('W012');for(const name of ['ハルカ','ユウキ','ABCDE','アカネ']){const raw=f.raw.replace('ハルカ',name),r=lookup(raw);assert.equal(r.output,pcQuote.replace('[玩家]',name));assert.equal(r.familyId,'pc_boot');assert.equal(r.bindingsByGame.ruby['[玩家]'].raw,name);}
 assert.equal(lookup(f.raw).output,pcQuote.replace('[玩家]','ハルカ'));
});
check('Incomplete boot text, long or broken names, appended events, placeholder injection and wrong layouts remain raw',()=>{
 const f=fixture('W012');for(const raw of [f.raw.slice(0,-1),f.raw+'\nまたね！',f.raw.replace('ハルカ','ABCDEF'),f.raw.replace('ハルカ','ハル\nカ'),f.raw.replace('ハルカ','[PLAYER]'),f.raw.replace('ハルカ','�')]){const r=lookup(raw);assert.equal(r.chinese,null,raw);assert.equal(r.output,raw);}
 assert.equal(lookup(f.raw,'bag_description').chinese,null);
});
check('PC ownership, player house, party actions and honorifics reuse only their original source-scoped tokens',()=>{
 for(const id of ['W015','W130','W175','W146','W313','W360','W484']){const f=fixture(id),r=lookup(f.raw,f.type);assert.equal(r.chinese,f.expectedChinese);assert.deepEqual(r.bindingsByGame,f.expectedBindingsByGame);}
 assert.equal(changed('W146','ちゃん','くん').bindingsByGame.ruby['[占位符]'].value,'くん');
 assert.equal(changed('W146','ちゃん','せんせい').chinese,null);
});
check('Rival helping their father uses the unchanged original localized help-and-affection unit and only the current rival name',()=>{
 const f=fixture('W145'),family=pack.contracts.find(f=>f.id==='rival_help_father');
 assert.equal(family.semanticReview.chineseRewritten,false);assert.equal(family.semanticReview.sharedAction.helper,'current RIVAL');
 for(const name of ['ユウキ','ハルカ','ABCDE']){
  const r=lookup(f.raw.replace('ユウキ',name),f.type);assert.equal(r.output,'他喜欢让'+name+'帮他的忙。\n\n两人的感情很要好呢。');assert.equal(r.familyId,family.id);assert.equal(r.bindingsByGame.ruby['[对手]'].raw,name);
  assert.ok(r.citations.every(c=>c.sourceLine===614&&!c.quote.includes('栖息')&&c.quote.includes('[对手]')));assert.ok(!r.output.includes('栖息'));
 }
 for(const raw of [f.raw.replace('ユウキ',''),f.raw.replace('ユウキ','ABCDEF'),f.raw.replace('ユウキ','ユウ\nキ'),f.raw.replace('おてつだい','おたたかい'),f.raw+'\nまたね！'])assert.equal(lookup(raw,f.type).chinese,null,raw);
 assert.equal(lookup(f.raw,'battle_message').chinese,null);assert.equal(lookup(f.raw,f.type).chinese,f.expectedChinese);
});
check('Current HP recipient and amount are rebound on every call, including observed digit width',()=>{
 const f=fixture('W275');for(const [name,amount] of [['レックウザ','91'],['ポチ','５'],['カイオーガ','0']]){
  const r=lookup(f.raw.replace('カイオーガ',name).replace('17',amount),f.type),values=r.bindingsByGame.ruby;assert.equal(values['[buffer1]'].value,name);assert.equal(values['[buffer2]'].value,amount);
 }
 for(const amount of ['-1','1 7','017','100000','17.5'])assert.equal(changed('W275','17',amount).chinese,null,amount);
});
check('The same RSC token label has different reviewed roles for PC, move use, switch intent and normal experience',()=>{
 const r=id=>{const f=fixture(id);return lookup(f.raw,f.type);};
 assert.equal(r('W012').bindingsByGame.ruby['[玩家]'].sourceSlot,'PLAYER');
 assert.ok(r('W156').bindingsByGame.ruby['[玩家]'].citations.every(c=>c.qid==='rs.common.move_names.gMoveNames.341'));
 assert.equal(r('W240').bindingsByGame.ruby['[玩家]'].sourceSlot,'B_BUFF2');
 assert.equal(r('W159').bindingsByGame.ruby['[玩家]'].value,'');
});
check('Moves and ordinary stat changes fill original buffers with source-backed complete terms, not generated phrases',()=>{
 for(const id of ['W156','W160','W163','W165','W161','W166','W167','W317']){const f=fixture(id),r=lookup(f.raw,f.type);assert.equal(r.chinese,f.expectedChinese);assert.deepEqual(r.bindingsByGame,f.expectedBindingsByGame);}
 const move=changed('W156','ラグラージ','ポチ');assert.equal(move.bindingsByGame.ruby['[LegendPokemon1]'].value,'ポチ');assert.equal(move.bindingsByGame.ruby['[玩家]'].value,fixture('W156').expectedBindingsByGame.ruby['[玩家]'].value);
 assert.equal(changed('W161','さがった','ぐーんと さがった').chinese,null);
 assert.equal(changed('W156','マッドショット','マッドショッ').chinese,null);
});
check('Normal experience binds actor, verified empty modifier and current displayed amount across the Japanese/English buffer difference',()=>{
 for(const id of ['W159','W239','W245','W248','W253','W281','W292','W304']){const f=fixture(id),r=lookup(f.raw,f.type);assert.equal(r.chinese,f.expectedChinese);assert.equal(r.bindingsByGame.ruby['[玩家]'].value,'');}
 const r=changed('W159','15','１５');assert.equal(r.bindingsByGame.ruby['\\v\\h2A'].value,'１５');
 const f=fixture('W159');assert.equal(lookup(f.raw.replace('は\n','は おおめに\n'),f.type).chinese,null);
});
check('Switch intent cannot publish the following question and the question cannot reuse an earlier actor or species',()=>{
 const intent=fixture('W240'),question=fixture('W241'),a=lookup(intent.raw,intent.type),b=lookup(question.raw,question.type);
 assert.equal(a.chinese,intent.expectedChinese);assert.equal(b.chinese,question.expectedChinese);assert.ok(!a.output.includes(b.output));
 assert.equal(changed('W241','ハルカ','ユウキ').bindingsByGame.ruby['\\v\\h20'].value,'ユウキ');
 assert.ok(a.citations.every(c=>c.span[1]<b.citations.find(b=>b.game===c.game).span[0]));
});
check('Trainer class boundaries, distinct actors and ability call-site constraints are preserved',()=>{
 for(const id of ['W229','W230','W232','W261','W272','W278','W284','W305']){const f=fixture(id);assert.equal(lookup(f.raw,f.type).chinese,f.expectedChinese);}
 assert.equal(changed('W164','あめふらし','もうか').chinese,null);
 const f=fixture('W232'),r=lookup(f.raw.replace('カイオーガ','レックウザ'),f.type);assert.equal(r.bindingsByGame.ruby['[LegendPokemon2]'].value,'レックウザ');assert.equal(r.bindingsByGame.ruby['\\v\\h10'].raw,'あいての グラエナ');
});
check('Fainting, status, recall, catching and item use keep literal original templates and current actor labels',()=>{
 for(const id of ['W158','W179','W250','W256','W274','W279','W287','W289','W296','W299','W301','W302','W314','W318']){const f=fixture(id);assert.equal(lookup(f.raw,f.type).chinese,f.expectedChinese,id);}
 const f=fixture('W314'),r=lookup(f.raw,f.type);assert.equal(r.bindingsByGame.ruby['\\v\\h20'].value,'ハルカ');assert.ok(r.bindingsByGame.ruby['\\v\\h13'].citations.every(c=>c.qid==='rs.common.items.gItems.3'));
 assert.ok(!r.output.includes(fixture('W275').expectedChinese));
});
check('Reviewed same-event wording chooses an unchanged original variant; unreviewed version conflicts still remain raw',()=>{
 const f=fixture('W154'),r=lookup(f.raw,f.type);assert.equal(r.chinese,f.expectedChineseByGame.ruby);assert.equal(r.originalWordingSelection,'ruby');assert.equal(new Set(r.citations.map(c=>c.game)).size,2);
 for(const game of ['ruby','sapphire'])assert.equal(lookup(f.raw,f.type,game).chinese,f.expectedChineseByGame[game]);
 assert.notEqual(f.expectedChineseByGame.ruby,f.expectedChineseByGame.sapphire);
 const p=structuredClone(compiled);delete p.variableBindings.contracts.find(f=>f.id==='wild_encounter').equivalentWording;assert.equal(new S6VisibleWindowProbe(p).lookupUnit(f,{type:f.type}).chinese,null);
});
check('Original quote, token mapping, component witnesses and Japanese-source tampering are rejected or fail closed',()=>{
 for(const change of [p=>p.contracts[0].citations[0].quote+='x',p=>p.terms[0].chinese+='x',p=>Object.values(p.contracts[0].bindings)[0].from='new_sentence',p=>p.matcherRecords.find(r=>r.qid===p.contracts[0].qid).japanese+='x']){const p=structuredClone(pack);change(p);assert.throws(()=>validateVariableBindings(p));}
 const p=structuredClone(compiled);p.variableBindings.contracts.find(f=>f.id==='pc_boot').bindings['[玩家]'].slot='B_DEF_NAME_WITH_PREFIX';const blocked=new S6VisibleWindowProbe(p),f=fixture('W012');assert.equal(blocked.lookupUnit(f,{type:f.type}).chinese,null);
 assert.equal(renderBoundOriginal(pcQuote,{'[玩家]':'$&[buffer1]'}),pcQuote.replace('[玩家]',()=>'$&[buffer1]'));
 assert.throws(()=>renderBoundOriginal('[等待按键]',{'[等待按键]':'X'}));assert.throws(()=>renderBoundOriginal('\\v\\hFF',{'\\v\\hFF':'X'}));
});
check('All 101 former variable fallback cases have explicit outcomes and no generic variable blocker remains',()=>{
 const audit=json('reports/s6-visible-windows/variable-binding-audit.json'),summary=json('reports/s6-visible-windows/summary.json');assert.equal(audit.uniqueCases,101);assert.equal(audit.occurrences,134);assert.equal(audit.originalTemplateOutputOccurrences,134);assert.equal(audit.retainedOccurrences,0);
 assert.equal(summary.approvedOriginalTemplateFamilies,43);assert.equal(summary.generatedChineseTemplates,0);assert.ok(!Object.hasOwn(summary.fallbackReasons,'variable_printing_unverified'));
 const pc=audit.cases.find(c=>c.decisionId==='W012');assert.equal(pc.occurrences.length,2);assert.ok(pc.occurrences.every(o=>o.chinese!==null&&o.passed));
});
fs.writeFileSync(path.join(root,'reports/s6-visible-windows/variable-binding-checks.json'),JSON.stringify({passed:true,scope:'Original template binding, current-value isolation, version/source boundaries and complete former-variable audit',checks},null,2)+'\n');
console.log(`${checks.length} original-variable checks passed`);
