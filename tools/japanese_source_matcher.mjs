import fs from 'node:fs';
import path from 'node:path';
import {parseAligned,parseCsv,read,sha256} from './corpus_common.mjs';
import {compositeUnits} from './japanese_source_layout.mjs';
import {BattleSourceMatcher,battleMeaningConsensus} from './battle_source_matcher.mjs';

const WS=/[ \u3000\r\n]/;
const SLOT=/^(PLAYER|RIVAL|STR_VAR_[123]|KUN|VERSION|EVIL_TEAM|GOOD_TEAM|EVIL_LEADER|GOOD_LEADER|EVIL_LEGENDARY|GOOD_LEGENDARY|B_BUFF[123]|B_COPY_VAR_[123]|B_TRAINER[12]_CLASS|B_(?:ATK|DEF|SCR_ACTIVE|ACTIVE|EFF|LINK_PARTNER|LINK_PLAYER_MON[12]|LINK_OPPONENT[12]|LINK_OPPONENT_MON[12]|LINK_SCR_TRAINER|OPPONENT_MON[12]|PLAYER|TRAINER[12]|OPPONENT[12])_NAME(?:_WITH_PREFIX)?|B_(?:ATK|DEF|SCR_ACTIVE|CURRENT|LAST)_(?:ABILITY|MOVE|ITEM)|B_(?:ATK|DEF)_PREFIX[123]|B_PC_CREATOR_NAME)$/;
// Elision is a retrieval hypothesis only; positioning, clearing, font and unknown
// functions remain unsupported. It is never an approval of printing semantics.
const NONPRINTING=/^(?:COLOR(?:_HIGHLIGHT_SHADOW)?|HIGHLIGHT|SHADOW|PALETTE|PAUSE|PLAY_SE|PLAY_BGM)(?: [A-Z0-9_ ]+)?$|^(?:PAUSE_UNTIL_PRESS|WAIT_SE|NOP)$/;
const applicable=(r,game)=>game==='both'||r.game==='both'||r.game===game;
const add=(map,key,value)=>{const list=map.get(key)||[];list.push(value);map.set(key,list);};
const BATTLE_MENU_QIDS=new Set(['rs.common.battle_strings.BattleText_MenuOptions','rs.common.battle_strings.BattleText_MenuOptionsSafari']);

// Keep original offsets and digit boundaries. The default is width-sensitive;
// the explicit display projection folds only digits, H/P and the slash.
// No NFKC, case conversion or kana substitution is applied.
export function project(text,{display=false}={}) {
  let key='';const offsets=[];
  for(let i=0;i<text.length;i++) {
    if(WS.test(text[i])) {
      let end=i+1;while(end<text.length&&WS.test(text[end]))end++;
      if(/[0-9０-９]/.test(text[i-1]||'')&&/[0-9０-９]/.test(text[end]||'')) {key+=' ';offsets.push(i);}
      i=end-1;
    } else {
      const c=text[i];key+=display&&/[０-９ＨＰ]/.test(c)?String.fromCharCode(c.charCodeAt(0)-0xFEE0):display&&c==='／'?'/':c;
      offsets.push(i);
    }
  }
  return {key,offsets};
}

export function parseSource(text) {
  const pages=[['']];const slots=new Set(),controls=[],unsupported=[];
  let current=()=>pages.at(-1);
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='\\') {
      const next=text[++i];
      if(next==='c')pages.push(['']);
      else if(next==='n'||next==='r')current().push('');
      else if(['\\','[','{'].includes(next))current()[current().length-1]+=next;
      else unsupported.push(`escape:${next??'EOF'}`);
    } else if(c==='[') {
      const end=text.indexOf(']',i);
      if(end<0){unsupported.push('unclosed_token');break;}
      const token=text.slice(i+1,end);i=end;
      if(SLOT.test(token)){slots.add(token);current()[current().length-1]+=`\uE000${token}\uE001`;}
      else if(NONPRINTING.test(token))controls.push(token);
      else unsupported.push(token);
    } else if(c==='{')unsupported.push('furigana_or_unclassified_brace');
    else current()[current().length-1]+=c;
  }
  return {pages,slots:[...slots],controls,unsupported};
}

