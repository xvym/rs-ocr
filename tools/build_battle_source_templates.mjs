import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,read,sha256,csv} from './corpus_common.mjs';
import {parseSource} from './japanese_source_matcher.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]||'outputs/battle-source-matching');fs.mkdirSync(out,{recursive:true});
const inputs=[];
const input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
const rules=JSON.parse(input('corpus/battle-matching/rules.json'));
const evidence=JSON.parse(input('reports/battle-source-matching/japanese-evidence.json'));
for(const f of evidence.sourceInputs)if(sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error(`Printing evidence source changed: ${f.local}`);
if(evidence.roms.length!==2||evidence.roms.some(r=>r.movesChecked!==354))throw Error('Incomplete Japanese selector evidence');
if(JSON.stringify(rules.moveUse.particles)!==JSON.stringify(evidence.particleTextsByGroup)||JSON.stringify(rules.moveUse.suffixSources)!==JSON.stringify(evidence.suffixSourcesByGroup))throw Error('Rules do not match verified Japanese particle/suffix selection');
const records=parseCsv(input('outputs/corpus-mapping/records.csv'));
const build=JSON.parse(read(path.join(root,'outputs/corpus-mapping/build-manifest.json')));
if(inputs.at(-1).sha256!==build.outputs.find(f=>f.file==='records.csv').sha256)throw Error('Corpus records changed');
const byId=new Map(records.map(r=>[r.qid,r])),sources=new Map();
function source(id){const qid=id.startsWith('rs.')?id:rules.sourcePrefix+id,r=byId.get(qid);if(!r||!r.japanese||r.japanese==='[NULL]')throw Error(`Missing source ${qid}`);sources.set(qid,r);return r;}
const parsed=id=>{const r=source(id),p=parseSource(r.japanese);if(p.unsupported.length||p.pages.length!==1)throw Error(`Unsupported model source ${r.qid}`);return {record:r,text:p.pages[0].join('\n')};};
function parts(id,actors,finite={}){
  const {text}=parsed(id);return text.split(/(\uE000[^\uE001]+\uE001)/).filter(Boolean).map(value=>{
    if(!value.startsWith('\uE000'))return {type:'literal',text:value};
    const slot=value.slice(1,-1);
    if(actors[slot])return {type:'actor',slot,role:actors[slot]};
    if(finite[slot])return {type:'choice',slot,choices:finite[slot]};
    throw Error(`Untyped battle slot ${id}/${slot}`);
  });
}
const stats=rules.normalStatChange.stats.map(s=>({...s,qid:source(s.source).qid,text:source(s.source).japanese}));
const variants=[];
for(const stat of stats)for(const change of rules.normalStatChange.changes){
  const ids=change.delta>0?rules.normalStatChange.upSources:rules.normalStatChange.downSources;
  const qids=ids.map(id=>source(id).qid),actors={},literalChange=change.sources.map(s=>source(s).japanese).join('');
  const first=parsed(ids[0]);
  const actor=first.text.match(/^\uE000([^\uE001]+)\uE001/)[1];actors[actor]='subject';
  const p=parts(ids[0],actors,{
    B_BUFF1:[{text:stat.text,sourceQid:stat.qid}],B_BUFF2:[{text:literalChange,sourceQids:change.sources.map(s=>source(s).qid)}]
  }).map(p=>p.type==='choice'?{type:'literal',text:p.choices[0].text}:p);
  const sourceSlotMaps={};
  for(const id of ids){const current=parsed(id).text;const variable=current.match(/^\uE000([^\uE001]+)\uE001/)[1];
    if(current.replace(variable,actor)!==first.text)throw Error('Stat source variants differ beyond actor role');sourceSlotMaps[source(id).qid]={[actor]:variable};}
  variants.push({id:`stat:${stat.id}:${change.delta}`,family:'ordinary_stat_change',strategy:'preexpanded',sourceQids:qids,sourceSlotMaps,parts:p,
    meaning:{event:'stat_change',stat:stat.id,delta:change.delta,deltaBasis:'displayed_wording'},
    componentSources:[stat.qid,...change.sources.map(s=>source(s).qid)]});
}
const groups=evidence.groups;if(groups.length!==5||groups.at(-1).length)throw Error('Invalid move classification');
const moveGroup=new Map();for(const [group,ids] of groups.entries())for(const id of ids){if(moveGroup.has(id))throw Error('Duplicate classified move');moveGroup.set(id,group);}
const moveSource=source(rules.moveUse.source);
if(moveSource.japanese!=='[B_ATK_NAME_WITH_PREFIX][B_BUFF1]\\n[B_BUFF2]')throw Error('Move source template changed');
for(let id=rules.moveUse.firstMoveId;id<=rules.moveUse.lastMoveId;id++){
  const move=source(`rs.common.move_names.gMoveNames.${id}`),group=moveGroup.get(id)??4,suffix=source(rules.moveUse.suffixSources[group]);
  variants.push({id:`move:${id}`,family:'move_use',strategy:'preexpanded_from_verified_selector',sourceQids:[moveSource.qid],
    parts:[{type:'actor',slot:'B_ATK_NAME_WITH_PREFIX',role:'subject'},{type:'literal',text:rules.moveUse.particles[group]+'\n'+move.japanese+suffix.japanese}],
    meaning:{event:'move_use',moveId:id,moveQid:move.qid},componentSources:[move.qid,suffix.qid],
    generation:{classificationGroup:group,particle:rules.moveUse.particles[group],suffixQid:suffix.qid,
      sourceBufferValues:{B_BUFF1:rules.moveUse.particles[group],B_BUFF2:move.japanese+suffix.japanese},japaneseSelectorsVerified:true}});
}
for(const rule of rules.related){
  const finite={};
  for(const [slot,definition] of Object.entries(rule.finite||{})){
    if(definition==='stats')finite[slot]=stats.map(s=>({text:s.text,sourceQid:s.qid,meaning:{stat:s.id}}));
    else if(['items','trainer_classes','abilities'].includes(definition)){
      const prefix=definition==='items'?'rs.common.items.gItems.':definition==='abilities'?'rs.common.ability_names.gAbilityNames.':'rs.common.trainer_class_names.gTrainerClassNames.';
      finite[slot]=records.filter(r=>r.qid.startsWith(prefix)&&r.japanese&&r.japanese!=='[NULL]'&&!/[\[\\]/.test(r.japanese)).map(r=>{
        source(r.qid);return {text:r.japanese,sourceQid:r.qid,meaning:definition==='items'?{itemId:Number(r.qid.slice(prefix.length)),itemQid:r.qid}:definition==='abilities'?{abilityId:Number(r.qid.slice(prefix.length)),abilityQid:r.qid}:{trainerClassQid:r.qid}};
      });
    }else finite[slot]=definition.map(id=>{const ability=source(`rs.common.ability_names.gAbilityNames.${id}`);return {text:ability.japanese,sourceQid:ability.qid,meaning:{abilityId:id,abilityQid:ability.qid}};});
  }
  const {id,source:sourceName,event,actors,finite:_,...meaning}=rule;
  variants.push({id:`related:${id}`,family:'related_stat_message',strategy:'typed_regex',sourceQids:[source(sourceName).qid],
    parts:parts(sourceName,actors,finite),meaning:{event,...meaning,...(event==='stat_change'?{deltaBasis:'displayed_wording'}:{})},componentSources:Object.values(finite).flat().map(c=>c.sourceQid)});
}
const font=JSON.parse(input('src/main/resources/ocr/fonts.json'));
const frozen=JSON.parse(read(path.join(root,'reports/s3-acceptance/freeze-manifest.json')));
if(inputs.at(-1).sha256!==frozen.files['src/main/resources/ocr/fonts.json'])throw Error('Native glyph evidence changed');
const allowedActorCharacters=[...new Set(font.glyphs.filter(g=>g.font===3&&g.text.length===1&&!/[ \u3000\r\n�]/.test(g.text)).map(g=>g.text))].sort().join('');
const prefixes=rules.actor.prefixSources.map(id=>{const r=source(id);return {sourceQid:r.qid,text:r.japanese};});
const summary={ordinaryStatSurfaces:28,ordinaryStatSourceBindings:56,moveSurfaces:354,relatedTypedModels:rules.related.length,totalModels:variants.length,
 japaneseMovesVerifiedPerRom:354,roms:evidence.roms.map(r=>r.gameCode),releaseChinese:false};
const value={schemaVersion:1,id:rules.id,summary,actor:{...rules.actor,prefixes,allowedCharacters:allowedActorCharacters},
 sources:[...sources.values()],variants,printingEvidenceSha256:sha256(fs.readFileSync(path.join(root,'reports/battle-source-matching/japanese-evidence.json'))),
 releasePolicy:rules.releasePolicy};
const content=JSON.stringify(value,null,2)+'\n';fs.writeFileSync(path.join(out,'templates.json'),content);
const audit=csv(variants.map(v=>({id:v.id,family:v.family,strategy:v.strategy,
 japanese:v.parts.map(p=>p.type==='literal'?p.text:p.type==='actor'?`{${p.role}}`:`{${p.slot}: ${p.choices.map(c=>c.text).join(' | ')}}`).join(''),
 sourceQids:JSON.stringify(v.sourceQids),meaning:JSON.stringify(v.meaning),componentSourceQids:JSON.stringify(v.componentSources)})),['id','family','strategy','japanese','sourceQids','meaning','componentSourceQids']);
fs.writeFileSync(path.join(out,'templates.csv'),audit);
const implementations=['tools/build_battle_source_templates.mjs','tools/battle_source_matcher.mjs','tools/japanese_source_matcher.mjs','tools/corpus_common.mjs','tools/verify_battle_printing.py'];
fs.writeFileSync(path.join(out,'build-manifest.json'),JSON.stringify({schemaVersion:1,inputs,sourceInputs:evidence.sourceInputs,
 implementation:implementations.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
 outputs:[{file:'templates.json',sha256:sha256(Buffer.from(content))},{file:'templates.csv',sha256:sha256(Buffer.from(audit))}],summary},null,2)+'\n');
console.log(JSON.stringify(summary));
