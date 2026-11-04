import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,read} from './corpus_common.mjs';
import {checkedJson,visibleValues,displaySymbols,validateExpectedValues} from './chinese_corpus_acceptance_common.mjs';
import {annotations} from '../corpus/acceptance/annotations.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'corpus/acceptance'),policy=checkedJson(path.join(dir,'policy.json'));
const source=checkedJson(path.join(root,policy.japaneseReference),policy.japaneseReferenceSha256);
const active=source.regions.filter(r=>r.recognition_in_scope),groups=new Map();
for(const r of active) {
  const key=r.region_type+'\0'+r.text;
  const entry=groups.get(key)||{firstId:r.instance_id,type:r.region_type,japanese:r.text,regionIds:[]};
  entry.regionIds.push(r.instance_id);groups.set(key,entry);
}
if(active.length!==579||groups.size!==389||Object.keys(annotations).length!==389)throw Error('Reference denominator changed');
const bindings=text=>{
  const names=['ハルカ','ジーク','ユウキ','マユミ','カゼノ','ラグラージ','カイオーガ','レックウザ','ボスゴドラ','ヘラクロス','ケムッソ','グラエナ','ノクタス','サメハダー','アブソル','ダーテング','サマヨール','ジュペッタ','ヤミラミ','ジグザグマ','エネコロロ'];
  return names.flatMap(raw=>[...text.matchAll(new RegExp(raw,'g'))].map(m=>({raw,start:m.index,end:m.index+raw.length,rule:'whole_visible_name_lookup_or_preserve; no identity inference'}))).sort((a,b)=>a.start-b.start);
};
const groupRows=[];
for(const g of groups.values()) {
  const annotation=annotations[g.firstId];
  if(!annotation)throw Error(`Missing annotation: ${g.firstId}`);
  const action=typeof annotation==='string'?'translate':annotation.action;
  const chinese=typeof annotation==='string'?annotation:g.japanese;
  if(!['translate','retain_incomplete','retain_name_or_translate'].includes(action))throw Error(`Invalid action: ${g.firstId}`);
  validateExpectedValues(g.japanese,chinese,g.firstId);
  let unitPairs=[[g.japanese,chinese]];
  if(policy.segmentation.rowwiseTypes.includes(g.type)||policy.segmentation.gridTypes.includes(g.type)) {
    const japaneseRows=g.japanese.split('\n'),chineseRows=chinese.split('\n');
    if(japaneseRows.length!==chineseRows.length)throw Error(`Menu rows differ: ${g.firstId}`);
    unitPairs=japaneseRows.flatMap((ja,i)=>{
      if(!policy.segmentation.gridTypes.includes(g.type))return [[ja,chineseRows[i]]];
      const a=ja.split(/[ \u3000]+/),b=chineseRows[i].split(/[ \u3000]+/);
      if(a.length!==b.length)throw Error(`Grid width differs: ${g.firstId}`);
      return a.map((s,j)=>[s,b[j]]);
    });
  }
  groupRows.push({...g,action,expectedChinese:chinese,reason:typeof annotation==='string'?'Translate only the currently visible meaning.':annotation.reason,
    units:unitPairs.map(([ja,zh],i)=>{
      validateExpectedValues(ja,zh,`${g.firstId}:${i}`);
      return {index:i+1,japanese:ja,expectedChinese:zh,action,values:visibleValues(ja),symbols:displaySymbols(ja),requiredBindings:bindings(ja),semanticBound:'current_visible_unit_only'};
    })});
}
const byKey=new Map(groupRows.map(g=>[g.type+'\0'+g.japanese,g]));
const regions=source.regions.map(r=>{
  const common={id:r.instance_id,imageId:r.image_id,platform:r.platform,source:r.source,sourceSha256:r.source_sha256,
    crop:r.crop,regionType:r.region_type,japanese:r.text,game:null};
  if(!r.recognition_in_scope)return {...common,action:'exclude_no_output',reason:r.recognition_exclusion_reason||r.target_text_visibility_reason,units:[]};
  const g=byKey.get(r.region_type+'\0'+r.text);
  return {...common,action:g.action,expectedChinese:g.expectedChinese,reason:g.reason,annotationGroup:g.firstId,
    units:g.units.map(u=>({...u,id:`${r.instance_id}:U${u.index}`}))};
});
const scenarios=checkedJson(path.join(dir,'scenarios.json'));
if(new Set(scenarios.map(s=>s.id)).size!==scenarios.length)throw Error('Duplicate scenarios');
for(const s of scenarios)if(s.action==='translate')validateExpectedValues(s.japanese,s.expectedChinese,s.id);
const reference={schemaVersion:1,id:policy.id,date:policy.date,status:'frozen_model_authored_non_blind',policy,
  japaneseReferenceSha256:policy.japaneseReferenceSha256,
  groups:groupRows,regions,scopeNegativeImages:source.images.filter(i=>i.scope_negative_approved).map(i=>({id:i.id,source:i.source,sha256:i.sha256})),scenarios,
  summary:{images:source.images.length,targetRegions:active.length,excludedRegions:regions.filter(r=>r.action==='exclude_no_output').length,
    annotationGroups:groupRows.length,units:regions.flatMap(r=>r.units).length,translationUnits:regions.flatMap(r=>r.units).filter(u=>u.action==='translate').length,
    legalRawUnits:regions.flatMap(r=>r.units).filter(u=>u.action!=='translate').length,scenarios:scenarios.length}};
if(process.argv.includes('--draft')) {
  fs.writeFileSync(path.join(root,'.tools/chinese-acceptance-draft.json'),JSON.stringify(reference,null,2)+'\n');
  console.log(JSON.stringify(reference.summary,null,2));
  process.exit(0);
}
const review=checkedJson(path.join(dir,'annotation-review.json'));
if(review.method!=='same_model_second_pass'||review.groupsReviewed!==389||review.issuesUnresolved!==0)throw Error('Annotation second review incomplete');
const annotationHash=sha256(fs.readFileSync(path.join(dir,'annotations.mjs')));
if(review.annotationsSha256!==annotationHash)throw Error('Annotation review is stale');
const bytes=Buffer.from(JSON.stringify(reference,null,2)+'\n'),file=path.join(dir,'reference.json');
if(fs.existsSync(file)&&sha256(fs.readFileSync(file))!==sha256(bytes))throw Error('Refusing to overwrite a different frozen reference; create a new policy/version');
fs.writeFileSync(file,bytes);
const files=['policy.json','annotations.mjs','annotation-review.json','scenarios.json','reference.json'];
const manifest={schemaVersion:1,id:policy.id,japaneseReferenceSha256:policy.japaneseReferenceSha256,
  files:files.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(dir,local)))}))};
const manifestFile=path.join(dir,'freeze-manifest.json'),manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
if(fs.existsSync(manifestFile)&&sha256(fs.readFileSync(manifestFile))!==sha256(manifestBytes))throw Error('Frozen manifest differs');
fs.writeFileSync(manifestFile,manifestBytes);
console.log(JSON.stringify({...reference.summary,referenceSha256:sha256(bytes)},null,2));
