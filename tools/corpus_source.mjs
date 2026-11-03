// Source reconstruction ported from outputs/pokeruby-text-audit/verify-source.mjs.
// Uses fixed English rev2 symbols and source definitions, never RSC byte counts.
import fs from 'node:fs';
import path from 'node:path';
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const hex = n => '0x' + n.toString(16).toUpperCase().padStart(6, '0');
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
export function reconstruct(source, symbolFile, game) {
const files = [...walk(path.join(source,'src')), ...walk(path.join(source,'data'))].filter(p=>/\.(?:c|h|s|inc)$/.test(p) && !/(?:_de\.|[\\/]data-de[\\/])/.test(p));
const chars = new Map(), tokens = new Map();
for (const line of read(path.join(source,'charmap.txt')).split('\n')) {
  let m = line.match(/^\s*(?:'((?:\\.|[^'])*)'|([A-Za-z_][\w]*))\s*=\s*((?:[\dA-F]{2}\s*)+)/);
  if(m) (m[1] !== undefined ? chars : tokens).set(m[1] ?? m[2],m[3].trim().split(/\s+/).map(x=>parseInt(x,16)));
}
chars.set("'", chars.get("\\'"));
// The corpus uses current battle placeholder names; rev2 still spells these as byte escapes.
for (const m of read(path.join(source,'include/battle_message.h')).matchAll(/^#define B_TXT_(\w+)\s+(0x[\da-f]+)/gmi)) {
  tokens.set('B_' + m[1], [0xFD, Number(m[2])]);
}
tokens.set('B_BUFF1', [0xFD, 0]);
tokens.set('B_BUFF2', [0xFD, 1]);
tokens.set('B_BUFF3', [0xFD, 0x2A]);
tokens.set('NOP', [0xFC, 7]);
tokens.set('WAIT_SE', [0xFC, 0x0A]);
tokens.set('MIN_LETTER_SPACING', [0xFC, 0x14]);
tokens.set('FONT_NORMAL', [0xFC, 6, 1]);
function encode(s) {
  const bytes=[];
  for(let i=0;i<s.length;) {
    if(s[i]==='{') {
      const end=s.indexOf('}',i); if(end<0) throw Error('unclosed token');
      for(const token of s.slice(i+1,end).trim().split(/\s+/)) {
        if(tokens.has(token)) bytes.push(...tokens.get(token));
        else if(/^0x[\da-f]+$/i.test(token)) { const value=parseInt(token,16); for(let n=0;n<Math.ceil((token.length-2)/2);n++)bytes.push((value >>> (8*n))&255); }
        else if(/^\d+$/.test(token)) bytes.push(Number(token));
        else throw Error('unknown token '+token);
      }
      i=end+1;
    } else if(s[i]==='\\' && s[i+1]==='x') { bytes.push(parseInt(s.slice(i+2,i+4),16)); i+=4; }
    else {
      const key=s[i]==='\\' ? s.slice(i,i+2) : s[i];
      if(chars.has(key)) bytes.push(...chars.get(key));
      else if(key==='\\"' && chars.has('“')) bytes.push(...chars.get('“'));
      else throw Error('unknown character '+JSON.stringify(key));
      i+=key.length;
    }
  }
  return bytes;
}
function preprocess(text,game) {
  const macros=new Map([['ENGLISH','1'],[game==='ruby'?'RUBY':'SAPPHIRE','1'],['REVISION','2'],['DEBUG','0'],['MODERN','0'],['DEBUG_FIX','0']]);
  const stack=[]; let active=true;
  const test=expr=>{
    expr=expr.replace(/defined\s*(?:\(\s*(\w+)\s*\)|(\w+))/g,(_,a,b)=>macros.has(a||b)?'1':'0');
    expr=expr.replace(/\b[A-Za-z_]\w*\b/g,x=>/^\d+$/.test(macros.get(x)||'')?macros.get(x):'0');
    if(!/^[\d\sxXa-fA-F()!<>=&|+\-*/%~]+$/.test(expr))return false;
    try{return !!Function('return ('+expr+')')();}catch{return false;}
  };
  const stripped=text.replace(/^\s*\.(if\w*|elseif|else|endif)\b/gm, (_,op)=>op==='elseif'?'#elif':['if','ifdef','ifndef','else','endif'].includes(op)?'#'+op:'#if 0 //').replace(/\/\*[\s\S]*?\*\//g,s=>s.replace(/[^\n]/g,' ')).replace(/\/\/[^\n]*/g,'');
  const result=stripped.split('\n').map(line=>{
    const m=line.match(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif|define|undef)\b(.*)/);
    if(!m)return active?line:'';
    const op=m[1],arg=m[2].trim();
    if(['if','ifdef','ifndef'].includes(op)){
      const cond=op==='ifdef'?macros.has(arg):op==='ifndef'?!macros.has(arg):test(arg);
      stack.push({parent:active,taken:cond});active=active&&cond;
    }else if(op==='else') {const f=stack.at(-1);active=f.parent&&!f.taken;f.taken=true;}
    else if(op==='elif'){const f=stack.at(-1),cond=!f.taken&&test(arg);active=f.parent&&cond;f.taken ||= cond;}
    else if(op==='endif'){active=stack.pop().parent;}
    else if(op==='define'&&active){const d=arg.match(/^(\w+)(?:\s+(.*))?$/);if(d)macros.set(d[1],d[2]??'1');}
    else if(op==='undef'&&active)macros.delete(arg);
    return '';
  }).join('\n');
  return {text:result,macros};
}
  const symbolText=read(symbolFile);
  const symbols=new Map();
  for(const m of symbolText.matchAll(/^([\da-f]{8})\s+\S\s+([\da-f]{8})\s+(\S+)$/gmi)){
    const address=parseInt(m[1],16)-0x08000000;if(address>=0&&address<0x2000000)symbols.set(m[3],{address,size:parseInt(m[2],16)});
  }
  const memory=new Map(),owners=new Map(),errors=[];
  const definitions=new Map(),processed=new Map();
  function put(address,bytes,name,file){
    for(let i=0;i<bytes.length;i++){
      if(memory.has(address+i)&&memory.get(address+i)!==bytes[i])errors.push({name,file,error:'conflicting reconstructed byte',address:hex(address+i)});
      memory.set(address+i,bytes[i]);owners.set(address+i,{name,start:address,file:path.relative(source,file).replaceAll('\\','/')});
    }
  }
  for(const file of files){
    const pp=preprocess(read(file),game);processed.set(path.relative(source,file).replaceAll('\\','/'),pp);
    if(/\.(?:s|inc)$/.test(file)){
      let address=null,name=null;
      for(const line of pp.text.split('\n')){
        let m=line.match(/^\s*(\w+)::?/);
        if(m){name=m[1];address=symbols.get(name)?.address??null;continue;}
        m=line.match(/^\s*\.string\s+"((?:\\.|[^"\\])*)"(?:\s*,\s*(\d+))?/);
        if(m&&address!==null){
          try{let bytes=encode(m[1]);if(m[2]){if(bytes.length>Number(m[2]))throw Error('width overflow');bytes=bytes.concat(Array(Number(m[2])-bytes.length).fill(0));}put(address,bytes,name,file);address+=bytes.length;}
          catch(e){errors.push({name,file:path.relative(source,file),error:e.message});address=null;}
        }else if(address!==null&&/^\s*\.(?:byte|2byte|4byte|incbin|include|align|space|ascii)\b/.test(line))address=null;
      }
    }else{
      const re=/\b(?:const\s+)?(?:u8|char)\s+(\w+)\s*\[\s*\]\s*=\s*_\(\s*((?:"(?:\\.|[^"\\])*"\s*)+)\)/g;
      for(const m of pp.text.matchAll(re)){
        if(!symbols.has(m[1]))continue;
        try{const raw=[...m[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map(x=>x[1]).join('');const bytes=[...encode(raw),255];if(symbols.get(m[1]).size && symbols.get(m[1]).size!==bytes.length)throw Error('scalar size differs from CI symbol: '+bytes.length+' vs '+symbols.get(m[1]).size);definitions.set(m[1],{raw,bytes,file});put(symbols.get(m[1]).address,bytes,m[1],file);}
        catch(e){errors.push({name:m[1],file:path.relative(source,file),error:e.message});}
      }
    }
  }
  // Known fixed-width and structure fields are reconstructed below, separately
  // from scalar declarations. Their offsets follow the GBA struct definitions.
  function rawExpression(expr,macros){
    expr=expr.trim().replace(/^_\(([\s\S]*)\)$/,'$1');
    for(let j=0;j<8&&/^\w+$/.test(expr)&&macros.has(expr);j++)expr=macros.get(expr);
    const literals=[...expr.matchAll(/"((?:\\.|[^"\\])*)"/g)];
    if(!literals.length)throw Error('unsupported string expression '+expr.slice(0,60));
    return literals.map(m=>m[1]).join('');
  }
  function addField(symbol,index,stride,offset,width,expr,pp,file){
    try{
      const bytes=[...encode(rawExpression(expr,pp.macros)),255];
      if(bytes.length>width)throw Error('field width overflow');
      put(symbols.get(symbol).address+index*stride+offset,bytes.concat(Array(width-bytes.length).fill(0)),`${symbol}[${index}]+${offset}`,path.join(source,file));
    }catch(e){errors.push({name:symbol,file,error:e.message});}
  }
  const addArray=(symbol,file,stride,field,offset,width)=>{
    const pp=processed.get(file);if(!pp||!symbols.has(symbol))throw Error('missing '+symbol);
    const start=pp.text.indexOf(symbol);const text=pp.text.slice(start,pp.text.indexOf('\n};',start));
    const re=new RegExp('\\.'+field+'\\s*=\\s*([^\\n]*?)(?:,|\\n)','g');
    const matches=[...text.matchAll(re)];
    if(symbols.get(symbol).size!==matches.length*stride)throw Error(`array size mismatch ${symbol}: ${matches.length} * ${stride} != ${symbols.get(symbol).size}`);
    matches.forEach((m,index)=>addField(symbol,index,stride,offset,width,m[1],pp,file));
    return matches.length;
  };
  addArray('gTrainers','src/data/trainers_en.h',40,'trainerName',4,12);
  addArray('gItems','src/data/items_en.h',44,'name',0,14);
  addArray('gPokedexEntries','src/data/pokedex_entries_en.h',36,'categoryName',0,12);
  addArray('gBattleTowerTrainers','src/data/battle_tower/trainers.h',24,'name',1,8);
  addArray('gContestOpponents','src/data/contest_opponents.h',64,'nickname',2,11);
  addArray('gContestOpponents','src/data/contest_opponents.h',64,'trainerName',13,8);
  addArray('gBerries','src/berry.c',28,'name',0,7);
  addArray('gDefaultContestWinners','src/contest_2.c',32,'nickname',11,11);
  addArray('gDefaultContestWinners','src/contest_2.c',32,'trainerName',22,8);
  {
    const file='src/decoration.c',pp=processed.get(file),start=pp.text.indexOf('gDecorations[]');
    const block=pp.text.slice(start,pp.text.indexOf('\n};',start));
    [...block.matchAll(/\{\s*DECOR_\w+\s*,\s*(_\("(?:\\.|[^"\\])*"\))/g)].forEach((m,i)=>addField('gDecorations',i,32,1,16,m[1],pp,file));
  }
  {
    const file='src/trade.c',pp=processed.get(file),start=pp.text.indexOf('gIngameTrades[]');
    const block=pp.text.slice(start,pp.text.indexOf('\n};',start));
    [...block.matchAll(/_\(("(?:\\.|[^"\\])*")\)/g)].forEach((m,i)=>addField('gIngameTrades',Math.floor(i/2),60,i%2?43:0,11,m[1],pp,file));
  }
  {
    const file='src/easy_chat_2.c',pp=processed.get(file),start=pp.text.indexOf('gUnknown_083DBEAC[][32]');
    const block=pp.text.slice(start,pp.text.indexOf('\n};',start));
    [...block.matchAll(/_\(("(?:\\.|[^"\\])*")\)/g)].forEach((m,i)=>addField('gUnknown_083DBEAC',i,32,0,32,m[1],pp,file));
  }
  {
    const file='src/data/text/species_names_en.h',pp=processed.get(file);
    const expr=pp.text.match(/\[SPECIES_NONE\]\s*=\s*(_\("(?:\\.|[^"\\])*"\))/)[1];
    addField('gSpeciesNames',0,11,0,11,expr,pp,file);
  }
  {
    const file='src/data/region_map/region_map_sections.json';
    for(const section of JSON.parse(read(path.join(source,file))).map_sections){
      for(const name of ['sMapName_'+section.id.replace(/^MAPSEC_/,''),'sMapName_'+section.name.replace(/\W/g,'_')])
        if(symbols.has(name))put(symbols.get(name).address,[...encode(section.name),255],name,path.join(source,file));
    }
  }
  {
    const file='src/data/text/trainer_class_names_en.h',pp=processed.get(file);
    [...pp.text.matchAll(/_\(("(?:\\.|[^"\\])*")\)/g)].forEach((m,i)=>addField('gTrainerClassNames',i,13,0,13,m[1],pp,file));
  }

  // Fixed-width name arrays absent from the older address audit's reconstruction.
  for (const [symbol,file,width] of [
    ['gSpeciesNames','src/data/text/species_names_en.h',11],
    ['gMoveNames','src/data/text/move_names_en.h',13],
  ]) {
    const pp = processed.get(file);
    const expressions = [...pp.text.matchAll(/\[\w+\]\s*=\s*(_\("(?:\\.|[^"\\])*"\))/g)];
    if (symbols.get(symbol).size !== expressions.length * width) throw Error(`Array size mismatch: ${symbol}`);
    expressions.forEach((m,i) => addField(symbol,i,width,0,width,m[1],pp,file));
  }
return {memory, owners, symbols, errors, encode, tokens, chars, processed};
}
