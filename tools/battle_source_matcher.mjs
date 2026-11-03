const regexEscape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const charEscape=s=>s.replace(/[\\\]\[\-^]/g,'\\$&');

// Source definitions remain structured. Ordinary changes and move grammar are
// preexpanded by the builder; related messages use finite typed choices. All
// regexes are anchored, then bounded enumeration retains ambiguous bindings.
export class BattleSourceMatcher {
  constructor(pack,{records,project}){
    this.pack=pack;this.project=project;this.records=new Map(records.map(r=>[r.qid,r]));
    for(const r of pack.sources)if(this.records.get(r.qid)?.japanese!==r.japanese)throw Error(`Stale battle source ${r.qid}`);
    this.sourceQids=new Set(pack.variants.flatMap(v=>v.sourceQids));
    this.allowed=new Set([...pack.actor.allowedCharacters]);
    this.prefixes=pack.actor.prefixes.map(p=>({...p,key:project(p.text,{display:true}).key}));
    this.maxNickname=pack.actor.maxNicknameCharacters;
    this.maxActor=this.maxNickname+Math.max(0,...this.prefixes.map(p=>p.key.length));
    const actor=`[${charEscape(pack.actor.allowedCharacters)}]{1,${this.maxActor}}`;
    this.models=pack.variants.map(v=>{
      const tokens=v.parts.map(p=>p.type==='literal'?{...p,key:project(p.text,{display:true}).key,
        lineBreaks:[...p.text.matchAll(/\n/g)].map(m=>project(p.text.slice(0,m.index),{display:true}).key.length)}:p.type==='choice'?{...p,choices:p.choices.map(c=>({...c,key:project(c.text,{display:true}).key}))}:p);
      const pattern=tokens.map(t=>t.type==='literal'?regexEscape(t.key):t.type==='choice'?'(?:'+t.choices.map(c=>regexEscape(c.key)).join('|')+')':actor).join('');
      return {...v,tokens,regex:new RegExp('^(?:'+pattern+')$','u')};
    });
  }
  actorValue(key,projection,raw,start,end){
    if(!key||[...key].some(c=>!this.allowed.has(c)))return null;
    const prefix=this.prefixes.find(p=>key.startsWith(p.key)&&key.length>p.key.length);
    const nickname=prefix?key.slice(prefix.key.length):key;
    if(nickname.length>this.maxNickname)return null;
    const rawStart=projection.offsets[start],rawEnd=projection.offsets[end-1]+1;
    if(/[\r\n]/.test(raw.slice(rawStart,rawEnd)))return null;
    const nicknameStart=projection.offsets[start+(prefix?.key.length||0)];
    return {raw:raw.slice(rawStart,rawEnd),start:rawStart,end:rawEnd,
      nameRaw:raw.slice(nicknameStart,rawEnd),prefixRaw:prefix?raw.slice(rawStart,nicknameStart):'',
      prefixSourceQid:prefix?.sourceQid||null,prefixCouldBeNickname:Boolean(prefix&&key.length<=this.maxNickname),
      identityInferred:false,speciesInferred:false};
  }
  lookup(projection,raw){
    const hits=[];let complete=true;
    for(const model of this.models){
      if(!model.regex.test(projection.key))continue;
      const solutions=[];let steps=0,overflow=false;
      const visit=(index,offset,bindings,actors,typed,seen)=>{
        if(++steps>10000||solutions.length>=32){overflow=true;return;}
        if(index===model.tokens.length){if(offset===projection.key.length)solutions.push({bindings,actors,typed});return;}
        const token=model.tokens[index];
        if(token.type==='literal'){
          const breaksMatch=token.lineBreaks.every(n=>{
            const position=offset+n;if(position<=0||position>=projection.key.length)return false;
            return /[\r\n]/.test(raw.slice(projection.offsets[position-1]+1,projection.offsets[position]));
          });
          if(breaksMatch&&projection.key.startsWith(token.key,offset))visit(index+1,offset+token.key.length,bindings,actors,typed,seen);return;
        }
        if(token.type==='choice'){
          for(const choice of token.choices)if(projection.key.startsWith(choice.key,offset)){
            const start=projection.offsets[offset],end=projection.offsets[offset+choice.key.length-1]+1,value=raw.slice(start,end);
            if(/[\r\n]/.test(value))continue;
            if(seen.has(token.slot)&&seen.get(token.slot)!==value)continue;
            const nextSeen=new Map(seen);nextSeen.set(token.slot,value);
            visit(index+1,offset+choice.key.length,[...bindings,{slot:token.slot,raw:value,start,end,semanticType:'finite_source_term',sourceQid:choice.sourceQid,approvedForTranslation:false}],actors,{...typed,...choice.meaning},nextSeen);
          }
          return;
        }
        for(let end=offset+1;end<=Math.min(projection.key.length,offset+this.maxActor);end++){
          const key=projection.key.slice(offset,end),actor=this.actorValue(key,projection,raw,offset,end);if(!actor)continue;
          if(seen.has(token.slot)&&seen.get(token.slot)!==actor.raw)continue;
          const nextSeen=new Map(seen);nextSeen.set(token.slot,actor.raw);
          visit(index+1,end,[...bindings,{slot:token.slot,raw:actor.raw,normalized:key,start:actor.start,end:actor.end,semanticType:'observed_battle_actor',completeness:'whole_input_anchored',approvedForTranslation:false}],{...actors,[token.role]:actor},typed,nextSeen);
          if(overflow)return;
        }
      };
      visit(0,0,[],{},{},new Map());complete&&=!overflow;
      for(const s of solutions)for(const qid of model.sourceQids){
        const slotMap=model.sourceSlotMaps?.[qid]||{};
        hits.push({record:{...this.records.get(qid),kind:'battle',controls:[]},mode:'battle_composed',names:s.bindings.map(b=>b.slot),
          bindings:s.bindings.map(b=>({...b,slot:slotMap[b.slot]||b.slot})),page:0,lineStart:0,lineCount:raw.split('\n').length,
          sourceForm:model.strategy,modelId:model.id,componentSourceQids:model.componentSources,
          generation:model.generation,bindingSearchComplete:!overflow,bindingInterpretations:solutions.length,
          meaning:{...model.meaning,...s.typed,actors:s.actors},displayProjection:false});
      }
    }
    return {hits,complete};
  }
}

// Script identities can differ while the observed meaning is identical. Never
// choose the first match. Extra untyped candidates keep semantic status unknown.
export function battleMeaningConsensus(candidates,{searchComplete=true}={}){
  const structured=candidates.filter(c=>c.meaning);
  if(!structured.length)return {status:'not_applicable',meaning:null};
  if(!searchComplete||structured.length!==candidates.length)return {status:'incomplete',meaning:null};
  const meanings=new Map();
  for(const c of structured){
    const actors=Object.fromEntries(Object.entries(c.meaning.actors).sort(([a],[b])=>a.localeCompare(b)).map(([role,a])=>[role,a.raw]));
    const {actors:_,...fields}=c.meaning,key=JSON.stringify({fields:Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b))),actors});
    meanings.set(key,c.meaning);
  }
  return meanings.size===1?{status:'consistent',meaning:[...meanings.values()][0],sourceQids:[...new Set(candidates.map(c=>c.qid))]}:
    {status:'conflict',meaning:null,alternatives:[...meanings.values()]};
}
