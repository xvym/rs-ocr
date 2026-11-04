import {read,sha256} from './corpus_common.mjs';
import fs from 'node:fs';
import path from 'node:path';
export const POLICY='rsc-original-only-v1';
export function loadPolicy(root){
  const policy=JSON.parse(read(path.join(root,'corpus/translation-policy.json')));
  if(policy.id!==POLICY||policy.generatedChineseAllowed!==false||policy.wordingChangesAllowed!==false||policy.sourceSelection!=='unique_original_rsc_text'||policy.semanticDifferenceFallback!==false)throw Error('RSC-only unique-source policy required');
  const sources=JSON.parse(read(path.join(root,'corpus/sources.json'))).sources.filter(s=>s.repository===policy.repository&&s.commit===policy.commit);
  if(sources.length!==6)throw Error('Missing pinned RSC sources');
  return {policy,sources};
}
export function verifyManifest(root,directory){
  const base=path.join(root,directory),manifest=JSON.parse(read(path.join(base,'build-manifest.json')));
  for(const f of [...(manifest.inputs||[]),...(manifest.implementation||[])]){
    if(/(^|\/)archive\//.test(f.local))throw Error('Historical model archive is not a build input');
    if(sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error('Changed corpus input '+f.local);
  }
  for(const f of manifest.outputs)if(sha256(fs.readFileSync(path.join(base,f.file)))!==f.sha256)throw Error('Changed corpus artifact '+f.file);
  return manifest;
}
export function validateOriginalRows(rows,candidates,sources){
  const allowed=new Set(sources.map(s=>s.id)),byId=new Map(candidates.map(c=>[c.id,c]));
  for(const r of rows){
    if(r.reviewAction&&r.reviewAction!=='retain')throw Error('Only source retention is allowed');
    const ids=r.candidateIds||r.sourceCandidates;
    if(!ids?.length||!ids.some(id=>{const c=byId.get(id);return c&&allowed.has(c.sourceId)&&c.qid===r.qid&&c.game===r.game&&c.chinese===r.chinese;}))throw Error('Chinese is not an original RSC candidate: '+r.qid);
  }
}
// Until source-specific printing rules are verified, controls and variables
// cannot be silently removed, rewritten or completed to produce Chinese.
export const displayOriginal=text=>typeof text==='string'&&text.length&&!/[\\\[\]{}\uE000\uE001]/.test(text)?text:null;