export function sourceKind(qid) {
  if(qid.startsWith('native.label.'))return 'native_label';
  const group=qid.split('.')[2];
  return ({species_names:'species',move_names:'move',move_descriptions:'move_description',type_names:'type',ability_names:'ability',items:'item',item_descriptions:'item_description',ability_descriptions:'ability_description',nature_names:'nature',battle_strings:'battle',battle_message:'battle'})[group]||
    (qid.startsWith('rs.script.')?'dialogue':group?.includes('battle')?'battle':'ui');
}

function piecesFor(source) {
  const pieces=[];
  for(let page=0;page<source.pages.length;page++) {
    const lines=source.pages[page];
    // Complete pages plus one- and two-line windows. Never concatenate across
    // clear-window boundaries. Partial words are handled separately as hints.
    for(let start=0;start<lines.length;start++) {
      const sizes=new Set([1,2]);if(start===0)sizes.add(lines.length);
      for(const count of sizes) {
        if(start+count>lines.length)continue;
        const text=lines.slice(start,start+count).join('\n'),key=project(text,{display:true}).key;
        if(!key)continue;
        const whole=source.pages.length===1&&start===0&&count===lines.length;
        pieces.push({text,key,page,lineStart:start,lineCount:count,displayProjection:project(text).key!==key,mode:whole?'full_record':'control_window'});
      }
    }
  }
  return pieces;
}

function compileTemplate(piece) {
  const parts=piece.key.split(/(\uE000[^\uE001]+\uE001)/),names=[];
  const tokens=[];let fixed=0,previousSlot=false;
  for(const part of parts) {
    if(part.startsWith('\uE000')) {
      const slot=part.slice(1,-1);
      // Only a finite Japanese honorific may follow a name without a literal
      // delimiter. Arbitrary adjacent buffers still cannot be separated.
      if(previousSlot&&!(slot==='KUN'&&['PLAYER','RIVAL'].includes(tokens.at(-1)?.slot)))return null;
      names.push(slot);tokens.push({slot,...(slot==='KUN'?{choices:['くん','ちゃん']}:{} )});previousSlot=true;
    } else {if(part)tokens.push({literal:part});fixed+=part.length;if(part)previousSlot=false;}
  }
  // A name or a bare buffer cannot match arbitrary text. Short templates need
  // call-site rules before use. Total query length and matching work are bounded.
  if((fixed<6&&!(fixed>=4&&names.length===1))||names.length>4)return null;
  return {...piece,tokens,names,fixed};
}

function matchTemplate(template,projection,raw) {
  if(template.fixed/Math.max(1,projection.key.length)<0.25)return {matches:[],complete:true};
  const results=[],key=projection.key;
  let steps=0,overflow=false;
  function visit(index,offset,bindings,seen) {
    if(++steps>4096||results.length>=16){overflow=true;return;}
    if(index===template.tokens.length){if(offset===key.length)results.push({...template,bindings});return;}
    const token=template.tokens[index];
    if(token.literal){if(key.startsWith(token.literal,offset))visit(index+1,offset+token.literal.length,bindings,seen);return;}
    for(let end=offset+1;end<=Math.min(key.length,offset+64);end++) {
      if(token.choices&&!token.choices.includes(key.slice(offset,end)))continue;
      const next=template.tokens[index+1];if(next?.literal&&!key.startsWith(next.literal,end))continue;
      if(!next&&end!==key.length)continue;
      const value=key.slice(offset,end),startRaw=projection.offsets[offset],endRaw=projection.offsets[end-1]+1;
      if(token.slot==='VISIBLE_RIBBON_COUNT'&&!/^[0-9]{1,2}$/.test(value))continue;
      const rawValue=raw.slice(startRaw,endRaw),identity=rawValue.replace(/[\r\n]/g,'');
      if(value.includes('�')||/[\uE000\uE001]/.test(value)||(seen.has(token.slot)&&seen.get(token.slot)!==identity))continue;
      const nextSeen=new Map(seen);nextSeen.set(token.slot,identity);
      visit(index+1,end,[...bindings,{slot:token.slot,raw:rawValue,normalized:value,start:startRaw,end:endRaw,
        semanticType:token.slot==='PLAYER'?'player_identity_hypothesis':token.slot==='RIVAL'?'rival_identity_hypothesis':token.slot==='KUN'?'honorific_hypothesis':'unreviewed_callsite_buffer',
        crossesObservedLineBreak:/[\r\n]/.test(rawValue),completeness:'syntactic_span_requires_callsite_review',approvedForTranslation:false}],nextSeen);
      if(overflow)return;
    }
  }
  visit(0,0,[],new Map());
  // An incomplete search must never appear as a unique binding solution.
  return {matches:results.map(r=>({...r,bindingSearchComplete:!overflow,bindingInterpretations:results.length})),complete:!overflow};
}

