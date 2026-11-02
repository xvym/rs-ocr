"""Rebuild the manually reviewed screenshot layout catalog (no OCR engine)."""
from pathlib import Path
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
import json, hashlib, html

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REGIONS = {}

def region(key, name, group, box, appearance, content, note=''):
    REGIONS[key] = dict(key=key, name=name, group=group, logical_box=box,
                        appearance=appearance, content=content, note=note)

BLUE='蓝色圆角边框、浅色底、深灰字；正文通常两行'
GRAY='深灰方框、浅色底、深灰字'
BATTLE='红色外框、青灰底、白字及深色阴影；通常两行'
PANEL='彩色页面内的浅色文字区域；日文像素字与较小的数字/拉丁字符混排'
region('field_dialog','普通对白／标牌／系统提示','对白与确认',[11,115,218,43],BLUE,'对白、提示、标牌；含逐字状态、翻页箭头','不同正文和背景地图合并为同一布局。')
region('boot_dialog','启动时系统提示','对白与确认',[16,113,208,47],GRAY,'时钟相关提示','NGC-001 中出现；与普通蓝框分开。')
region('field_choice','场景右侧二选一','对白与确认',[160,66,56,46],GRAY,'はい／いいえ、选择箭头','出现在普通对白上方。')
region('battle_choice','战斗右侧二选一','对白与确认',[192,66,48,46],GRAY,'はい／いいえ、选择箭头','比场景二选一靠右；会遮挡我方状态栏。')
region('blender_choice','混合机右侧二选一','对白与确认',[184,66,48,46],GRAY,'はい／いいえ')
region('condition_choice','状态图页右下二选一','对白与确认',[184,82,56,46],GRAY,'はい／いいえ','位于状态图与底部提示之间。')
region('block_choice','方块盒左侧二选一','对白与确认',[56,46,56,50],GRAY,'はい／いいえ','与右侧选择框分开。')
region('pc_connect_menu','PC 连接对象菜单','PC',[0,0,88,80],GRAY,'マユミのパソコン、玩家 PC、殿堂、退出')
region('pc_pokemon_menu','PC 宝可梦操作菜单','PC',[0,0,112,80],GRAY,'取出、寄存、整理、退出')
region('pc_item_menu','玩家 PC 主菜单','PC',[0,0,88,64],GRAY,'道具寄存、信箱、装饰、退出')
region('pc_store_menu','PC 道具操作子菜单','PC',[0,0,96,80],GRAY,'取出、寄存、丢弃、返回')
region('pc_item_heading','PC 道具操作标题','PC',[0,0,88,32],GRAY,'どうぐを ひきだす／どうぐを すてる')
region('pc_item_list','PC 道具列表','PC',[112,0,128,160],GRAY,'道具名、×、数量、上下滚动箭头','底部滚动箭头独立于正文。')
region('pc_item_description','PC 道具说明','PC',[0,96,112,64],GRAY,'所选道具说明，通常两行')
region('bag_category','背包分类标题','背包',[0,77,108,22],'黄色横条、深色字、左右切换箭头','道具、球、招式机、树果、重要物品')
region('bag_list','背包右侧列表','背包',[108,0,132,160],'黄色列表框、深色字、选中行高亮','道具/树果/招式名、编号、×、数量、滚动箭头','重要物品可出现红色 SELECT 标记；底部可出现关闭背包。')
region('bag_description','背包左下说明','背包',[0,100,108,60],GRAY,'所选项目说明')
region('bag_action','背包道具操作弹窗','背包',[0,58,108,44],GRAY,'けってい、タグをみる、やめる','覆盖原分类标题，和下方操作提示一起出现。')
region('bag_prompt','背包左下操作提示','背包',[0,102,108,58],GRAY,'どうしますか？')
region('shop_menu','商店入口菜单','商店',[0,0,88,64],GRAY,'购买、出售、退出')
region('shop_money','商店左上金额','商店',[0,0,112,32],GRAY,'おこづかい、金额、円')
region('shop_list','商店右侧商品列表','商店',[112,0,128,160],'黄色列表框、深色字、选中行高亮','商品名、价格、退出项、滚动箭头')
region('shop_description','商店左下说明','商店',[0,100,112,60],GRAY,'所选商品说明或退出提示')
region('save_summary','保存前左上摘要','保存',[0,0,112,96],GRAY,'地点、主人公、徽章数、图鉴数、游戏时间')
region('party_lead','队伍左侧首位卡片','队伍',[8,24,80,56],'蓝绿色卡片；白字、深色阴影','昵称、性别、Lv、HP 当前/最大值、状态','图标本身不作为文字转录。')
for n in range(5):
    region(f'party_row{n+2}',f'队伍右侧第 {n+2} 位卡片','队伍',[96,10+n*24,144,24],'蓝绿色横卡；白字、深色阴影','昵称、性别、Lv、HP 当前/最大值、状态','菜单或提示框可遮住卡片的一部分。')
