# rs-ocr

面向日版《宝可梦 红宝石／蓝宝石》的 Windows 离线 OCR 翻译项目。

项目已建立 Java 21 离线日文 OCR 开发入口，可批量读取现有 GBA／NGC 两组截图，输出原始日文和逐字符诊断；尚未达到固定集 100% 门槛，未完成产品验收。

- [Spec](spec.md)：目标、输入、行为、语料和验收要求。
- [ExecPlan](execplan.md)：调查、实现、验证及交付步骤。
- [离线识别开发报告与运行方式](reports/ocr-development/README.md)：构建、图片识别、资源来源及未完成项。[逐项比对](reports/ocr-development/review.html)保留完整 574 项分母；当前严格相同 567 项，按同形字提案相同 569 项，11 个遮挡排除区域无误输出。候选转录未冻结，结果不计为 S3 验收通过。
- [文本框调查目录](reports/textbox-catalog/index.html)：下载仓库后可离线浏览，原图位于 `gba_testcase/` 和 `ngc_testcase/`。
- [日版 ROM 文本框识别特征](reports/textbox-features/index.html)：51 个保留区域键的位置、面板轮廓、原生颜色、变体及固定像素掩码；与旧人工近似坐标目录分开保存。
- [testcase 日文转录审阅](outputs/ocr-ground-truth-20261102/review.html)：585 个区域存档中，11 个文字被挡或不可见区域排除，当前识别目标为 574 个；框体被盖但文字完整的区域保留识别。[文字可见性复核](outputs/ocr-ground-truth-20261102/occlusion_review.json)、[排除清单](outputs/ocr-ground-truth-20261102/excluded_regions.json)、[JSON 主数据](outputs/ocr-ground-truth-20261102/ground_truth.json)及[比对说明](outputs/ocr-ground-truth-20261102/README.txt)供程序测试使用，待人工复核冻结，不计为 OCR 验收通过。
- [文本地址来源清单](outputs/pokeruby-text-audit/manifest.json)：RSC 中文与 pokeruby 美版资料的固定版本及哈希。

开发用 ROM 由用户自行提供，放入 [rom-resource/](rom-resource/)，文件身份见 Spec 第 3.2 节。ROM、用户附件、上游下载副本、依赖和临时检查缓存不纳入 Git；下载的上游资料按来源清单单独恢复。

汉化文本来源为 [UWorldGX/pkmn_rs_chn_rsc](https://github.com/UWorldGX/pkmn_rs_chn_rsc)，美版结构参考为 [pret/pokeruby](https://github.com/pret/pokeruby)，日英桥接语料为 [Poké Corpus](https://github.com/abcboy101/poke-corpus)。具体用途和证据边界见 Spec。
