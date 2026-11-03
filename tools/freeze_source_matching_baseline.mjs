import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['corpus/source-matching/reference.json','corpus/source-matching/review-cases.mjs','reports/japanese-source-matching/ocr-inputs.json'];
const value={schemaVersion:1,id:'japanese-source-matching-existing-ocr-v1',
 description:'Freeze actual OCR input and separate direct-source judgments. Does not certify exhaustive source accuracy.',
 files:files.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))}))};
const target=path.join(root,'corpus/source-matching/freeze-manifest.json'),bytes=JSON.stringify(value,null,2)+'\n';
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==bytes)throw Error('Different source baseline: create a new baseline version instead of replacing answers');
fs.writeFileSync(target,bytes);console.log(`Frozen ${files.length} source-evaluation baseline files`);
