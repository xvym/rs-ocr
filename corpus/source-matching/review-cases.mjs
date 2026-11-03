// Source judgments authored from frozen Japanese + direct pinned-source text
// inspection. This file is evaluation-only and never imported by the matcher.
// The reviewing model also implements the matcher: non-blind, not human review.
const cases=[];
const add=(id,japanese,qids,reason,options={})=>cases.push({id,input:{japanese,...options},expectedSourceQids:qids,completeCandidateSet:false,reason,method:'model_direct_source_text_review'});
add('ability-dialogue','ポケモンの とくせいに よっては\nわざの いりょくが かわったり',
 ['rs.script.MossdeepCity_PokemonCenter_1F.MossdeepCity_PokemonCenter_1F_Text_18D69A'],'原记录前两行；下一行由滚动控制引入，当前窗口不包含该行。');
add('gym-before-scroll','この まちの ジムリーダー\nなんといっても あの コンビネーションは',
 ['rs.script.MossdeepCity_PokemonCenter_1F.MossdeepCity_PokemonCenter_1F_Text_18D62F'],'原记录第1、2行。');
add('gym-after-scroll','なんといっても あの コンビネーションは\nさいこう！ さすが！ って かんじよ',
 ['rs.script.MossdeepCity_PokemonCenter_1F.MossdeepCity_PokemonCenter_1F_Text_18D62F'],'原记录第2、3行；上滚后保留相邻两行。');
for(const [id,ja] of [['nurse-welcome','おつかれさまです！\nポケモン センター です'],['nurse-recover','ここでは ポケモンの\nたいりょく かいふくを します'],['nurse-question','あなたの ポケモンを\nやすませて あげますか？']])
 add(id,ja,['rs.script.pkmn_center_nurse.gText_NurseJoy_Welcome'],'同一源记录的三个清屏分段，分别定位；不据此发布其他分段。');
add('nurse-take','それでは\nおあずかり いたします！',['rs.script.event_scripts.gText_NurseJoy_OkayIllTakeYourPokemon'],'静态完整两行，只差排版空白。');
add('nurse-return','またの\nごりようを おまち してます！',[
 'rs.script.record_mix.UnusedMixRecordsSeeYouAgainText','rs.script.pkmn_center_nurse.gText_NurseJoy_WeHopeToSeeYouAgain'],
 '原语料中有相同全文的未使用与实际脚本记录，两个来源均须保留。');
for(const [id,ja] of [['bookshelf-title','ポケモンざっしが ならんでる！'],['bookshelf-before-scroll','‥‥「ポケモンのとも」\n‥‥「ポケモン てちょう」'],['bookshelf-after-scroll','‥‥「ポケモン てちょう」\n‥‥「かわいい ポケモン」']])
 add(id,ja,['rs.script.check_furniture.Text_PokemonCenterBookshelf'],'书架记录首段或清屏后的两行／滚动窗口；日英分页不同。');
add('boot-pc','ハルカは\nパソコンの スイッチを いれた！',[
 'rs.script.pc.Text_BootUpPC','rs.script.secret_base.SecretBase_Text_BootUpPC'],
 '两份原记录均为[PLAYER]模板；ハルカ为当前可见捕获，不能借此推断唯一脚本来源或自动确认玩家身份。');
add('pc-question','どこの パソコンに せつぞく して\nつうしん しますか？',['rs.script.pc.Text_WhichPCShouldBeAccessed'],'完整两行。');
add('pc-lanette','マユミの パソコンに せつぞく した！',['rs.script.pc.Text_AccessedLanettesPC'],'完整静态句。');
add('pc-open','ポケモンの あずかり システムを\nよびだした！',['rs.script.pc.Text_StorageSystemOpened'],'完整两行。');
add('pc-help','ボックスに あずけている ポケモンを\nてもちに くわえる ことが できます',['rs.common.strings.PCText_MovePokeToParty'],'两行源文的尾随空格不影响来源。');
add('pc-withdraw-item','どうぐを ひきだす',['rs.common.strings.PCText_WithdrawItem'],'完整菜单项。');
add('antidote-description','どく じょうたいを\nかいふくする',['rs.common.item_descriptions.gItemDescription_Antidote'],'完整道具说明。');
add('hyper-potion','すごいキズぐすり',['rs.common.items.gItems.21'],'完整道具名，物品类型约束。',{kind:'item'});
add('mud-shot','マッドショット',['rs.common.move_names.gMoveNames.341'],'完整招式名，招式类型约束。',{kind:'move'});
add('hardy','がんばりや',['rs.common.nature_names.NatureName_Hardy'],'完整性格名。',{kind:'nature'});
add('rain-start','あめが ふりはじめた！',['rs.common.battle_strings.BattleText_RainStart'],'完整战斗消息；其他含相同句尾的模板也可能构成候选。');
add('super-effective','こうかは ばつぐんだ！',['rs.common.battle_strings.BattleText_SuperEffective'],'完整战斗提示。',{kind:'battle'});
add('ghost-species','ゴースト',['rs.common.species_names.gSpeciesNames.93'],'物种上下文为鬼斯通，不可选属性记录。',{kind:'species'});
add('ghost-type','ゴースト',['rs.common.type_names.gTypeNames.7'],'属性上下文为幽灵，不可选物种记录。',{kind:'type'});
add('heracross-raw','へラクロス',['rs.common.species_names.gSpeciesNames.214'],'固定集OCR输出平假名へ，字体3距离0同时保留ヘ；只能利用显式字形候选找原记录。',
 {kind:'species',alternatives:[{index:0,raw:'へ',candidates:['へ','ヘ'],font:3,distance:0}]});
add('pikachu','ピカチュウ',['rs.common.species_names.gSpeciesNames.25'],'完整物种名。',{kind:'species'});
// These complete typed name judgments have exhaustively inspected their group.
for(const c of cases)if(c.input.kind&&c.input.kind!=='battle')c.completeCandidateSet=true;
export default {schemaVersion:1,scope:'27 direct-source reviewed probes, including fixed-set Japanese and explicit typed contexts; not exhaustive 579-region source accuracy',
 independence:{blind:false,human:false,method:'separate source-text judgments and source-hash binding; same model authored implementation',limitation:'Additional candidates are not scored as correct unless the candidate set was exhaustively reviewed.'},cases};
