# RSC 原译文来源检查

当前检查命令：`node tools/evaluate_s6_corpus.mjs --origin-gate`。

检查构建输入与制品哈希、原候选来源和资源政策，并在冻结日文 OCR 输入上报告保守的静态可用性。它不读取旧模型中文答案；当前使用来源匹配模块的基础分段进行静态探测，未执行全部来源消歧，不能与完整来源诊断或旧模型门槛的 770 个单元直接比较。结果见 [summary.json](summary.json)。

`originGatePassed` 只表示来源检查通过，不表示中文语义准确率、完整首版覆盖、S6 完成或实际应用通过。未建立对应的单元保留日文；未知对应不计作已证实的上游缺译。

旧模型中文答案、输出复核和 770/770 报告已移入 [历史档案](../../archive/model-translations/README.md)，不再作为当前通过证据。`--gate` 会明确拒绝使用已撤回门槛。新的原文对应、窗口和变量验收须从原 RSC 译文建立可追溯预期，再独立核对日文、可见窗口和变量。

新的 [原 RSC 可见窗口基线](../s6-visible-windows/README.md)已独立保存原来源范围和冻结预期，检查命令为 `node tools/evaluate_visible_windows.mjs --gate`，兼容入口为 `node tools/accept_chinese_corpus.mjs --visible-window-gate`。首版 783 个固定单元中 772 个按原译文/格式输出、11 个保留原文（其中 4 个 EXP 标签按设计保留），范围外 350 个继续登记。它与本报告 1,124 个基础静态探测单元的分段和范围不同，不直接比较比例；同一模型非盲核对，完整首版与最终应用 A6 仍未通过。
