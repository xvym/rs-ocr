# S6：仅使用 RSC 原译文

当前包为 `outputs/s6-corpus/`，版本 3，政策为 `rsc-original-only-v1`。中文只从固定 RSC 总文本及该项目提供的四份词典中选择，逐字保留。模型补译、改写、中文事件格式和组合规则均已停用；旧包与原中文验收答案在 [历史档案](../../archive/model-translations/README.md)。

包内 `lexicon` 为有来源的完整词条，`units` 为保留原译文的静态记录；两者可能重叠，不能相加当作覆盖数。每条中文通过候选 ID、qid、游戏、来源文件和固定提交追溯。`candidates` 保存全部 21,192 条原候选，唯一定位的原汉化不再另做语义等价筛选；仍需确定当前可见范围和变量。`provenance.json` 保留原始索引和两段对应证据，`source-inventory.csv` 记录逐作对应状态。

加载器拒绝旧版模型包和不属于原候选的中文；未知内容、冲突、未经验证的控制符和变量整句回退日文。没有中文格式、称呼前缀或词语拼句兜底。人物选择清单仅包含 qid/游戏，不携带新译文。

```powershell
node tools/build_corpus.mjs
node tools/build_s6_corpus.mjs
node tools/test_corpus.mjs
node tools/test_s6_corpus.mjs
node tools/evaluate_s6_corpus.mjs --origin-gate
node tools/audit_s6_progress.mjs
```

`runtime.json`、`summary.json`、`provenance.json`、`source-inventory.csv`、`correspondences.json`、`visible-windows.json` 及 `build-manifest.json` 组成可隔离加载的包；首次建库需按 [语料说明](../../corpus/README.md)恢复固定上游。清单保存输入、实现和制品哈希，测试核对来源、拒绝模型包、保守回退和逐字节重建。

当前 [正式对应索引](../rsc-correspondence-index/README.md)涵盖 222 个有已审来源关联的日文 qid；483 条记录／原中文范围关联、18 条日中源片段关联及 772 条图鉴父记录结构关联，合计 1,273 条。原 115 条反查队列现有 35 条记录与 18 条片段对应，两作各余 31 条同源日文为空的记录。片段保存精确日文范围及哈希，单列在 `source-inventory.csv`，不计作整条已覆盖。`loadS6Probe(...).correspondenceIndex` 返回隔离加载的索引；它不参加 `probe.lookup()` 的译文发布。唯一来源不因中日含义不同而拒绝；调用与窗口未核实的记录仍单列。当前词条 2,506 条、静态记录 319 条不变，所有索引关联均标为待发布审查，图鉴具体日文跨度未推断。

[来源完整性报告](../s6-acceptance/README.md)仅检查中文来自原汉化，不以日中语义等价或译文质量作为门槛。新增 [原 RSC 可见窗口基线](../s6-visible-windows/README.md)登记全部 579 个区域、1,133 个可见单元，首版 783 个中 772 个按原译文/格式输出、11 个保留原文（其中 4 个 EXP 标签按设计保留）。270 个静态原文范围规则随包保存，`loadS6Probe(...).visibleProbe` 可离线核对；它与旧静态 `probe.lookup()` 分开，不增加既有词条/静态记录数。静态中文为连续原文引用；43 类原 RSC 模板仅绑定已核对的原占位符；41 组语义单元处理换行、滚动和清屏；4 种原有打印规则处理当前地点/数字。772 个输出中 8 个是数字或等级格式，不计作中文文本。词条和原标点/格式均有来源，不新增或改写中文模板。未知变量保留原文。

旧 770/770 已撤回。来源关联与固定窗口引用/回退基线已有检查，但 S6 仍未完成；首版长尾、分页语法、变量/打印及新中文全覆盖验收仍需推进。未建立对应不等于汉化项目缺译。用户已要求暂时跳过这些剩余项，现有资源已接入 [S7 Java 桌面中文](../s7-integration/README.md)，真实设备连续游戏及最终延迟验收仍待完成。资源包中的 `runtimeIntegration` 是构建时快照，当前集成状态见 S7 报告及本目录进度审计顶层字段。

两作原生 [命名证据](japanese-name-evidence.json)及 [Easy Chat/对战塔证据](easy-chat-native-evidence.json)保留；它们证明日版数据及打印规则，不授权生成中文。当前状态见 [progress.json](progress.json)，检查见 [checks.json](checks.json)。
