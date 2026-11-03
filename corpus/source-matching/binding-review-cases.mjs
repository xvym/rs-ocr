// Model review of visible text and source slot boundaries, written separately
// from matching output. This checks only the named subset, not every source.
export const cases=[
  {regionId:'GBA-027-R01',japanese:'おとうさんの ことば‥‥\nハルカ！ こういうものには',source:'gOtherText_DadsAdvice',player:'ハルカ'},
  {regionId:'GBA-144-R01',japanese:'してんのうの カゲツが\nしょうぶを しかけてきた！',source:'BattleText_SingleWantToBattle1',name:'カゲツ'},
  {regionId:'GBA-145-R03',japanese:'してんのうの カゲツは\nグラエナを くりだした！',source:'BattleText_SentOutSingle1',name:'カゲツ'},
  {regionId:'GBA-160-R02',japanese:'してんのうの カゲツは\nノクタスを くりだそうと している',source:'BattleText_WillSwitch',name:'カゲツ'},
  {regionId:'GBA-167-R02',japanese:'してんのうの カゲツは\nサメハダーを くりだそうと している',source:'BattleText_WillSwitch',name:'カゲツ'},
  {regionId:'GBA-172-R02',japanese:'してんのうの カゲツは\nアブソルを くりだそうと している',source:'BattleText_WillSwitch',name:'カゲツ'},
  {regionId:'GBA-178-R02',japanese:'してんのうの カゲツは\nダーテングを くりだそうと している',source:'BattleText_WillSwitch',name:'カゲツ'},
  {regionId:'GBA-186-R02',japanese:'してんのうの カゲツ\nとの しょうぶに かった！',source:'BattleText_PlayerDefeatedTrainer2',name:'カゲツ'},
  {regionId:'GBA-197-R01',japanese:'してんのうの フヨウが\nしょうぶを しかけてきた！',source:'BattleText_SingleWantToBattle1',name:'フヨウ'},
  {regionId:'GBA-209-R02',japanese:'してんのうの フヨウは\nジュペッタを くりだそうと している',source:'BattleText_WillSwitch',name:'フヨウ'},
  {regionId:'GBA-213-R02',japanese:'してんのうの フヨウは\nヤミラミを くりだした！',source:'BattleText_SentOutSingle1',name:'フヨウ'},
  {regionId:'GBA-223-R02',japanese:'してんのうの フヨウは\nサマヨールを くりだそうと している',source:'BattleText_WillSwitch',name:'フヨウ'},
  {regionId:'GBA-242-R02',japanese:'してんのうの フヨウ\nとの しょうぶに かった！',source:'BattleText_PlayerDefeatedTrainer2',name:'フヨウ'}
].map(c=>({...c,...(c.name?{trainerClass:'してんのう'}:{})}));
