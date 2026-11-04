import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read,sha256,parseCsv,csv} from './corpus_common.mjs';
import {loadPolicy,POLICY,validateOriginalRows,verifyManifest,displayOriginal} from './rsc_translation_policy.mjs';
import {validateRscCorrespondenceIndex} from './rsc_correspondence_index.mjs';
import {compileVisibleWindows} from './s6_visible_windows.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]||'outputs/s6-corpus');fs.mkdirSync(out,{recursive:true});
const {policy,sources}=loadPolicy(root);
verifyManifest(root,'outputs/corpus-mapping');
const inputs=[];
const input=local=>{const bytes=fs.readFileSync(path.join(root,local));inputs.push({local,sha256:sha256(bytes)});return bytes.toString('utf8').replace(/^\uFEFF/,'');};
input('corpus/translation-policy.json');input('corpus/sources.json');input('outputs/corpus-mapping/build-manifest.json');
for(const local of ['corpus/visible-windows/policy.json','corpus/visible-windows/decisions.json','reports/japanese-source-matching/ocr-inputs.json','reports/japanese-source-matching/results.json','reports/s3-acceptance/reference.json'])input(local);
const variableReview=JSON.parse(input('corpus/visible-windows/variable-bindings.json'));for(const f of variableReview.inputs)input(f.local);
input('corpus/visible-windows/semantic-units.json');
const nativeFields=JSON.parse(input('corpus/visible-windows/native-fields.json'));for(const local of new Set(nativeFields.fields.flatMap(f=>[f.sourceEvidence.local,...(f.additionalEvidence||[]).map(e=>e.local)])))input(local);
const visibleWindows=compileVisibleWindows(root);
const personSelections=new Set(JSON.parse(input('corpus/rsc-person-selections.json')).selections.map(r=>r.qid+':'+r.game));
const records=parseCsv(input('outputs/corpus-mapping/records.csv'));
const candidates=parseCsv(input('outputs/corpus-mapping/candidates.csv'));
const sourceLinks=parseCsv(input('outputs/corpus-mapping/source-links.csv'));
const correspondenceText=input('outputs/corpus-mapping/correspondences.json'),correspondences=validateRscCorrespondenceIndex(JSON.parse(correspondenceText),records);
const base=JSON.parse(input('outputs/corpus-mapping/runtime.json'));
if(base.translationPolicy!==POLICY)throw Error('Legacy model corpus is not permitted');
const allowed=new Set(sources.map(s=>s.id));
if(candidates.some(c=>!allowed.has(c.sourceId)))throw Error('Non-RSC candidate source');
const byQid=new Map(records.map(r=>[r.qid,r])),groups=new Map();
for(const c of candidates){const k=c.qid+':'+c.game,list=groups.get(k)||[];list.push(c);groups.set(k,list);}
const kinds={species_names:'species',move_names:'move',items:'item',ability_names:'ability',nature_names:'nature',type_names:'type',trainer_class_names:'trainer_class',trainers:'person'};
const lexicon=[],conflicts=[];
for(const list of groups.values()){
  const c=list[0],r=byQid.get(c.qid),kind=kinds[r.qid.split('.')[2]];
  if(!kind||!r.japanese||r.japanese==='[NULL]'||/[\\\[\]{}]/.test(r.japanese))continue;
  if(kind==='person'&&!personSelections.has(r.qid+':'+c.game))continue;
  // The four dictionaries supplied by RSC are authoritative for typed names.
  // Address candidates remain in provenance; no global text replacement occurs.
  const dictionary=list.filter(c=>c.kind===kind),choices=dictionary.length?dictionary:list;
  const texts=[...new Set(choices.map(c=>c.chinese))];
  if(texts.length!==1){conflicts.push({qid:r.qid,game:c.game,kind,candidateIds:choices.map(c=>c.id)});continue;}
  lexicon.push({id:r.qid+':'+c.game,qid:r.qid,game:c.game,kind,japanese:r.japanese,chinese:texts[0],
    candidateIds:choices.filter(c=>c.chinese===texts[0]).map(c=>c.id),selection:dictionary.length?'original_rsc_typed_dictionary':'unambiguous_original_rsc_candidate'});
}
const units=base.records.map(r=>({...r,candidateIds:r.sourceCandidates.filter(id=>candidates.some(c=>c.id===id&&c.chinese===r.chinese))}));
validateOriginalRows([...lexicon,...units],candidates,sources);
const summary={schemaVersion:3,translationPolicy:POLICY,sourceSelection:policy.sourceSelection,semanticDifferenceFallback:false,generatedChineseRecords:0,rewrittenChineseRecords:0,
  lexiconRecords:lexicon.length,staticRecords:units.length,originalCandidateRows:candidates.length,
  deferredTypedConflicts:conflicts.length,displayableRecords:[...lexicon,...units].filter(r=>displayOriginal(r.chinese)!==null).length,
  chineseTemplates:visibleWindows.variableBindings.contracts.length,templatePolicy:'existing_original_RSC_only',chineseEventFormats:0,chineseCompositionRules:0,originalRscTemplateFamilies:visibleWindows.variableBindings.contracts.length,generatedChineseTemplates:0,complete:false,
  correspondenceIndex:correspondences.summary,
  visibleWindows:{reviewedOriginalSpans:visibleWindows.rules.filter(r=>r.disposition==='original_rsc_span').length,reviewedOriginalTemplateCases:visibleWindows.rules.filter(r=>r.disposition==='original_rsc_template').length,reviewedSemanticCases:visibleWindows.rules.filter(r=>r.disposition==='original_rsc_semantic').length,reviewedNativeFieldCases:visibleWindows.rules.filter(r=>r.disposition==='original_rsc_native_field').length,semanticUnitPlans:visibleWindows.semanticUnits.plans.length,originalPrintRecipes:visibleWindows.nativeFields.fields.length,retainedJapanese:visibleWindows.rules.filter(r=>r.disposition==='retain_japanese').length,outsideFirstEdition:visibleWindows.rules.filter(r=>r.disposition==='outside_first_edition').length,scope:'fixed_observed_units_not_full_first_edition',approvedOriginalTemplateFamilies:visibleWindows.variableBindings.contracts.length,generatedChineseTemplates:0},
  semanticAcceptance:'not_required_for_unique_original_source',runtimeIntegration:'S7_pending',
  fallback:'original_japanese',unmatchedIsNotProofOfMissingTranslation:true};
