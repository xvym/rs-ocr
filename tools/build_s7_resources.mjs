import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadS6Probe} from './s6_corpus_probe.mjs';
import {sha256} from './corpus_common.mjs';

// Development-only compilation. The desktop runs these data with Java, without
// Node, a ROM, upstream checkout, screenshot IDs or acceptance answers.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {pack,visibleProbe,manifest}=loadS6Probe(root),matcher=visibleProbe.variables.matcher;
const generic=matcher.templates.map(({record,tokens,page,lineStart,lineCount,fixed})=>({qid:record.qid,game:record.game,tokens,page,lineStart,lineCount,fixed}));
const battle=matcher.battle.models.map(({regex,...model})=>model);
const data={schemaVersion:1,translationPolicy:pack.translationPolicy,sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,
  s6Complete:false,lexicon:pack.lexicon,units:pack.units,candidates:pack.candidates,rscSources:pack.rscSources,
  visible:visibleProbe.pack,generic,battle,
  includedTypes:JSON.parse(fs.readFileSync(path.join(root,'corpus/visible-windows/policy.json'),'utf8')).scopeIncludedTypes,
  s6ManifestSha256:sha256(fs.readFileSync(path.join(root,'outputs/s6-corpus/build-manifest.json')))};
const target=path.join(root,'desktop/target/generated-resources/translation');fs.mkdirSync(target,{recursive:true});
const bytes=Buffer.from(JSON.stringify(data));fs.writeFileSync(path.join(target,'runtime.json'),bytes);
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({schemaVersion:1,translationPolicy:pack.translationPolicy,sha256:sha256(bytes),
  s6ManifestSha256:data.s6ManifestSha256,s6Inputs:manifest.outputs.map(({file,sha256})=>({file,sha256})),generatedChineseRecords:0,rewrittenChineseRecords:0},null,2)+'\n');
console.log(JSON.stringify({resourceBytes:bytes.length,originalTemplates:data.visible.variableBindings.contracts.length,genericPatterns:generic.length,battlePatterns:battle.length,s6Complete:false}));
