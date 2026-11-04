import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,read} from './corpus_common.mjs';
import {POLICY,loadPolicy,verifyManifest,validateOriginalRows,displayOriginal} from './rsc_translation_policy.mjs';
import {loadOriginalRscEntries,loadRscCorrespondenceIndex,queryRscCorrespondences} from './rsc_correspondence_index.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2) {
  if(!['--qid','--japanese','--game','--source-id','--source-line'].includes(args[i]) || args[i+1]===undefined) throw Error('Usage: node tools/query_corpus.mjs (--qid ID | --japanese TEXT | --source-id ID --source-line NUMBER) [--game ruby|sapphire|both]');
  options[args[i].slice(2)]=args[i+1];
}
const sourceMode=options['source-id']!==undefined||options['source-line']!==undefined;
if(Number(Boolean(options.qid))+Number(Boolean(options.japanese))+Number(sourceMode)!==1||!['ruby','sapphire','both'].includes(options.game||'both')||sourceMode&&(!options['source-id']||!/^\d+$/.test(options['source-line']||'')||Number(options['source-line'])<1||!Number.isSafeInteger(Number(options['source-line']))))throw Error('Provide exactly one qid, exact Japanese, or complete original source locator and a valid game');
const dir=path.join(root,'outputs/corpus-mapping');
verifyManifest(root,'outputs/corpus-mapping');
const index=loadRscCorrespondenceIndex(root);
const correspondences=queryRscCorrespondences(index,{qid:options.qid??null,japanese:options.japanese??null,sourceId:options['source-id']??null,sourceLine:sourceMode?Number(options['source-line']):null,game:options.game||'both'});
const originalSource=sourceMode?loadOriginalRscEntries(root,parseCsv(read(path.join(dir,'rsc-import.csv')))).entries.get(`${options['source-id']}:${Number(options['source-line'])}`)||null:null;
const allCandidates=parseCsv(read(path.join(dir,'candidates.csv')));
const linkedQids=new Set(sourceMode?[...allCandidates.filter(c=>c.sourceId===options['source-id']&&Number(c.sourceLine)===Number(options['source-line'])&&(!options.game||options.game==='both'||c.game===options.game)).map(c=>c.qid),...correspondences.map(c=>c.qid)]:[]);
const records=parseCsv(read(path.join(dir,'records.csv'))).filter(r=>sourceMode?linkedQids.has(r.qid):options.qid?r.qid===options.qid:r.japanese===options.japanese)
  .filter(r=>!options.game||options.game==='both'||r.game==='both'||r.game===options.game);
const qids=new Set(records.map(r=>r.qid));
const candidates=allCandidates.filter(c=>qids.has(c.qid)&&(!options.game||options.game==='both'||c.game===options.game)&&(!sourceMode||c.sourceId===options['source-id']&&Number(c.sourceLine)===Number(options['source-line'])));
const pack=JSON.parse(read(path.join(dir,'runtime.json')));
if(pack.translationPolicy!==POLICY)throw Error('Legacy model corpus rejected');
validateOriginalRows(pack.records,parseCsv(read(path.join(dir,'candidates.csv'))),loadPolicy(root).sources);
// Original-source queries return evidence only. A different source that happens
// to share a Japanese qid must not become this source's approved translation.
const runtime=sourceMode?[]:pack.records.filter(c=>qids.has(c.qid)&&(!options.game||options.game==='both'||c.game===options.game));
const summary=JSON.parse(read(path.join(dir,'summary.json')));
const held=summary.heldReviews.filter(c=>records.some(r=>r.japanese===c.japanese)&&(!options.game||options.game==='both'||c.game===options.game));
const translations=[...new Set(runtime.map(c=>displayOriginal(c.chinese)))];
const missingStatus=sourceMode&&originalSource?options.game&&options.game!=='both'&&originalSource.game!=='both'&&originalSource.game!==options.game?'source_game_mismatch':'source_without_indexed_japanese':'no_record';
console.log(JSON.stringify({status:!records.length?missingStatus:held.length?'context_required':runtime.length&&translations.length===1&&translations[0]!==null?'reviewed_static':correspondences.some(c=>!['pokedex_parent','reviewed_source_fragment'].includes(c.relation))?'indexed_correspondence_pending_publication':correspondences.some(c=>c.relation==='reviewed_source_fragment')?'indexed_fragment_pending_window_review':correspondences.length?'indexed_parent_pending_window_review':'needs_review',
  translation:!held.length&&runtime.length&&translations.length===1?translations[0]:null,originalSource,records,candidates,correspondences,reviews:runtime,held},null,2));
