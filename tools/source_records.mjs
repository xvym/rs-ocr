import {project,sourceKind} from './japanese_source_matcher.mjs';

// Whole-record printing only. No page/line-number alignment, substring lookup,
// buffer-number inference, or generated Chinese. Original strings stay intact.
const roles={PLAYER:'[玩家]',RIVAL:'[对手]',KUN:'[占位符]',B_ATK_NAME_WITH_PREFIX:'[LegendPokemon1]',B_DEF_NAME_WITH_PREFIX:'[LegendPokemon2]'};
// PrintNextChar/ExtCtrlCode handlers change style, sound, or timing here;
// cursor movement, clearing, arbitrary buffers and display symbols stay blocked.
const nonprintingJp=/^(?:PAUSE_UNTIL_PRESS|WAIT_SE|NOP|FONT_NORMAL|PAUSE [0-9]+|PALETTE [0-9]+|(?:PLAY_SE|PLAY_BGM) [A-Z0-9_]+|(?:COLOR|HIGHLIGHT|SHADOW) [A-Z0-9_]+|COLOR_HIGHLIGHT_SHADOW [A-Z0-9_]+ [A-Z0-9_]+ [A-Z0-9_]+)$/;
const nonprintingZh=/^(?:等待按键|等待提示音|日文|英文|(?:延时|调色板|文本色|背景色|阴影色)[0-9A-Fa-f]{2}|字景色[0-9A-Fa-f]{6}|(?:提示音|播放音乐)[0-9A-Fa-f]{4})$/;
const groups={ability_description:['summary_ability'],item_description:['bag_description','shop_description','pc_item_description'],move_description:['summary_move_description'],dialogue:['field_dialog','boot_dialog','party_prompt','party_short_prompt','party_recovery'],battle:['battle_message','battle_prompt']};
const uiTypes=['field_dialog','boot_dialog','save_summary','bag_category','bag_action','bag_prompt','shop_menu','pc_connect_menu','pc_pokemon_menu','pc_item_menu','pc_store_menu','pc_item_heading','party_prompt','party_short_prompt','party_field_action','party_battle_action','party_recovery','party_cancel','summary_personal','summary_ability','summary_memo','summary_item','summary_ribbon','summary_stats','summary_experience','battle_action','battle_move_meta'];

export function sourcePrint(text,language) {
  let value='',slots=[];const controls=[];
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='\\') {
      const next=text[++i];
      if((language==='jp'?'nrc':'nlp').includes(next??'\0'))value+=next===(language==='jp'?'c':'p')?'\n\n':'\n';
      else return {reason:'unsupported_printing_control',control:'escape:'+next};
    } else if(c==='[') {
      const end=text.indexOf(']',i);if(end<0)return {reason:'unsupported_printing_control',control:'unclosed_token'};
      const token=text.slice(i+1,end);i=end;
      const role=language==='jp'?Object.hasOwn(roles,token)?token:null:Object.keys(roles).find(k=>roles[k]==='['+token+']');
      if(role){slots.push(role);value+=language==='jp'?'\uE000'+role+'\uE001':roles[role];}
      else if((language==='jp'?nonprintingJp:nonprintingZh).test(token))controls.push(token);
      else return {reason:language==='jp'&&/^(?:STR_VAR|B_|EVIL_|GOOD_|VERSION)/.test(token)||language==='zh'&&/^(?:buffer|BUFFER|LegendPokemon|Team|Version)/.test(token)?'unverified_variable_binding':'unsupported_printing_control',control:token};
    } else if(/[\]{}\uE000\uE001�\x00-\x08\x0B\x0C\x0E-\x1F]/.test(c))return {reason:'unsupported_printing_control',control:c};
    else value+=c;
  }
  return {value,slots:[...new Set(slots)],controls};
}