region('party_prompt','队伍底部选择提示','队伍',[0,130,192,30],GRAY,'ポケモンを えらんで ください')
region('party_short_prompt','队伍底部对象操作提示','队伍',[0,130,160,30],GRAY,'某宝可梦を どうする？')
region('party_cancel','队伍右下返回按钮','队伍',[192,128,48,32],'紫色按钮、浅色字','もどる')
region('party_field_action','队伍场景操作菜单','队伍',[160,64,80,96],GRAY,'そらをとぶ、つよさをみる、ならびかえ、もちもの、やめる')
region('party_battle_action','队伍战斗操作菜单','队伍',[160,96,80,64],GRAY,'いれかえる、つよさをみる、やめる')
region('party_recovery','队伍恢复结果弹窗','队伍',[24,112,192,48],GRAY,'恢复对象及 HP 恢复数值','覆盖底部提示与末尾卡片。')
region('battle_message','战斗底部消息','战斗',[0,112,240,48],BATTLE,'招式、效果、能力变化、天气、替换、捕获、胜负、奖金等动态消息','正文不同不另立区域；包含逐字未完成状态。')
region('battle_enemy','战斗左上对手状态栏','战斗',[12,16,96,28],'浅黄色卡片、深色字','名字、性别、Lv；HP 条不作为数字','进出场时可水平移入或消失。')
region('battle_own','战斗右下我方状态栏','战斗',[136,72,96,40],'浅黄色卡片、深色字','名字、性别、Lv、HP 当前/最大值、状态','进出场时可移入，或被确认框遮挡。')
region('battle_prompt','战斗左下行动提示','战斗',[0,112,136,48],BATTLE,'某宝可梦は どうする？')
region('battle_action','战斗右下四项行动','战斗',[136,112,104,48],GRAY,'たたかう、バッグ、ポケモン、にげる')
region('battle_moves','战斗左下四招式菜单','战斗',[0,112,144,48],GRAY,'四个招式名、选择箭头','左右两列，每列两项；选择箭头指向当前招式。')
region('battle_move_meta','战斗右下招式信息','战斗',[144,112,96,48],GRAY,'PP 当前/最大值、わざタイプ／属性')
region('blender_name_tl','混合机左上姓名栏','树果混合机',[0,42,72,30],'白色小面板、彩色玩家名','参与者姓名','准备阶段面板为空；空白也有记录。')
region('blender_name_tr','混合机右上姓名栏','树果混合机',[168,42,72,30],'白色小面板、彩色玩家名','参与者姓名')
region('blender_name_bl','混合机左下姓名栏','树果混合机',[0,86,72,30],'白色小面板、彩色玩家名','参与者姓名')
region('blender_name_br','混合机右下姓名栏','树果混合机',[168,86,72,30],'白色小面板、彩色玩家名','参与者姓名')
region('blender_message','混合机／喂食底部提示','树果混合机',[0,112,240,48],GRAY,'启动、选树果、完成方块、等级与口感、喂食提示')
region('blender_ranking','混合机中央排名弹窗','树果混合机',[32,16,176,128],GRAY,'ランキング、玩家排名、◎／○／× 及次数','覆盖后方姓名栏。')
region('blender_result','混合机中央配方结果弹窗','树果混合机',[32,16,176,128],GRAY,'まぜたけっか、姓名、投入树果、最高转速、时间','与同位置的排名表分开，字段结构不同。')
region('blender_timer','混合机底部计时','树果混合机',[96,136,48,16],'小型数字显示条','分秒计时；阶段数字属于过程提示')
region('blender_countdown','混合机中央倒计时','树果混合机',[96,56,48,48],'圆形机构上方大型数字','倒计时数字','不是传统矩形文字框，作为独立文字区域。')
region('berry_tag_heading','树果标签页标题','树果标签',[16,0,96,16],'棕色标题条、深色字','きのみのタグ')
region('berry_tag_name','树果标签名称','树果标签',[84,32,140,16],PANEL,'编号、树果名')
region('berry_tag_properties','树果标签属性','树果标签',[84,56,128,32],PANEL,'大小、cm、软硬度')
region('berry_tag_flavor','树果标签五项口味','树果标签',[40,88,168,24],'口味文字与椭圆选中标记','からい、しぶい、あまい、にがい、すっぱい')
region('berry_tag_description','树果标签说明','树果标签',[24,112,192,40],PANEL,'两行树果说明')
region('block_title','方块盒左上标题','方块与状态',[8,0,88,32],PANEL,'ポロックケース')
region('block_list','方块盒右侧列表','方块与状态',[112,0,128,160],PANEL,'颜色名称、方块、Lv、制作/退出选项')
region('block_flavors','方块盒左下口味属性','方块与状态',[8,100,104,52],PANEL,'からい、しぶい、あまい、にがい、すっぱい、なめらかさ')
region('condition_title','状态图页左上标题','方块与状态',[0,0,88,24],'紫色标题框、白字','コンディション')
region('condition_identity','状态图页上方身份','方块与状态',[96,0,112,24],PANEL,'昵称、性别、Lv')
region('condition_graph','状态图五项标签与 FEEL','方块与状态',[96,32,144,96],'浅蓝色面板内小字','かっこよさ、うつくしさ、かわいさ、かしこさ、たくましさ、FEEL','图表形状、星点与图标不当作文字。')
region('condition_hint','状态图页左下操作提示','方块与状态',[0,104,88,24],PANEL,'せいかく／がんばりや')
region('condition_message','状态图页底部消息','方块与状态',[0,128,240,32],GRAY,'喂食确认、状态提升结果')
region('summary_title','摘要页左上页名','摘要页面',[0,0,160,16],'黄色或黄绿色页眉、白字','宝可梦信息、能力、战斗招式、华丽招式')
region('summary_hint','摘要页右上按键提示','摘要页面',[192,0,48,16],'页眉中红色 A 标记与浅色字','やめる／いれかえ／きりかえ')
region('summary_identity','摘要页左侧身份栏','摘要页面',[0,16,80,112],'紫色底、浅色字','图鉴号、等级、物种/昵称、性别','背包球图标及宝可梦像不视为文字。')
region('summary_personal','信息页训练家身份／属性栏','摘要页面',[80,20,160,44],PANEL,'パーソナル、おや、IDNo、タイプ、属性')
region('summary_ability','信息页特性栏','摘要页面',[80,60,160,44],PANEL,'とくせい、特性名、特性说明')
region('summary_memo','信息页训练家笔记','摘要页面',[80,100,160,44],PANEL,'トレーナーメモ、性格、相遇等级、地点')
region('summary_item','能力页持有道具','摘要页面',[80,22,80,26],PANEL,'もちもの、道具名或なし')
region('summary_ribbon','能力页缎带','摘要页面',[160,22,80,26],PANEL,'リボン、数量或なし')
region('summary_stats','能力页六项数值','摘要页面',[80,46,160,58],PANEL,'HP、攻击、防御、特攻、特防、速度及数值')
region('summary_experience','能力页经验栏','摘要页面',[80,104,160,44],PANEL,'けいけんち、当前经验、升级所需经验、EXP 标签','EXP 条图形不计作文本。')
region('summary_battle_moves','战斗招式页列表','摘要页面',[80,24,160,88],PANEL,'招式属性、招式名、PP 当前/最大值；选择状态有もどる')
region('summary_move_power','战斗招式页威力／命中','摘要页面',[0,110,80,42],PANEL,'こうか、いりょく、めいちゅう、数值','未选择招式时该区域未显示；不是识别缺失。')
region('summary_move_description','战斗招式页说明','摘要页面',[80,110,160,42],PANEL,'せつめい、两行招式说明','未选择招式时只有标题和空说明框。')
region('summary_contest_moves','华丽招式页列表','摘要页面',[80,24,160,88],PANEL,'华丽类别、招式名、PP；选中状态有もどる')
region('summary_contest_effect','华丽招式页魅力／妨碍','摘要页面',[0,110,80,42],PANEL,'こうか、アピール、ぼうがい、心形符号','心形是评分符号，需要和文字语义一起保留。')
region('summary_contest_description','华丽招式页说明','摘要页面',[80,110,160,42],PANEL,'せつめい、两行华丽效果说明','未选择招式时只有标题和空说明框。')

