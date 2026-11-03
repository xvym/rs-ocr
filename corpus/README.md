# 中日文语料映射库

当前提供固定来源的全量日英索引、中文候选和新的 S6 正式语料包。S6 整体仍未完成，全首版语义、电视变量及任意组合短语仍有缺口；S7 窗口集成尚未开始。

当前入口：[正式包/结构/重建说明](../reports/s6-corpus/README.md)、[新覆盖与正确性验收](../reports/s6-acceptance/README.md)、[阶段未完成项](../reports/s6-corpus/progress.json)。`s6/` 保存词条、语义单元、模板、名字政策、同文多译及电视页面的离线决定；只有获批单元进入新包。

[新中文库验收](../reports/s6-acceptance/README.md)采用未改动的冻结答案：770／770 个应翻译单元和 8／8 个合法保留单元通过。300 组实际输出差异的非盲模型复核保存于 `s6/output-judgments.json`，不参与建库。最终应用 A6 尚未执行。

```powershell
node tools/build_s6_corpus.mjs
node tools/evaluate_s6_corpus.mjs --gate
node tools/test_s6_corpus.mjs
node tools/audit_s6_progress.mjs
```

以下 `outputs/corpus-mapping/`、`reviews.json`、原查询命令和 [旧中文验收](../reports/chinese-corpus-acceptance/README.md)描述保持不变的 v1 导入/静态基线：410 条完整静态记录、25／770 未通过。新包位于 `outputs/s6-corpus/`，两者不能混用计数。旧包通过失败退出码不表示新包门槛失败。

## 重建与查询

需要 Node.js 22 或更新版本。下列命令在仓库根目录运行，无第三方 npm 依赖。首次恢复公开上游资料需要网络；资料齐备后的建库、检查和查询均离线。

```powershell
node tools/download_corpus.mjs
node tools/prepare_corpus.mjs
node tools/build_corpus.mjs
node tools/test_corpus.mjs

node tools/query_corpus.mjs --japanese ピカチュウ --game ruby
node tools/query_corpus.mjs --japanese ゴースト --game both
node tools/query_corpus.mjs --qid rs.script.PetalburgCity.PetalburgCity_Text_16433E --game ruby

# 当前返回退出码2表示库级门槛未通过；测试工具检查与库级通过分开。
node tools/accept_chinese_corpus.mjs --gate
node tools/test_chinese_corpus_acceptance.mjs
```

`sources.json` 固定 16 份上游输入的仓库、提交、原路径、下载 URL、缓存位置和原始 SHA-256。下载器只接受哈希匹配的字节。源码压缩包经校验后由 `prepare_corpus.mjs` 解压到忽略的 `.tools/corpus-source/`，保存逐文件哈希；不使用既有地址调查目录中可能被修改的源码树。构建器再次检查输入和源码树，逐作重建英文。只读开发资料，不读取或修改日版 ROM、截图答案或 OCR 引擎。

查询按完整日文值或完整 qid 精确检索，返回原文、全部中文候选、来源、核对与暂缓信息。没有选择游戏时保留两作；不做前缀、昵称片段或模糊猜测。`translation` 只返回已进入静态资源包的唯一中文；`null` 表示待核对、需上下文或未收录。该入口用于审查数据库，并非已经集成的 S7 翻译器。

已新增 [日文来源匹配器](../reports/japanese-source-matching/README.md)，先查询完整源记录及已冻结的原生标签，分别处理排版、数字显示形式、清屏／滚动窗口、短模板、姓名＋有限称呼、受锚点约束的变量及有实际字形证据的候选。摘要页等组合字段保留原文跨度和当前数值，分组成文字查询。`node tools/resolve_japanese.mjs --japanese ゴースト --kind type` 可按明确词条类型检索；批量输入支持实际 OCR 布局和字形诊断。原精确查询入口保持独立；新入口不发布中文，也不将来源候选当作已审核译文。实际 579 区域的诊断、同一旧分母的修复比较、单独来源复核和复现方式见报告。

## 数据结构

全部生成物位于 [outputs/corpus-mapping/](../outputs/corpus-mapping/)，CSV 为 UTF-8 BOM，使用标准引号转义。源文本内的 `\n` 等仍是原始转义序列，不改写原文。

| 文件 | 内容与主键 |
| --- | --- |
| `records.csv` | 每个 qid 一条：原始行号、日文、英文、显式版本标记。共 13,479 条，不过滤空记录后重新拼接。 |
| `source-links.csv` | qid × 游戏 × 英文源码地址的候选关联，含符号、文件、符号起址、内部偏移与证据类型。 |
| `rsc-import.csv` | 游戏 × 原汉化地址：原文、原地址、纠正地址、汉化长度、实际英文长度、结构成员、偏移及英文字节哈希。 |
| `candidates.csv` | 候选 ID：qid、游戏、中文、来源 ID、原记录序号／词典行号、地址、成员及独立的语义核对状态。 |
| `conflicts.json` | 同文多译原候选、qid、处理状态；实质冲突保留，不按首条选择。 |
| `gaps.csv` | qid × 游戏没有中文候选的原因，包括日文／英文不存在、英文未对应、缺汉化及未支持编码。 |
| `semantic-worklist.csv` | 包含排版或变量的源记录及换行、滚动、清屏计数，全部仍须打印机制和语义分段核对。 |
| `variables.csv` | 日文括号项的出现数、初步类型、绑定条件、来源和待核对状态。 |
| `runtime.json` | 仅经显式核对且无未解决同文歧义的完整静态记录；日中原文、qid、游戏、核对方法、原译文及候选 ID 均保留。 |
| `summary.json` | 来源对应、缺口、核对、同文多译与静态可用数量；不表示实际画面或运行覆盖。 |
| `build-manifest.json` | 固定输入、实现／核对文件及生成物 SHA-256，支持逐字节重建比对。 |

