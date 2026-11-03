import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv,read} from './corpus_common.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2) {
  if(!['--qid','--japanese','--game'].includes(args[i]) || args[i+1]===undefined) throw Error('Usage: node tools/query_corpus.mjs (--qid ID | --japanese TEXT) [--game ruby|sapphire|both]');
  options[args[i].slice(2)]=args[i+1];
}
if(Boolean(options.qid)===Boolean(options.japanese) || !['ruby','sapphire','both'].includes(options.game||'both')) throw Error('Provide exactly one qid or complete Japanese value and a valid game');
const dir=path.join(root,'outputs/corpus-mapping');
const records=parseCsv(read(path.join(dir,'records.csv'))).filter(r=>options.qid?r.qid===options.qid:r.japanese===options.japanese)
  .filter(r=>!options.game||options.game==='both'||r.game==='both'||r.game===options.game);
const qids=new Set(records.map(r=>r.qid));
const candidates=parseCsv(read(path.join(dir,'candidates.csv'))).filter(c=>qids.has(c.qid)&&(!options.game||options.game==='both'||c.game===options.game));
const runtime=JSON.parse(read(path.join(dir,'runtime.json'))).records.filter(c=>qids.has(c.qid)&&(!options.game||options.game==='both'||c.game===options.game));
const summary=JSON.parse(read(path.join(dir,'summary.json')));
const held=summary.heldReviews.filter(c=>records.some(r=>r.japanese===c.japanese)&&(!options.game||options.game==='both'||c.game===options.game));
const translations=[...new Set(runtime.map(c=>c.chinese))];
console.log(JSON.stringify({status:!records.length?'no_record':held.length?'context_required':runtime.length&&translations.length===1?'reviewed_static':'needs_review',
  translation:!held.length&&runtime.length&&translations.length===1?translations[0]:null,records,candidates,reviews:runtime,held},null,2));
