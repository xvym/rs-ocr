import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256,csv,parseCsv} from './corpus_common.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]||'reports/model-translation-audit');
const inputs=[],rows=[];
function json(local){const b=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(b)});return JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));}
const pairKey=(sourceText,chinese)=>JSON.stringify([sourceText.replace(/\s/g,''),chinese]);
const runtime=json('outputs/s6-corpus/runtime.json');
const candidateLocal='outputs/corpus-mapping/candidates.csv',candidateBytes=fs.readFileSync(path.join(root,candidateLocal));inputs.push({local:candidateLocal,sha256:sha256(candidateBytes)});
const candidates=parseCsv(candidateBytes.toString('utf8'));
const runtimePairs=new Set([...runtime.lexicon,...runtime.units,...runtime.templates].map(r=>pairKey(r.japanese,r.chinese)));
function add(file,pointer,category,sourceText,chinese,{id=pointer,game='both',group='',note=''}={}){
  assert.equal(typeof chinese,'string');assert.ok(chinese.length);
  rows.push({id:'mt-'+sha256(Buffer.from(file+'\0'+pointer)).slice(0,20),file,pointer,sourceId:id,game,group,category,sourceText,chinese,note,
    runtimePairPresent:runtimePairs.has(pairKey(sourceText,chinese)),pairKey:pairKey(sourceText,chinese)});
}
const unchanged=(r)=>r.japanese===r.chinese;
const formatKey=s=>s.replace(/\\[nlpcr]/g,'').replace(/\[(?:延时|等待|提示音|音乐|调色板|擦除|文本色|背景色|阴影色|字景色|日文|英文)[^\]]*\]/g,'').replace(/\s/g,'').normalize('NFKC');

// Review tags do not imply authorship. Original retained terms and literal
// control/line-break cleanup are classified separately from newly written text.
const oldFile='corpus/reviews.json',old=json(oldFile);
old.forEach((r,i)=>{
  const category=r.action==='retain'?'copied_original_reviewed':r.action==='correct'&&formatKey(r.originalChinese)===formatKey(r.chinese)?'mechanical_formatting':'model_authored_resource';
  add(oldFile,`/${i}/chinese`,category,r.japanese,r.chinese,{id:r.qid,game:r.game,group:'v1_'+r.action,note:r.reason});
});

for(const file of ['corpus/s6/lexicon-reviews.json','corpus/s6/person-reviews.json']){
  json(file).records.forEach((r,i)=>{
    const category=r.action==='retain'||r.action==='typed_status_supplement'?'copied_original_reviewed':'model_authored_resource';
    if(category==='copied_original_reviewed'){
      const originals=r.originalCandidates?.length?r.originalCandidates:candidates.filter(c=>c.qid===r.qid&&c.game===r.game).map(c=>c.chinese);
      assert.ok(originals.includes(r.chinese),'Non-retained text misclassified as copy: '+r.qid);
    }
    add(file,`/records/${i}/chinese`,category,r.japanese,r.chinese,{id:r.id||r.qid,game:r.game,group:r.action,note:'Explicit retain is not model generation; typed status values already have identical original candidates. Supplemental complete names/terms are model-filled entries.'});
  });
}

const easyFile='corpus/s6/easy-chat-reviews.json',easy=json(easyFile);
// The actual authoring procedure copied 92 status terms from reviewed finite
// ability/type lexicons, with these 17 explicit Japanese-label overrides. The
// overrides and the other 906 literal word labels were authored by the model.
const statusOverrides=new Set(['いろ','いろちがい','うつくしい','うつくしさ','かしこい','かしこさ','かっこいい','かっこよさ','かわいい','かわいさ','ゴースト','タイプ','たくましい','たくましさ','ひかる','ポケルス','もよう']);
const lex=json('corpus/s6/lexicon-reviews.json').records;
let copiedStatus=0;
easy.records.forEach((r,i)=>{
  const copy=r.qid.includes('easy_chat_group_status.')&&!statusOverrides.has(r.japanese);
  if(copy){const choices=[...new Set(lex.filter(l=>l.japanese===r.japanese&&['ability','type'].includes(l.kind)).map(l=>l.chinese))];assert.deepEqual(choices,[r.chinese]);copiedStatus++;}
  const category=unchanged(r)?'literal_retention':copy?'copied_lexicon':'model_authored_resource';
  add(easyFile,`/records/${i}/chinese`,category,r.japanese,r.chinese,{id:r.qid,game:r.game,group:'easy_chat',note:copy?'Copied complete ability/type term, not independently generated.':'Directly authored label; may coincide with an existing RSC translation. Unchanged punctuation is retained, not translated.'});
});
assert.equal(copiedStatus,92);

