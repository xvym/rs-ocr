// Separately authored judgments for the current visible action, with exhaustive
// expected source IDs for these eight cases. No single/double identity is given.
const sendSources=['BattleText_SentOutDouble3','BattleText_SentOutSingle1','BattleText_SentOutSingle11','BattleText_SentOutSingle2','BattleText_SentOutSingle3','BattleText_SentOutSingle4','BattleText_SentOutSingle5'];
export const cases=[
  {regionId:'GBA-145-R03',japanese:'してんのうの カゲツは\nグラエナを くりだした！',trainer:'してんのうの カゲツ',subject:'グラエナ',event:'send_out',sources:sendSources},
  {regionId:'GBA-160-R02',japanese:'してんのうの カゲツは\nノクタスを くりだそうと している',trainer:'してんのうの カゲツ',subject:'ノクタス',event:'send_out_intent',sources:['BattleText_WillSwitch']},
  {regionId:'GBA-167-R02',japanese:'してんのうの カゲツは\nサメハダーを くりだそうと している',trainer:'してんのうの カゲツ',subject:'サメハダー',event:'send_out_intent',sources:['BattleText_WillSwitch']},
  {regionId:'GBA-172-R02',japanese:'してんのうの カゲツは\nアブソルを くりだそうと している',trainer:'してんのうの カゲツ',subject:'アブソル',event:'send_out_intent',sources:['BattleText_WillSwitch']},
  {regionId:'GBA-178-R02',japanese:'してんのうの カゲツは\nダーテングを くりだそうと している',trainer:'してんのうの カゲツ',subject:'ダーテング',event:'send_out_intent',sources:['BattleText_WillSwitch']},
  {regionId:'GBA-209-R02',japanese:'してんのうの フヨウは\nジュペッタを くりだそうと している',trainer:'してんのうの フヨウ',subject:'ジュペッタ',event:'send_out_intent',sources:['BattleText_WillSwitch']},
  {regionId:'GBA-213-R02',japanese:'してんのうの フヨウは\nヤミラミを くりだした！',trainer:'してんのうの フヨウ',subject:'ヤミラミ',event:'send_out',sources:sendSources},
  {regionId:'GBA-223-R02',japanese:'してんのうの フヨウは\nサマヨールを くりだそうと している',trainer:'してんのうの フヨウ',subject:'サマヨール',event:'send_out_intent',sources:['BattleText_WillSwitch']}
];
