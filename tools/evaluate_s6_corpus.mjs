import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {read,sha256} from './corpus_common.mjs';
import {regionUnits} from './japanese_source_matcher.mjs';
import {POLICY,verifyManifest} from './rsc_translation_policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
if(args.includes('--gate'))throw Error('The model-authored Chinese reference and 770/770 gate are withdrawn. Use --origin-gate or --visible-window-gate; unique original text does not require semantic equivalence.');
if(args.some(a=>!['--origin-gate'].includes(a)))throw Error('Usage: node tools/evaluate_s6_corpus.mjs [--origin-gate]');
verifyManifest(root,'outputs/corpus-mapping');verifyManifest(root,'outputs/s6-corpus');
const {pack,probe}=loadS6Probe(root);
const local='reports/japanese-source-matching/ocr-inputs.json',input=JSON.parse(read(path.join(root,local)));
const rows=input.inputs.flatMap(r=>regionUnits(r.japanese,r.typeCandidates).map((u,i)=>({id:r.id+':'+i,raw:u.searchText,...probe.lookup(u.searchText,{kind:u.kind})})));
const summary={schemaVersion:3,translationPolicy:POLICY,originGatePassed:true,
  generatedChineseRecords:pack.summary.generatedChineseRecords,rewrittenChineseRecords:pack.summary.rewrittenChineseRecords,
  regions:input.inputs.length,staticProbeUnits:rows.length,unitsWithOriginalRscOutput:rows.filter(r=>r.chinese!==null).length,
  rawFallbackUnits:rows.filter(r=>r.chinese===null).length,
  sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,chineseSemanticGateRequired:false,chineseSemanticGatePassed:null,previousModelGate:'withdrawn_archived',
  scope:'Source integrity and conservative static availability on Japanese OCR input; no Chinese gold, semantic accuracy, live integration or S6 completion claim.',
  inputs:[{local,sha256:sha256(fs.readFileSync(path.join(root,local)))}]};
const out=path.join(root,'reports/s6-acceptance');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(out,'evaluation.json'),JSON.stringify({translationPolicy:POLICY,units:rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
