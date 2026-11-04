// Retrieval only: none of these operations author Chinese or approve runtime output.
export const stripControls=text=>text.replace(/\\[nrclp]/g,' ').replace(/\[[^\]]*\]|\{[^}]*\}/g,' ');
export const normalized=text=>stripControls(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const decoderTables=new WeakMap();
export function decodeSource(bytes,engine){
  if(!bytes)return null;
  if(!decoderTables.has(engine))decoderTables.set(engine,[...engine.chars].map(([text,value])=>({text,value})).sort((a,b)=>b.value.length-a.value.length));
  const chars=decoderTables.get(engine);
  const arities=[0,1,1,1,3,1,1,0,1,0,0,2,1,1,1,0,2,1,1,1,1,0,0,0,0];
  let text='';
  for(let i=0;i<bytes.length;){
    if(bytes[i]===0xFD){if(i+1>=bytes.length)return null;text+=`{VAR_${bytes[i+1].toString(16)}}`;i+=2;continue;}
    if(bytes[i]===0xFC){const n=arities[bytes[i+1]];if(n===undefined||i+2+n>bytes.length)return null;text+=`{CTRL_${bytes[i+1].toString(16)}}`;i+=2+n;continue;}
    const c=chars.find(c=>c.value.every((b,j)=>bytes[i+j]===b));
    if(!c)return null;text+=c.text;i+=c.value.length;
  }
  return text;
}
const stop=new Set('a an the of to and is are was were be been for in on at it its this that with as by from your you i me my we our they their he she his her have has do does did will would can could'.split(' '));
export function englishTerms(text){return [...new Set((stripControls(text).normalize('NFKC').toLowerCase().match(/[a-zé]+|\d+/g)||[]).filter(t=>!stop.has(t)))];}
export function createRanker(documents){
  const inverted=new Map();
  const documentTerms=documents.map(d=>englishTerms(d.english||''));
  for(const [i,terms] of documentTerms.entries())for(const token of terms){const list=inverted.get(token)||[];list.push(i);inverted.set(token,list);}
  return (query,{game,limit=5}={})=>{
    const scores=new Map(),terms=englishTerms(query);
    for(const token of terms){const ids=inverted.get(token)||[],weight=Math.log(1+documents.length/(1+ids.length));for(const id of ids){if(game&&documents[id].game&&documents[id].game!==game)continue;scores.set(id,(scores.get(id)||0)+weight);}}
    return [...scores].map(([i,score])=>({document:documents[i],score:score/Math.sqrt(Math.max(1,documentTerms[i].length))})).sort((a,b)=>b.score-a.score||a.document.id.localeCompare(b.document.id)).slice(0,limit);
  };
}