const pack={schemaVersion:3,id:'rs-rsc-original-only-v1',translationPolicy:POLICY,rscSources:sources,
  lexicon,units,candidates,summary};
const write=(file,value)=>{const target=path.join(out,file),text=JSON.stringify(value,null,2)+'\n';if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){const temporary=target+'.tmp';fs.writeFileSync(temporary,text);fs.renameSync(temporary,target);}};
write('runtime.json',pack);write('summary.json',summary);
write('visible-windows.json',visibleWindows);
write('provenance.json',{translationPolicy:policy,records,candidates,sourceLinks,typedConflicts:conflicts});
fs.writeFileSync(path.join(out,'correspondences.json'),correspondenceText);
const reviewedPairs=new Set(correspondences.links.filter(l=>!['pokedex_parent','reviewed_source_fragment'].includes(l.relation)).map(l=>l.qid+':'+l.game));
const fragmentPairs=new Set(correspondences.links.filter(l=>l.relation==='reviewed_source_fragment').map(l=>l.qid+':'+l.game));
const parentPairs=new Set(correspondences.links.filter(l=>l.relation==='pokedex_parent').map(l=>l.qid+':'+l.game));
const inventory=records.flatMap(r=>(r.game==='both'?['ruby','sapphire']:[r.game]).map(game=>({qid:r.qid,game,
  status:groups.has(r.qid+':'+game)?'original_rsc_candidates_available':reviewedPairs.has(r.qid+':'+game)?'reviewed_correspondence_indexed':fragmentPairs.has(r.qid+':'+game)?'reviewed_fragment_only':'correspondence_not_established',
  reviewedCorrespondence:reviewedPairs.has(r.qid+':'+game),reviewedSourceFragment:fragmentPairs.has(r.qid+':'+game),parentAssociation:parentPairs.has(r.qid+':'+game),
  staticPublished:units.some(u=>u.qid===r.qid&&u.game===game)})));
fs.writeFileSync(path.join(out,'source-inventory.csv'),csv(inventory,['qid','game','status','reviewedCorrespondence','reviewedSourceFragment','parentAssociation','staticPublished']));
const files=['runtime.json','summary.json','provenance.json','source-inventory.csv','correspondences.json','visible-windows.json'];
write('build-manifest.json',{schemaVersion:3,translationPolicy:POLICY,inputs,
  implementation:['tools/build_s6_corpus.mjs','tools/corpus_common.mjs','tools/rsc_translation_policy.mjs','tools/rsc_correspondence_index.mjs','tools/s6_visible_windows.mjs','tools/s6_variable_bindings.mjs','tools/s6_semantic_units.mjs','tools/s6_native_fields.mjs','tools/japanese_source_matcher.mjs','tools/japanese_source_layout.mjs','tools/battle_source_matcher.mjs'].map(local=>({local,sha256:sha256(fs.readFileSync(path.join(root,local)))})),
  outputs:files.map(file=>({file,sha256:sha256(fs.readFileSync(path.join(out,file)))}))});
console.log(JSON.stringify(summary,null,2));
