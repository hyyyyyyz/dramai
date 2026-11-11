# @dramai/mock-providers

本地**模拟服务商**，给前端开发、整条流程的手动验证和演示用。本地服务通过正常的服务商配置去调它，中间没有任何特殊分支；
它只监听回环地址（`127.0.0.1`，Host 头也只认回环名字）。**这是开发 / 演示工具：正式的启动路径不依赖它**（依赖方向是 `mock-providers → server`，不是反过来）。

## 一条命令跑起来

```bash
pnpm demo            # 本地服务 http://127.0.0.1:8787 + 模拟服务商 http://127.0.0.1:8788
pnpm demo --fresh    # 先清空演示数据目录（~/.dramai-demo，与正式数据完全分开）
pnpm demo --help
```

启动时终端会明确打印：这是演示模式、不会产生任何费用、生成的是占位内容。服务商配置（大模型 / 两种文生图 / 两种图生视频 / 配音）
会自动建好并指向模拟服务商，走的是普通的 `providers.create` 接口；再次启动会把 baseUrl 对齐到当前的模拟服务商端口。

**界面怎么知道是演示**：`GET /api/system` 返回 `demo: { active: true, notice: '演示模式：…' }`，前端据此显示持续可见的提示。正式启动 `active` 恒为 `false`。

| 选项                                                                       | 作用                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `--latency <ms>` `--jitter <ms>`                                           | 每个请求的固定延迟 / 再随机加的延迟                                           |
| `--video-ms <ms>`                                                          | 视频任务从提交到完成要多久（默认 3000；期间轮询依次看到排队 → 进行中 → 完成） |
| `--fail-rate <0..1>` `--fail-kinds a,b` `--fail-on image,video` `--seed n` | 随机失败；同样的种子 + 同样的操作顺序 = 同样的失败                            |
| `--port` `--mock-port` `--data-dir` `--static-dir` `--verbose`             | 端口、数据目录、托管前端构建产物、打印每个模拟请求                            |

## 它模拟什么

| 服务     | 协议（对应现有预设）                                  | 返回                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 大模型   | OpenAI chat completions，**流式**                     | 对流水线的 6 个文本步骤（分集规划 / 分镜拆解 / 实体抽取 / 合并 / 变体分析 / 镜头提示词）返回结构合法、**和输入对得上**的 JSON：本地规则识别人名、地点、道具、服装、对白和说话人；换一篇中文短篇也能跑出像样的分集和分镜。把握度有高有低，界面上能看到三档 |
| 图片     | Gemini `generateContent`、OpenAI `images/generations` | 占位 PNG：按请求的画幅 / 尺寸；按提示词取色，印着 SHEET / SHOT、提示词编号、请求序号、尺寸（同一个提示词再生成一次，序号和颜色会变，看得出换了一张）                                                                                                      |
| 图生视频 | 阿里万相、火山 Seedance（异步任务 + 轮询）            | 以起始帧做缓慢推近的 mp4，时长按请求，画幅跟着起始帧；`generate_audio` 时带一条音轨。**需要 ffmpeg**                                                                                                                                                      |
| 配音     | OpenAI `audio/speech`                                 | 占位 WAV：时长和文字长度成正比（标点停顿、语速生效）                                                                                                                                                                                                      |
| 模型列表 | `GET /models`、`/v1/models`、`/v1beta/models`         | 让“测试连接”走通                                                                                                                                                                                                                                          |

大模型的规则不是语言理解：它认的是常见的中文人名（姓氏 + 动作 / 对白）、地点后缀（茶馆、码头……）、量词 + 物件。认不出的就是认不出。

## 演练界面状态：故障注入

三种来源，优先级从高到低：

1. **请求自己指定**：提示词里写 `[[mock:rate_limit]]`（任何文本、镜头描述、提示词里都行），或请求头 `X-Mock-Fault`。
2. **规则**（`POST /__mock/rules`，`DELETE /__mock/rules` 清空）：`{ "fault": "upstream_failed", "on": "video", "nth": 2 }`，可用 `on` / `promptIncludes` / `nth` / `every` / `times`。
3. **随机**：`--fail-rate` 等。

运行中随时可改：`GET/PUT http://127.0.0.1:8788/__mock/config`、`GET /__mock/state`、`GET /__mock/requests`、`POST /__mock/heal`（清掉已有视频任务身上的故障，演练“上游恢复后续上原任务”）、`POST /__mock/reset`。

| 故障              | 上游表现                                         | 任务落到                                                        |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `rate_limit`      | HTTP 429 + Retry-After                           | `generation_failed` `HTTP_429`（明确拒绝，没有费用）            |
| `reject`          | HTTP 400                                         | `generation_failed` `HTTP_400`                                  |
| `server_error`    | HTTP 500                                         | `submission_unknown` `HTTP_500`（不得自动重投）                 |
| `drop_connection` | 连接被掐断                                       | `submission_unknown`                                            |
| `bad_output`      | 200 但读不懂（文本：一段不是 JSON 的话）         | `submission_unknown` `UNREADABLE_RESPONSE`（文本：步骤失败）    |
| `upstream_failed` | 视频任务状态 FAILED（图片 / 配音：HTTP 422）     | `generation_failed` `UPSTREAM_FAILED`（图片 / 配音 `HTTP_422`） |
| `poll_error`      | 视频轮询一直 502                                 | `delivery_failed` `POLL_FAILED`（可续上原任务）                 |
| `download_error`  | 视频完成但成品地址 404                           | `delivery_failed` `HTTP_404`（可续上原任务）                    |
| `slow_queue`      | 视频任务长时间排队（`slowQueueMs`，默认 2 分钟） | 一直是“进行中”（带上游任务号），之后正常完成                    |

## 在测试里用

```ts
const mock = await startMockProviders({ config: { videoMs: 150 } })
// 用 mock.url 作为服务商配置的 baseUrl；mock.addRule({ fault: 'poll_error', on: 'video', times: 1 })
await mock.close()
```

测试在 `test/`：协议级（含用真实提示词核对步骤识别）、一篇中文短篇从上传原文到成片的端到端、每种故障落到的失败分类。
