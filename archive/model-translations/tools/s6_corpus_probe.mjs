import fs from 'node:fs';
import path from 'node:path';
import {read,sha256} from './corpus_common.mjs';
import {project,regionUnits,JapaneseSourceMatcher} from './japanese_source_matcher.mjs';
const key=s=>project(s,{display:true}).key;
const applicable=(r,game)=>game==='both'||!r.game||r.game==='both'||r.game===game;
const unique=a=>[...new Set(a)];
const apply=(format,values)=>{
  let complete=true;const output=format.replace(/\{([^}]+)\}/g,(_,slot)=>{if(values[slot]===undefined||values[slot]===null){complete=false;return '';}return String(values[slot]);});
  return complete?output:null;
};

// S6 resource-availability probe, with no session or identity memory. It never
// reads expected Chinese, frame IDs, masks or future observations.
export class S6CorpusProbe {
  constructor(pack,{matcher=null}={}){
    this.pack=pack;this.matcher=matcher;this.allowed=new Set(pack.allowedNameCharacters);
    this.lexicon=pack.lexicon;this.units=pack.units;
    this.lexByKey=new Map();this.unitsByKey=new Map();
    for(const [rows,index] of [[this.lexicon,this.lexByKey],[this.units,this.unitsByKey]])for(const r of rows){const k=key(r.japanese),list=index.get(k)||[];list.push(r);index.set(k,list);}
    this.templates=pack.templates.map(r=>({...r,tokens:project(r.japanese,{display:true}).key.split(/(\[[^\]]+\])/).filter(Boolean).map(s=>s.startsWith('[')?{slot:s.slice(1,-1)}:{literal:s})}));
  }
  lexical(raw,{game='both',kind=null}={}){
    const matches=(this.lexByKey.get(key(raw))||[]).filter(r=>applicable(r,game)&&(kind?r.kind===kind:!r.typedOnly));
    const outputs=unique(matches.map(r=>r.chinese));
    return {chinese:outputs.length===1?outputs[0]:null,conflict:outputs.length>1,sources:matches.map(r=>r.qid+':'+r.game)};
  }
  name(raw,{game='both',trainer=false,prefixDisplay=false}={}){
    for(const kind of this.pack.namePolicy.nicknamePriority){const hit=this.lexical(raw,{game,kind});if(hit.conflict)return raw;if(hit.chinese!==null)return hit.chinese;}
    if(trainer){
      const choices=[];
      for(const term of this.lexicon.filter(r=>r.kind==='trainer_class'&&applicable(r,game))){
        const prefix=key(term.japanese)+'の',p=project(raw,{display:true});
        if(!p.key.startsWith(prefix)||p.key.length<=prefix.length)continue;
        const rest=raw.slice(p.offsets[prefix.length]),translated=this.name(rest,{game});
        if(translated!==rest)choices.push(term.chinese+' '+translated);
      }
      if(unique(choices).length===1)return choices[0];
    }
    if(prefixDisplay){
      const p=project(raw,{display:true});
      for(const [japanese,chinese] of Object.entries(this.pack.namePolicy.prefixDisplayConvention.prefixes)){
        const prefix=key(japanese);if(!p.key.startsWith(prefix)||p.key.length<=prefix.length)continue;
        const rest=raw.slice(p.offsets[prefix.length]),translated=this.name(rest,{game});
        if(translated!==rest)return chinese+translated;
      }
    }
    return raw;
  }
  templateMatches(raw,{game='both',type=null}={}){
    const p=project(raw,{display:true}),results=[];let complete=true;
    for(const t of this.templates){
      if(t.types?.length&&!t.types.includes(type))continue;
      const solutions=[];let steps=0,overflow=false;
      const visit=(i,offset,bindings,values)=>{
        if(++steps>4096||solutions.length>=16){overflow=true;return;}
        if(i===t.tokens.length){if(offset===p.key.length){const chinese=apply(t.chinese,values);if(chinese!==null)solutions.push({chinese,bindings,sources:[t.id]});}return;}
        const token=t.tokens[i];if(token.literal){if(p.key.startsWith(token.literal,offset))visit(i+1,offset+token.literal.length,bindings,values);return;}
        const spec=t.slots[token.slot];
        for(let end=offset+1;end<=Math.min(p.key.length,offset+(spec.maxCharacters||16));end++){
          const next=t.tokens[i+1];if(next?.literal&&!p.key.startsWith(next.literal,end))continue;
          if(!next&&end!==p.key.length)continue;
          const startRaw=p.offsets[offset],endRaw=p.offsets[end-1]+1,value=raw.slice(startRaw,endRaw),normalized=p.key.slice(offset,end);
          if(/[\r\n]/.test(value)||value.includes('�'))continue;
          if(bindings[token.slot]&&bindings[token.slot].raw!==value)continue;
          let translated;
          if(spec.type==='name'){
            if([...normalized].some(c=>!this.allowed.has(c)))continue;
            translated=this.name(value,{game,trainer:spec.role==='trainer_display',prefixDisplay:spec.prefixDisplay});
          } else if(spec.type==='number'){
            if(!/^[0-9０-９]+$/.test(value))continue;translated=value;
          } else if(spec.type==='lexical'){
            translated=this.lexical(value,{game,kind:spec.kind}).chinese;if(translated===null)continue;
          } else if(spec.type==='enum'){
            if(spec.translations){const choice=Object.keys(spec.translations).find(c=>key(c)===normalized);if(!choice)continue;translated=spec.translations[choice];}
            else {if(!spec.choices.some(c=>key(c)===normalized))continue;translated=value;}
          } else throw Error('Unknown S6 slot kind');
          visit(i+1,end,{...bindings,[token.slot]:{raw:value,start:startRaw,end:endRaw,type:spec.type}},{...values,[token.slot]:translated});
          if(overflow)return;
        }
      };
      visit(0,0,{},{});complete&&=!overflow;results.push(...solutions);
    }
    return {results,complete};
  }
  event(raw,{game='both'}={}){
    if(!this.matcher)return null;
    const result=this.matcher.lookup(raw,{game}),resolution=result.semanticResolution;
    if(resolution.status!=='consistent')return null;
    const m=resolution.meaning,e=this.pack.events,v={};
    for(const [role,a] of Object.entries(m.actors))v[role]=this.name(a.raw,{game,trainer:role==='trainer',prefixDisplay:role!=='trainer'});
    for(const kind of ['move','item','ability'])if(m[kind+'Qid']){
      const terms=this.lexicon.filter(r=>r.qid===m[kind+'Qid']&&applicable(r,game));const values=unique(terms.map(r=>r.chinese));
      if(values.length!==1)return null;v[kind]=values[0];
    }
    // Keep the observed numeric spelling, including width, rather than rendering
    // the numeric meaning field and silently rewriting the user's value.
    for(const field of ['experienceAmount','moneyAmount','restoredAmount'])if(m[field]!==undefined){
      const observed=unique(result.candidates.flatMap(c=>c.bindings.filter(b=>b.semanticType==='displayed_decimal_number').map(b=>b.raw)));
      if(observed.length!==1)return null;v[field]=observed[0];
    }
    let format=m.event;
    if(m.event==='stat_change'){v.stat=e.statNames[m.stat];v.change=e.changes[m.delta];if(v.cause&&v.ability)format='stat_change_cause';}
    if(m.event==='stat_limit'){v.stat=e.statNames[m.stat]||'能力';format+='_'+m.limit;}
    if(m.event==='experience_gain'&&m.boostedWording)format+='_boosted';
    if(['send_out','send_out_intent'].includes(m.event)&&!v.trainer)format+='_without_trainer';
    if(!e.formats[format])return null;
    const chinese=apply(e.formats[format],v);return chinese===null?null:{chinese,sources:result.sourceQids,bindings:result.candidates.flatMap(c=>c.bindings),event:m.event};
  }
  lookup(raw,{game='both',kind=null,type=null,depth=0}={}){
    if(!kind&&type==='easy_chat')kind='easy_chat_word';
    const fallback=status=>({chinese:null,output:raw,status,sources:[],complete:false});
    if(typeof raw!=='string'||raw.length>1024||raw.includes('�')||/[\uE000\uE001]/.test(raw))return fallback('unknown_or_invalid_input');
    const direct=(this.unitsByKey.get(key(raw))||[]).filter(r=>applicable(r,game)&&(!r.kind||!kind||r.kind===kind)&&(!r.types?.length||r.types.includes(type)));
    let options=direct.map(r=>({chinese:r.chinese,sources:[r.id||r.qid]}));
    if(!options.length){const lexical=this.lexical(raw,{game,kind});if(lexical.conflict)return fallback('typed_lexical_conflict');if(lexical.chinese!==null)options.push(lexical);}
    const templated=this.templateMatches(raw,{game,type});if(!templated.complete)return fallback('template_search_incomplete');options.push(...templated.results);
    if(!options.length){const event=this.event(raw,{game});if(event)options.push(event);}
    const translations=unique(options.map(r=>r.chinese));
    if(translations.length>1)return fallback('substantive_resource_conflict');
    if(translations.length===1)return {chinese:translations[0],output:translations[0],status:'reviewed_unit_available',sources:unique(options.flatMap(r=>r.sources)),bindings:options.flatMap(r=>r.bindings||[]),complete:true};
    if(depth<2&&type){
      const units=regionUnits(raw,[type]);
      if(units.length>1||units[0]?.searchText!==raw){
        let output=raw,sources=[],changed=false;const replacements=[];
        for(const u of units){
          let child=this.lookup(u.searchText,{game,kind:u.kind,type,depth:depth+1});
          const nameOnly=type==='condition_identity'&&u.visibleFields.some(f=>f.role==='visible_gender');
          if(!child.complete&&nameOnly){const named=this.name(u.searchText,{game});child={complete:true,output:named,sources:[]};}
          if(!child.complete)return fallback('composition_component_unavailable');
          let rendered=u.raw;const at=rendered.indexOf(u.searchText);if(at<0)return fallback('composition_requires_explicit_rule');
          rendered=rendered.slice(0,at)+child.output+rendered.slice(at+u.searchText.length);
          if(u.visibleFields.some(f=>f.role==='grammatical_connector'&&f.raw===this.pack.compositionPolicy.memoConnector.japanese))rendered=this.pack.compositionPolicy.memoConnector.chinese+rendered.slice(1);
          if(u.visibleFields.some(f=>f.role==='price'))rendered=rendered.replace(/円$/,this.pack.compositionPolicy.priceLabel.chinese);
          for(const f of u.visibleFields.filter(f=>f.role==='field_qualifier'))if(this.pack.compositionPolicy.fieldQualifiers[f.raw])rendered=rendered.replace(f.raw,this.pack.compositionPolicy.fieldQualifiers[f.raw]);
          if(type==='save_summary'){
            const counter=this.pack.compositionPolicy.saveCounters[u.searchText];
            if(counter&&rendered.endsWith(counter.japanese))rendered=rendered.slice(0,-counter.japanese.length)+counter.chinese;
          }
          for(const f of u.visibleFields.filter(f=>['visible_original_trainer','visible_player_name'].includes(f.role)))rendered=rendered.replace(f.raw,this.name(f.raw,{game}));
          replacements.push({start:u.start,end:u.end,text:rendered});sources.push(...child.sources);changed||=rendered!==u.raw;
        }
        for(const r of replacements.sort((a,b)=>b.start-a.start))output=output.slice(0,r.start)+r.text+output.slice(r.end);
        if(changed)return {chinese:output,output,status:'reviewed_composition_available',sources:unique(sources),complete:true};
      }
    }
    return fallback('no_reviewed_current_unit');
  }
}
export function loadS6Probe(root){
  const manifest=JSON.parse(read(path.join(root,'outputs/s6-corpus/build-manifest.json')));
  for(const f of manifest.outputs)if(sha256(fs.readFileSync(path.join(root,'outputs/s6-corpus',f.file)))!==f.sha256)throw Error('Changed S6 artifact');
  const pack=JSON.parse(read(path.join(root,'outputs/s6-corpus/runtime.json')));
  const matcher=new JapaneseSourceMatcher(pack.sourceRecords,{battleTemplates:pack.sourceTemplates});
  return {pack,probe:new S6CorpusProbe(pack,{matcher}),manifest};
}
