import fs from 'node:fs';
import {sha256} from './corpus_common.mjs';

export function layoutKey(text) {
  // Preserve a boundary between adjacent numeric chunks ("1 0" is not "10").
  return text.replace(/(?<=[0-9０-９])[ \u3000\r\n]+(?=[0-9０-９])/g,'\u0001')
    .replace(/[ \u3000\r\n]/g,'').replaceAll('\u0001',' ');
}
export function visibleValues(text) {
  return [...text.matchAll(/[0-9０-９]+/g)].map(m=>({raw:m[0],start:m.index,end:m.index+m[0].length,
    role:/^(?:10|１０)$/.test(m[0])&&text.slice(m.index+m[0].length).startsWith('まんボルト')?'lexical_move_name':'visible_number'}));
}
export function dataValues(text) {return visibleValues(text).filter(v=>v.role!=='lexical_move_name').map(v=>v.raw);}
export function displaySymbols(text) {return text.match(/HP|PP|EXP|SEL|♂|♀|×/g)||[];}
export function validateExpectedValues(japanese,chinese,id) {
  if(JSON.stringify(dataValues(japanese))!==JSON.stringify(dataValues(chinese))) throw Error(`Reference numeric values differ: ${id}`);
  if(JSON.stringify(displaySymbols(japanese))!==JSON.stringify(displaySymbols(chinese))) throw Error(`Reference symbols differ: ${id}`);
}
export function checkedJson(file,expectedHash) {
  const bytes=fs.readFileSync(file);
  if(expectedHash&&sha256(bytes)!==expectedHash)throw Error(`Hash mismatch: ${file}`);
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
}
export function sameItems(a,b) {return JSON.stringify(a)===JSON.stringify(b);}

// Read only publishable static records. Candidate tables and reference answers are not inputs.
export class StaticCorpusProbe {
  constructor(runtime) {
    this.records=runtime.records;
    this.exact=new Map();this.layout=new Map();
    for(const r of this.records) {
      for(const [index,key] of [[this.exact,r.japanese],[this.layout,layoutKey(r.japanese)]]) {
        const list=index.get(key)||[];list.push(r);index.set(key,list);
      }
    }
  }
  lookup(japanese,game='both') {
    const exact=(this.exact.get(japanese)||[]).filter(r=>game==='both'||r.game===game);
    const candidates=(this.layout.get(layoutKey(japanese))||[]).filter(r=>game==='both'||r.game===game);
    const translations=[...new Set(candidates.map(r=>r.chinese))];
    if(translations.length!==1)return {japanese,chinese:null,output:japanese,status:candidates.length?'ambiguous_static':'not_in_static_pack',exactMatch:exact.length>0,sources:candidates.map(r=>r.id)};
    return {japanese,chinese:translations[0],output:translations[0],status:'static_record_available',exactMatch:exact.length>0,sources:candidates.map(r=>r.id)};
  }
}
