import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256,read,csv} from './corpus_common.mjs';
import {normalized} from './rsc_semantic_retrieval.mjs';
import {japaneseConfirmed,englishConfirmed,partial,explicitReasons,preferredIds,extraQueries} from '../reports/rsc-semantic-audit/semantic-review-rules.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'reports/rsc-semantic-audit');
const retrieval=JSON.parse(read(path.join(out,'retrieval.json'))),docs=JSON.parse(read(path.join(root,'.tools/rsc-semantic/index.json'))),docIndex=new Map(docs.map(d=>[d.id,d]));
for(const r of retrieval.records)for(const g of r.games)g.candidates=g.candidates.map(id=>docIndex.get(id));
const reviews=[];
const citation=(doc,quote=null)=>{
 const start=quote===null?0:doc.chinese.indexOf(quote);if(start<0)throw Error('Quote is not in the original Chinese');
 const chinese=quote??doc.chinese;
 return {documentId:doc.id,game:doc.game,english:doc.english,chinese,chineseSpan:[start,start+chinese.length],originalChineseSha256:sha256(Buffer.from(doc.chinese)),
  witnesses:doc.witnesses.filter(w=>w.primary||w.sourceId).length?doc.witnesses.filter(w=>w.primary||w.sourceId):doc.witnesses};
};
for(const r of retrieval.records){
 const classification=r.games[0].classification;
 if(!['bilingual_duplicate_found','english_whole_candidate_found','japanese_whole_candidate_found'].includes(classification))continue;
 let verdict='not_confirmed',reason=explicitReasons[r.qid]||'Context, localization, extra content, grammatical role or name identity prevents approval as the same Japanese unit.';
 if(partial.has(r.qid)){verdict='partial_original_segments';reason='Original wording expresses only a component, adds another value/object, or needs source-window/printing rules; not a whole-unit match.';}
 else if(classification==='bilingual_duplicate_found'||r.group==='script'||r.group==='region_map_entries'||englishConfirmed.has(r.qid)||japaneseConfirmed.has(r.qid)){
  verdict='original_correspondence_found';reason=classification==='bilingual_duplicate_found'?'Same Japanese and bridge-English concept already has original RSC wording elsewhere.':'Model compared Japanese meaning with the original RSC quotation: same entity, action, polarity and stated values; printing/variables remain unapproved.';
 }
 const sourceReferences=[];
 for(const g of r.games){
  let selected=g.candidates;
  if(preferredIds[r.qid]){
   const preferredDocs=preferredIds[r.qid].map(id=>docIndex.get(id));
   selected=docs.filter(d=>(!d.game||d.game===g.game)&&preferredDocs.some(p=>p&&p.chinese===d.chinese&&normalized(p.english)===normalized(d.english)));
   if(!selected.length)throw Error('Missing preferred per-game source witness');
  }
  else if(classification==='bilingual_duplicate_found')selected=selected.filter(d=>g.bilingualIds.includes(d.id));
  const preferred=selected.filter(d=>d.witnesses.some(w=>w.primary||w.sourceId));
  sourceReferences.push({game:g.game,originalGap:g.originalGap,candidates:(preferred.length?preferred:selected).map(d=>citation(d))});
 }
 reviews.push({qid:r.qid,japanese:r.japanese,english:r.english,sourceTextSha256:sha256(Buffer.from(r.japanese+'\0'+r.english)),classification,verdict,reason,sourceReferences});
}
for(const query of extraQueries){
 const r=retrieval.records.find(r=>r.qid===query.qid);if(!r)throw Error('Unknown review target');
 const selected=query.ids.map(id=>{const d=docIndex.get(id);if(!d)throw Error('Unknown source witness');return d;});
 // Review both editions against their own actual file at the corresponding
 // English/Chinese document, without synthesizing or concatenating Chinese.
 const sourceReferences=r.games.map(g=>({game:g.game,candidates:selected.flatMap(d=>{
  const same=docs.filter(s=>(!s.game||s.game===g.game)&&normalized(s.english)===normalized(d.english)&&s.chinese===d.chinese&&s.witnesses.some(w=>w.primary||w.sourceId));
  return same.slice(0,1).map(s=>citation(s,query.quote??null));
 })}));
 if(query.ids.length&&sourceReferences.some(g=>!g.candidates.length))throw Error('Missing per-game review witness');
 reviews.push({qid:r.qid,japanese:r.japanese,english:r.english,sourceTextSha256:sha256(Buffer.from(r.japanese+'\0'+r.english)),classification:'model_semantic_query',query:query.query,verdict:query.verdict,
  reason:query.verdict==='not_confirmed'?'The semantic query did not yield a reliable whole-unit source quotation; not a proof of upstream absence.':'Original text located using Japanese meaning; quotations remain unchanged and components are not concatenated.',sourceReferences});
}
const resultById=new Map(retrieval.records.map(r=>[r.qid,{qid:r.qid,group:r.group,retrievalClassification:r.games[0].classification,status:r.games[0].classification}]));
for(const review of reviews)resultById.get(review.qid).status=review.verdict;
const results=[...resultById.values()],counts=Object.fromEntries([...new Set(results.map(r=>r.status))].sort().map(status=>[status,results.filter(r=>r.status===status).length]));
const summary={...retrieval.summary,semanticReview:{method:'non_blind_model_comparison_of_original_quotes; no Chinese authored, rewritten, concatenated or published',reviewedQids:new Set(reviews.map(r=>r.qid)).size,
  confirmedOriginalCorrespondenceQids:results.filter(r=>r.status==='original_correspondence_found').length,originalSourceSpanQids:results.filter(r=>r.status==='original_source_span_found').length,
  partialOriginalSegmentQids:results.filter(r=>r.status==='partial_original_segments').length,counts,
  sourceNotFoundOrNotConfirmedIsNotProofOfAbsence:true,runtimePackageChanged:false,
  confirmedBySourceType:{currentPinnedInputs:0,additionalProjectFilesOnly:0},
  upstreamStatement:{file:'README.md',line:44,commit:retrieval.summary.sourceCommit,scope:'The project explicitly says Easy Chat phrases, including related TV/Tower combinations, were not localized. This does not mean every reusable word is absent elsewhere.'}}};
for(const r of reviews.filter(r=>r.verdict==='original_correspondence_found'||r.verdict==='original_source_span_found')){
 const any=r.sourceReferences.flatMap(g=>g.candidates);summary.semanticReview.confirmedBySourceType[any.some(c=>c.witnesses.some(w=>w.sourceId))?'currentPinnedInputs':'additionalProjectFilesOnly']++;
}
summary.actualUpstreamMissingConfirmed=null;
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
write('semantic-review.json',{method:summary.semanticReview.method,reviews});write('summary.json',summary);write('results.json',{summary,records:results});
fs.writeFileSync(path.join(out,'semantic-worklist.csv'),csv(results,['qid','group','retrievalClassification','status']));
write('semantic-review-manifest.json',{inputs:['reports/rsc-semantic-audit/retrieval.json','reports/rsc-semantic-audit/semantic-review-rules.mjs','.tools/rsc-semantic/index.json'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
 implementation:{local:'tools/review_rsc_semantic_audit.mjs',sha256:sha256(fs.readFileSync(path.join(root,'tools/review_rsc_semantic_audit.mjs')))},outputs:['semantic-review.json','summary.json','results.json','semantic-worklist.csv'].map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary.semanticReview,null,2));
