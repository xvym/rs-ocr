# 日中映射与原汉化资源

当前只使用 `UWorldGX/pkmn_rs_chn_rsc` 的原译文，包括该项目总文本及四份词典；固定提交 `f513cf437acca23d1a5882650ee3b148dc463a17`。政策见 [translation-policy.json](translation-policy.json)。模型可以协助定位、对齐、核对和选择原候选，不能补译、重译、润色或另造中文组合格式。

已撤回旧模型译文、中文预期及其 770/770 验收资格，原件见 [历史档案](../archive/model-translations/README.md)。S6 仍未完成，S7 Java 中文集成尚未开始。当前证据见 [正式包](../reports/s6-corpus/README.md)、[来源检查](../reports/s6-acceptance/README.md)及 [阶段审计](../reports/s6-corpus/progress.json)。

## 重建与查询

Node.js 22 或更新版本，无第三方 npm 依赖。首次恢复公开上游需要网络；输入齐备后可离线构建。

```powershell
node tools/download_corpus.mjs
node tools/prepare_corpus.mjs
node tools/build_corpus.mjs
node tools/build_s6_corpus.mjs
node tools/test_corpus.mjs
node tools/test_s6_corpus.mjs
node tools/test_rsc_correspondences.mjs
node tools/evaluate_s6_corpus.mjs --origin-gate
node tools/audit_s6_progress.mjs

node tools/query_corpus.mjs --japanese ピカチュウ --game ruby
node tools/query_corpus.mjs --japanese ゴースト --game both
node tools/query_corpus.mjs --source-id upstream-5 --source-line 5051
```

`sources.json` 固定 16 份输入的仓库、提交、路径、URL、缓存位置和原始 SHA-256。下载器和构建器验证原字节；`prepare_corpus.mjs` 解压已验证源码并固定逐文件哈希。保留 13,479 条日英记录、两作各 9,805 条汉化和 21,192 条原中文候选。原始来源不修改，换行、清屏、变量和空记录不丢失。

## 数据与发布

`outputs/corpus-mapping/` 保存 `records.csv`、`candidates.csv`、`source-links.csv`、`rsc-import.csv`、`conflicts.json`、`gaps.csv`、`variables.csv`、`semantic-worklist.csv`、静态 `runtime.json`、汇总和构建清单。新增 `correspondences.json` 保存确认对应及图鉴父记录关系，`correspondence-gaps.csv` 记录计入确认对应后的剩余缺口；原 `gaps.csv` 仍是地址/英文桥接基线。CSV 为 UTF-8 BOM；原文内的转义仍按原样保存。

日英桥与英中地址桥分别保存证据。美版 1.2 地址纠错仍为求雨 `0x3CAE94 → 0x3CAEB0`、小果然玩偶 `0x3EC2761 → 0x3EC261`；原地址不覆盖。不能按汉化“字节数”截取英文，也须确认 qid、游戏、源码字段和原汉化范围；唯一对应后不再要求日中语义等价。

`reviews.json` 当前仅允许 `retain`，中文必须等于 `originalChinese` 且确实存在于该 qid/游戏的原候选中。旧 36 条补译已移除，31 条修改恢复原文，留下 404 条来源保留决定；同文冲突仍可能阻止静态发布。`rsc-person-selections.json` 仅保存已有来源人物的 qid/游戏选择，不包含中文。

`outputs/s6-corpus/` 是当前版本 3 的原译文包，结构和交接方式见 [正式包说明](../reports/s6-corpus/README.md)。完整物种、招式、道具、特性名称优先选择 RSC 项目自带的对应类型词典；原地址候选仍完整保留。其他完整词条须有唯一原候选。不能跨类型全局替换词语、拼接称呼或套用模型句式。

每条可输出中文都有原候选 ID 和固定来源。加载器拒绝旧模型包、未经来源验证的中文及中文事件/组合规则。未知、冲突、未核实的原控制符和变量整句暂时保留日文；后续应完善原汉化对应和打印规则。没有找到对应不能推断原汉化缺少译文。

查询接受完整日文、qid 或原文件 `source-id` 与 `source-line`，返回原候选、确认对应、来源和状态；不做前缀或模糊猜测。新增索引支持日文、qid/游戏和原汉化位置双向查找，详见 [索引说明](../reports/rsc-correspondence-index/README.md)。关联不自动成为可发布译文，`translation:null` 仍表示尚未可靠发布。独立 [日文来源匹配器](../reports/japanese-source-matching/README.md)仍返回日文来源证据，不发布中文。

## 验收边界

`--origin-gate` 验证来源完整性和保守静态可用性；不对原汉化译文质量设门槛，也不等于首版覆盖。旧 `--gate` 及模型中文答案冻结命令已停用。新的中文预期必须直接来源于原 RSC 译文并记录来源和变量依据；不能由模型另编答案后再验证模型产物。

日文 S3 冻结、S4/S5、日文来源匹配与原生命名/Easy Chat 证据继续保留。S6 当前未完成；接下来处理原汉化的完整来源、可见窗口和变量对应，以及来源可追溯的中文验收。

对地址桥接基线中 1,772 条未对应记录的 [全文与语义审计](../reports/rsc-semantic-audit/README.md)已找回 197 条原译文对应，现已形成 448 条逐作、逐来源的正式索引关联；历史部分对应结果随后按明确来源和范围逐步入库。原项目说明明确 Easy Chat 组合未作汉化；单个词在其他原文本中的可复用性另行核对，不通过模型补译填补。

当前优先 [从原汉化反查日文](../reports/rsc-reverse-mapping/README.md)。两作各 9,805 条总文本中，原地址候选关联为 9,293／9,294 条；已有记录／原中文范围关联 86／85 条、日中源片段各 9 条、图鉴父记录结构各 386 条，两作各余 31 条无确认关联。原 115 条队列已确认 35 条记录对应及 18 条片段对应，原 115 条待核记录的选择／保留原因均保存于 `rsc-reverse-reviews.json`。片段不计作整条覆盖，不自动发布。772 条逐作图鉴关联只定位所属日文整段，具体中文分页对应的日文范围仍为空；不计为已完成语义或窗口发布。选择快照只保存源位置、范围和哈希，建库直接读取固定原汉化，S6 包携带相同索引。