for(const file of ['corpus/s6/visible-unit-reviews.json','corpus/s6/template-reviews.json','corpus/s6/tower-phrase-reviews.json']){
  json(file).records.forEach((r,i)=>{
    const category=unchanged(r)?'literal_retention':r.id.startsWith('availability-move:')?'mechanical_expansion':'model_authored_resource';
    add(file,`/records/${i}/chinese`,category,r.japanese,r.chinese,{id:r.id,game:r.game,group:path.basename(file,'.json')});
  });
}

const tvFile='corpus/s6/tv-page-reviews.json',tv=json(tvFile);
for(const field of ['units','pendingTemplates','nonPublishedPlaceholders'])tv[field].forEach((r,i)=>{
  add(tvFile,`/${field}/${i}/chinese`,'model_authored_resource',r.japanese,r.chinese,{id:r.id,game:r.game,group:'tv_'+field,note:field==='units'?'In resource pack; not live Java output.':'Not published: pending binding or unused placeholder.'});
});
assert.equal(tv.records.reduce((n,r)=>n+r.chinesePages.length,0),tv.units.length+tv.pendingTemplates.length+tv.nonPublishedPlaceholders.length);
// chinesePages is a second serialization of the same pages, not extra output.
tv.records.forEach((r,index)=>r.chinesePages.forEach((text,page)=>{
  const saved=[...tv.units,...tv.pendingTemplates,...tv.nonPublishedPlaceholders].find(x=>x.id===`tv-page-${index}-${page}`);
  assert.equal(saved?.chinese,text);
}));

const homoFile='corpus/s6/homograph-reviews.json',homo=json(homoFile);
for(const field of ['units','templates'])homo[field].forEach((r,i)=>add(homoFile,`/${field}/${i}/chinese`,unchanged(r)?'literal_retention':'model_authored_resource',r.japanese,r.chinese,{id:r.id,game:r.game,group:'homograph_pages'}));
for(const r of homo.records.filter(r=>r.decision)){
  const saved=[...homo.units,...homo.templates].filter(x=>x.game===r.game&&x.homographReference.japanese===r.japanese).sort((a,b)=>a.homographReference.page-b.homographReference.page);
  assert.deepEqual(saved.map(x=>x.chinese),r.decision);
}

const eventFile='corpus/s6/event-translations.json',events=json(eventFile);
for(const [key,text] of Object.entries(events.formats))add(eventFile,'/formats/'+key,'model_authored_resource','@event:'+key,text,{group:'event_formats',note:'Stored whole Chinese event format; no concrete names or amounts are invented.'});
for(const field of ['statNames','changes'])for(const [key,text] of Object.entries(events[field]))add(eventFile,`/${field}/${key}`,'model_authored_fragment',`@${field}:${key}`,text,{group:'event_fragments'});

const nameFile='corpus/s6/name-policy.json',name=json(nameFile);
for(const [jp,cn] of Object.entries(name.prefixDisplayConvention.prefixes))add(nameFile,'/prefixDisplayConvention/prefixes/'+jp,'model_authored_fragment',jp,cn,{group:'name_prefixes'});
const compFile='corpus/s6/composition-policy.json',comp=json(compFile);
for(const field of ['priceLabel','memoConnector'])add(compFile,`/${field}/chinese`,'model_authored_fragment',comp[field].japanese,comp[field].chinese,{group:'composition_fragments'});
for(const [key,value] of Object.entries(comp.saveCounters))add(compFile,`/saveCounters/${key}/chinese`,'model_authored_fragment',key+':'+value.japanese,value.chinese,{group:'composition_fragments'});
for(const field of ['fieldQualifiers','conditionTerms'])for(const [jp,cn] of Object.entries(comp[field]))add(compFile,`/${field}/${jp}`,'model_authored_fragment',jp,cn,{group:'composition_fragments'});

