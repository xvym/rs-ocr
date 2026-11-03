# S5 实时捕获与原始日文显示

2026-11-02。本阶段接入 Windows 窗口捕获、游戏区域校准、实时日文显示和结果失效管理。用户当前不方便打开实机链路，因此本次交付范围为代码与受控回放；NDS 投屏软件和 NGC／OBS 的实际连续输出验收保持待完成。

当前版本另包含 [战斗菜单光标修复](../cursor-fix/README.md)：将原生选择光标与文字输入分离，修复右列光标被读成未知字的重叠显示。该回归有 19 项自动检查及独立制品身份；本文的回放测量保留原测量版本和口径。

当前版本另包含 [战斗菜单光标修复](../cursor-fix/README.md)：将原生选择光标与文字输入分离，修复右列光标被读成未知字的重叠显示。该回归有 19 项自动检查及独立制品身份；本文的回放测量保留原测量版本和口径。

## 使用

1. 关闭旧版窗口，双击根目录 [start-desktop.cmd](../../start-desktop.cmd)。启动器仍自动选择 Java 21。
2. 点击“刷新窗口”，选择 NDS 投屏或 OBS 窗口；“图像配置”可选择“NDS 采集”或“NGC／OBS 采集”，再点击“开始实时”。
3. 已知截图几何可自动校准。未定位时，点击“校准游戏区域”，拖动框选完整游戏画面，排除软件工具栏和 OBS 外层画布；必要时微调“左／上／宽／高”，点击“使用此区域”。
4. 可关闭原图对照或打开诊断；“保存测量”将当前会话数据保存为本地 JSON。

“停止”清除当前结果；重新开始、切换来源或配置会创建新会话。窗口最小化时暂停并清除结果，恢复后重新确认映射。尺寸、DPI 或捕获池变化使旧映射失效；自动校准无法确认时需要重新框选。目标关闭或捕获失败后清除结果，刷新并重新开始即可选择其他来源。打开截图会结束实时会话，保留 S4 的离线入口。

## 实现与证据

- 使用 Windows.Graphics.Capture／D3D11，捕获选定窗口；没有桌面截图回退。API 的最低系统条件为 Windows 10 1903／build 18362，见 [微软说明](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)。本机验证环境为 Windows build 26200、x64、DPI 144；这不代表发行包已在全部最低版本通过测试。
- 原生捕获复用只读参考 g1 `v0.0.3`，只替换 JNI 命名空间；Java 侧改为延迟加载内置 DLL、校验缓存，在像素处理之前记录 Java 时钟对齐点，并直接包装不可变 ARGB 数组，避免第二次全窗口复制。组件和工具链依据见 [native-capture.json](native-capture.json)。
- 自动校准只尝试已有依据的客户区几何，并用当前图像中的固定特征确认。客户区本身不自动等同于游戏画面。手动框选支持 NGC 这类非 3:2 的实际输入视口，再还原为 240×160。
- 捕获与 OCR 各有一个工作线程，最多一个 OCR 任务在途。计划轮询间隔为处理结束后再等 16ms，实际间隔包含处理时间。
- 框体定位在读取可变文字之前执行，允许显示空框或“识别中”。定位与冻结引擎在全部 456 张图片、579 个区域上逐项一致，见 [layout-compatibility.json](layout-compatibility.json)。
- 文字区域各自保存像素指纹和内容代次；区域外的动画不重置文字稳定计时。文字变化即清除该区旧内容，窗口／会话／映射／区域代次不符的结果不会发布。
- 按用户最新要求，当前实时模式等待所有可见文字区连续 **150ms** 不变后再提交整帧 OCR。没有新捕获帧时，轮询仍会检查等待时间，不会卡在最后一帧。稳定文字只识别一次；字模匹配算法保留，触发方式改为稳定后读取整页。
- 已确认的原生选择箭头与红色等待箭头从文字变化判断中排除。结果区的选择位置连续 60ms 后更新，短暂消失保持最多 500ms；原框消失、内容变化、映射或会话切换时清除历史选择。结果内容相同则跳过画布重绘，尺寸不变时不重置画布。原图区继续显示实际动画。
- 150ms 是当前开发参数，像素稳定不证明句子或名字完整。较长打印停顿仍可能触发一次识别；中文与语义处理仍在 S6／S7。新增稳定等待计入延迟，不能继续引用下表旧版耗时作为当前版本性能。