`reviews.json` 是可维护的离线核对／补译／订正决定。每条绑定 qid、游戏、原始日英文本和全部原中文候选；输入或候选变化时构建失败，须重新核对。所有本次核对标为 `model_reviewed`，未冒充人工。补译必须原本没有候选；订正保留原译文和原因。`variable-rules.json` 只记录开发期约束，未将缓冲编号当作语义类型，也未批准动态运行绑定。

`source-matching/` 保存来源检索的单独复核、固定源文本证据及基线哈希。与 `acceptance/` 一样只供验证，不参与建库或查询。来源匹配器即使捕获到槽位，也仍标为未核对调用点的语法假设，不批准身份缓存、实际变量语义或中文绑定。

`source-matching/binding-review-cases.mjs` 另编 13 个实际区域的玩家名/训练家类别与姓名判断，仅供边界审计。`node tools/audit_source_bindings.mjs` 比较原 148 个槽位单元，累计排除 138 个错误解释并补回 9 个正确经验值解释；只余 2 个含义一致的双打行号身份多解。新增 `observation-review-cases.mjs` 的 9 项野生/捕获/金额/回复/使用消息复核通过。逐源规则不批准全量缓冲或完整调用点，见 [来源报告](../reports/japanese-source-matching/README.md)。

`source-matching/experience-review-cases.mjs` 另编 9 个存档区域的正确来源、当前名字与经验值；`typed-slot-rules.json` 只为三个明确 qid 保存赠物／物种的保守词条约束和原始日英哈希，不全局定义缓冲编号。经验值普通／额外句式具有两份日版 ROM 的局部缓冲执行证据，排除 78 个领取误解释并加入 9 个正确经验值解释；约束的模型核对、未验证调用点及自定义显示回退边界见 [专项报告](../reports/japanese-source-matching/README.md#经验值来源与数值专项)。中文静态包保持原样。

`battle-matching/send-out-rules.json` 以完整日文锁定 8 个派出／换入预告源记录，生成 15 个当前行动窗口。只替换明确审过的段／行，不删除同源的未审整段或后续清屏窗口；类别＋姓名与完整姓名比较当前显示标签，保留单／双打来源和行号。`source-matching/send-out-review-cases.mjs` 另编 8 个实际区域的来源集合及行动含义，见 [窗口报告](../reports/japanese-source-matching/README.md#单／双打来源窗口与当前含义)。此项模型复核没有新增原生脚本执行或中文批准。

`battle-matching/rules.json` 是单独的战斗来源／显示含义模型：普通升降预展开，其他句式按有限词表约束，招式使用形式由日版原生选择函数核验。`node tools/build_battle_source_templates.mjs` 生成资源与审阅 CSV，`node tools/test_battle_source_matching.mjs` 检查边界及固定案例。生成器不读取答案，`battle-matching/review-*` 仅用于另行复核，不参与运行资源。它不修改原中文库或 `variable-rules.json` 的全局待审状态，详见 [战斗来源报告](../reports/battle-source-matching/README.md)。

## 对应规则与边界

日英记录按固定 corpus 的原始物理行对齐，验证行数与 qid 唯一性，保留 `[NULL]`、控制序列和完整文本。`^R`、`^S` 明确版本标记分别保存；无标记只表示上游共用记录，不能证明所有日版行为一致。格式依据为固定版本的 [Poké Corpus NOTES.md](https://github.com/abcboy101/poke-corpus/blob/0370812d2a2d7b148de0504ab16d5ef90c7af5c9/NOTES.md)。其盲文已经转成普通文字，相关记录不能直接视为 OCR 显示串。

英文以固定美版 rev2 源码、字符表和符号还原；文件偏移等于符号 CPU 地址减 `0x08000000`。变量、`\n`、`\r`、`\c` 分别转换为原英文编码后逐字节核对；字符串由终止符和控制参数长度确定，不按汉化字节数截取。数组及结构字段按源定义步长定位，原始记录序号和偏移保留。遇到不支持的控制或编码则留缺口。

同名符号、已知数组成员或旧 qid 地址到 rev0 符号的别名，必须同时满足英文编码完全一致，才记为结构证据。符号改名或成员未确定时，完全相同的英文只形成候选；可能的一对多全部保留。字节相同并不证明日中语义相同。独立词典只针对物种、招式、特性、道具的完整类型词条；英文大小写和历史名称空格等压缩匹配单列证据，碰撞保留，不在对白内替换子串。

汉化导入保留两处原错误，通过单独纠错层应用红宝石“求雨” `0x3CAE94 → 0x3CAEB0`、“小果然玩偶” `0x3EC2761 → 0x3EC261`。原下载文件和既有地址调查制品不改写。

当前静态包拒绝所有变量、日文换行／滚动／清屏记录。中文仅在明确核对的少数完整静态句中去掉原汉化的排版换行，原文和理由仍保留。没有从一个控制符分隔的整段文本推定可提前发布的中文，也没有声称已枚举可见窗口。S7 应消费明确的资源状态，不能直接把 `candidates.csv` 当作已批准译文。
