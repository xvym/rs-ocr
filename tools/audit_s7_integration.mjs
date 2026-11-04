import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'reports/s7-integration');
const json=local=>JSON.parse(fs.readFileSync(path.join(root,local),'utf8'));
const hash=local=>sha256(fs.readFileSync(path.join(root,local)));
const parity=json('reports/s7-integration/java-parity.json'),render=json('reports/s7-integration/render-checks.json'),packaged=json('reports/s7-integration/package-checks.json'),live=json('reports/s7-integration/live/playback-checks.json');
const finalReplay=json('reports/s7-integration/live-final/playback-checks.json'),finalImplementation=json('reports/s7-integration/live-final/implementation.json');
const resource=json('desktop/target/generated-resources/translation/manifest.json');
if(resource.s6ManifestSha256!==hash('outputs/s6-corpus/build-manifest.json')||resource.sha256!==hash('desktop/target/generated-resources/translation/runtime.json')||packaged.jarSha256!==hash('desktop/target/rs-ocr-desktop-0.1.0.jar')||packaged.s6ManifestSha256!==resource.s6ManifestSha256||finalImplementation.jarSha256!==packaged.jarSha256)throw Error('Stale packaged translation evidence');
const suites=fs.readdirSync(path.join(root,'desktop/target/surefire-reports')).filter(n=>/^TEST-.*\.xml$/.test(n)).map(file=>{
 const text=fs.readFileSync(path.join(root,'desktop/target/surefire-reports',file),'utf8'),head=text.match(/<testsuite\b[^>]+>/)?.[0]||'';
 const attribute=name=>Number(head.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]||0);
 return {file,tests:attribute('tests'),failures:attribute('failures'),errors:attribute('errors'),skipped:attribute('skipped')};
});
const tests={tests:suites.reduce((n,s)=>n+s.tests,0),failures:suites.reduce((n,s)=>n+s.failures+s.errors,0),suites};
const software=parity.passed&&parity.checks===2349&&render.passed&&packaged.passed&&live.passed&&finalReplay.passed&&live.originalRscChineseIntegration&&tests.tests>0&&tests.failures===0;
const summary={schemaVersion:1,stage:'S7',complete:false,status:software?'software_integrated_actual_device_acceptance_pending':'implementation_checks_incomplete',softwareIntegrationPassed:software,
 s6:'temporarily_deferred_by_user',s6Complete:false,translationPolicy:'rsc-original-only-v1',sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,generatedChineseRecords:0,rewrittenChineseRecords:0,
 s6ManifestSha256:resource.s6ManifestSha256,jarSha256:packaged.jarSha256,javaParityChecks:parity.checks,staticImages:render.images,staticRegions:render.panels,originalWindowAndFormatOutputs:772,additionalVisibleNameFields:4,renderedBlocks:render.renderedBlocks,desktopTests:tests,
 latencyTargetMs:200,allControlledSamplesWithinTarget:Object.values(live.chains).every(c=>c.measurement.chineseDisplay.maxMs!==null&&c.measurement.chineseDisplay.maxMs<=200),
 finalPackageReplay:{passed:finalReplay.passed,images:Object.values(finalReplay.chains).reduce((n,c)=>n+c.states,0),scenarios:finalReplay.scenarios.length,report:'reports/s7-integration/live-final/playback-checks.json'},
 controlledReplay:{passed:live.passed,images:Object.values(live.chains).reduce((n,c)=>n+c.states,0),scenarios:live.scenarios.length,unexpectedDisplayedText:live.unexpectedDisplayedText,
  chains:Object.fromEntries(Object.entries(live.chains).map(([chain,c])=>[chain,{states:c.states,fullyShown:c.fullyShown,missedStates:c.missedStates,chineseDisplay:c.measurement.chineseDisplay}]))},
 remaining:[
 {stage:'S6',reason:'Existing 7 unresolved fixed units and broader source/window/variable/version coverage remain deferred; not generated or silently marked complete.'},
 {stage:'S7',reason:'Actual NDS and NGC continuous-gameplay Chinese latency and behavior still require device-chain evidence. Controlled replay does not replace it.'},
 {stage:'S7',reason:'The 200ms end-to-end target is not met by the controlled replay: P95 is about 210ms/227ms, with over-target samples retained.'},
 {stage:'S7',reason:'Manual/session player identity is available with current>manual>memory priority; existing approved templates require complete current variables and have no approved hidden-player-only slot.'},
 {stage:'S8',reason:'Final Chinese acceptance, clean-machine distribution and supported-environment verification remain pending.'}
 ],report:'reports/s7-integration/README.md'};
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const walk=local=>fs.readdirSync(path.join(root,local),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(local+'/'+e.name):e.name.endsWith('.java')?[local+'/'+e.name]:[]);
const implementation=[...walk('desktop/src/main/java'),...walk('desktop/src/test/java'),'tools/build_s7_resources.mjs','tools/check_s7_package.mjs','tools/audit_s7_integration.mjs','build-desktop.ps1','desktop/pom.xml'];
const inputs=['outputs/s6-corpus/build-manifest.json','target/rs-ocr-0.1.0.jar','desktop/target/generated-resources/translation/manifest.json','reports/s7-integration/java-parity.json','reports/s7-integration/render-checks.json','reports/s7-integration/package-checks.json','reports/s7-integration/live/playback-checks.json','reports/s7-integration/live/implementation.json','reports/s7-integration/live-final/playback-checks.json','reports/s7-integration/live-final/implementation.json',...suites.map(s=>'desktop/target/surefire-reports/'+s.file)];
fs.writeFileSync(path.join(out,'run-manifest.json'),JSON.stringify({inputs:inputs.map(local=>({local,sha256:hash(local)})),implementation:implementation.map(local=>({local,sha256:hash(local)})),summarySha256:hash('reports/s7-integration/summary.json'),jarSha256:packaged.jarSha256,hardwareAcceptance:false},null,2)+'\n');
console.log(JSON.stringify({softwareIntegrationPassed:software,complete:false,javaChecks:parity.checks,images:render.images,desktopTests:tests.tests,controlledReplay:summary.controlledReplay.images}));
if(!software)process.exitCode=2;
