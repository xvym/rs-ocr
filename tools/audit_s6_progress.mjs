import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256} from './corpus_common.mjs';
import {verifyManifest,POLICY} from './rsc_translation_policy.mjs';
import {verifyFiles} from './s6_visible_windows.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
verifyManifest(root,'outputs/s6-corpus');
const json=local=>JSON.parse(read(path.join(root,local)));
const resource=json('outputs/s6-corpus/summary.json'),gate=json('reports/s6-acceptance/summary.json');
const s7Local='reports/s7-integration/summary.json',s7=fs.existsSync(path.join(root,s7Local))?json(s7Local):null;
const integrated=Boolean(s7?.softwareIntegrationPassed&&s7.s6ManifestSha256===sha256(fs.readFileSync(path.join(root,'outputs/s6-corpus/build-manifest.json'))));
const visible=json('reports/s6-visible-windows/summary.json'),visibleManifest=json('reports/s6-visible-windows/run-manifest.json');
const reverse=json('reports/rsc-reverse-mapping/summary.json'),reverseManifest=json('reports/rsc-reverse-mapping/run-manifest.json');
verifyFiles(root,[...reverseManifest.inputs,...reverseManifest.implementation]);
for(const f of reverseManifest.outputs)if(sha256(fs.readFileSync(path.join(root,'reports/rsc-reverse-mapping',f.file)))!==f.sha256)throw Error('Changed reverse-mapping result '+f.file);
if(JSON.stringify(reverse.correspondenceIndex)!==JSON.stringify(resource.correspondenceIndex))throw Error('Stale reverse-mapping progress');
verifyFiles(root,[...visibleManifest.inputs,...visibleManifest.implementation]);
for(const f of visibleManifest.outputs)if(sha256(fs.readFileSync(path.join(root,'reports/s6-visible-windows',f.file)))!==f.sha256)throw Error('Changed visible-window result '+f.file);
if(resource.translationPolicy!==POLICY||gate.translationPolicy!==POLICY)throw Error('RSC-only evidence required');
const gaps=[
  {id:'original_rsc_correspondence',stage:'S6',status:'open',reason:'Resolve original RSC record/page/visible-window correspondence; unmatched does not mean upstream translation is missing.'},
  {id:'original_rsc_variables_and_printing',stage:'S6',status:'partially_completed',reason:`${visible.approvedOriginalTemplateFamilies} original RSC template families, ${visible.semanticUnitPlans} reviewed semantic-unit plans and ${visible.originalPrintRecipes} existing print recipes are bound. All ${visible.variableBindingAudit.uniqueCases} prior variable fallback cases (${visible.variableBindingAudit.occurrences} occurrences) are reviewed: ${visible.variableBindingAudit.originalTemplateOutputOccurrences} now output original wording/format; ${visible.variableBindingAudit.retainedOccurrences} remain retained. Wrapping and scrolling do not divide the same identified unit. Broader source and page-state coverage remains open.`},
  {id:'source_linked_chinese_reference',stage:'S6',status:visible.baselineGatePassed?'fixed_visible_baseline_complete':'failed',reason:`All ${visible.targetRegions} fixed target regions are registered. The ${visible.firstEditionUnits} in-scope units have ${visible.originalChineseUnits} original wording/format outputs (${visible.originalFormatOnlyUnits} numeric/level formats) and ${visible.retainedJapaneseUnits} raw retentions (${visible.retainedByDesignUnits} invariant labels; ${visible.unresolvedRetainedUnits} unresolved). Fixed baseline checks do not complete whole-first-edition source/window/variable coverage or live application acceptance.`},
  {id:'first_edition_scope_and_states',stage:'S6',status:'open',reason:'Verify required first-edition pages/states and long-tail source correspondence.'},
  {id:'java_integration_and_live_acceptance',stage:'S7_S8',status:integrated?'java_integrated_device_acceptance_pending':'pending',reason:integrated?'Existing S6 resources are integrated into Java desktop and controlled window replay; actual device-chain and final product acceptance remain pending.':'Java Chinese integration and actual continuous-chain acceptance remain pending.'}
];
const report={schemaVersion:3,stage:'S6',complete:false,translationPolicy:POLICY,
  originGatePassed:gate.originGatePassed,sourceSelection:'unique_original_rsc_text',semanticDifferenceFallback:false,chineseSemanticGateRequired:false,chineseSemanticGatePassed:null,previousModelGate:'withdrawn_archived',
  generatedChineseRecords:resource.generatedChineseRecords,resourceSummary:resource,resourceSummaryIsBuildSnapshot:true,runtimeIntegration:integrated?'java_desktop_integrated_pending_device_acceptance':'S7_pending',s7Integration:integrated?{report:s7.report,complete:s7.complete,softwareIntegrationPassed:true}:null,gaps,
  reverseCorrespondenceReview:{...reverse.reverseReview,remainingByGame:Object.fromEntries(Object.entries(reverse.perGame).map(([game,value])=>[game,{unlinked:value.remainingWithoutConfirmedOrParentLink,fragmentOnly:value.indexedReviewedFragments}])),report:'reports/rsc-reverse-mapping/README.md'},
  visibleWindowBaseline:{passed:visible.baselineGatePassed,regions:visible.targetRegions,units:visible.units,firstEditionRegions:visible.firstEditionRegions,firstEditionUnits:visible.firstEditionUnits,originalChineseUnits:visible.originalChineseUnits,originalFormatOnlyUnits:visible.originalFormatOnlyUnits,retainedJapaneseUnits:visible.retainedJapaneseUnits,retainedByDesignUnits:visible.retainedByDesignUnits,unresolvedRetainedUnits:visible.unresolvedRetainedUnits,outsideFirstEditionUnits:visible.outsideFirstEditionUnits,approvedOriginalTemplateFamilies:visible.approvedOriginalTemplateFamilies,semanticUnitPlans:visible.semanticUnitPlans,originalPrintRecipes:visible.originalPrintRecipes,variableBindingAudit:visible.variableBindingAudit,fullFirstEditionChineseGatePassed:visible.fullFirstEditionChineseGatePassed,independentReview:visible.independentReview,report:'reports/s6-visible-windows/README.md'},
  preservedNativeEvidence:['reports/s6-corpus/japanese-name-evidence.json','reports/s6-corpus/easy-chat-native-evidence.json']};
const out=path.join(root,'reports/s6-corpus');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(report,null,2)+'\n');
const inputs=['outputs/s6-corpus/build-manifest.json','reports/s6-acceptance/summary.json','reports/s6-visible-windows/summary.json','reports/s6-visible-windows/run-manifest.json','reports/rsc-reverse-mapping/summary.json','reports/rsc-reverse-mapping/run-manifest.json',...report.preservedNativeEvidence];
if(s7)inputs.push(s7Local);
fs.writeFileSync(path.join(out,'progress-manifest.json'),JSON.stringify({inputs:inputs.map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),implementation:{local:'tools/audit_s6_progress.mjs',sha256:sha256(fs.readFileSync(path.join(root,'tools/audit_s6_progress.mjs')))},outputSha256:sha256(fs.readFileSync(path.join(out,'progress.json')))},null,2)+'\n');
console.log(JSON.stringify({complete:false,originGatePassed:gate.originGatePassed,generatedChineseRecords:report.generatedChineseRecords}));