records=json.loads((HERE/'inventory.json').read_text(encoding='utf-8'))
by_id={r['id']:r for r in records}
for r in records:
    r.update(layout=None, regions=[], observations=[], review='逐张目视检查；复用人工布局模板，非逐字符 OCR 标注')

def ids(spec):
    out=[]
    for chunk in str(spec).split(','):
        ab=chunk.strip().split('-');out.extend(range(int(ab[0]),int(ab[-1])+1))
    return out

def set_layout(p,spec,label,keys):
    for i in ids(spec):
        r=by_id[f'{p.upper()}-{i:03}'];assert r['layout'] is None,(r['id'],r['layout'])
        r['layout']=label;r['regions']=[dict(type=k) for k in keys.split()]

def add(p,spec,*keys):
    for i in ids(spec):by_id[f'{p.upper()}-{i:03}']['regions'] += [dict(type=k) for k in keys]

def remove(p,spec,*keys):
    for i in ids(spec):
        r=by_id[f'{p.upper()}-{i:03}'];r['regions']=[v for v in r['regions'] if v['type'] not in keys]

def note(p,spec,text):
    for i in ids(spec):by_id[f'{p.upper()}-{i:03}']['observations'].append(text)

def state(p,spec,key,value):
    for i in ids(spec):
        rr=[v for v in by_id[f'{p.upper()}-{i:03}']['regions'] if v['type']==key];assert len(rr)==1,(p,i,key)
        rr[0]['text_state']=value

def box(p,spec,key,value):
    for i in ids(spec):
        rr=next(v for v in by_id[f'{p.upper()}-{i:03}']['regions'] if v['type']==key);rr['logical_box']=value

PARTY='party_lead party_row2 party_row3 party_row4 party_row5 party_row6'
for p,spec in [('gba','1-17,21,27-34,37-50,52-69,97-143,189-196,245-250,256-275,288-303'),('ngc','2-10,15-39,42-67,70-81,100-112,121-122')]:
    set_layout(p,spec,'普通对白／场景提示','field_dialog')
set_layout('ngc','1','启动提示','boot_dialog')
for p,spec in [('gba','6,50,63,271,273,303'),('ngc','44,77,79')]:add(p,spec,'field_choice')
for p,spec in [('gba','13'),('ngc','5')]:add(p,spec,'pc_connect_menu')
for p,spec in [('gba','16'),('ngc','8-9')]:add(p,spec,'pc_pokemon_menu')
for p,spec in [('gba','17'),('ngc','10')]:add(p,spec,'pc_item_menu')
add('gba','21','pc_store_menu')
for p,spec in [('gba','18,20'),('ngc','11')]:set_layout(p,spec,'PC 道具列表','pc_item_heading pc_item_list pc_item_description')
for p,spec in [('gba','19,22-26'),('ngc','12-14,85')]:set_layout(p,spec,'背包列表','bag_category bag_list bag_description')
add('gba','27-28','bag_category','bag_list','bag_description')
state('gba','27-28','bag_description','empty')
note('gba','27-28','重要物品列表下部被普通对白覆盖；分类标题仍可见，左下说明区域可见部分为空。')
for p,spec in [('gba','34'),('ngc','39')]:add(p,spec,'shop_menu')
for p,spec in [('gba','35-36'),('ngc','40-41')]:set_layout(p,spec,'商店商品列表','shop_money shop_list shop_description')
for p,spec in [('gba','303'),('ngc','44')]:add(p,spec,'save_summary')
for p,spec in [('gba','51'),('ngc','68')]:set_layout(p,spec,'队伍场景操作',PARTY+' party_short_prompt party_field_action')
set_layout('ngc','69','队伍选择',PARTY+' party_prompt party_cancel')
set_layout('gba','214','队伍选择',PARTY+' party_prompt party_cancel')
set_layout('gba','91,215','队伍战斗操作',PARTY+' party_short_prompt party_battle_action')
set_layout('gba','201,229','队伍恢复结果',PARTY+' party_prompt party_cancel party_recovery')
for p,spec in [('gba','70-90,92-96,144-188,197-200,202-213,216-228,230-244,251-255'),('ngc','113-120')]:set_layout(p,spec,'战斗消息','battle_enemy battle_own battle_message')
for p,spec in [('gba','70,144,197'),('ngc','113-114')]:remove(p,spec,'battle_own')
remove('gba','144,197','battle_enemy')
remove('gba','74-75,158-161,165-168,170-173,176-179,185-188,207-210,212-213,217,221-223,240-244','battle_enemy')
remove('ngc','119-120','battle_enemy')
box('gba','145','battle_enemy',[0,16,72,28])
box('gba','198','battle_enemy',[12,16,96,28])
remove('gba','93','battle_own')
note('gba','145','对手状态栏正在移入，左边界被画面裁切；只标可见部分。')
note('gba','198','我方精灵仍为出场过渡画面，但我方状态栏尚未显示。')
remove('gba','198','battle_own')
remove('gba','217','battle_own')
for p,spec in [('gba','90'),('ngc','115')]:
    remove(p,spec,'battle_message');add(p,spec,'battle_prompt','battle_action');
    for i in ids(spec):by_id[f'{p.upper()}-{i:03}']['layout']='战斗行动菜单'