export class JapaneseSourceMatcher {
  constructor(records,{candidates=[],runtime={records:[]},battleTemplates=null}={}) {
    this.records=records;this.exact=new Map();this.layout=new Map();this.templates=[];this.fragments=[];this.unsupported=[];
    this.candidates=new Map();this.runtime=new Map();
    this.battle=battleTemplates?new BattleSourceMatcher(battleTemplates,{records,project}):null;
    for(const c of candidates)add(this.candidates,c.qid,c);
    for(const r of runtime.records)add(this.runtime,r.qid,r);
    for(const record of records) {
      if(!record.japanese||record.japanese==='[NULL]')continue;
      const kind=sourceKind(record.qid),parsed=parseSource(record.japanese);
      if(parsed.unsupported.length){this.unsupported.push({qid:record.qid,tokens:parsed.unsupported});continue;}
      const source={...record,kind,controls:parsed.controls};
      if(!parsed.slots.length&&!this.battle?.sourceQids.has(record.qid))add(this.exact,record.japanese,{record:source,mode:'exact_record',page:0,lineStart:0,lineCount:1,key:project(record.japanese).key});
      for(const piece of piecesFor(parsed)) {
        if(this.battle?.sourceQids.has(record.qid)&&piece.mode==='full_record')continue;
        if(piece.key.includes('\uE000')) {
          if(this.battle?.sourceQids.has(record.qid))continue;
          const compiled=compileTemplate(piece);
          if(compiled)this.templates.push({...compiled,record:source});
        } else {
          const item={...piece,record:source};add(this.layout,piece.key,item);
          // Retain complete pages for diagnostic substring lookup only.
          if(piece.lineStart===0&&piece.lineCount===parsed.pages[piece.page].length)this.fragments.push(item);
        }
      }
      // These source records contain a complete 2x2 menu, not four separate
      // strings. Index only its explicit double-space-delimited cells; ordinary
      // prose is never split into arbitrary substring source candidates.
      if(BATTLE_MENU_QIDS.has(record.qid)&&parsed.pages.length===1&&parsed.pages[0].length===2){
        const rows=parsed.pages[0].map(line=>line.trim().split(/[ \u3000]{2,}/));
        if(rows.every(row=>row.length===2&&row.every(text=>text&&!text.includes('\uE000')))){
          for(const [row,cells] of rows.entries())for(const [column,text] of cells.entries())add(this.layout,project(text,{display:true}).key,
            {record:source,text,key:project(text,{display:true}).key,page:0,lineStart:row,lineCount:1,mode:'menu_option',
              sourceUnit:{kind:'menu_option',row,column,japanese:text,parentQid:record.qid}});
        }
      }
      // The fixed source contains two placeholder zeroes. The pinned US summary
      // caller overwrites that count (pokemon_summary_screen.c, PrintNumRibbons).
      // Keep this as an explicit Japanese-layout hypothesis, never a generic
      // rule that treats literal source numbers as variables.
      if(record.qid==='rs.common.strings.gOtherText_Ribbons00'&&record.japanese==='げんざい　００こ'){
        const piece={text:record.japanese,key:'げんざい\uE000VISIBLE_RIBBON_COUNT\uE001こ',page:0,lineStart:0,lineCount:1,
          mode:'full_record',displayProjection:true,sourceForm:'ribbon_count_overwrite_hypothesis'};
        const template=compileTemplate(piece);if(template)this.templates.push({...template,record:source});
      }
    }
  }

