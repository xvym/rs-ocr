# rs-ocr

面向日版《宝可梦 红宝石／蓝宝石》的 Windows 离线 OCR 翻译项目。

项目处于需求与资料调查阶段，尚未交付 OCR 应用或完成产品验收。

- [Spec](spec.md)：目标、输入、行为、语料和验收要求。
- [ExecPlan](execplan.md)：调查、实现、验证及交付步骤。
- [文本框调查目录](reports/textbox-catalog/index.html)：下载仓库后可离线浏览，原图位于 `gba_testcase/` 和 `ngc_testcase/`。
- [日版 ROM 文本框识别特征](reports/textbox-features/index.html)：51 个保留区域键的位置、面板轮廓、原生颜色、变体及固定像素掩码；与旧人工近似坐标目录分开保存。
- [文本地址来源清单](outputs/pokeruby-text-audit/manifest.json)：RSC 中文与 pokeruby 美版资料的固定版本及哈希。

开发用 ROM 由用户自行提供，放入 [rom-resource/](rom-resource/)，文件身份见 Spec 第 3.2 节。ROM、用户附件、上游下载副本、依赖和临时检查缓存不纳入 Git；下载的上游资料按来源清单单独恢复。

汉化文本来源为 [UWorldGX/pkmn_rs_chn_rsc](https://github.com/UWorldGX/pkmn_rs_chn_rsc)，美版结构参考为 [pret/pokeruby](https://github.com/pret/pokeruby)，日英桥接语料为 [Poké Corpus](https://github.com/abcboy101/poke-corpus)。具体用途和证据边界见 Spec。