remove('ngc','116','battle_message');add('ngc','116','battle_moves','battle_move_meta');by_id['NGC-116']['layout']='战斗招式选择'
add('gba','161,168,173,179,210','battle_choice')
box('gba','178','battle_own',[126,72,106,40])
note('gba','161,173','对手下一只尚未出场，先显示更换确认；不标注移入中的状态栏。')
note('gba','178','我方状态栏正在水平移动；外接矩形较常态偏左。')
for p,spec in [('gba','276-277,279-283'),('ngc','82-83,87-94')]:set_layout(p,spec,'树果混合机','blender_name_tl blender_name_tr blender_name_bl blender_name_br blender_message')
remove('gba','279-281','blender_message')
add('gba','279','blender_timer','blender_countdown')
add('gba','280','blender_ranking')
add('gba','281','blender_result')
remove('ngc','87,92','blender_message');add('ngc','87,92','blender_result')
add('gba','283','blender_choice');add('ngc','89,94','blender_choice')
for p,spec in [('gba','276-277,282-283'),('ngc','82-83,88-91,93-94')]:
    for key in ['blender_name_tl','blender_name_tr','blender_name_bl','blender_name_br']:state(p,spec,key,'empty')
for p,spec in [('gba','278'),('ngc','84')]:set_layout(p,spec,'背包操作弹窗','bag_list bag_action bag_prompt')
set_layout('ngc','86','树果标签','berry_tag_heading berry_tag_name berry_tag_properties berry_tag_flavor berry_tag_description')
set_layout('gba','284-285','方块盒','block_title block_list block_flavors')
add('gba','285','block_choice','field_dialog')
set_layout('ngc','95','方块盒确认','block_title block_list block_flavors block_choice field_dialog')
for p,spec in [('gba','286'),('ngc','98')]:set_layout(p,spec,'喂食动画提示','blender_message')
for p,spec in [('gba','287'),('ngc','96-97,99')]:set_layout(p,spec,'宝可梦状态图','condition_title condition_identity condition_graph condition_hint')
add('gba','287','condition_message');add('ngc','97,99','condition_message');add('ngc','97','condition_choice')
for p,spec in [('gba','304,310'),('ngc','123,131')]:set_layout(p,spec,'摘要信息页','summary_title summary_hint summary_identity summary_personal summary_ability summary_memo')
for p,spec in [('gba','305,311'),('ngc','124,132')]:set_layout(p,spec,'摘要能力页','summary_title summary_identity summary_item summary_ribbon summary_stats summary_experience')
for p,spec in [('gba','306-307,312-313'),('ngc','125-127,133-137')]:set_layout(p,spec,'摘要战斗招式页','summary_title summary_hint summary_identity summary_battle_moves summary_move_description')
for p,spec in [('gba','308-309,314'),('ngc','128-130,138-141')]:set_layout(p,spec,'摘要华丽招式页','summary_title summary_hint summary_identity summary_contest_moves summary_contest_description')
add('gba','306-307,313','summary_move_power');add('ngc','126-127,134-137','summary_move_power')
add('gba','308-309,314','summary_contest_effect');add('ngc','129-130,138-140','summary_contest_effect')
for p,spec,key in [('gba','312','summary_move_description'),('ngc','125,133','summary_move_description'),('ngc','128,141','summary_contest_description')]:state(p,spec,key,'heading_only_body_empty')
note('gba','312','未选中招式：说明正文为空，威力/命中区域未显示。')
note('ngc','125,128,133,141','未选中招式：保留说明标题及空框；左下属性面板未显示。')
note('ngc','135,137,140','红色矩形选中高亮未显示，但左下属性及说明仍显示；保留此独立可见状态。')
for p,spec in [('gba','153,175,256,268'),('ngc','28')]:note(p,spec,'可见正文在词句中途结束，疑似逐字打印/未完成；单帧不能判定句尾。')
note('gba','302','正文显示省略号；不能仅凭单帧判定为尚未打印完成。')
note('ngc','97','右侧确认框遮住状态图部分文字。')
if 'GBA-315' in by_id:
    set_layout('gba','315','战斗招式选择','battle_enemy battle_own battle_moves battle_move_meta')
    note('gba','315','新增实图：左下四招式菜单，右下 PP 4/5、わざタイプ／ノーマル。选择箭头指向「あさのひざし」。')
    for v in by_id['GBA-315']['regions']:
        if v['type']=='battle_moves':
            v['visible_text_lines']=['あさのひざし　すいとる','かぜおこし　しびれごな'];v['selected_item']='あさのひざし'
        elif v['type']=='battle_move_meta':v['visible_text_lines']=['PP　4/5','わざタイプ／ノーマル']

# Visual layers. Later regions cover earlier regions only where they intersect.
LAYERS={k:0 for k in REGIONS}
for k in ['field_dialog','battle_message','battle_prompt','blender_message','condition_message','party_prompt','party_short_prompt','bag_action','bag_prompt','blender_ranking','blender_result']:
    LAYERS[k]=10
