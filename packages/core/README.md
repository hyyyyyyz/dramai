# @dramai/core

dramai 的业务内核：域模型、服务商适配器、任务系统、准入检查、产物时效、提示词与模型画像、ffmpeg 封装。
**不含** React、DOM API、HTTP 框架、SQLite——这些由 `@dramai/server` 通过 `src/ports` 里的接口接入。

## 怎么被使用

- 源码用 `.ts` 扩展名互相 import（`erasableSyntaxOnly`，没有 enum / 参数属性），可以直接被 Node ≥ 22.18 / vitest 执行。
- `pnpm build` 用 `tsc` 编译到 `dist/`（`rewriteRelativeImportExtensions` 把 `.ts` 改写成 `.js`），运行时入口是 `dist/index.js`。
- `package.json` 的 `exports` 对类型指向 `src/`（不用先 build 就能 typecheck 下游包），对运行时指向 `dist/`。
- `@dramai/core/testing` 是各端口的内存实现，给测试用。
- 随包数据在 `data/`（提示词 `*.prompt`、模型画像 `models/*.json`、风格预设 `styles.json`），运行时通过 `loadCatalog({ extraDirs })` 加载，额外目录按 id 覆盖内置。

## 目录

| 目录          | 内容                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `domain/`     | 项目 → 集 → 场 → 镜头、资产、版本历史；时间线与发声归属只有类型                                                        |
| `ports/`      | 仓库、文件存储、密钥、事件、时钟、id 生成的接口                                                                        |
| `generation/` | `resolveInputs`：准入 / 执行器 / 预览 / 时效共用的唯一输入计算                                                         |
| `admission/`  | 花钱前的闸：逐目标原因码、整批通过或整批不跑                                                                           |
| `artifacts/`  | 产物清单与时效（只存依据摘要，状态读时派生）                                                                           |
| `jobs/`       | Job、车道、取消/重试/恢复原任务、重启恢复、worker 循环                                                                 |
| `providers/`  | 协议纯函数、统一执行器、模型能力与价目、预设、测试连接                                                                 |
| `prompts/`    | 模板库、风格预设、资产提及、PromptSpec 编译器、分镜提示词与容错解析                                                    |
| `media/`      | 原生 ffmpeg：定位与能力探测、规整/拼接/混旁白/字幕、输出尺寸规则、参考图压缩                                           |
| `pipeline/`   | 2B 流水线：素材入库 → 分集 → 分场分镜 → 实体 → 镜头提示词 → 设定图 / 分镜图 / 视频 / 旁白 → 合成；任务处理器与整集预检 |
| `timeline/`   | 时间线文档（追加式修订）、摆放（纯函数）、读取时的问题检查                                                             |
| `export/`     | 字幕导出、素材包（zip）、v0.4 备份导入                                                                                 |
| `parsers/`    | txt / md / docx / 图片尺寸                                                                                             |
| `subtitles/`  | SRT / VTT                                                                                                              |

## 测试

`pnpm test`。`media.test.ts` 用真实 ffmpeg 和 `lavfi` 测试源；找不到 ffmpeg 时整组跳过并打印原因。
所有服务商测试用假 `fetch`，不会发出真实请求。