// All generated dictionary copies remain in the exhaustive ledger, but they
// are not counted a second time as new independent model translations.
runtime.lexicon.forEach((r,i)=>{if(r.method!=='model_reviewed')add('outputs/s6-corpus/runtime.json',`/lexicon/${i}/chinese`,'mechanical_expansion',r.japanese,r.chinese,{id:r.qid,game:r.game,group:r.kind,note:'Condition labels copied from saved policy, or colors composed by the builder.'});});
const builderLocal='tools/build_s6_corpus.mjs',builderBytes=fs.readFileSync(path.join(root,builderLocal));inputs.push({local:builderLocal,sha256:sha256(builderBytes)});
const builder=builderBytes.toString('utf8'),blockMatch=builder.match(/const blockTranslations=(\{[^;]+\});/);assert.ok(blockMatch);
const colors=Object.fromEntries([...blockMatch[1].matchAll(/'([^']+)':'([^']+)'/g)].map(m=>[m[1],m[2]]));assert.equal(Object.keys(colors).length,14);
for(const [jp,cn] of Object.entries(colors))add(builderLocal,'/blockTranslations/'+jp,'model_authored_fragment',jp,cn,{group:'block_color_fragments'});
assert.ok(builder.includes("blockTranslations[prefix]+'方块'"));add(builderLocal,'/blockSuffix','model_authored_fragment','ポロック','方块',{group:'block_color_fragments'});

// Count independent source annotations once, not all copied screenshot
// occurrences, segmented units, output judgments and generated HTML/CSV/JSON.
const referenceFile='corpus/acceptance/reference.json',reference=json(referenceFile);
reference.groups.forEach((g,i)=>{
  add(referenceFile,`/groups/${i}/expectedChinese`,g.action==='translate'?'model_authored_expected':'literal_retention',g.japanese,g.expectedChinese,{id:g.firstId,group:'frozen_annotation_group'});
});
reference.scenarios.forEach((s,i)=>{if(s.action==='translate')add('corpus/acceptance/scenarios.json',`/${i}/expectedChinese`,'model_authored_expected',s.japanese,s.expectedChinese,{id:s.id,group:'supplemental_scenario'});});
json('corpus/acceptance/scenarios.json');
// The sole separately authored repeat-slot grammar is a test sentence, never
// a reviewed game sentence. Other test expected strings repeat resource text.
const testLocal='tools/test_s6_corpus.mjs',testBytes=fs.readFileSync(path.join(root,testLocal));inputs.push({local:testLocal,sha256:sha256(testBytes)});
assert.ok(testBytes.toString('utf8').includes("japanese:'[name]は [name]に あいさつした！',chinese:'{name}向{name}打招呼！'"));
add(testLocal,'/syntheticRepeatedSlotGrammar','model_authored_test_only','[name]は [name]に あいさつした！','{name}向{name}打招呼！',{group:'synthetic_grammar'});
const oldTestLocal='tools/test_chinese_corpus_acceptance.mjs',oldTestBytes=fs.readFileSync(path.join(root,oldTestLocal));inputs.push({local:oldTestLocal,sha256:sha256(oldTestBytes)});
assert.ok(oldTestBytes.toString('utf8').includes("japanese:'HP 17',chinese:'体力17'"));
add(oldTestLocal,'/syntheticNumericTranslation','model_authored_test_only','HP 17','体力17',{group:'synthetic_numeric_translation'});
for(const [id,japanese,chinese,file] of [['conflict-a','テスト','甲',testLocal],['conflict-b','テスト','乙',testLocal],['mock-meaning-a','甲 乙','第一义',oldTestLocal],['mock-meaning-b','甲乙','第二义',oldTestLocal]])
  add(file,'/mock/'+id,'test_placeholder_not_translation',japanese,chinese,{group:'intentional_test_dummies',note:'Deliberately fake outputs to test conflict handling; not game translations.'});

for(const local of ['corpus/acceptance/semantic-judgments.json','corpus/s6/output-judgments.json']){
  const js=json(local);
  for(const j of js){assert.ok(rows.some(r=>r.chinese===j.expectedChinese)||reference.groups.some(g=>g.units.some(u=>u.expectedChinese===j.expectedChinese)));assert.ok(rows.some(r=>r.chinese===j.actualChinese)||runtime.units.some(r=>r.chinese===j.actualChinese)||local.includes('/s6/'));}
}
// Event/policy fragments are stored in named runtime objects rather than the
// ordinary Japanese/chinese pair arrays. Their location is verified separately.
for(const r of rows){
  if(r.file===eventFile)r.runtimePairPresent=true;
  if(r.file===nameFile||r.file===compFile)r.runtimePairPresent=true;
}