LAYERS['summary_move_power']=10
LAYERS['summary_contest_effect']=10
for k in ['field_choice','battle_choice','blender_choice','condition_choice','block_choice','party_field_action','party_battle_action','party_recovery']:LAYERS[k]=20

def intersect(a,b):
    x=max(a[0],b[0]);y=max(a[1],b[1]);x2=min(a[0]+a[2],b[0]+b[2]);y2=min(a[1]+a[3],b[1]+b[3])
    return [x,y,x2-x,y2-y] if x<x2 and y<y2 else None

def subtract(a,b):
    q=intersect(a,b)
    if not q:return [a]
    x,y,w,h=a;u,v,s,t=q;result=[]
    for rect in [[x,y,w,v-y],[x,v+t,w,y+h-v-t],[x,v,u-x,t],[u+s,v,x+w-u-s,t]]:
        if rect[2]>0 and rect[3]>0:result.append(rect)
    return result

for r in records:
    assert r['layout'],r['id']
    p=ROOT/r['source'];r['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
    r['viewport_original']=[0,0,1200,800] if r['platform']=='gba' else [212,200,1172,800]
    vx,vy,vw,vh=r['viewport_original']
    def mapped(b):return [round(vx+b[0]*vw/240),round(vy+b[1]*vh/160),round(b[2]*vw/240),round(b[3]*vh/160)]
    for i,v in enumerate(r['regions']):
        v['instance_id']=r['id']+f'-R{i+1:02}'
        v['logical_box']=v.get('logical_box',REGIONS[v['type']]['logical_box'])
        v['text_state']=v.get('text_state','visible')
        v['original_box']=mapped(v['logical_box'])
        visible=[v['logical_box']];occluders=[]
        for other in r['regions']:
            if LAYERS[other['type']]<=LAYERS[v['type']]:continue
            ob=other.get('logical_box',REGIONS[other['type']]['logical_box'])
            if intersect(v['logical_box'],ob):
                visible=[piece for a in visible for piece in subtract(a,ob)];occluders.append(other['type'])
        v['visible_logical_rectangles']=visible;v['occluded_by']=occluders
        if not visible:v['text_state']='fully_occluded'
        v['visible_original_rectangles']=[mapped(a) for a in visible]
    if r['platform']=='ngc':
        r['external_text_regions']=[dict(type='gb_player_menu_hint',name='Game Boy Player 右上菜单提示',original_box=[1110,54,370,74],content='Z ボタン：メニュー',scope='外层设备界面，不是游戏对白')]
    else:r['external_text_regions']=[]
    r['thumbnail']='thumbs/'+r['id']+'.jpg'
    (HERE/'thumbs').mkdir(exist_ok=True)
    im=Image.open(p).crop((vx,vy,vx+vw,vy+vh));im.resize((480,320)).save(HERE/r['thumbnail'],quality=88)

metadata={
 'schema_version':1,'date':'2026-11-01','task':'testcase 截图文本框类型与位置整理',
 'method':f'全部 {len(records)} 张逐图目视检查，再按已检查的布局模板建立区域。不是游戏源码窗口 ID，也不是逐字符日文识别答案。',
 'coordinate_convention':'[x,y,width,height]，左上原点，右/下边界不包含。logical_box 归一化到 240×160；original_box 为原始截图像素。',
 'precision':'人工近似窗口/文字区外接框，包含边框和留白，不是紧贴字形的框。建议误差预算：逻辑坐标约 ±3 px；NGC 另有视口估计误差。不得直接视为像素级 OCR 裁切真值。',
 'viewports':{'gba':{'original':[0,0,1200,800],'scale_x':5,'scale_y':5},'ngc':{'original':[212,200,1172,800],'scale_x':1172/240,'scale_y':5,'note':'目视近似活动画面；存在边缘过渡，非无损等比缩放。所有截图固定映射，未验证时序稳定性。'}},
 'occlusion':'logical_box 为候选窗口范围；visible_logical_rectangles 减去已标注高层弹窗的覆盖。只表示可见几何，不补写隐藏文字。',
 'font':'这里只记录目视字体/颜色/排版；未读取 ROM/源码确认字体编号、步进和字高。不能假定所有文字都在统一 8×8 网格。',
 'exclusions':'地图装饰、精灵/道具图标、HP/EXP 条图形、无文字空白背景和外框品牌标志不作为游戏文本框；NGC 外层 Z 菜单提示单列。',
 'gaps':['本次只整理现有静态截图，不能证明全部游戏窗口布局已覆盖。','未见 PC 盒子网格、盒内宝可梦详情或移动/寄存实际操作页。','未见独立宝可梦图鉴、宝可导航的完整页面。','商店只见入口与购买列表，未见出售、数量选择和成交确认。','GBA 本批未见战斗招式选择菜单；NGC 本批未见训练家战斗完整流程。','NGC 有树果标签；GBA 本批未见树果标签。','没有连续录像，无法验证闪烁、滚动、打印结束或窗口移动轨迹。','额外收录华丽招式页、方块盒、混合机和状态图，不因此改变 spec.md 首版范围。']
}

def render_catalog(document):
    payload=json.dumps(document,ensure_ascii=False).replace('<','\\u003c')
    template=r'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__PLATFORM__ 文本框目录</title>
<style>
:root{color-scheme:light;--ink:#172a39;--blue:#075f90}*{box-sizing:border-box}body{margin:0;background:#f1f5f7;color:var(--ink);font:15px/1.6 "Microsoft YaHei",system-ui,sans-serif}header{background:#16394b;color:white;padding:24px 5vw}header h1{margin:6px 0;font-size:28px}header a{color:#d9f2ff}main{max-width:1500px;margin:auto;padding:20px}h2{font-size:21px}a{color:var(--blue)}button,select,input{font:inherit;padding:9px 12px;border:1px solid #b6c5cf;border-radius:7px;background:white;color:var(--ink)}button{cursor:pointer}button:hover{border-color:#057cab}button.active{background:#075f90;color:white}section,.intro{background:white;border-radius:12px;padding:18px;margin-bottom:20px}details{padding:8px 0}summary{cursor:pointer;font-weight:600}.controls{display:flex;gap:10px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:#eef5f8ee;padding:12px;border-bottom:1px solid #cbd8df}.controls input{min-width:240px;flex:1}.muted{color:#566b7a}.badge{display:inline-block;background:#dfeef5;padding:2px 8px;margin:2px;border-radius:4px;font-size:12px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:9px;text-align:left;border-bottom:1px solid #dfe7ec;vertical-align:top}th{background:#edf4f8}td button{font-size:13px;padding:3px 8px}.tablewrap{overflow:auto;max-height:550px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}.card{background:white;border:1px solid #d7e1e7;border-radius:10px;overflow:hidden;cursor:pointer}.card img{display:block;width:100%;aspect-ratio:1.5;background:#111}.caption{padding:10px}.caption strong{font-size:16px}.caption small{display:block;color:#5d6d78}.card:hover{box-shadow:0 4px 16px #1233}.pager{display:flex;gap:12px;align-items:center;margin:20px 0}.notice{border-left:4px solid #db9e27;padding-left:12px}dialog{border:0;border-radius:12px;width:min(1460px,98vw);max-height:96vh;padding:16px}dialog::backdrop{background:#001521c9}.modalhead{display:flex;justify-content:space-between;align-items:center;gap:12px}.modalbody{display:grid;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);gap:16px}.preview{position:sticky;top:0;align-self:start;background:#10222c}.preview svg{display:block;width:100%;max-height:78vh}.regionlist{max-height:78vh;overflow:auto}.regionrow{border:1px solid #d5dfe5;padding:9px;margin:7px 0;border-radius:7px;cursor:pointer}.regionrow.selected{background:#e3f4ff;border-color:#0079c7}.coords{font-family:Consolas,monospace;font-size:12px}.legend{font-size:12px;color:#b5e9ff;padding:8px}.end{font-size:12px;color:#566b7a;padding:20px 0}@media(max-width:850px){.modalbody{display:block}.preview{position:static}.regionlist{max-height:none}}
</style>
<header><a href="index.html">← 总览</a>　<a href="gba.html">GBA 目录</a>　<a href="ngc.html">NGC 目录</a><h1>__PLATFORM__ · 文本框与文字区域目录</h1><div id="stats"></div></header>
<main><section class="intro"><b>整理单位：可见文字区域的用途 × 位置 × 布局。</b> 对白内容、背景地图或宝可梦名称改变时复用同一类型；位置或字段结构改变时分开。包括无边框文字栏和有文字语义的数值、符号。<p class="notice">坐标是人工近似外接框，包含边框与留白。逻辑坐标按 240×160 表示，原图坐标保留各链路映射。此目录用于布局调查，尚不是像素级裁切真值或 OCR 验收答案。</p><div id="viewport"></div><details><summary>方法、字体与遮挡说明</summary><div id="method"></div></details><details><summary>本轮排除的类型</summary><p>按用户在 Excel 中删除的类型行排除。排除不表示画面上不存在；相关遮挡仍按真实画面保留。</p><ul id="excludedTypes"></ul></details><details><summary>本批样本的覆盖缺口</summary><ul id="gaps"></ul></details><details><summary>含保留区域的页面／状态统计</summary><div id="layouts"></div></details></section>
<section><h2>区域类型索引</h2><p class="muted">“查看”可筛选出全部关联截图。统计包含空文字框；被遮住的区域保留候选范围及可见部分。</p><div class="tablewrap"><table><thead><tr><th>用途／位置</th><th>逻辑坐标 [x,y,w,h]</th><th>样本数</th><th>内容与外观</th><th></th></tr></thead><tbody id="types"></tbody></table></div></section>
<div class="controls"><select id="group"><option value="">所有类别</option></select><select id="type"><option value="">所有区域类型</option></select><input id="query" placeholder="搜索编号、文件名、页面、备注…"><label><input type="checkbox" id="includeExcluded" style="min-width:0"> 包含无保留区域原图</label><button id="reset">重置</button></div><p id="result"></p><div id="grid" class="grid"></div><div class="pager"><button id="prev">上一页</button><span id="page"></span><button id="next">下一页</button></div><p class="end">2026-11-01 · 全量人工目视布局调查，按用户 Excel 筛选同步。原图保持不变。机器可读数据：<a href="__LOWER__.json">__LOWER__.json</a>。</p></main>
<dialog id="modal"><div class="modalhead"><h2 id="modalTitle"></h2><button id="close">关闭 ×</button></div><p id="modalMeta" class="muted"></p><div class="modalbody"><div class="preview"><svg id="svg"></svg><div class="legend">蓝框：当前区域可见部分；虚线：候选窗口完整范围。点击右侧区域可单独高亮。</div></div><div class="regionlist" id="regionlist"></div></div></dialog>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent), $=s=>document.getElementById(s), defs=Object.fromEntries([...(D.excluded_region_types||[]),...D.region_types].map(d=>[d.key,d]));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const source=r=>'../../'+r.source;
let page=0,filtered=[],active=null,selected=-1;
$('stats').textContent=`${D.image_count} 张原图 · ${D.retained_image_count??D.image_count} 张含保留区域 · 本轮 ${D.region_type_count} 类 · 排除 ${D.excluded_region_type_count||0} 类`;
$('excludedTypes').innerHTML=(D.excluded_region_types||[]).map(t=>`<li>${esc(t.review_id||t.id)}　${esc(t.name)}</li>`).join('')||'<li>无</li>';
const vp=D.metadata.viewports[D.platform];$('viewport').textContent=`原始截图 ${D.images[0].size.join('×')}；游戏视口近似 [${vp.original.join(', ')}]；逻辑到原图：x × ${vp.scale_x.toFixed(4)}，y × ${vp.scale_y.toFixed(4)}，再加视口偏移。`;
$('method').textContent=[D.metadata.method,D.metadata.precision,D.metadata.font,D.metadata.occlusion,D.metadata.exclusions].join(' ');
$('gaps').innerHTML=D.metadata.gaps.map(t=>`<li>${esc(t)}</li>`).join('');
$('layouts').innerHTML='<table>'+Object.entries(D.layout_counts).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v} 张</td></tr>`).join('')+'</table>';
for(const g of [...new Set(D.region_types.map(d=>d.group))])$('group').add(new Option(g,g));
function fillTypes(){const old=$('type').value;$('type').innerHTML='<option value="">所有区域类型</option>';for(const d of D.region_types.filter(d=>!$('group').value||d.group===$('group').value))$('type').add(new Option(d.name,d.key));$('type').value=old;}
fillTypes();
$('types').innerHTML=D.region_types.map(d=>`<tr><td><span class="badge">${esc(d.group)}</span><br><b>${esc(d.name)}</b><small class="muted"><br>${esc(d.review_id||d.id)}</small></td><td class="coords">${d.logical_box.join(', ')}</td><td>${d.image_count}</td><td>${esc(d.content)}<br><small class="muted">${esc(d.appearance)} ${esc(d.note)}</small></td><td><button data-key="${d.key}">查看</button></td></tr>`).join('');
$('types').addEventListener('click',e=>{if(!e.target.dataset.key)return;const d=defs[e.target.dataset.key];$('group').value=d.group;fillTypes();$('type').value=d.key;page=0;render();$('result').scrollIntoView({block:'start'});});
function render(){const g=$('group').value,t=$('type').value,q=$('query').value.trim().toLowerCase();filtered=D.images.filter(r=>($('includeExcluded').checked||r.regions.length>0)&&(!g||r.regions.some(v=>defs[v.type].group===g))&&(!t||r.regions.some(v=>v.type===t))&&(!q||[r.id,r.source,r.layout,...r.observations,...r.regions.map(v=>defs[v.type].name)].join(' ').toLowerCase().includes(q)));const max=Math.max(1,Math.ceil(filtered.length/48));page=Math.min(page,max-1);$('result').textContent=`符合条件 ${filtered.length} 张。点击截图查看本轮保留区域和真实遮挡。`;$('page').textContent=`${page+1} / ${max}`;$('prev').disabled=page===0;$('next').disabled=page>=max-1;$('grid').innerHTML=filtered.slice(page*48,(page+1)*48).map(r=>`<article class="card" data-id="${r.id}" tabindex="0"><img src="${r.thumbnail}" loading="lazy" alt="${r.id} ${esc(r.layout)}"><div class="caption"><strong>${r.id} · ${esc(r.layout)}</strong><small>${esc(r.source.split('/').pop())}</small><span class="badge">${r.regions.length} 个保留区域</span>${r.observations.length?'<span class="badge">有状态备注</span>':''}</div></article>`).join('');}
for(const id of ['type','query'])$(id).addEventListener(id==='query'?'input':'change',()=>{page=0;render()});
$('group').onchange=()=>{fillTypes();page=0;render()};$('includeExcluded').onchange=()=>{page=0;render()};$('reset').onclick=()=>{$('group').value='';fillTypes();$('type').value='';$('query').value='';$('includeExcluded').checked=false;page=0;render()};$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};
const states={visible:'有可见文字',empty:'空文字框',heading_only_body_empty:'有标题，正文为空',fully_occluded:'候选范围完全被遮挡'};
function show(id){active=D.images.find(r=>r.id===id);selected=-1;$('modalTitle').textContent=active.id+' · '+active.layout;$('modalMeta').innerHTML=`<a href="${encodeURI(source(active))}" target="_blank">打开原始截图</a>　${esc(active.source)}<br>${active.observations.map(esc).join('；')}`;$('regionlist').innerHTML=active.regions.map((v,i)=>{const d=defs[v.type];return `<div class="regionrow" data-index="${i}"><b>${i+1}. ${esc(d.name)}</b><br>${esc(states[v.text_state]||v.text_state)}<div class="coords">逻辑 [${v.logical_box.join(', ')}]<br>原图 [${v.original_box.join(', ')}]</div>${v.occluded_by.length?'<small>被遮挡：'+v.occluded_by.map(k=>esc(defs[k].name)).join('、')+'</small>':''}</div>`}).join('')+active.external_text_regions.map(v=>`<div class="regionrow muted"><b>外层：${esc(v.name)}</b><br>${esc(v.content)}<div class="coords">原图 [${v.original_box.join(', ')}]</div>${esc(v.scope)}</div>`).join('');draw();$('modal').showModal();}
function draw(){const svg=$('svg');svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${active.size[0]} ${active.size[1]}`);function node(name,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);svg.appendChild(e);return e;}node('image',{href:encodeURI(source(active)),width:active.size[0],height:active.size[1]});function rect(b,color,dashed=false){node('rect',{x:b[0],y:b[1],width:b[2],height:b[3],fill:'none',stroke:color,'stroke-width':selected<0?3:5,'stroke-dasharray':dashed?'9 7':'none'});}active.regions.forEach((v,i)=>{if(selected>=0&&i!==selected)return;const chosen=!$('type').value||v.type===$('type').value;if(selected<0&&!chosen)return;rect(v.original_box,'#ffda64',true);for(const b of v.visible_original_rectangles)rect(b,'#00caff');const label=node('text',{x:v.original_box[0]+4,y:Math.max(18,v.original_box[1]+17),fill:'#00141e',stroke:'white','stroke-width':3,'paint-order':'stroke',style:'font:bold 18px sans-serif'});label.textContent=String(i+1);});if(selected<0&&!$('type').value)for(const v of active.external_text_regions)rect(v.original_box,'#dd88ff');for(const e of $('regionlist').querySelectorAll('[data-index]'))e.classList.toggle('selected',Number(e.dataset.index)===selected);}
$('grid').onclick=e=>{const c=e.target.closest('[data-id]');if(c)show(c.dataset.id)};$('grid').onkeydown=e=>{if(e.key==='Enter'){const c=e.target.closest('[data-id]');if(c)show(c.dataset.id)}};$('regionlist').onclick=e=>{const r=e.target.closest('[data-index]');if(r){const n=Number(r.dataset.index);selected=selected===n?-1:n;draw()}};$('close').onclick=()=>$('modal').close();$('modal').onclick=e=>{if(e.target===$('modal'))$('modal').close()};render();
</script></html>'''
    return template.replace('__DATA__',payload).replace('__PLATFORM__',document['platform'].upper()).replace('__LOWER__',document['platform'])

selection_path=HERE/'review_selection.json'
selection=json.loads(selection_path.read_text(encoding='utf-8')) if selection_path.exists() else None
if selection:
    metadata['review_selection']={k:selection[k] for k in ['date','source_workbook','source_sha256','snapshot','archive','method']}
    metadata['user_scope_updates']=selection.get('scope_updates',[])
    metadata['sample_updates']=selection.get('sample_updates',[])
    if 'GBA-315' in by_id:
        metadata['gaps']=[g.replace('GBA 本批未见战斗招式选择菜单；','新增 GBA-315 已补齐战斗招式选择菜单；') for g in metadata['gaps']]
    metadata['method']+=' 已按用户 Excel 保留/删除的类型行同步本轮范围，仍保留全部原图索引和排除项。'

for platform in ['gba','ngc']:
    rr=[r for r in records if r['platform']==platform]
    stable_ids={}
    if selection:
        baseline=json.loads((HERE/selection['archive']/(platform+'.json')).read_text(encoding='utf-8'))
        stable_ids={d['key']:d.get('review_id',f'{platform.upper()}-T{i+1:03}') for i,d in enumerate(baseline['region_types']+baseline.get('excluded_region_types',[]))}
        stable_ids.update({d['key']:d['review_id'] for d in selection['platforms'][platform].get('additional_types',[])})
    used={v['type'] for r in rr for v in r['regions']}
    defs=[]
    for key,definition in REGIONS.items():
        if key not in used:continue
        d=definition.copy();d['id']=platform.upper()+'-'+key
        examples=[r['id'] for r in rr if any(v['type']==key for v in r['regions'])]
        d['example_ids']=examples;d['image_count']=len(examples)
        d['instance_count']=sum(v['type']==key for r in rr for v in r['regions'])
        d['review_id']=stable_ids.get(key,f'{platform.upper()}-T{len(defs)+1:03}')
        defs.append(d)
    all_defs=defs
    excluded=[]
    if selection:
        scope=selection['platforms'][platform];retained=set(scope['retained_keys']);additional_keys={d['key'] for d in scope.get('additional_types',[])};review_rows={row['P']:row for row in scope['review_rows']}
        excluded=[d for d in all_defs if d['key'] not in retained|additional_keys]
        defs=[next(d for d in all_defs if d['key']==key) for key in scope['retained_keys']]
        for d in defs:
            row=review_rows[d['key']]
            assert d['review_id']==row['A'],(d['key'],row['A'])
            assert not row.get('J') and row.get('I')=='['+', '.join(str(v) for v in d['logical_box'])+']','本轮发现坐标修改，需要单独应用'
            d['review_status']=row.get('B','');d['review_comment']=row.get('C','')
            d['representative_image_id']=row.get('M','')
        for addition in scope.get('additional_types',[]):
            key=addition['key']
            assert key not in retained,'附加类型已经出现在原保留清单'
            existing=next((d for d in all_defs if d['key']==key),None)
            d=existing.copy() if existing else dict(REGIONS[key],id=platform.upper()+'-'+key,example_ids=[],image_count=0,instance_count=0)
            d.update(addition)
            d.update(representative_image_id=addition.get('reference_image_id','') if existing else '',review_comment='')
            defs.append(d);retained.add(key)
        for r in rr:
            r['in_source_workbook']=r['id'] in scope.get('source_image_ids',scope['image_reviews'])
            r['excluded_regions']=[v for v in r['regions'] if v['type'] not in retained]
            r['regions']=[v for v in r['regions'] if v['type'] in retained]
            if not r['in_source_workbook']:
                r['excluded_regions']+=r['regions'];r['regions']=[]
            r['in_current_scope']=bool(r['regions'])
            r['scope_note']='' if r['regions'] else '本轮无保留区域；原有文字区域均被用户排除，并非空白截图。'
            if not r['in_source_workbook']:r['scope_note']='最新 Excel 逐图审阅页未收录；仅保留原图存档，不计入本轮审阅范围。'
            r['review_status']=scope['image_reviews'].get(r['id'],{}).get('status','未审阅')
            r['review_comment']=scope['image_reviews'].get(r['id'],{}).get('comment','')
    document=dict(metadata=metadata,platform=platform,image_count=len(rr),retained_image_count=sum(bool(r['regions']) for r in rr),region_type_count=len(defs),excluded_region_type_count=len(excluded),region_instance_count=sum(len(r['regions']) for r in rr),excluded_region_instance_count=sum(len(r.get('excluded_regions',[])) for r in rr),layout_counts=dict(Counter(r['layout'] for r in rr if r['regions'])),source_layout_counts=dict(Counter(r['layout'] for r in rr)),region_types=defs,excluded_region_types=excluded,images=rr)
    (HERE/(platform+'.json')).write_text(json.dumps(document,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(platform,len(rr),'images',len(defs),'region types',sum(len(r['regions']) for r in rr),'instances')
    (HERE/(platform+'.html')).write_text(render_catalog(document),encoding='utf-8')
