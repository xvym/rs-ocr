import fs from 'node:fs';
import crypto from 'node:crypto';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const read = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
export const hex = n => '0x' + n.toString(16).toUpperCase().padStart(6, '0');
export function lines(text) {
  // Remove one file terminator, never blank records inside or at the end.
  return text.replace(/\r?\n$/, '').split(/\r?\n/);
}
export function parseAligned(qid, japanese, english) {
  const columns = [qid, japanese, english].map(lines);
  if (new Set(columns.map(x => x.length)).size !== 1) throw Error('Aligned corpus line counts differ');
  const seen = new Set();
  return columns[0].map((id, i) => {
    if (!id || seen.has(id)) throw Error(`Empty or duplicate qid at line ${i + 1}: ${id}`);
    seen.add(id);
    const game = id.includes('^R.') ? 'ruby' : id.includes('^S.') ? 'sapphire' : 'both';
    return {qid:id, line:i + 1, japanese:columns[1][i], english:columns[2][i], game};
  });
}
export function parseRsc(text) {
  const entries = [...text.matchAll(/\{\s*地址=(0x[\da-f]+)\s+字节数=(\d+)\s+文本=([\s\S]*?)\r?\n[ \t]*\}/gi)]
    .map((m, i) => ({index:i + 1, address:Number(m[1]), declaredBytes:Number(m[2]), chinese:m[3].trim()}));
  if ((text.match(/地址=/g) || []).length !== entries.length) throw Error('Unparsed RSC entries');
  if (new Set(entries.map(x => x.address)).size !== entries.length) throw Error('Duplicate RSC address');
  return entries;
}
export function parseDictionary(text) {
  return [...text.matchAll(/\{\s*原文=([^\r\n]+)\r?\n\s*译文=([^\r\n]+)\r?\n\s*\}/g)]
    .map(m => ({english:m[1].trim(), chinese:m[2].trim(), line:text.slice(0,m.index).split('\n').length}));
}
export function csv(rows, columns) {
  return '\uFEFF' + [columns, ...rows.map(r => columns.map(k => r[k] ?? ''))]
    .map(row => row.map(v => '"' + String(v).replaceAll('"','""') + '"').join(',')).join('\r\n') + '\r\n';
}
export function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {value += '"'; i++;} else quoted = !quoted;
    } else if (c === ',' && !quoted) {row.push(value); value = '';}
    else if (c === '\n' && !quoted) {row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '';}
    else value += c;
  }
  if (quoted) throw Error('Unclosed CSV quote');
  if (value || row.length) {row.push(value.replace(/\r$/, '')); rows.push(row);}
  const columns = rows.shift() || [];
  return rows.map(r => {
    if (r.length !== columns.length) throw Error('Invalid CSV width');
    return Object.fromEntries(columns.map((k,i) => [k,r[i]]));
  });
}
export const tokensIn = text => [...text.matchAll(/(?<!\\)\[([^\]]+)\]/g)].map(m => m[1]);
export const termKey = text => text.toUpperCase().replace(/[ .\-’']/g, '');

export function sourceBytes(memory, address) {
  const bytes = [];
  for (let i = address; i < address + 4096; i++) {
    if (!memory.has(i)) return null;
    const value=memory.get(i);
    if (value === 255) return Buffer.from(bytes);
    bytes.push(value);
    let args=0;
    if(value===0xFD) args=1;
    if(value===0xFC) {
      const opcode=memory.get(++i),arities=[0,1,1,1,3,1,1,0,1,0,0,2,1,1,1,0,2,1,1,1,1,0,0,0,0];
      if(opcode===undefined || arities[opcode]===undefined) return null;
      bytes.push(opcode);args=arities[opcode];
    }
    for(let j=0;j<args;j++) {
      const arg=memory.get(++i);
      if(arg===undefined)return null;
      bytes.push(arg);
    }
  }
  return null;
}

export function toSourceEnglish(text) {
  let result='';
  for(let i=0;i<text.length;i++) {
    if(text[i]==='\\') {
      const escaped=text[++i],mapped={n:'\\n',r:'\\l',c:'\\p','\\':'\\\\','[':'[','{':'{'}[escaped];
      if(mapped===undefined)throw Error(`Unsupported corpus escape: ${escaped}`);
      result+=mapped;
    } else if(text[i]==='[') {
      const end=text.indexOf(']',i);
      if(end<0)throw Error('Unclosed corpus token');
      result+='{'+text.slice(i+1,end)+'}';i=end;
    } else if(text.startsWith('⒆⒇',i)) {result+='{PKMN}';i++;}
    else result+=text[i];
  }
  return result;
}

// Reviews are explicit, input-bound decisions. Candidate generation alone cannot approve a translation.
export function applyReview(review, record, candidates) {
  if (review.japanese !== record.japanese || review.english !== record.english) throw Error(`Stale review: ${record.qid}`);
  if (!['model_reviewed','human_reviewed','rsc_original_retained'].includes(review.method) || !review.reason || !review.chinese) throw Error('Incomplete review');
  const found = candidates.filter(c => c.qid === record.qid && c.game === review.game && c.chinese === review.originalChinese);
  const originals=[...new Set(candidates.filter(c=>c.qid===record.qid&&c.game===review.game).map(c=>c.chinese))].sort();
  if (JSON.stringify([...(review.originalCandidates||[])].sort())!==JSON.stringify(originals)) throw Error(`Stale review candidate set: ${record.qid}`);
  if (review.action !== 'retain') throw Error('RSC-only policy rejects supplement, correction and unification');
  if (!found.length) throw Error(`Review original translation not found: ${record.qid}`);
  if (review.chinese !== review.originalChinese) throw Error('Retain review changes text');
  return found;
}