const authored=new Set(['model_authored_resource','model_authored_fragment','model_authored_expected','model_authored_test_only']);
const groupBy=(rs,key)=>Object.fromEntries([...new Set(rs.map(r=>r[key]))].sort().map(k=>[k,rs.filter(r=>r[key]===k).length]));
const primary=rows.filter(r=>authored.has(r.category));
function unique(rs){const groups=new Map();for(const r of rs){const group=groups.get(r.pairKey)||{id:'unique-'+sha256(Buffer.from(r.pairKey)).slice(0,20),sourceText:r.sourceText,chinese:r.chinese,categories:[],locations:[],runtimePairPresent:false};if(!group.categories.includes(r.category))group.categories.push(r.category);group.locations.push({file:r.file,pointer:r.pointer,id:r.sourceId,game:r.game});group.runtimePairPresent||=r.runtimePairPresent;groups.set(r.pairKey,group);}return [...groups.values()];}
const uniquePrimary=unique(primary),uniqueResource=unique(rows.filter(r=>r.category==='model_authored_resource')),uniqueFragments=unique(rows.filter(r=>r.category==='model_authored_fragment')),
 uniqueExpected=unique(rows.filter(r=>r.category==='model_authored_expected')),uniqueDerived=unique(rows.filter(r=>r.category==='mechanical_expansion'));
assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
assert.equal(rows.filter(r=>r.group==='template-reviews'&&r.category==='mechanical_expansion').length,354);
assert.equal(rows.filter(r=>r.group==='frozen_annotation_group'&&r.category==='model_authored_expected').length,384);
const categorySummary=Object.fromEntries([...new Set(rows.map(r=>r.category))].map(category=>{const rs=rows.filter(r=>r.category===category);return [category,{records:rs.length,uniquePairs:unique(rs).length}];}));
const snapshot=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
const summary={schemaVersion:1,snapshot,scope:'Current stored model-authored/modified game translation resources, previous v1 changes, fragments, pending pages and independently authored Chinese expectations. Not deleted historical drafts or generated display copies.',
 definition:'Authorship-based broad inventory, not a count of novel wording. Directly authored text remains included even if it happens to equal an RSC phrase. Explicit original retention, verified lexical copying and mechanical expansion are separately classified. model_reviewed alone is never used as proof of generation.',
 deduplication:'Exact Chinese plus Japanese/source key with whitespace removed; ignore game duplicates, preserve Chinese punctuation/width and slot names. Different contexts may contain the same words. Whole annotated regions and their segmented units are not added together.',
 directlyAuthored:{records:primary.length,uniquePairs:uniquePrimary.length,uniqueChineseStrings:new Set(primary.map(r=>r.chinese)).size,
  resourceUniquePairs:uniqueResource.length,resourceUniquePairsPresentInRuntime:uniqueResource.filter(r=>r.runtimePairPresent).length,resourceUniquePairsNotPresentInRuntime:uniqueResource.filter(r=>!r.runtimePairPresent).length,
  fragmentUniquePairs:uniqueFragments.length,expectedUniquePairs:uniqueExpected.length,testOnlyUniquePairs:unique(rows.filter(r=>r.category==='model_authored_test_only')).length,
  sumOfCategoryUniqueCounts:uniqueResource.length+uniqueFragments.length+uniqueExpected.length+unique(rows.filter(r=>r.category==='model_authored_test_only')).length},
 categories:categorySummary,byResourceGroup:groupBy(rows.filter(r=>r.category==='model_authored_resource'),'group'),
 derived:{records:rows.filter(r=>r.category==='mechanical_expansion').length,uniquePairs:uniqueDerived.length,additionalUniquePairsBeyondDirectAuthorship:uniqueDerived.filter(r=>!uniquePrimary.some(p=>p.id===r.id)).length,
  note:'354 preexpanded move forms plus 36 copied/composed dictionary records; not separately generated by an LLM for each displayed name/value.'},
 excludedCopies:{sourceRetainedAndCopiedRecords:rows.filter(r=>['copied_original_reviewed','copied_lexicon'].includes(r.category)).length,formatOnlyRecords:rows.filter(r=>r.category==='mechanical_formatting').length,literalRetentionRecords:rows.filter(r=>r.category==='literal_retention').length,
  additionalDuplicateContainers:['corpus/s6/tv-page-reviews.json: records[].chinesePages duplicate the 403 saved pages','corpus/s6/homograph-reviews.json: records[].decision duplicate units/templates','corpus/acceptance/annotations.mjs and reference.groups carry the same source expectations','reference.regions, predictions/evaluation, output-judgments, HTML/CSV reports and runtime copies do not represent new independent authorship']},
 limitations:['This is current stored text, not the unknowable number of all sampled/generated drafts.','No finding that each model-authored item was necessary, correct, independently reviewed, or originally missing from RSC.','A runtime pair means those text values are present; it does not approve every original source identity or Java/live output.','The prior 685 was a partial body-difference comparison, not total model authorship.']};
