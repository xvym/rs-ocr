# rs-ocr

面向日版《宝可梦 红宝石／蓝宝石》的 Windows 离线 OCR 翻译项目。

已构建后可双击 [start-desktop.cmd](start-desktop.cmd) 打开独立窗口，启动器自动寻找 Java 21；当前机器可直接复用已有工具链。

项目已建立 Java 21 离线日文 OCR 入口，并通过 S3 固定实机截图验收：现有 456 张原图、579 个目标在冻结同形字规则下全部正确，CER=0；严格字符一致 577 项。S4 独立窗口已实现，S5 已接入窗口实时捕获、游戏区域校准和结果失效管理；456 张受控回放及 23 个状态场景通过。实际 NDS／NGC 连续链路验收、中文和发行交付尚未完成。

实时模式已调整为文字连续稳定 150ms 后再识别，选择光标和等待箭头动画不反复触发文字识别；结果区对光标显示防抖，内容不变时跳过重绘。更新后关闭旧窗口，再双击启动器使用新版。验证记录见 [稳定触发与防闪烁](reports/s5-live/README.md#稳定触发版本的验证)。

- [Spec](spec.md)：目标、输入、行为、语料和验收要求。
- [ExecPlan](execplan.md)：调查、实现、验证及交付步骤。
- [中日文映射库](corpus/README.md)、[S6 建设报告](reports/corpus-mapping/README.md)：固定日英记录 13,479 条，21,192 条中文候选；410 条已核对静态记录可供后续接入，动态模板、全量语义与中文验收仍在建设。支持离线重建、来源查询和缺口审计。
- [中文库固定集验收](reports/chinese-corpus-acceptance/README.md)、[逐区域审阅](reports/chinese-corpus-acceptance/review.html)：579 个目标另编并冻结中文预期；当前静态包可提供 25／770 个应翻译单元，覆盖 3.25%，库级未通过。未冒充窗口中文或实机验收。
- [日文来源匹配器](reports/japanese-source-matching/README.md)、[来源逐区诊断](reports/japanese-source-matching/review.html)：检索完整语料与原生标签，并支持 [日版战斗组合匹配](reports/battle-source-matching/README.md)。原 769 个 OCR 跨度中 766 个具备组成文字的候选证据；新增 8 个升降及 24 个招式消息的来源／显示含义复核全部通过，只余 3 个未完成片段。45 项来源检查、18 项战斗检查通过；全量来源准确率及中文发布仍未验收，中文基线不变。
- [S5 实时捕获与回放报告](reports/s5-live/README.md)：双击启动后选择投屏或 OBS 窗口，点击“开始实时”；未定位时使用“校准游戏区域”。包含当前测量和实机待验项目。
- [S4 独立窗口与检查记录](reports/s4-window/README.md)：运行方式、456 张实机截图布局检查和显示样例；通过 [build-desktop.ps1](build-desktop.ps1) 构建、[run-desktop.ps1](run-desktop.ps1) 启动，需要 Java 21。
- [S3 固定实机截图验收](reports/s3-acceptance/README.md)、[逐项审阅](reports/s3-acceptance/review.html)：AI 再次复核后冻结现有 testcase；原 574 项加 5 个遗漏字段，579／579 通过。11 个排除区域与 5 张范围内无目标图片无误输出，不宣称独立保留集、全游戏或实时通过。
- [离线识别开发报告与运行方式](reports/ocr-development/README.md)：构建、图片识别及资源来源；原 574 项开发基线单独保留。
- [文本框调查目录](reports/textbox-catalog/index.html)：下载仓库后可离线浏览，原图位于 `gba_testcase/` 和 `ngc_testcase/`。
- [日版 ROM 文本框识别特征](reports/textbox-features/index.html)：51 个保留区域键的位置、面板轮廓、原生颜色、变体及固定像素掩码；与旧人工近似坐标目录分开保存。
- [原始 testcase 转录档案](outputs/ocr-ground-truth-20261102/review.html)：保留 585 个旧目录区域和原 574 项开发分母，旧人工复核字段作为历史记录保留。当前正式依据为 [AI 复核记录](reports/s3-acceptance/ai-review.json)和 [S3 冻结快照](reports/s3-acceptance/reference.json)。
- [文本地址来源清单](outputs/pokeruby-text-audit/manifest.json)：RSC 中文与 pokeruby 美版资料的固定版本及哈希。
- [实际输入登记](reports/input-capture.json)：用户确认 NDS／NGC 实机采集，NDS 疑似 Loopy 卡，NGC 转 HDMI 后经 OBS 采集；具体型号、设置及实际游戏版本待补。

开发用 ROM 由用户自行提供，放入 [rom-resource/](rom-resource/)，文件身份见 Spec 第 3.2 节。ROM、用户附件、上游下载副本、依赖和临时检查缓存不纳入 Git；下载的上游资料按来源清单单独恢复。

汉化文本来源为 [UWorldGX/pkmn_rs_chn_rsc](https://github.com/UWorldGX/pkmn_rs_chn_rsc)，美版结构参考为 [pret/pokeruby](https://github.com/pret/pokeruby)，日英桥接语料为 [Poké Corpus](https://github.com/abcboy101/poke-corpus)。具体用途和证据边界见 Spec。