  lookup(raw,{game='both',kind=null,alternatives=[],previous=null,session=null,contextKey=null,sequence=null}={}) {
    if(typeof raw!=='string'||!['both','ruby','sapphire'].includes(game))throw Error('Invalid Japanese input or game');
    if(kind!==null&&!['species','move','move_description','type','ability','item','item_description','ability_description','nature','battle','dialogue','ui','native_label'].includes(kind))throw Error('Unknown source kind');
    const base={rawOcr:raw,game,kind,translation:null,translationPublishable:false,sourceQids:[],resolvedJapanese:null,
      bindingSearchComplete:true,bindingAmbiguous:false,semanticResolution:{status:'not_applicable',meaning:null},session,contextKey,sequence};
    if(raw.length>512)return {...base,status:'blocked',reason:'query_too_long',candidates:[],hints:[]};
    if(!project(raw).key||raw.includes('�')||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000\uE001]/.test(raw))return {...base,status:'blocked',reason:'empty_unknown_or_control_input',candidates:[],hints:[]};
    const variants=[{text:raw,evidence:[]}],alternativeIndices=new Set();
    for(const a of alternatives) {
      const valid=Number.isInteger(a.index)&&raw[a.index]===a.raw&&a.font===3&&a.distance===0&&
        [['へ','ヘ'],['0','O']].some(pair=>pair.includes(a.raw)&&pair.every(c=>a.candidates?.includes(c)))&&
        a.candidates.every(c=>c.length===1&&[['へ','ヘ'],['0','O']].some(pair=>pair.includes(a.raw)&&pair.includes(c)));
      if(!valid||alternativeIndices.has(a.index))throw Error('Unproven or duplicate OCR alternative');
      alternativeIndices.add(a.index);
      const original=[...variants];
      for(const v of original)for(const c of a.candidates)if(c!==a.raw)variants.push({text:v.text.slice(0,a.index)+c+v.text.slice(a.index+1),evidence:[...v.evidence,{index:a.index,raw:a.raw,resolved:c,font:3,distance:0}]});
      if(variants.length>32)return {...base,status:'blocked',reason:'alternative_limit',candidates:[],hints:[]};
    }
    const found=[];let bindingSearchComplete=true;
    const eligible=p=>applicable(p.record,game)&&(!kind||p.record.kind===kind);
    for(const v of variants) {
      const projection=project(v.text,{display:true}),hits=[...(this.exact.get(v.text)||[]),...(this.layout.get(projection.key)||[])];
      for(const t of this.templates)if(eligible(t)){
        const matches=matchTemplate(t,projection,raw);hits.push(...matches.matches);bindingSearchComplete&&=matches.complete;
      }
      if(this.battle&&(!kind||kind==='battle')){
        const matches=this.battle.lookup(projection,raw);hits.push(...matches.hits);bindingSearchComplete&&=matches.complete;
      }
      for(const p of hits.filter(eligible)) {
        const cs=(this.candidates.get(p.record.qid)||[]).filter(c=>game==='both'||c.game===game||c.game==='both');
        const approved=(this.runtime.get(p.record.qid)||[]).filter(c=>game==='both'||c.game===game||c.game==='both');
        found.push({qid:p.record.qid,sourceJapanese:p.record.japanese,sourceEnglish:p.record.english,sourceGame:p.record.game,
          kind:p.record.kind,mode:p.mode==='battle_composed'?'battle_composed':p.names?'template_hypothesis':p.mode,page:p.page,lineStart:p.lineStart,lineCount:p.lineCount,
          ...(p.record.nativeEvidence?{nativeEvidence:p.record.nativeEvidence}:{}),
          ...(p.sourceUnit?{sourceUnit:p.sourceUnit}:{}),
          matchedJapanese:v.text,resolvedVisibleJapanese:v.text,ocrAlternatives:v.evidence,bindings:p.bindings||[],
          bindingSearchComplete:p.bindingSearchComplete??true,bindingInterpretations:p.bindingInterpretations??0,
          controlsElided:p.record.controls,requiresPrintingReview:Boolean(p.record.controls.length)||p.mode==='control_window'||Boolean(p.names),
          displayProjectionUsed:Boolean(p.displayProjection)||project(v.text).key!==projection.key,
          ...(p.sourceForm?{sourceForm:p.sourceForm}:{}),
          ...(p.meaning?{meaning:p.meaning,modelId:p.modelId,componentSourceQids:p.componentSourceQids,generation:p.generation}:{}),
          chinese:{hasCandidate:cs.length>0,hasReviewedStaticRecord:approved.length>0,candidateCount:cs.length,
            reviewedRecordIds:approved.map(r=>r.id),status:approved.length?'reviewed_record_exists_not_window_approval':cs.length?'candidate_needs_review':'no_chinese_candidate'}});
      }
    }
    const unique=new Map();
    const rank={exact_record:0,full_record:1,battle_composed:2,menu_option:3,control_window:4,template_hypothesis:5};
    for(const c of found) {
      const key=JSON.stringify([c.qid,c.page,c.lineStart,c.lineCount,c.bindings,c.matchedJapanese,c.sourceUnit,c.modelId,c.meaning]);
      if(!unique.has(key)||rank[c.mode]<rank[unique.get(key).mode])unique.set(key,c);
    }
    // Exact matches never erase other compatible source windows/templates.
    let candidates=[...unique.values()].sort((a,b)=>rank[a.mode]-rank[b.mode]||a.qid.localeCompare(b.qid)||a.page-b.page||a.lineStart-b.lineStart);
    let continuityApplied=false;
    if(previous&&session&&contextKey&&previous.session===session&&previous.contextKey===contextKey&&Number.isInteger(sequence)&&sequence===previous.sequence+1&&previous.game===game&&previous.kind===kind&&previous.rawOcr&&Array.isArray(previous.candidates)) {
      // Recompute observed evidence rather than trusting supplied source IDs.
      const old=this.lookup(previous.rawOcr,{game,kind}).candidates.filter(c=>!['template_hypothesis','battle_composed'].includes(c.mode));
      const before=previous.rawOcr.split('\n'),after=raw.split('\n');
      const overlap=before.length===2&&after.length===2&&project(before[1]).key===project(after[0]).key;
      const narrowed=overlap?candidates.filter(c=>old.some(p=>p.qid===c.qid&&p.page===c.page&&c.lineStart===p.lineStart+1)):[];
      if(narrowed.length){candidates=narrowed;continuityApplied=true;}
    }
    const qids=[...new Set(candidates.map(c=>c.qid))];
    let hints=[];
    if(!candidates.length&&project(raw).key.length>=6) {
      const key=project(raw).key;
      hints=this.fragments.filter(p=>eligible(p)&&p.key.includes(key)).map(p=>({qid:p.record.qid,sourceJapanese:p.record.japanese,
        sourceGame:p.record.game,page:p.page,mode:'partial_fragment_hint',notResolved:true}));
    }
    const templates=candidates.some(c=>['template_hypothesis','battle_composed'].includes(c.mode));
    const bindingSets=new Map();
    for(const c of candidates.filter(c=>c.bindings.length)){
      const set=bindingSets.get(c.qid)||new Set();set.add(JSON.stringify(c.bindings.map(b=>[b.slot,b.raw])));bindingSets.set(c.qid,set);
    }
    return {...base,status:qids.length>1?'ambiguous':qids.length?templates?'template_candidate':'source_candidate':hints.length?'fragment_only':'not_found',
      sourceQids:qids,resolvedJapanese:qids.length===1&&!templates&&bindingSearchComplete?(candidates[0].sourceUnit?.japanese||candidates[0].sourceJapanese):null,bindingSearchComplete,
      bindingAmbiguous:[...bindingSets.values()].some(s=>s.size>1),
      semanticResolution:battleMeaningConsensus(candidates,{searchComplete:bindingSearchComplete}),
      reason:qids.length?'source_identity_does_not_approve_translation':hints.length?'partial_text_does_not_prove_complete_unit':'no_supported_source_form',
      candidates,hints,continuityApplied,session,requiresSemanticUnitReview:candidates.some(c=>c.mode!=='exact_record'&&c.mode!=='full_record')};
  }
}

