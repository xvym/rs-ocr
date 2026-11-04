# 已确认原汉化对应的正式索引

当前索引已纳入 `outputs/corpus-mapping/correspondences.json`，并随 S6 包交接。它是来源对应索引，不能直接充当可显示译文。

| 内容 | 数量 |
| --- | ---: |
| 有已审来源关联的唯一日文 qid（含片段） | 222 |
| 上述 qid 的逐作关联（含片段） | 441 |
| 逐作、逐原汉化条目的记录／原中文范围关联 | 483 |
| 另列的日中源片段关联 | 18 |
| 两作图鉴第二页到日文整段的结构关联 | 772 |
| 总关联 | **1,273** |

多个原条目可能对应同一日文，词典也可能被两作共同使用，所以这些数不能互换。原 115 条反查队列现确认 35 条记录对应和 18 条源片段对应；两作各余 31 条同源日文为空的记录，另各 9 条仅有片段。唯一原汉化一经可靠定位，不以日中语义等价、翻译质量或本地化差异另设回退。窗口及变量绑定另行核对，见 [反查报告](../rsc-reverse-mapping/README.md)。

## 查询

```powershell
# 按日文精确查询
node tools/query_corpus.mjs --japanese セーブできませんでした --game ruby

# 按 qid 查询
node tools/query_corpus.mjs --qid rs.common.strings2.gSystemText_LoadingError.4 --game ruby

# 从红宝石原汉化第5051条反查日文
node tools/query_corpus.mjs --source-id upstream-5 --source-line 5051

# 查已有原汉化但尚无日文索引的占位介绍
node tools/query_corpus.mjs --source-id upstream-5 --source-line 5049
```

`upstream-5`／`upstream-6` 分别是两作正式总文本，`source-line` 在总文本中表示解析后的原记录序号；对词典则表示实际文件行号，不是统一的文本行数。索引同时支持 `byQidGame`、`byJapanese` 和 `bySource`，只按完整值查找，不猜前缀或模糊匹配。

返回的 `correspondences` 保留原汉化条目、中文引用范围、原文件与内容哈希、日英原文及游戏版本。原条目存在但没有日文关联时返回 `source_without_indexed_japanese`；游戏与原文件不符时返回 `source_game_mismatch`，不会跨版本套用。

四种关联分别为：

- `reviewed_correspondence`：原译文记录的对应已核对，打印、变量与发布范围仍需处理。
- `reviewed_original_span`：引用原中文记录中的既有范围，例如 A 键提示不会带入同条原文前面的保存完成消息。
- `reviewed_source_fragment`：同时保存日文、原中文范围及日文片段哈希，只确认这些片段。例如公斤单位不包括未知重量，拒学招式分支不包括忘记／学会分支。查询状态为 `indexed_fragment_pending_window_review`，不计作整条来源覆盖。
- `pokedex_parent`：只定位所属日文整段，具体日文跨度为空，尚未核对图鉴中文第二页的发布范围。

全部关联均为 `publicationApproved:false`。当前查询的 `translation` 仍只来自原有静态发布规则，原条目反查一律不自动发布译文。S6 的 2,506 条词条和 319 条静态记录未因本次建索引而增加；模型生成、改写中文仍为 0。

## 构建与来源

`corpus/correspondence-selections.json` 保存确认关联的 qid、适用游戏、原来源位置、引用范围及日英中哈希，**不保存新写的中文**。原有 `originReview` 保留此前语义审计快照；新增关联分别指向 [反查选择](../../corpus/rsc-reverse-reviews.json)，该文件固定保存原 115 条待核记录的选择、范围、哈希及保留原因。导入器合并两批已审选择，建库校验反查快照与导入结果一致，不自动批准待核记录。每次直接从固定六份 RSC 文件重取中文并验证哈希。

图鉴结构关联从固定记录及同物种、同版本的 `_1`／`_2` 关系重建。`Dummy_2` 不建立父记录关联；`[NULL]` 不生成日文，不机械分摊日文，也不拼接中文。

```powershell
node tools/build_corpus.mjs
node tools/build_s6_corpus.mjs
node tools/test_rsc_correspondences.mjs
node tools/audit_rsc_reverse_mapping.mjs
```

只有在新的来源对应核对完成后，才用 `node tools/import_rsc_correspondences.mjs` 更新选择快照。它同时读取原语义审计和反查选择，保留各自来源身份，不批准运行时翻译。

原 `candidates.csv`、`source-links.csv` 和 `gaps.csv` 继续描述原地址/英文桥接。`correspondence-gaps.csv` 排除已有整条／原中文范围关联的记录；仅有日文源片段不会消除整条缺口。目前两作各为 1,557 条有效日文记录，包含首版外和调试资料，不能当作确定缺译数。交接包 `source-inventory.csv` 将 `reviewedSourceFragment` 与 `reviewedCorrespondence` 分列。

索引清单与原包制品共同保存输入/实现/输出哈希。S6 包内携带相同索引，`loadS6Probe(...).correspondenceIndex` 可在没有 ROM、下载缓存或旧答案的情况下用于来源查询。当前 [13 项检查](checks.json)验证原文引用、双向查询、版本隔离、过期输入拒绝、片段／互斥分支边界、保留队列、整条覆盖、重建和隔离交接。另有原建库、S6、日文来源和战斗来源回归；S6 整体和 S7 中文集成仍未完成。
