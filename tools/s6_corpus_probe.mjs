import fs from 'node:fs';
import path from 'node:path';
import {read,sha256} from './corpus_common.mjs';
import {project} from './japanese_source_matcher.mjs';
import {POLICY,validateOriginalRows,displayOriginal} from './rsc_translation_policy.mjs';
import {validateRscCorrespondenceIndex} from './rsc_correspondence_index.mjs';
import {S6VisibleWindowProbe} from './s6_visible_windows.mjs';
const key=text=>project(text).key;
const applicable=(r,game)=>game==='both'||r.game==='both'||r.game===game;
export class S6CorpusProbe{
  constructor(pack){
    if(pack.schemaVersion!==3||pack.translationPolicy!==POLICY||['templates','events','compositionPolicy','namePolicy'].some(k=>k in pack))throw Error('RSC-only pack required; legacy model corpus rejected');
    if(pack.rscSources?.length!==6||pack.rscSources.some(s=>s.repository!=='UWorldGX/pkmn_rs_chn_rsc'||s.commit!=='f513cf437acca23d1a5882650ee3b148dc463a17'))throw Error('Pinned RSC source identities required');
    validateOriginalRows([...pack.lexicon,...pack.units],pack.candidates,pack.rscSources);
    this.pack=structuredClone(pack);this.index=new Map();
    for(const r of [...this.pack.lexicon,...this.pack.units]){const k=key(r.japanese),list=this.index.get(k)||[];list.push(r);this.index.set(k,list);}
  }
  lookup(raw,{game='both',kind=null}={}){
    const fallback=status=>({chinese:null,output:raw,status,sources:[],complete:false});
    if(typeof raw!=='string'||!raw.length||raw.length>1024||/[\\\[\]{}\uE000\uE001�]/.test(raw))return fallback('unknown_or_invalid_input');
    const rows=(this.index.get(key(raw))||[]).filter(r=>applicable(r,game)&&(!kind||r.kind===kind));
    if(!rows.length)return fallback('no_original_rsc_unit');
    const texts=[...new Set(rows.map(r=>r.chinese))];
    if(texts.length!==1)return fallback('original_rsc_context_required');
    const chinese=displayOriginal(texts[0]);
    if(chinese===null)return fallback('original_rsc_printing_rules_required');
    return {chinese,output:chinese,status:'original_rsc_available',sources:[...new Set(rows.map(r=>r.id))],candidateIds:[...new Set(rows.flatMap(r=>r.candidateIds))],complete:true};
  }
  lexical(raw,context={}){return this.lookup(raw,context);}
  name(raw,context={}){return this.lookup(raw,context).chinese??raw;}
}
export function loadS6Probe(root){
  const dir=path.join(root,'outputs/s6-corpus'),manifest=JSON.parse(read(path.join(dir,'build-manifest.json')));
  if(manifest.translationPolicy!==POLICY)throw Error('RSC-only manifest required');
  for(const f of manifest.outputs)if(sha256(fs.readFileSync(path.join(dir,f.file)))!==f.sha256)throw Error('Changed S6 artifact '+f.file);
  const pack=JSON.parse(read(path.join(dir,'runtime.json')));
  const correspondenceIndex=validateRscCorrespondenceIndex(JSON.parse(read(path.join(dir,'correspondences.json'))));
  const visibleWindows=JSON.parse(read(path.join(dir,'visible-windows.json')));
  return {pack,probe:new S6CorpusProbe(pack),manifest,correspondenceIndex,visibleProbe:new S6VisibleWindowProbe(visibleWindows)};
}