const ROW_TYPES=new Set(['pc_connect_menu','pc_pokemon_menu','pc_item_menu','pc_store_menu','pc_item_list','bag_list','shop_menu','shop_list','party_field_action','party_battle_action','block_list']);
const GRID_TYPES=new Set(['battle_action','battle_moves','bag_action']);

// Splitting is driven by the detected layout, never by an answer's semantic
// segmentation. Composite fields are retained; this does not render Chinese.
export function regionUnits(raw,typeCandidates=[]) {
  const types=[...new Set(typeCandidates)];
  if(types.length===1){const composed=compositeUnits(raw,types[0]);if(composed)return composed.map(c=>({...c,raw:c.text}));}
  const strategy=t=>ROW_TYPES.has(t)?'rows':GRID_TYPES.has(t)?'grid':'whole';
  const strategies=new Set(types.map(strategy));
  const mode=strategies.size===1?strategies.values().next().value:'whole';
  const chunks=[];
  if(mode==='whole'||!types.length)chunks.push({text:raw,start:0});
  else {
    let offset=0;
    for(const line of raw.split('\n')) {
      if(mode==='rows')chunks.push({text:line,start:offset});
      else for(const m of line.matchAll(/[^ \u3000]+/g))chunks.push({text:m[0],start:offset+m.index});
      offset+=line.length+1;
    }
  }
  return chunks.filter(c=>c.text.trim()).map(c=>{
    let searchText=c.text,kind=null;const visibleFields=[];
    if(types.length===1&&['pc_item_list','bag_list','shop_list','block_list'].includes(types[0])) {
      const suffix=types[0]==='shop_list'?/\s+([0-9０-９]+)円$/:types[0]==='block_list'?/\s+Lv([0-9０-９]+)$/:/\s+[×]\s*([0-9０-９]+)$|\s+(SEL)$/;
      const m=suffix.exec(searchText);
      if(m){visibleFields.push({role:m[2]?'selection_marker':types[0]==='shop_list'?'price':types[0]==='block_list'?'level':'quantity',raw:m[0],value:m[1]||m[2]});searchText=searchText.slice(0,m.index);}
      const prefix=/^No([0-9０-９]+)(?=[^0-9０-９])/.exec(searchText);
      if(prefix){visibleFields.push({role:'display_number',raw:prefix[0],value:prefix[1]});searchText=searchText.slice(prefix[0].length);}
      // TM list entries are move names; berry numbering alone is insufficient
      // to distinguish a move and an item, so retain both kinds in that case.
      // Rows without quantity/price/selection evidence may be interface actions
      // such as Close Bag or Cancel. They must not be filtered as item names.
      kind=prefix||!m||types[0]==='block_list'?null:'item';
    }
    if(types.length===1&&types[0]==='battle_moves')kind='move';
    return {raw:c.text,start:c.start,end:c.start+c.text.length,searchText,kind,visibleFields,segmentation:mode};
  });
}

