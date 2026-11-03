import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import review from '../corpus/source-matching/review-cases.mjs';
import {parseAligned,read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sources=JSON.parse(read(path.join(root,'corpus/sources.json')));
const inputs=[];
const input=name=>{
  const s=sources.sources.find(s=>path.basename(s.local)===name),bytes=fs.readFileSync(path.join(root,s.local));
  if(sha256(bytes)!==s.sha256)throw Error('Unpinned source bytes');inputs.push({local:s.local,sha256:s.sha256});return bytes.toString('utf8');
};
const records=parseAligned(input('qid_msg.txt'),input('ja-Hrkt_msg.txt'),input('en_msg.txt')),byId=new Map(records.map(r=>[r.qid,r]));
const value={...review,inputs,judgmentsSha256:sha256(fs.readFileSync(path.join(root,'corpus/source-matching/review-cases.mjs'))),
 cases:review.cases.map(c=>({...c,sourceEvidence:c.expectedSourceQids.map(qid=>{
   const r=byId.get(qid);if(!r)throw Error(`Unknown reviewed source ${qid}`);
   return {qid,japanese:r.japanese,english:r.english,game:r.game,line:r.line,japaneseSha256:sha256(Buffer.from(r.japanese))};
 })}))};
const target=path.join(root,'corpus/source-matching/reference.json'),bytes=JSON.stringify(value,null,2)+'\n';
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==bytes)throw Error('Refusing to replace a different source-review baseline; version changes explicitly');
fs.writeFileSync(target,bytes);console.log(`Frozen ${value.cases.length} source-text judgments; no matcher output read`);
