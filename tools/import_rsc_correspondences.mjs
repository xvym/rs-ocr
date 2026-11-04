import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,parseCsv,sha256} from './corpus_common.mjs';
import {POLICY} from './rsc_translation_policy.mjs';
import {loadOriginalRscEntries,validateReverseCorrespondenceReview} from './rsc_correspondence_index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),local='reports/rsc-semantic-audit/semantic-review.json';
const bytes=fs.readFileSync(path.join(root,local)),reviews=JSON.parse(bytes.toString('utf8')).reviews;
const records=parseCsv(read(path.join(root,'outputs/corpus-mapping/records.csv'))),recordMap=new Map(records.map(r=>[r.qid,r]));
const originals=loadOriginalRscEntries(root,parseCsv(read(path.join(root,'outputs/corpus-mapping/rsc-import.csv')))),{entries}=originals,links=[],used=new Set();
for(const review of reviews.filter(r=>['original_correspondence_found','original_source_span_found'].includes(r.verdict))){
  const r=recordMap.get(review.qid);if(!r||r.japanese!==review.japanese||r.english!==review.english)throw Error('Stale semantic source');
  for(const group of review.sourceReferences)for(const quote of group.candidates)for(const w of quote.witnesses){
    const entry=entries.get(`${w.sourceId}:${w.index}`);
    if(!entry||entry.originalChineseSha256!==quote.originalChineseSha256||entry.originalChinese.slice(...quote.chineseSpan)!==quote.chinese)throw Error('Review must quote a pinned original RSC entry');
    const relation=review.verdict==='original_source_span_found'?'reviewed_original_span':'reviewed_correspondence';
    const identity=JSON.stringify([r.qid,group.game,entry.id,quote.chineseSpan,relation]);if(used.has(identity))continue;used.add(identity);
    links.push({qid:r.qid,game:group.game,japaneseSha256:sha256(Buffer.from(r.japanese)),englishSha256:sha256(Buffer.from(r.english)),
      sourceId:entry.sourceId,sourceLine:entry.sourceLine,originalChineseSha256:entry.originalChineseSha256,chineseSpan:quote.chineseSpan,relation,reason:review.reason});
  }
}
const reverseLocal='corpus/rsc-reverse-reviews.json',reverseBytes=fs.readFileSync(path.join(root,reverseLocal));
const reverse=validateReverseCorrespondenceReview(JSON.parse(reverseBytes),{records,originals,sourceManifestSha256:sha256(fs.readFileSync(path.join(root,'corpus/sources.json')))});
for(const c of reverse.cases.filter(c=>c.verdict==='confirmed')){
  links.push({qid:c.qid,game:c.game,japaneseSha256:c.japaneseSha256,englishSha256:c.englishSha256,sourceId:c.sourceId,sourceLine:c.sourceLine,
    originalChineseSha256:c.originalChineseSha256,chineseSpan:c.chineseSpan,japaneseSpan:c.japaneseSpan,japaneseFragmentSha256:c.japaneseFragmentSha256,relation:c.relation,reason:c.reason,
    originReview:{local:reverseLocal,sha256:sha256(reverseBytes)}});
}
const output={schemaVersion:1,translationPolicy:POLICY,sourceManifestSha256:sha256(fs.readFileSync(path.join(root,'corpus/sources.json'))),
  originReview:{local,sha256:sha256(bytes),method:'non_blind_model_semantic_comparison',note:'Provenance snapshot; the report is not a build input. All source hashes are checked afresh.'},
  includePokedexParents:true,publicationApproved:false,links};
fs.writeFileSync(path.join(root,'corpus/correspondence-selections.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({selectedJapaneseQids:new Set(links.map(r=>r.qid)).size,selectedLinks:links.length,includePokedexParents:true}));
