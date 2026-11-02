testcase 文本识别候选基准（2026-11-02）

用途
按用户确认的现有筛选范围，从截图目视转录原始日文，供后续 OCR 程序比对。
这是可复核的候选标注，未经过独立人工复核和冻结；不是现有 OCR 引擎输出，也不表示已达到 100% OCR 验收。

入口
review.html：离线逐区域审阅；默认只显示当前识别目标，支持切换“仅排除的区域”及“全部存档”，可按 GBA/NGC、编号、类型和日文筛选。点击截图查看原图。
ground_truth.json：完整主数据，包含所有原图、哈希、区域、可见范围、文字、换行、数值串和例外说明。
regions.jsonl：每行一个区域对象，便于流式读取。
regions.csv：UTF-8 BOM 表格，含真正的多行文本单元格；程序读取应使用 CSV 解析器，不能简单 splitlines。
summary.json：覆盖数量与暂缓计分项目。
excluded_regions.json：按目标文字可见性导出的11项排除记录、原图路径及具体理由。
occlusion_review.json：21项框体重叠的原图目视复核，含原图哈希、文字可见性及理由；10项文字完整保留识别，11项文字被挡或不可见排除。是AI目视登记，待人工复核，不是运行时按截图编号判断的规则。
SHA256SUMS.txt：导出文件及区域截图的 SHA-256。

范围
456 张原图索引全部保留并验证哈希，目标为 585 个保留区域记录，跨链路合并 51 个用途键。
GBA 45 类/379 个，NGC 47 类/206 个。按各组自己的保留清单筛选，不跨组自动扩展。
以上为存档整理范围；当前按 Spec R18 排除11项（GBA8、NGC3），识别目标为574项（GBA371、NGC203）。
排除项含原7项裁切残字、2项不可见旧候选及2项正常文字区被对白覆盖的背包说明。只遮住边缘、底板或空白而目标文字完整的10项保留识别。
recognition_in_scope 为本帧识别范围；recognition_occluded_by 只记录框体几何遮挡，不能据其非空直接排除。target_text_visibility 及 target_text_visibility_reason 登记文字可见性与理由，expect_region_visible 表示实际可见事实。
原生窗口分配框、面板轮廓和ROI用于发现遮挡复核候选；最终依目标文字或正常文字区是否被覆盖判定，不能仅因框体或ROI重叠排除。
旧目录及已核查共现组合的层叠关系提供候选，occlusion_review.json 提供本批素材逐项复核。原图、转录、裁切和旧Excel保留清单不删除。
GBA-315 继续仅存档；无保留区域的图片不自动当作全图无文字负样本。
两处旧 party_prompt 候选确认不可见；其余 583 项为可见区域，含可见空白或只有部分字形的面板。
524 份不同的区域裁切被逐份目视转录；59 个采样像素、区域类型及尺寸完全相同的实例通过 duplicate_of 显式复用，不按推测正文去重。
每个区域保留稳定 instance_id 和原图 SHA-256，不能只按文件排序或编号猜输入身份。
截图所属红宝石/蓝宝石、ROM 修订版和真实采集链路仍未确认，game_version=null。

文字约定
lines 数组为逐行答案，text 为用 LF 连接的同一内容。同一行双列项目从左到右转写，列间用一个空格。
可见词间间隔转为一个 ASCII 空格；字距、居中、右对齐留白不按像素展开，不能据此反推游戏底层空格编码。
数字和拉丁字符用半角；感叹号/问号为 ！/？；斜线和冒号用 / 和 :；乘号用 ×；二点省略字形用 ‥。
等级/编号/训练家编号的预绘制标志分别记 Lv/No/IDNo；PP、HP、EXP、FEEL、SEL 等可读文字也转录。
保留前导零，number_tokens 使用字符串，例如 No03 中的 03 不转成整数 3。
只认当前帧，不从相邻帧、ROM 正文或剧情补句；明显逐字打印中的 4 个实例单独标记 printing_partial。
图标、光标、上下/翻页箭头、血条、经验条、心形评分和雷达图多边形不作为文字。
7 项有被遮住一部分的字形，原转录和残片说明保留存档，assertion_ready=false；这些区域因目标文字被挡而排除，不再作为当前识别答案或待计分项。GBA-287-R03及NGC-099-R03虽有五项完整标签，但FEEL字形被挡，仍按原目标区域排除，本次未拆分子区域。
两处恢复弹窗下的 party_prompt 设 expect_region_visible=false；不输出隐藏提示。这不意味着整张图没有其他目标。
human_review_status=pending 对所有记录成立：表示尚待人工复核，不会把本次 AI 目视转录声称为人工逐字验收。