调整前的 16 项自动检查覆盖原有窗口行为、全量定位兼容、文字清空、框体消失、背景变化、迟到结果、会话与映射失效、DPI 条件、原生像素通道／行序及延迟统计。原构建和冻结引擎比对见 [artifact-checks.json](artifact-checks.json)；当前版本的 24 项检查与打包核对见 [stability/artifact-checks.json](stability/artifact-checks.json)：S3 的 471 个冻结文件及识别 JAR 保持一致，桌面包内的 14 个识别类／资源逐字节一致；普通运行包不含 ROM、测试图片或答案。

## 回放方法

[LivePlaybackCheck](../../desktop/src/test/java/io/github/rsocr/desktop/LivePlaybackCheck.java)在独立测试窗口中展示已有实机截图，经真正的 WGC 捕获、校准、实时状态管理、OCR 和 JavaFX 结果画布。运行链路不接收图片编号或预期答案；独立验证端对照 S3 归档原始预测，检查显示与已验收引擎一致。

比较使用归档预测中的实际检测框，目录标注 ROI 只用于范围归属。部分招式页的实际框高为 72，而目录标注 ROI 高为 88；没有要求两者相等或修改原始标注。

每张截图至少展示 300ms，不等 OCR 完成才切换；未及时完整显示的图片编号会保留。测试窗口标题额外每 16ms 请求刷新，产生持续捕获帧负载；这属于构造负载，不是实机连续游戏。逐字打印、滚动、自动推进、设备滤镜、混帧及实际投屏软件在遮挡后的输出行为尚未验收。

图像对照检查 38,398／38,400 个归一化像素完全一致。仅受控窗口底部两个角像素受系统圆角混合影响，已通过保存的原图／捕获图定位；只在回放图像对照中排除这两个角点，不修改运行时图片、文字答案或 S3 同形字规则，全部文字仍逐项比较。

受控场景包括两组配置下的完全遮挡后获取不同内容、最小化／恢复、大小改变与恢复、手动校准、拒绝旧校准、停止；另有不同 HWND 之间切换、空对白、残缺字形、框体消失／恢复和关闭来源。空框与残缺字形由原素材明确构造，未冒充真实游戏录像。实际结果和所有遗漏编号保存在 [playback-checks.json](playback-checks.json)。

## 稳定触发版本的验证

24 项自动检查覆盖逐字变化后重新计时、150ms 边界、稳定页面只识别一次、背景及箭头闪烁不重置计时、光标防抖、真实移动与无新帧时收敛，并保留空框、翻页、迟到结果及会话失效检查。绘制检查确认光标短暂消失前后结果区像素完全一致，真实选择移动后像素更新，见 [render-checks.json](stability/render-checks.json)。

新版本受控回放输出单独保存于 [stability/playback-checks.json](stability/playback-checks.json)，每张素材暴露 750ms；这是回放覆盖条件，不是延迟达标线。先前每组一张的 500ms 短检查中，NGC 首次切换没有在门槛内显示，随后原文正确；该失败与全部 23 个通过的状态场景保留在 [stability-desktop-check/playback-checks.json](stability-desktop-check/playback-checks.json)。受限环境无法创建窗口捕获会话的检查另保存在 `stability-diagnostic/`，不计为实机或识别失败。旧版 300ms 回放作为历史证据保留。实际设备连续游戏及物理屏幕频闪仍需实机验证。

完整回放全部 456 张画面正确显示、23 个受控状态场景通过。新增 150ms 稳定等待后的耗时如下；起点仍是原生接收首帧，未把等待从统计中扣除。该版本优先实现用户要求的稳定触发，当前受控回放 **未达到全部样本 200ms 以内**，也不作为中文链路性能验收。

| 配置 | 图片／完整显示 | 日文样本 | P50 | P95 | 最大 | 超过 200ms |
| --- | --- | --- | --- | --- | --- | --- |
| NDS／GBA 截图回放 | 315／315 | 363 | 188.40ms | 206.22ms | 270.43ms | 47 |
| NGC 截图回放 | 141／141 | 193 | 205.70ms | 224.87ms | 345.74ms | 136 |

## 稳定等待调整前的回放结果（历史记录）

全部 456 张原图在回放门槛内完整显示，与归档原始预测一致；23 个受控状态场景通过，没有发现当前图像混入其他状态的日文。统计按区域内容代次去重，稳定未变的文字不重复计延迟样本。

| 配置 | 图片／完整显示 | 日文延迟样本 | P50 | P95 | 最大 | 超过 200ms |
| --- | --- | --- | --- | --- | --- | --- |
| NDS／GBA 截图回放 | 315／315 | 363 | 29.73ms | 40.20ms | 146.78ms | 0 |
| NGC 截图回放 | 141／141 | 193 | 38.25ms | 51.55ms | 190.92ms | 0 |