fs.mkdirSync(out,{recursive:true});
const save=(file,data)=>fs.writeFileSync(path.join(out,file),JSON.stringify(data,null,2)+'\n');
save('summary.json',summary);save('unique-translations.json',uniquePrimary);
fs.writeFileSync(path.join(out,'model-authored-translations.csv'),csv(uniquePrimary.map(r=>({id:r.id,categories:r.categories.join('|'),sourceText:r.sourceText,chinese:r.chinese,runtimePairPresent:r.runtimePairPresent,locations:r.locations.map(l=>l.file+'#'+l.pointer).join('\n')})),['id','categories','sourceText','chinese','runtimePairPresent','locations']));
const body=`当前仓库存留的大模型生成译文审计\n\n基线提交：${snapshot}\n统计范围：旧版语料、新S6资源、待核页、模板、中文片段及独立中文验收预期。\n不统计：已删除历史草稿、未保存的模型输出、复制的原汉化、核对说明、重复报告、原文保留、纯格式清理。\n\n直接编写/调整：${summary.directlyAuthored.records}条原始记录；跨文件及两作去重后${summary.directlyAuthored.uniquePairs}个条目；仅按中文字符串去重为${summary.directlyAuthored.uniqueChineseStrings}种文本。\n资源译文：${uniqueResource.length}个去重条目，其中${summary.directlyAuthored.resourceUniquePairsPresentInRuntime}项在当前S6包中出现同一文本对，${summary.directlyAuthored.resourceUniquePairsNotPresentInRuntime}项未出现。出现不等于批准所有来源或已接入Java。\n短片段：${uniqueFragments.length}个；验收预期：${uniqueExpected.length}个；专用构造测试句：${summary.directlyAuthored.testOnlyUniquePairs}个。分类有交叉，不可直接相加。\n机械派生：${summary.derived.records}条记录、${summary.derived.uniquePairs}个去重条目，单独列示，不冒充逐条大模型生成。\n\n“model_reviewed”不等于“模型生成”。本次按作者流程及明确动作分类；即使模型编写的中文恰好与原汉化一致，也仍在直接编写清单中。685是此前局部字面改写比较，不是本次全部生成数。\n去重键：来源日文/用途键（移除空白）＋完整中文，忽略两作重复；保留中文标点、宽度及模板槽名。不同粒度的整段预期与资源单元分开追踪，重复导出不重新计数。\n本审计不证明任何一项重译有必要、正确、原汉化缺失或经过独立人员复核。\n\nall-records.csv：完整分类、文件及定位、原日文/用途键、中文和资源出现状态。\nunique-translations.json：全部直接编写内容的去重条目和所有来源定位。\nsummary.json：分类汇总。manifest.json：固定输入与实现哈希。\n`;
fs.writeFileSync(path.join(out,'README.txt'),body);
fs.writeFileSync(path.join(out,'all-records.csv'),csv(rows.map(({pairKey,...r})=>r),['id','category','group','file','pointer','sourceId','game','sourceText','chinese','runtimePairPresent','note']));
save('manifest.json',{schemaVersion:1,inputs:[...new Map(inputs.map(i=>[i.local,i])).values()],implementation:{local:'tools/audit_model_translations.mjs',sha256:sha256(fs.readFileSync(fileURLToPath(import.meta.url)))},outputs:['summary.json','unique-translations.json','model-authored-translations.csv','all-records.csv','README.txt'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));