坐标约定
[x,y,width,height]，左上原点，右/下边界不包含；logical_box 使用 240x160 游戏坐标。
original_box/visible_original_rectangles 为映射后的原图坐标；catalog_* 保留旧人工候选框供追溯。
当前 ROI 使用日版特征表校正，包含边框及留白，不是字符紧框。部分扩展招式列表按观察到的实际高度调整。
GBA 按 5x 原图采样供审阅；NGC 使用旧目录估计视口供审阅，不能把 NGC 的浮点映射当作像素级真值。
crop 是原转录审阅辅助图，灰色表示原标注中扣除的遮挡；是否纳入需查 target_text_visibility 及文字可见性理由，不能仅凭框体重叠或裁切图判断。原图是文字证据。crop_sha256 是采样像素摘要，crop_file_sha256 是 PNG 文件摘要。
本轮补充 GBA-287 和 NGC-099 的状态图被底部消息框遮挡关系；condition_choice 使用已核查的 [184,80,56,48] 作为遮挡来源，仍不纳入识别目标。

程序比对
预测 JSON 格式参考 prediction_format.example.json。每项使用 instance_id 和 text，或使用 lines 数组。
漏检可省略对应项，也可写 {"instance_id":"...","present":false}；present=false 时不得同时输出非空文本。
可选 logical_box 提供本程序的 ROI 坐标，工具仅报告 IoU，不做未经校准的坐标验收。
输入适配器应按 recognition_in_scope 选择本帧目标，不能把585个存档区域全部当作识别目标；未知 instance_id 作为输入范围错误报告，不混入字符错误率。
比对器仅对 recognition_in_scope=true 的574项计算文字、漏检及数值指标；10项框体重叠但文字完整的目标正常计分，漏掉它们属于漏检。11个文字被挡或不可见的区域不进入这些分母，省略或 present=false 均可。仍输出排除区域（包括空文本但 present=true）时，单列 false_positive_excluded_regions，并判范围行为不符合；隐藏提示另保留对应误输出字段。

运行（需要 Python 3；compare.py 仅使用标准库）：
  python outputs/ocr-ground-truth-20261102/compare.py predictions.json --out comparison.json

默认报告严格字符/换行结果、显式视觉等价结果、CER、缺失区域、不可见候选误输出、数字串符合情况及可完整计分的图片数。
严格模式仅统一 CRLF/LF；视觉模式额外 NFC、忽略空白、统一 ASCII/全角 ! ? / :，不做 NFKC、词典替换或相似假名纠错。
严格 CER 的分母包含答案中的空格和 LF；视觉 CER 去除空白后计算。行首布局缩进另存 line_indents_logical，不并入 text。
这两种 Unicode 比较口径均是候选约定，需在正式验收前由用户复核冻结。
当前识别范围内没有残字暂缓项。--include-fragments 只影响范围内残字断言，不能绕过遮挡框排除规则。
退出码：0=所有参与比较的项严格符合候选答案；1=有不符合或未知编号；2=输入格式/读写错误。
entire_scope_verified 只表示本次范围内的候选比对及排除框输出约束符合，不代表585个存档区域均参与，也不代表标注准确率或产品验收通过。
格式示例只含前三个区域，不是完整预测，也不是 OCR 运行结果。

复现与检查
prepare.py：从原图和现有目录重新生成裁切与审阅拼图，需要 Pillow、NumPy。
annotations/*.txt + transcriptions.json：按审阅拼图顺序保存的目视转录源；| 代表换行，两个方括号哨兵只用于构建，不出现在交付答案里。
build.py：生成 JSON/JSONL/CSV/HTML/摘要和导出哈希，仅使用标准库。
validate.py：核对源文件身份、范围、JSONL/CSV 往返、可见/遮挡边界及比对工具的漏检、误检、字符错误响应。
validation.json 记录的是数据完整性与比对工具检查结果，不是 OCR 识别准确率。
audit_glyphs.py / glyph-consistency.json：对 GBA 普通对白和战斗消息的重复位图字形做发现性一致性检查，曾据此回看原图并修正转录；模板来自本次标注，不是独立正确答案。NGC 视口未做像素级校准，不套用此检查。
browser-validation.json：离线审阅页的筛选、搜索和图片加载检查。

正式冻结前需人工重点复核：21项框体重叠的目标文字可见性判定、11项最终排除依据、日文同形字与标点的 Unicode 约定，以及 NGC 视口的像素级映射。原AI目视审查记录固定在 outputs/testcase-text-review-20261102/audit.json 所列旧主数据哈希，不作为当前范围已验收的依据。
