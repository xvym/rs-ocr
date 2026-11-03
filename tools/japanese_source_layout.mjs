// Layout-driven decomposition of observed text. Every non-space character stays
// in a component's raw span; values and punctuation are retained as fields.
// This describes retrieval hypotheses, not approved Chinese composition rules.
export function compositeUnits(raw,type) {
  const units=[];
  const field=(role,value)=>({role,raw:value,approvedForTranslation:false});
  const push=(start,end,searchText=raw.slice(start,end),kind=null,visibleFields=[])=>{
    units.push({text:raw.slice(start,end),start,end,searchText,kind,visibleFields,segmentation:'composite',compositionRule:type});
  };
  const lines=[...raw.matchAll(/[^\n]+/g)].map(m=>({text:m[0],start:m.index,end:m.index+m[0].length}));
  const line=l=>push(l.start,l.end);
  const words=(l,kind=null)=>{for(const m of l.text.matchAll(/[^ \u3000]+/g))push(l.start+m.index,l.start+m.index+m[0].length,m[0],kind);};
  if(!lines.length)return null;
  if(['summary_ability','summary_move_description','summary_contest_description'].includes(type)) {
    line(lines[0]);
    if(type==='summary_ability'&&lines.length>=2){push(lines[1].start,lines[1].end,lines[1].text,'ability');if(lines.length>2)push(lines[2].start,raw.length,raw.slice(lines[2].start),'ability_description');}
    else if(lines.length>1)push(lines[1].start,raw.length,raw.slice(lines[1].start),type==='summary_move_description'?'move_description':null);
  } else if(['summary_battle_moves','summary_contest_moves'].includes(type)) {
    line(lines[0]);
    for(const l of lines.slice(1)) {
      const m=/^([^ \u3000]+)[ \u3000]+(.+?)[ \u3000]+PP[ \u3000]*([0-9０-９]+)[ \u3000]*\/[ \u3000]*([0-9０-９]+)$/.exec(l.text);
      if(!m){line(l);continue;}
      push(l.start,l.start+m[1].length,m[1],type==='summary_battle_moves'?'type':null);
      const offset=l.text.indexOf(m[2],m[1].length);
      push(l.start+offset,l.end,m[2],'move',[field('current_pp',l.text.slice(offset+m[2].length))]);
    }
  } else if(type==='summary_stats') {
    line(lines[0]);
    for(const l of lines.slice(1)) {
      const matches=[...l.text.matchAll(/(HP|こうげき|ぼうぎょ|とくこう|とくぼう|すばやさ)[ \u3000]+([0-9０-９]+(?:[ \u3000]*\/[ \u3000]*[0-9０-９]+)?)/g)];
      if(!matches.length||l.text.replace(/(HP|こうげき|ぼうぎょ|とくこう|とくぼう|すばやさ)[ \u3000]+([0-9０-９]+(?:[ \u3000]*\/[ \u3000]*[0-9０-９]+)?)/g,'').trim()){line(l);continue;}
      for(const m of matches)push(l.start+m.index,l.start+m.index+m[0].length,m[1],null,[field('current_stat',m[2])]);
    }
  } else if(type==='summary_experience') {
    for(const l of lines) {
      const m=/^(げんざいのけいけんち|レベルアップまで)[ \u3000]+(?:(あと)[ \u3000]+)?([0-9０-９]+)$/.exec(l.text);
      if(!m){line(l);continue;}
      if(m[2]){
        push(l.start,l.start+m[1].length,m[1]);
        const index=l.text.indexOf(m[2],m[1].length);push(l.start+index,l.end,m[2],null,[field('current_experience_remaining',m[3])]);
      }else push(l.start,l.end,m[1],null,[field('current_experience',m[3])]);
    }
  } else if(type==='summary_personal') {
    for(const l of lines) {
      const owner=/^(おや\/)(.+?)[ \u3000]+IDNo([0-9０-９]+)$/.exec(l.text);
      const types=/^(タイプ\/)(.+)$/.exec(l.text);
      if(owner)push(l.start,l.end,owner[1],null,[field('visible_original_trainer',owner[2]),field('visible_trainer_id',owner[3])]);
      else if(types){push(l.start,l.start+types[1].length,types[1]);const tail={text:types[2],start:l.start+types[1].length};words(tail,'type');}
      else line(l);
    }
  } else if(type==='summary_memo') {
    for(const l of lines) {
      const m=/^(.+?)(なせいかく)[ \u3000]+Lv([0-9０-９]+)(のとき)$/.exec(l.text);
      if(!m){line(l);continue;}
      push(l.start,l.start+m[1].length,m[1],'nature');
      push(l.start+m[1].length,l.start+m[1].length+m[2].length,'せいかく',null,[field('grammatical_connector','な')]);
      push(l.start+l.text.indexOf('Lv'),l.end,m[4],null,[field('visible_met_level',m[3])]);
    }
  } else if(['summary_item','summary_ribbon','summary_contest_effect','berry_tag_description'].includes(type)) {
    for(const l of lines)line(l);
  } else if(type==='save_summary') {
    for(const l of lines){
      const m=/^(しゅじんこう|もっているバッジ|ポケモンずかん|プレイじかん)[ \u3000]+(.+)$/.exec(l.text);
      if(m)push(l.start,l.end,m[1],null,[field(m[1]==='しゅじんこう'?'visible_player_name':'visible_save_value',m[2])]);
      else line(l);
    }
  } else if(type==='condition_identity') {
    const m=/^(.+?)[ \u3000]+([♂♀])\/Lv([0-9０-９]+)$/.exec(raw);
    if(!m)return null;
    push(0,raw.length,m[1],null,[field('visible_gender',m[2]),field('visible_level',m[3])]);
  } else if(type==='condition_message') {
    const m=/^(.+?)(に ポロックを あげますか？|に みがきが かかった！)$/.exec(raw);
    if(!m)return null;
    push(0,m[1].length,m[1]);push(m[1].length,raw.length,m[2]);
  } else if(type==='blender_message') {
    if(lines.length!==2)return null;
    const made=/^(.+?)([ \u3000]+ができた！)$/.exec(lines[0].text);
    const values=/^(レベル)([0-9０-９]+)(で[ \u3000]+なめらかさは)([0-9０-９]+)(だ)$/.exec(lines[1].text);
    if(!made||!values)return null;
    push(0,made[1].length,made[1]);push(made[1].length,lines[0].end,made[2]);
    const offset=lines[1].start;
    push(offset,offset+values[1].length+values[2].length,values[1],null,[field('visible_block_level',values[2])]);
    const next=offset+values[1].length+values[2].length;
    push(next,next+values[3].length+values[4].length,values[3],null,[field('visible_smoothness',values[4])]);
    push(lines[1].end-values[5].length,lines[1].end,values[5]);
  } else if(type==='condition_hint') {
    const m=/^(せいかく\/)(.+)$/.exec(raw);
    if(!m)return null;
    push(0,m[1].length,'せいかく',null,[field('layout_separator','/')]);push(m[1].length,raw.length,m[2],'nature');
  } else if(type==='condition_graph'||type==='block_flavors') {
    for(const l of lines)for(const m of l.text.matchAll(/[^ \u3000]+/g)){
      const number=/^(なめらかさ)([0-9０-９]+)$/.exec(m[0]);
      push(l.start+m.index,l.start+m.index+m[0].length,number?number[1]:m[0],null,number?[field('current_smoothness',number[2])]:[]);
    }
  } else if(type==='battle_move_meta') {
    for(const l of lines){
      const pp=/^PP[ \u3000]*([0-9０-９]+)[ \u3000]*\/[ \u3000]*([0-9０-９]+)$/.exec(l.text);
      const type=/^(わざタイプ\/)(.+)$/.exec(l.text);
      if(pp)push(l.start,l.end,'PP',null,[field('current_pp',l.text.slice(2))]);
      else if(type){push(l.start,l.start+type[1].length,'タイプ/',null,[field('field_qualifier','わざ')]);push(l.start+type[1].length,l.end,type[2],'type');}
      else line(l);
    }
  } else return null;
  // Malformed or unsupported rows remain full queries above. This check also
  // prevents a parser change from silently dropping visible Japanese or digits.
  const covered=new Set();for(const u of units)for(let i=u.start;i<u.end;i++)covered.add(i);
  for(let i=0;i<raw.length;i++)if(!/[ \u3000\r\n]/.test(raw[i])&&!covered.has(i))throw Error(`Unaccounted layout character at ${i}`);
  return units;
}
