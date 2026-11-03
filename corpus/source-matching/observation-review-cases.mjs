// Current visible meaning only; the complete compatible source set is reviewed
// separately from model construction. Script identity and later pages stay unknown.
export const cases=[
  {regionId:'GBA-070-R02',japanese:'あ！ やせいの\nケムッソが とびだしてきた！',event:'wild_encounter',subject:'ケムッソ',sources:['rs.common.battle_strings.BattleText_WildAppeared1','rs.common.battle_strings.BattleText_WildAppeared3']},
  {regionId:'NGC-113-R02',japanese:'あ！ やせいの\nケムッソが とびだしてきた！',event:'wild_encounter',subject:'ケムッソ',sources:['rs.common.battle_strings.BattleText_WildAppeared1','rs.common.battle_strings.BattleText_WildAppeared3']},
  {regionId:'GBA-188-R02',japanese:'ハルカは しょうきんとして\n4900円 てにいれた！',event:'money_reward',subject:'ハルカ',amountField:'moneyAmount',amount:4900,sources:['rs.common.battle_strings.BattleText_WinningPrize']},
  {regionId:'GBA-244-R02',japanese:'ハルカは しょうきんとして\n5100円 てにいれた！',event:'money_reward',subject:'ハルカ',amountField:'moneyAmount',amount:5100,sources:['rs.common.battle_strings.BattleText_WinningPrize']},
  {regionId:'GBA-201-R09',japanese:'カイオーガの たいりょくが\n17 かいふくした',event:'hp_restored',subject:'カイオーガ',amountField:'restoredAmount',amount:17,sources:['rs.common.strings.gOtherText_HPRestoredBy']},
  {regionId:'GBA-229-R09',japanese:'レックウザの たいりょくが\n91 かいふくした',event:'hp_restored',subject:'レックウザ',amountField:'restoredAmount',amount:91,sources:['rs.common.strings.gOtherText_HPRestoredBy']},
  {regionId:'GBA-234-R03',japanese:'レックウザは\nねむるを つかった！',event:'move_use',subject:'レックウザ',moveId:156,sources:['rs.common.battle_strings.BattleText_OpponentUsedMove']},
  {regionId:'GBA-251-R03',japanese:'ハルカは\nスーパーボールを つかった！',event:'item_use',subject:'ハルカ',itemId:3,sources:['rs.common.battle_strings.BattleText_Used1','rs.common.strings.gOtherText_UsedFlute','rs.common.strings.gOtherText_UsedItem','rs.common.strings.gOtherText_UsedRepel']},
  {regionId:'GBA-255-R03',japanese:'やったー！\nジグザグマを つかまえたぞ！',event:'caught',subject:'ジグザグマ',sources:['rs.common.battle_strings.BattleText_BallCaught1','rs.common.battle_strings.BattleText_BallCaught2']}
];
