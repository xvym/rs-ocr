"""Create the entry report and a visual audit of the region templates."""
from pathlib import Path
from collections import Counter
from PIL import Image, ImageDraw, ImageFont
import json,html

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
docs={p:json.loads((HERE/(p+'.json')).read_text(encoding='utf-8')) for p in ['gba','ngc']}
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',14)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',12)
for platform,d in docs.items():
    (HERE/'audit').mkdir(exist_ok=True)
    for start in range(0,len(d['region_types']),16):
        canvas=Image.new('RGB',(1280,1000),'#eff3f5');draw=ImageDraw.Draw(canvas)
        for j,t in enumerate(d['region_types'][start:start+16]):
            matches=[(r,v) for r in d['images'] for v in r['regions'] if v['type']==t['key']]
            r,v=next(((r,v) for r,v in matches if v['text_state']=='visible' and not v['occluded_by']),matches[0])
            im=Image.open(ROOT/r['source']);x,y,w,h=v['original_box'];im=im.crop((x,y,x+w,y+h));im.thumbnail((304,180))
            cx=(j%4)*320;cy=(j//4)*250
            canvas.paste(im,(cx+8,cy+8));draw.text((cx+8,cy+190),t['name'],font=font,fill='#123')
            draw.text((cx+8,cy+212),r['id']+' '+str(v['logical_box']),font=small,fill='#456')
        canvas.save(HERE/'audit'/f'{platform}-{start//16+1:02}.jpg',quality=93)
    # A few annotated originals, useful outside the HTML viewer.
    reps={'gba':['GBA-006','GBA-018','GBA-051','GBA-090','GBA-303','GBA-306'],
          'ngc':['NGC-044','NGC-086','NGC-097','NGC-116','NGC-123','NGC-134']}[platform]
    (HERE/'examples').mkdir(exist_ok=True)
    for id in reps:
        r=next(r for r in d['images'] if r['id']==id);im=Image.open(ROOT/r['source']).convert('RGB');dr=ImageDraw.Draw(im)
        for n,v in enumerate(r['regions'],1):
            x,y,w,h=v['original_box'];dr.rectangle((x,y,x+w-1,y+h-1),outline='#ffb700',width=3)
            for a,b,c,e in v['visible_original_rectangles']:dr.rectangle((a,b,a+c-1,b+e-1),outline='#00bfff',width=3)
            dr.rectangle((x,y,x+26,y+24),fill='#003957');dr.text((x+3,y+1),str(n),fill='white',font=font)
        im.save(HERE/'examples'/(id+'.jpg'),quality=94)

groups=sorted({t['group'] for d in docs.values() for t in d['region_types']})
table=''
for g in groups:
    vals=[]
    for p,d in docs.items():
        keys={t['key'] for t in d['region_types'] if t['group']==g}
        count=sum(any(v['type'] in keys for v in r['regions']) for r in d['images'])
        vals.append(f'{len(keys)} 类 / {count} 张')
    table+=f'<tr><td>{g}</td><td>{vals[0]}</td><td>{vals[1]}</td></tr>'
gaps=''.join('<li>'+html.escape(x)+'</li>' for x in docs['gba']['metadata']['gaps'])
entry='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testcase 文本框整理</title><style>*{box-sizing:border-box}body{margin:0;background:#eff4f7;color:#193343;font:16px/1.8 "Microsoft YaHei",system-ui,sans-serif}main{max-width:1120px;padding:36px 24px;margin:auto}h1{font-size:34px;margin:0}h2{font-size:23px}a{color:#006699}.muted{color:#596e7c}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:25px 0}.card,section{background:white;border:1px solid #d7e3e9;border-radius:14px;padding:24px;margin-bottom:20px}.card a{font-size:24px;font-weight:bold}.count{font-size:36px;color:#00668e}.button{display:inline-block;background:#056c9b;color:white!important;border-radius:7px;padding:8px 18px;font-size:16px!important;text-decoration:none}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #dce6ec}th{background:#e9f2f7}.notice{border-left:4px solid #d39520;padding-left:15px}code{font:14px Consolas,monospace}.examples{display:grid;grid-template-columns:1fr 1fr;gap:20px}.examples img{width:100%;display:block}small{font-size:13px}@media(max-width:680px){.cards,.examples{grid-template-columns:1fr}main{padding:20px 12px}}</style><main><p class="muted">2026-11-01 · rs-ocr 静态截图调查</p><h1>Testcase 文本框整理</h1><p>已逐张检查 <b>455 张原始截图</b>，按文字区域的用途、位置及字段布局归类。GBA 与 NGC 分别编号、统计和保存坐标；原图不移动、不改写。</p><div class="cards"><div class="card"><a href="gba.html">GBA 独立目录</a><div class="count">314 张 · 72 类</div><p>1200×800，按全图归一化为 240×160。含普通对白、PC、背包、商店、队伍、野生与训练家战斗、混合机、方块盒及摘要页面。</p><a class="button" href="gba.html">打开 GBA 目录</a>　<a href="gba.json">区域数据</a></div><div class="card"><a href="ngc.html">NGC 独立目录</a><div class="count">141 张 · 74 类</div><p>1600×1200，先区分 Game Boy Player 外框，再取游戏视口。另见启动系统提示、树果标签和战斗招式菜单。</p><a class="button" href="ngc.html">打开 NGC 目录</a>　<a href="ngc.json">区域数据</a></div></div>
<section><h2>整理规则与坐标</h2><p>同一种对白在不同地图、不同正文或不同名字下复用布局；菜单位置、窗口尺寸或字段结构不同则分开。例如普通对白与战斗消息分开，场景右侧、战斗最右侧、方块盒左侧和状态图右下的确认框分别建档。队伍的六个位置分别记录，摘要的身份、特性、笔记、数值和招式说明分别记录。</p><p>目录可按类型筛选全部截图。点击图片后，在原图上显示区域；再点击区域名称可单独高亮。黄色表示候选完整范围，蓝色表示扣除高层窗口后的可见几何。空框、正文为空及疑似逐字打印状态单列，隐藏文字不补出。</p><p class="notice">所有框为人工近似的窗口／文字区外接矩形，含边框和留白，约有 ±3 个逻辑像素误差。它们用于布局归档，尚不适合作为紧贴字形的裁切真值。NGC 游戏视口也为近似测量，未验证像素还原、字体编号或实时 OCR。</p><table><tr><th>坐标</th><th>GBA</th><th>NGC</th></tr><tr><td>原图尺寸</td><td>1200×800</td><td>1600×1200</td></tr><tr><td>游戏视口 [x,y,w,h]</td><td>[0,0,1200,800]</td><td>约 [212,200,1172,800]</td></tr><tr><td>逻辑到原图映射</td><td>x×5，y×5</td><td>x×4.88333+212，y×5+200</td></tr></table><p>NGC 外层右上 <code>Z ボタン：メニュー</code> 单独记录为设备界面文字，不归入游戏对白。Nintendo 与 GAME BOY ADVANCE 品牌标志、场景装饰和纯图标不作为游戏文本框。</p></section>
<section><h2>类别覆盖</h2><p class="muted">每行“张数”按出现该类别的截图去重；一张图可包含多个类别，因此行数不相加。</p><table><tr><th>类别</th><th>GBA：位置类型 / 截图</th><th>NGC：位置类型 / 截图</th></tr>__TABLE__</table></section>
<section><h2>两组样本的差异</h2><ul><li>GBA 有多场训练家战斗、替换确认、奖金、捕获消息与队伍恢复弹窗；NGC 战斗以一段野生战斗为主，但补有四招式菜单及 PP／属性栏。</li><li>NGC 有树果标签页、无正文的招式说明框和状态图页喂食前确认；GBA 有混合机倒计时、计时条与中央排名弹窗。</li><li>两组都包含摘要信息页、能力数值页、战斗招式页和华丽招式页，内容不同但按各自截图独立登记。</li></ul><p>此处的“类”是本次人工整理的区域模板，不是游戏源码中的窗口 ID，也不表示对应页面已经具备 OCR 支持。</p></section>
<section><h2>框选示例</h2><div class="examples"><div><a href="examples/GBA-303.jpg"><img src="examples/GBA-303.jpg" alt="GBA 保存摘要、确认及对白"></a><small>GBA-303：保存摘要、右侧确认、底部对白。</small></div><div><a href="examples/NGC-116.jpg"><img src="examples/NGC-116.jpg" alt="NGC 战斗招式菜单和状态栏"></a><small>NGC-116：对手与我方状态栏、招式菜单、PP／属性栏。</small></div></div></section>
<section><h2>未覆盖与证据边界</h2><ul>__GAPS__</ul><p>只记录当前截图中的可见内容与布局。本次未建立逐字日文答案，未执行 OCR、翻译准确率或实机时序验收，未改动 spec.md 与 execplan.md。</p></section>
<section><h2>文件说明</h2><p><a href="gba.html">gba.html</a> / <a href="ngc.html">ngc.html</a>：分别查看类型索引与全部截图。<br><a href="gba.json">gba.json</a> / <a href="ngc.json">ngc.json</a>：原图路径、SHA-256、页面分类、逐区域类型、逻辑/原图坐标、遮挡、空框状态与目视备注。<br><a href="inventory.json">inventory.json</a>：455 张原图基础索引。<br><a href="说明.txt">说明.txt</a>：字段和重建方法。</p><p class="muted">请保留此目录与原始 testcase 目录的相对位置，以便打开原图。类型索引中的“查看”显示全部关联样本；图库每页 48 张，可翻页查看。</p></section></main></html>'''
(HERE/'index.html').write_text(entry.replace('__TABLE__',table).replace('__GAPS__',gaps),encoding='utf-8')
(HERE/'说明.txt').write_text('''Testcase 文本框目录（2026-11-01）

入口：index.html；GBA 和 NGC 在 gba.html / ngc.html 分开整理。
打开方式：直接用浏览器打开；不需要服务器、网络或依赖安装。
原图目录保持不变。移动目录时必须保持 reports/textbox-catalog 与 *_testcase 的相对位置。

数据：gba.json、ngc.json
- images[].id：按文件名排序后分配的本次固定索引。
- source、size、sha256：原图路径、尺寸和内容指纹。
- viewport_original：[x,y,width,height]，原图中近似游戏视口。
- layout：人工目视页面/状态。
- regions[].type：对应 region_types[].key。
- logical_box：[x,y,width,height]，归一化至 240×160 的人工近似区域。
- original_box：映射到原始截图像素。
- visible_*_rectangles：候选窗口减去已标注高层弹窗后的可见几何。
- occluded_by：覆盖该窗口的已标注高层区域类型。
- text_state：visible 有可见文字；empty 空文字框；heading_only_body_empty 有标题而正文为空；fully_occluded 完全被覆盖。
- observations：逐图可见状态备注；疑似逐字打印不是时序实测结论。
- external_text_regions：NGC 的 Game Boy Player 设备界面菜单提示。
- region_types：用途、位置、外观、可见字段、样本索引和计数。

“类”的计数包括不同位置的队伍卡片、不同用途的说明面板和确认框。
它不是游戏源码窗口 ID 计数，也不是全部游戏页面的完整清单。
本次为布局调查，没有逐字符日文转录、实际字库编号或像素级框校准。
坐标约 ±3 个逻辑像素，仅为便于审查的区域范围。
数值和字符不从其他截图补写；被遮挡部分不当作当前可见内容。

thumbs/ 是归一化预览；sheets/ 是初始全量目视用联系表。
audit/ 是各区域模板代表裁切；examples/ 是部分原图框选例。
build_catalog.py 中人工模板和逐图分组是本目录分类来源。
重建：使用有 Pillow 的 Python 依次运行 build_catalog.py、finish_catalog.py。
自动校验不代表 OCR 验收或人工真值准确率。
''',encoding='utf-8')
print('Entry report and visual audits generated.')