本次两组均无未显示的区域内容代次。持续捕获负载下，分别处理 3,664／1,583 个新原生帧；分别 107／104 个原生帧在 Java 采样前被更新帧取代，未把这些跳号当作新文字状态或从已知图片覆盖分母删除。每个画面的原文、区域、代次和分段耗时见 [完整记录](playback-checks.json)。

实际两条设备链路、真实逐字／滚动／自动推进和跨显示器 DPI 改变仍未验证。本次低于 200ms 的日文开发结果不构成中文链路最终达标声明。

## 延迟口径

起点为当前区域状态首个被处理帧的原生接收时刻；用同一原生 QPC 的接收／采样差值对齐 Java 时钟，计入像素复制、归一化、定位、排队、OCR 和 UI 更新。终点是 JavaFX 画布更新后的 post-layout pulse，属于绘制提交观察点，不是屏幕物理发光时间，更不是完整中文链路终点。

仅非空且已识别的日文结果计入文字延迟。未知字形、空结果、未显示的内容代次、未计算完就被替换的内容和 Java 未采样到的原生帧分别记录。重复读取旧帧不算新捕获帧。原生帧跳号不能证明设备或帧池没有丢帧；回放覆盖另按全部输入状态核对。P50／P95 使用 nearest-rank，超过 200ms 的样本保留。

每个事件另记录“接收到提交任务”“OCR 到接受结果”“接受到 UI pulse”三个耗时，以便定位延迟。开发测量不代替 Spec 的最终 200ms 中文验收，也不代表实机 60FPS 条件已达标。

[优化前记录](playback-before-pixel-copy-optimization.json)保留一次 NGC 首帧 229.4813ms，其中接收到任务提交 135.1634ms、OCR 到接受结果 90.1066ms、到 UI pulse 4.2113ms。该记录还包含比较器混用目录 ROI 导致的招式页误报；原文相同，未按文字错误处理。随后减少全窗口像素复制，并以相同 300ms 门槛复测，不删除这次超时。

## 构建和复现

桌面包内置 x64 捕获 DLL，普通启动不需要安装编译工具。本机开发构建复用已有工具链，临时设置仅限构建进程，g1 工作区未修改：

```powershell
./build-desktop.ps1 -JavaHome 'D:/Code/Workspace/g1-ocr/.tools/jdk21.0.9_10' -MavenRepository 'D:/Code/Workspace/g1-ocr/.tools/m2' -Offline
```

构建会调用 [build-capture.ps1](../../build-capture.ps1)。原生 SDK 的固定包来源和哈希见 `native-capture.json`；`build-capture.ps1 -ToolsRoot` 可指定相同工具链布局。根目录 S3 识别 JAR 不在本阶段重建。

```powershell
& 'D:/Code/Workspace/g1-ocr/.tools/jdk21.0.9_10/bin/java.exe' '-Djavafx.cachedir=.tools/javafx-cache' -cp 'desktop/target/test-classes;desktop/target/rs-ocr-desktop-0.1.0.jar' io.github.rsocr.desktop.LivePlaybackCheck $PWD
python tools/check_desktop_artifact.py --output reports/s5-live/artifact-checks.json
python tools/check_live_artifact.py
```

回放会临时创建并关闭测试自有窗口；结束后清理自有进程，交接文件留在忽略目录 `.tools/`。可在回放命令最后加数字限制每组图片数用于排查，不能将这种短检查记为全部 456 张通过。

稳定触发版本将完整结果写入独立目录；运行 Windows 窗口捕获检查需要正常桌面环境，受限环境可能无法创建捕获会话。绘制检查可以独立运行：

```powershell
& 'D:/Code/Workspace/g1-ocr/.tools/jdk21.0.9_10/bin/java.exe' '-Djavafx.cachedir=.tools/javafx-cache' -cp 'desktop/target/test-classes;desktop/target/rs-ocr-desktop-0.1.0.jar' io.github.rsocr.desktop.LivePlaybackCheck $PWD 2147483647 reports/s5-live/stability
& 'D:/Code/Workspace/g1-ocr/.tools/jdk21.0.9_10/bin/java.exe' '-Djavafx.cachedir=.tools/javafx-cache' -cp 'desktop/target/test-classes;desktop/target/rs-ocr-desktop-0.1.0.jar' io.github.rsocr.desktop.StabilityRenderCheck
```