function compile(r,candidates,contexts={}) {
  if(!r.japanese||r.japanese==='[NULL]')return {reason:'empty_or_null_japanese'};
  if(r.qid.split('.')[2]?.startsWith('pokedex_entries'))return {reason:'pokedex_page_alignment_required'};
  const texts=[...new Set(candidates.map(c=>c.chinese))];
  if(texts.length!==1)return {reason:'conflicting_original_candidates'};
  const jp=sourcePrint(r.japanese,'jp'),zh=sourcePrint(texts[0],'zh');
  if(jp.reason)return jp;if(zh.reason)return zh;
  if(!jp.value.trim()||!zh.value.trim())return {reason:'empty_printed_text'};
  if(jp.slots.some(s=>!zh.slots.includes(s))||zh.slots.some(s=>!jp.slots.includes(s)))return {reason:'unverified_variable_binding'};
  const kind=sourceKind(r.qid),types=groups[kind]||uiTypes;
  const tokens=project(jp.value,{display:true}).key.split(/(\uE000[^\uE001]+\uE001)/).filter(Boolean).map(p=>p.startsWith('\uE000')?{slot:p.slice(1,-1),singleLine:true,...(p==='\uE000KUN\uE001'?{choices:['くん','ちゃん']}:{})}:{literal:p});
  const fixed=tokens.filter(t=>t.literal).reduce((n,t)=>n+t.literal.length,0);
  if(jp.slots.length&&(fixed<6||jp.slots.length>3||tokens.some((t,i)=>t.slot&&tokens[i+1]?.slot&&tokens[i+1].slot!=='KUN')))return {reason:'ambiguous_variable_boundaries'};
  return {kind,types,context:contexts[r.qid]||null,matchText:jp.value,outputText:zh.value,mode:jp.slots.length?'named_template':'whole_static_record',tokens,fixed,
    bindings:Object.fromEntries(jp.slots.map(slot=>[roles[slot],slot])),printing:{japaneseControls:jp.controls,chineseControls:zh.controls,wholeSourceRequired:true}};
}

export function compileSourceRecords(records,candidates,existing=[],contexts={}) {
  const byPair=new Map(),known=new Set(existing.map(r=>r.qid+':'+r.game));
  for(const c of candidates){const key=c.qid+':'+c.game;if(!byPair.has(key))byPair.set(key,[]);byPair.get(key).push(c);}
  const output=[],inventory=[];
  for(const r of records)for(const game of r.game==='both'?['ruby','sapphire']:[r.game]) {
    const id=r.qid+':'+game,cs=byPair.get(id)||[];
    if(known.has(id)){inventory.push({qid:r.qid,game,status:'existing_registration'});continue;}
    if(!cs.length){inventory.push({qid:r.qid,game,status:'original_correspondence_required'});continue;}
    const compiled=compile(r,cs,contexts);
    if(compiled.reason){inventory.push({qid:r.qid,game,status:compiled.reason,...(compiled.control?{control:compiled.control}:{})});continue;}
    output.push({id,qid:r.qid,game,japanese:r.japanese,chinese:cs[0].chinese,candidateIds:cs.map(c=>c.id),selection:'unique_original_whole_source',...compiled});
    inventory.push({qid:r.qid,game,status:compiled.mode});
  }
  const statuses=Object.fromEntries([...new Set(inventory.map(r=>r.status))].map(k=>[k,inventory.filter(r=>r.status===k).length]));
  return {schemaVersion:1,contexts,records:output,inventory,summary:{records:output.length,statuses,generatedChineseRecords:0,rewrittenChineseRecords:0,complete:false}};
}

export function validateSourceRecords(rows,records,candidates,contexts={}) {
  const source=new Map(records.map(r=>[r.qid,r])),byId=new Map(candidates.map(c=>[c.id,c])),seen=new Set();
  for(const row of rows) {
    const r=source.get(row.qid),cs=row.candidateIds.map(id=>byId.get(id));
    if(!r||seen.has(row.id)||row.id!==row.qid+':'+row.game||r.game!=='both'&&r.game!==row.game||row.japanese!==r.japanese||!cs.length||cs.some(c=>!c||c.qid!==row.qid||c.game!==row.game||c.chinese!==row.chinese))throw Error('Invalid whole-source provenance '+row.id);
    seen.add(row.id);const rebuilt=compile(r,cs,contexts);
    for(const k of ['kind','types','context','matchText','outputText','mode','tokens','fixed','bindings','printing'])if(JSON.stringify(row[k])!==JSON.stringify(rebuilt[k]))throw Error('Changed whole-source printing or binding '+row.id+':'+k);
  }
}
