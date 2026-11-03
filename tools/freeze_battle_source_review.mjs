import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import review from '../corpus/battle-matching/review-cases.mjs';
import {parseCsv,read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const inputs=JSON.parse(read(path.join(root,'reports/japanese-source-matching/ocr-inputs.json'))).inputs;
const records=parseCsv(read(path.join(root,'outputs/corpus-mapping/records.csv'))),byId=new Map(records.map(r=>[r.qid,r]));
if(review.cases.length!==32||new Set(review.cases.map(c=>c.regionId)).size!==32)throw Error('Expected exactly the existing 24 move and 8 stat gaps');
const value={...review,judgmentsSha256:sha256(fs.readFileSync(path.join(root,'corpus/battle-matching/review-cases.mjs'))),
 ocrInputsSha256:sha256(fs.readFileSync(path.join(root,'reports/japanese-source-matching/ocr-inputs.json'))),
 cases:review.cases.map(c=>{
   const input=inputs.find(r=>r.id===c.regionId);if(!input)throw Error('Unknown reviewed OCR region');
   const evidence=c.expectedSourceQids.map(qid=>{const r=byId.get(qid);if(!r)throw Error('Unknown source');return {qid,japanese:r.japanese,sha256:sha256(Buffer.from(r.japanese))};});
   if(c.moveId){const r=byId.get(`rs.common.move_names.gMoveNames.${c.moveId}`);evidence.push({qid:r.qid,japanese:r.japanese,sha256:sha256(Buffer.from(r.japanese))});}
   return {...c,japanese:input.japanese,japaneseSha256:sha256(Buffer.from(input.japanese)),sourceEvidence:evidence};
 })};
const target=path.join(root,'corpus/battle-matching/review-reference.json'),bytes=JSON.stringify(value,null,2)+'\n';
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==bytes)throw Error('Refusing to replace battle source/meaning judgments; version the baseline');
fs.writeFileSync(target,bytes);console.log('Frozen 32 separate battle source/meaning judgments; no matcher output read');
