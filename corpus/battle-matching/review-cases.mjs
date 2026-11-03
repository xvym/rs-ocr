// Evaluation-only source/meaning judgments, manually authored from the visible
// frozen Japanese and direct source records. Never imported by the matcher or
// template builder. Same implementing model reviewed these: non-blind.
const cases=[];
const move=(ids,id,subject)=>{for(const regionId of ids.split(' '))cases.push({regionId,event:'move_use',moveId:id,subject,
 expectedSourceQids:['rs.common.battle_strings.BattleText_OpponentUsedMove']});};
const stat=(ids,id,delta,subject)=>{for(const regionId of ids.split(' '))cases.push({regionId,event:'stat_change',stat:id,delta,subject,
 expectedSourceQids:(delta>0?['BattleText_UnknownString7','BattleText_UnknownString3']:['BattleText_UnknownString5','BattleText_UnknownString6']).map(id=>'rs.common.battle_strings.'+id)});};
move('GBA-072-R03 NGC-117-R03',341,'ラグラージ');
move('GBA-076-R03 GBA-077-R03 GBA-087-R03',81,'やせいの ケムッソ');
move('GBA-080-R03',280,'へラクロス');
move('GBA-083-R03 GBA-084-R03 GBA-149-R03',347,'カイオーガ');
move('GBA-154-R03',28,'あいての グラエナ');
move('GBA-157-R03',57,'カイオーガ');
move('GBA-163-R03',58,'カイオーガ');
move('GBA-180-R03',252,'あいての ダーテング');
move('GBA-183-R03',104,'あいての ダーテング');
move('GBA-199-R03',109,'あいての サマヨール');
move('GBA-202-R03',325,'あいての サマヨール');
move('GBA-203-R03 GBA-204-R03',174,'あいての サマヨール');
move('GBA-220-R03',19,'レックウザ');
move('GBA-224-R03 GBA-226-R03 GBA-236-R03',58,'あいての サマヨール');
move('GBA-239-R03',200,'レックウザ');
move('GBA-253-R03',45,'やせいの ジグザグマ');
stat('GBA-078-R03','speed',-1,'へラクロス');
stat('GBA-085-R03 GBA-150-R03','special_attack',1,'カイオーガ');
stat('GBA-086-R03 GBA-151-R03','special_defense',1,'カイオーガ');
stat('GBA-088-R03','speed',-1,'カイオーガ');
stat('GBA-155-R03','accuracy',-1,'カイオーガ');
stat('GBA-184-R03','evasion',1,'あいての ダーテング');
export default {schemaVersion:1,method:'model_direct_japanese_and_source_review',blind:false,
 limitation:'A fixed-set source/observed-meaning check by the implementing model; not independent personnel, whole-game, Chinese or live acceptance.',
 cases};