export function resolveRegion(matcher,raw,{typeCandidates=[],alternatives=[],game='both',kind=null,...context}={}) {
  let segmentationTypes=typeCandidates;const layoutEvidence=[];
  const menuParents=typeCandidates.includes('battle_action')?matcher.lookup(raw,{game,alternatives}).candidates.filter(c=>BATTLE_MENU_QIDS.has(c.qid)&&c.mode==='full_record'):[];
  if(menuParents.length)layoutEvidence.push({rule:'complete_battle_menu_source',sourceQids:[...new Set(menuParents.map(c=>c.qid))],status:'observed_complete_menu'});
  if(typeCandidates.length>1&&typeCandidates.includes('pc_pokemon_menu')){
    const rows=raw.split('\n'),suffixes=['PCText_WithdrawPoke','PCText_DepositPoke','PCText_MovePoke','PCText_SeeYa'];
    if(rows.length===suffixes.length){
      const evidence=rows.map((row,i)=>matcher.lookup(row,{game,kind:'ui'}).candidates.filter(c=>c.qid===`rs.common.strings.${suffixes[i]}`));
      if(evidence.every(e=>e.length)){segmentationTypes=['pc_pokemon_menu'];layoutEvidence.push({rule:'complete_pc_menu_source_sequence',sourceQids:evidence.map(e=>e[0].qid),status:'retrieval_hypothesis_not_detector_override'});}
    }
  }
  const units=regionUnits(raw,segmentationTypes).map(u=>{
    const searchStart=u.start+u.raw.indexOf(u.searchText);
    let result=matcher.lookup(u.searchText,{...context,game,kind:kind||u.kind,
      alternatives:alternatives.filter(a=>a.index>=searchStart&&a.index<searchStart+u.searchText.length).map(a=>({...a,index:a.index-searchStart}))});
    if(menuParents.length){
      const candidates=result.candidates.filter(c=>c.mode==='menu_option'&&menuParents.some(p=>p.qid===c.qid));
      if(candidates.length){
        const qids=[...new Set(candidates.map(c=>c.qid))];
        result={...result,candidates,sourceQids:qids,status:qids.length===1?'source_candidate':'ambiguous',
          resolvedJapanese:qids.length===1?candidates[0].sourceUnit.japanese:null,menuParentContextApplied:true};
      }
    }
    return {...u,result};
  });
  return {rawOcr:raw,typeCandidates,game,layoutEvidence,units,allUnitsHaveSourceCandidates:units.length>0&&units.every(u=>u.result.candidates.length>0),translation:null,translationPublishable:false};
}

