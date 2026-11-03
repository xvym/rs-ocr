import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ref=JSON.parse(read(path.join(root,'reports/s3-acceptance/reference.json')));
const predictions=JSON.parse(read(path.join(root,'reports/s3-acceptance/predictions.json')));
const raws=['.tools/s3-gba-raw.json','.tools/s3-ngc-raw.json'].map(local=>({local,data:JSON.parse(read(path.join(root,local)))}));
const inputs=[];
for(const p of predictions.regions) {
  const r=ref.regions.find(r=>r.instance_id===p.instance_id);
  if(!r||!r.recognition_in_scope)throw Error('Unknown target prediction');
  const frames=raws.flatMap(f=>f.data.frames).filter(f=>f.source.replaceAll('\\','/')===r.source.replaceAll('\\','/'));
  if(frames.length!==1||frames[0].sourceSha256!==r.source_sha256)throw Error(`Frame identity ${p.instance_id}`);
  const regions=frames[0].regions.filter(c=>c.rawOcr===p.text&&JSON.stringify(c.logicalBox)===JSON.stringify(p.logical_box));
  if(regions.length!==1)throw Error(`Region identity ${p.instance_id}`);
  const detected=regions[0],compact=s=>s.replace(/[ \u3000\r\n]/g,'');
  // Character diagnostics include multi-character native labels. Flatten only
  // after verifying their complete raw sequence against the observed OCR.
  const ordered=[detected.characters,[...detected.characters].sort((a,b)=>a.y-b.y||a.x-b.x)].find(chars=>compact(chars.map(c=>c.raw).join(''))===compact(p.text));
  const ambiguousGlyphs=detected.characters.filter(c=>c.font===3&&c.distance===0&&c.candidates.length>1).length;
  const alternatives=[];let cursor=0;
  for(const c of ordered||[]) {
    while(/[ \u3000\r\n]/.test(p.text[cursor]||'')&&cursor<p.text.length)cursor++;
    const start=p.text.indexOf(c.raw,cursor);if(start<0)throw Error('Character alignment');
    if(c.font===3&&c.distance===0&&c.candidates.length>1&&[['へ','ヘ'],['0','O']].some(pair=>pair.includes(c.raw)&&pair.every(x=>c.candidates.includes(x))))alternatives.push({index:start,raw:c.raw,candidates:c.candidates,font:c.font,distance:c.distance});
    cursor=start+c.raw.length;
  }
  inputs.push({id:p.instance_id,imageId:r.image_id,platform:r.platform,source:r.source,sourceSha256:r.source_sha256,logicalBox:detected.logicalBox,
    japanese:p.text,typeCandidates:detected.typeCandidates,alternatives,
    alternativesStatus:ordered?'verified_diagnostic_sequence':ambiguousGlyphs?'unavailable_character_alignment':'no_ambiguous_glyphs',unmappedAmbiguousGlyphs:ordered?0:ambiguousGlyphs});
}
if(inputs.length!==579)throw Error('Expected all 579 targets');
const value={schemaVersion:1,description:'Compact actual S3 OCR output and detected types/zero-distance alternatives; no expected Japanese or Chinese passed to the matcher',
 referenceSha256:sha256(fs.readFileSync(path.join(root,'reports/s3-acceptance/reference.json'))),
 predictionsSha256:sha256(fs.readFileSync(path.join(root,'reports/s3-acceptance/predictions.json'))),
 rawInputs:raws.map(r=>({local:r.local,sha256:sha256(fs.readFileSync(path.join(root,r.local)))})),inputs};
const dir=path.join(root,'reports/japanese-source-matching');fs.mkdirSync(dir,{recursive:true});
const target=path.join(dir,'ocr-inputs.json'),bytes=JSON.stringify(value,null,2)+'\n';
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==bytes)throw Error('Refusing to replace different frozen OCR input; version the baseline');
fs.writeFileSync(target,bytes);console.log(`Frozen ${inputs.length} actual OCR regions`);
