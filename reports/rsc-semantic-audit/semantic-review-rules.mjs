// Non-blind model correspondence review, 2026-11-03. This file selects existing
// source witnesses for an audit only; it is never an input to runtime building.
export const japaneseConfirmed=new Set([
 'rs.common.^j_0.1','rs.common.^j_0.2',
 ...[4,5].map(i=>`rs.common.easy_chat_group_trainer.gEasyChatGroupWords_Trainer.${i}`),
 ...[11,16].map(i=>`rs.common.easy_chat_group_status.gEasyChatGroupWords_Status.${i}`),
 ...[5,20,37,45].map(i=>`rs.common.easy_chat_group_battle.gEasyChatGroupWords_Battle.${i}`),
 'rs.common.easy_chat_group_greetings.gEasyChatGroupWords_Greetings.16',
 ...[39,51].map(i=>`rs.common.easy_chat_group_voices.gEasyChatGroupWords_Voices.${i}`),
 'rs.common.easy_chat_group_endings.gEasyChatGroupWords_Endings.52',
 'rs.common.easy_chat_group_feelings.gEasyChatGroupWords_Feelings.28',
 ...[33,49].map(i=>`rs.common.easy_chat_group_conditions.gEasyChatGroupWords_Conditions.${i}`),
 ...[21,68].map(i=>`rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.${i}`),
 'rs.common.easy_chat_group_lifestyle.gEasyChatGroupWords_Lifestyle.5',
 ...[22,36].map(i=>`rs.common.easy_chat_group_hobbies.gEasyChatGroupWords_Hobbies.${i}`),
 'rs.common.easy_chat_group_events.gEasyChatGroupWords_Events.1',
 'rs.common.strings.gDexText_UnknownWeight.1',
 'rs.common.strings2.gOtherText_ItGotAway.1'
]);
export const englishConfirmed=new Set([
 'rs.common.items.gItems.273',
 'rs.common.contest.gText_Contest_WhichMoveWillBePlayed','rs.common.contest.gText_Contest_ButItCantParticipate',
 ...[6,15,35].map(i=>`rs.common.easy_chat_group_battle.gEasyChatGroupWords_Battle.${i}`),
 'rs.common.easy_chat_group_greetings.gEasyChatGroupWords_Greetings.21',
 ...[12,29,30,43].map(i=>`rs.common.easy_chat_group_voices.gEasyChatGroupWords_Voices.${i}`),
 ...[8,21].map(i=>`rs.common.easy_chat_group_speech.gEasyChatGroupWords_Speech.${i}`),
 'rs.common.easy_chat_group_endings.gEasyChatGroupWords_Endings.3',
 'rs.common.easy_chat_group_conditions.gEasyChatGroupWords_Conditions.28',
 'rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.52',
 'rs.common.battle_strings.BattleText_WinningPrize','rs.common.battle_strings.BattleText_PickedUpYen',
 ...['gSaveFileDeletedMessage','gOtherText_ThatWillBe','gOtherText_ThatWillBe2','gOtherText_ThatWillBe3','gOtherText_SoldItem',
 'OtherText_FreshWater','OtherText_SodaPop','OtherText_Lemonade','OtherText_50Coins','OtherText_500Coins',
 'gOtherText_Seconds','gOtherText_Times.0','PCText_WasDeposited','PCText_WasReleased','PCText_CameBack',
 'OtherText_SoPretty','OtherText_SoDarling','OtherText_SoRelaxed','OtherText_SoExciting','OtherText_SoAmusing','OtherText_SoMagical'].map(id=>'rs.common.strings.'+id),
 'rs.common.strings2.gOtherText_PokeBlockMade','rs.common.strings2.gOtherText_NoBerriesForBlend'
]);
export const partial=new Set([
 'rs.common.strings.gDexText_UnknownPoke',
 'rs.common.easy_chat_group_battle.gEasyChatGroupWords_Battle.1',
 'rs.common.easy_chat_group_greetings.gEasyChatGroupWords_Greetings.32',
 'rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.15',
 'rs.common.easy_chat_group_lifestyle.gEasyChatGroupWords_Lifestyle.22',
 'rs.common.easy_chat_group_trainer.gEasyChatGroupWords_Trainer.18',
 'rs.common.easy_chat_group_people.gEasyChatGroupWords_People.53',
 'rs.common.easy_chat_group_endings.gEasyChatGroupWords_Endings.21',
 'rs.common.easy_chat_group_endings.gEasyChatGroupWords_Endings.53',
 'rs.common.easy_chat_group_feelings.gEasyChatGroupWords_Feelings.32',
 'rs.common.easy_chat_group_events.gEasyChatGroupWords_Events.21',
 'rs.common.battle_strings.BattleText_Terminator','rs.common.battle_strings.BattleText_Exclamation5',
 'rs.common.battle_strings.BattleText_BoostedExp','rs.common.battle_strings.BattleText_Berry','rs.common.battle_strings.BattleText_Format10',
 ...['gDexText_UnknownWeight.0','gOtherText_Berry2','gOtherText_NoResponse','gOtherText_Is'].map(id=>'rs.common.strings.'+id),
 ...['gOtherText_Met','gOtherText_Egg2','gOtherText_Met2','gOtherText_Berry'].map(id=>'rs.common.strings2.'+id),
 'rs.common.easy_chat_group_endings.gEasyChatGroupWords_Endings.11'
]);
export const explicitReasons={
 'rs.common.easy_chat_group_voices.gEasyChatGroupWords_Voices.46':'Homonym: an interjection HUMPH is not the time unit MIN.',
 'rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.19':'Homonym: CHANGE is not the animal FROG.',
 'rs.common.easy_chat_group_people.gEasyChatGroupWords_People.4':'Localization mismatch: Japanese addresses YOU; SON/child is a different meaning.',
 'rs.common.easy_chat_group_people.gEasyChatGroupWords_People.28':'Localization mismatch: Japanese addresses YOU; DAUGHTER is a different meaning.',
 'rs.common.easy_chat_group_speech.gEasyChatGroupWords_Speech.12':'CASE as an occurrence is not a PokeBlock storage case; stripping display tokens caused a false retrieval.',
 'rs.common.easy_chat_group_speech.gEasyChatGroupWords_Speech.58':'The comparative/conjunction use is not the sender label FROM.',
 'rs.common.easy_chat_group_hobbies.gEasyChatGroupWords_Hobbies.49':'A holiday/rest word is not a missed battle turn.',
 'rs.common.strings.gDefaultBoyName1^S':'A person name KAITO is not the ordinary noun KITE.',
 'rs.common.strings.gExpandedPlaceholder_Chan':'A name honorific is not the trainer title LADY.',
 'rs.common.strings.OtherText_Terminator12':'A name honorific is not the trainer title LADY.',
 'rs.common.strings.OtherText_Terminator13':'A name honorific is not the trainer title LADY.',
 'rs.common.strings2.gOtherText_Terminator2':'Japanese means a move/technique; English MOVE retrieved a relocation label.',
 'rs.common.strings.PCText_IsSelected':'Japanese asks what to do with an entity; the English/Chinese candidate only states it is selected.',
 'rs.common.strings.OtherText_SoSunny':'Japanese describes warmth; the candidate describes sunny weather.',
 'rs.common.easy_chat_group_adjectives.gEasyChatGroupWords_Adjectives.35':'Excited anticipation is not the named danger-sensing ability.',
 'rs.common.easy_chat_group_feelings.gEasyChatGroupWords_Feelings.47':'Hardship/distress is not material hardness.'
};
export const preferredIds={
 'rs.common.items.gItems.273':['rsc-doc-026880'],
 'rs.common.easy_chat_group_status.gEasyChatGroupWords_Status.50':['rsc-doc-008458'],
 'rs.common.easy_chat_group_actions.gEasyChatGroupWords_Actions.68':['rsc-doc-008285'],
 'rs.common.easy_chat_group_hobbies.gEasyChatGroupWords_Hobbies.36':['rsc-doc-008495'],
 'rs.common.easy_chat_group_conditions.gEasyChatGroupWords_Conditions.28':['rsc-doc-003159']
};
export const extraQueries=[
 {qid:'rs.common.strings2.gSystemText_LoadingError.1',query:'press A button',ids:['rsc-doc-008871'],quote:'请按A键。',verdict:'original_source_span_found'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.4',query:'save failed',ids:['rsc-doc-008880'],verdict:'original_correspondence_found'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.5',query:'save completed',ids:['rsc-doc-008879'],verdict:'original_correspondence_found'},
 {qid:'rs.script.day_care.UnknownString_81B2C68.1',query:'egg congratulations hatched',ids:['rsc-doc-009008'],verdict:'partial_original_segments'},
 {qid:'rs.common.strings2.gOtherText_ForgotOrDidNotLearnMove',query:'forgot learned did not learn move',ids:['rsc-doc-009018','rsc-doc-009019'],verdict:'partial_original_segments'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.2',query:'connection established',ids:[],verdict:'not_confirmed'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.3',query:'data received',ids:[],verdict:'not_confirmed'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.6',query:'load failed',ids:[],verdict:'not_confirmed'},
 {qid:'rs.common.strings2.gSystemText_LoadingError.7',query:'load completed',ids:[],verdict:'not_confirmed'},
 {qid:'rs.common.item_use.gSSTidalBetaString',query:'unlimited tickets ship ride',ids:[],verdict:'not_confirmed'},
 {qid:'rs.common.item_use.gSSTidalBetaString2',query:'unlimited tickets ship ride',ids:[],verdict:'not_confirmed'}
];