export function loadSourceMatcher(root) {
  const manifest=JSON.parse(read(path.join(root,'corpus/sources.json'))),inputs=[];
  const input=name=>{
    const s=manifest.sources.find(s=>path.basename(s.local)===name);
    if(!s)throw Error(`Unpinned input ${name}`);
    const bytes=fs.readFileSync(path.join(root,s.local));
    if(sha256(bytes)!==s.sha256)throw Error(`Source hash mismatch: ${s.local}`);
    inputs.push({local:s.local,sha256:s.sha256});return bytes.toString('utf8');
  };
  const records=parseAligned(input('qid_msg.txt'),input('ja-Hrkt_msg.txt'),input('en_msg.txt'));
  const built=JSON.parse(read(path.join(root,'outputs/corpus-mapping/build-manifest.json')));
  const artifact=name=>{
    const file=path.join(root,'outputs/corpus-mapping',name),expected=built.outputs.find(f=>f.file===name);
    const bytes=fs.readFileSync(file);
    if(!expected||sha256(bytes)!==expected.sha256)throw Error(`Corpus artifact hash mismatch: ${name}`);
    inputs.push({local:`outputs/corpus-mapping/${name}`,sha256:expected.sha256});return bytes.toString('utf8');
  };
  const candidates=parseCsv(artifact('candidates.csv')),runtime=JSON.parse(artifact('runtime.json'));
  const frozen=JSON.parse(read(path.join(root,'reports/s3-acceptance/freeze-manifest.json')));
  const nativeInput=local=>{
    const bytes=fs.readFileSync(path.join(root,local));
    if(sha256(bytes)!==frozen.files[local])throw Error(`Changed frozen native resource ${local}`);
    inputs.push({local,sha256:sha256(bytes)});return JSON.parse(bytes.toString('utf8'));
  };
  const labels=nativeInput('src/main/resources/ocr/labels.json');
  const fonts=nativeInput('src/main/resources/ocr/fonts.json');
  const nativeRecords=labels.labels.map(l=>({qid:`native.label.${l.id}`,japanese:l.text,english:'',game:'both',nativeEvidence:{local:'src/main/resources/ocr/labels.json',id:l.id}}));
  for(const text of ['PP','ID','No','Lv'])if(fonts.glyphs.some(g=>g.text===text))nativeRecords.push({qid:`native.label.glyph_${text}`,japanese:text,english:'',game:'both',nativeEvidence:{local:'src/main/resources/ocr/fonts.json',text}});
  const battleManifestLocal='outputs/battle-source-matching/build-manifest.json';
  const battleManifest=JSON.parse(read(path.join(root,battleManifestLocal)));
  for(const f of [...battleManifest.inputs,...battleManifest.implementation])if(sha256(fs.readFileSync(path.join(root,f.local)))!==f.sha256)throw Error(`Battle templates stale: ${f.local}; rebuild battle templates`);
  const battleLocal='outputs/battle-source-matching/templates.json',battleBytes=fs.readFileSync(path.join(root,battleLocal));
  if(sha256(battleBytes)!==battleManifest.outputs.find(f=>f.file==='templates.json')?.sha256)throw Error('Battle template artifact hash mismatch');
  inputs.push(...battleManifest.inputs,{local:battleManifestLocal,sha256:sha256(fs.readFileSync(path.join(root,battleManifestLocal)))},{local:battleLocal,sha256:sha256(battleBytes)});
  const battleTemplates=JSON.parse(battleBytes.toString('utf8'));
  return {matcher:new JapaneseSourceMatcher([...records,...nativeRecords],{candidates,runtime,battleTemplates}),records,nativeRecords,battleTemplates,inputs};
}
