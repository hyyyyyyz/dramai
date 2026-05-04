# Providers

`dramai` 默认通过 OpenAI 兼容协议调用 LLM / 文生图 / 图生视频。本文整理常见
服务商的接入示例与坑点。

> 所有示例仅作技术配置参考。具体定价、可用模型、Quota 与服务商政策以官网为准。
> dramai 与各服务商**没有商业合作关系**。

## OpenAI 官方

- LLM Base URL: `https://api.openai.com/v1`
- 推荐模型：`gpt-4o-mini`、`gpt-4.1`、`gpt-4o`
- 文生图：`gpt-image-1` / `dall-e-3`
- CORS：默认**不**允许浏览器直连。请使用聚合服务或自建 BFF。

## Anthropic Claude

- 走 Claude 官方 API：`https://api.anthropic.com/v1`（需要 `x-api-key`，**非** OpenAI 兼容）
- 推荐通过聚合平台用 OpenAI 兼容协议接入。

## 聚合平台（推荐用于纯前端）

| 平台          | LLM Base URL                               |  CORS  | 备注                                                   |
| ------------- | ------------------------------------------ | :----: | ------------------------------------------------------ |
| OpenRouter    | `https://openrouter.ai/api/v1`             |   ✅   | 一个 key 调几乎所有主流模型；图片/视频生成需看具体模型 |
| 302.AI        | `https://api.302.ai/v1`                    |   ✅   | LLM + 文生图 + 图生视频 + nano banana 等齐全           |
| 词元 (CIYUAN) | `https://ciyuan.today/v1`                  |   ✅   | 国内可访问，含 GPT Image 2 / nano banana               |
| 火山引擎      | `https://ark.cn-beijing.volces.com/api/v3` | 需配置 | 豆包 / 即梦                                            |
| 智谱          | `https://open.bigmodel.cn/api/paas/v4`     | 需配置 | GLM-4.7 / CogView                                      |

> 上表的"CORS"列指**该 API 是否允许浏览器直接发请求**。打 ✅ 的可在 dramai 里
> 直接配置使用；标"需配置"的需要服务商在你账号下额外开启 CORS 来源（部分是默认允许）。

## 文生图 Provider

| 协议                                       | 备注                         |
| ------------------------------------------ | ---------------------------- |
| OpenAI Images API（`/images/generations`） | 通用                         |
| Stable Diffusion WebUI 兼容（自部署）      | 私有部署，不适合公开 demo    |
| 火山豆包 / 即梦                            | 通过 OpenAI 兼容代理或自封装 |
| Midjourney                                 | 无官方 API，需第三方代理     |

## 图生视频 Provider

| 平台                   | 协议                                                          |
| ---------------------- | ------------------------------------------------------------- |
| Runway Gen-3           | REST + 轮询                                                   |
| 可灵 (Kling)           | REST + 轮询                                                   |
| Sora 类（Tuzi 等代理） | OpenAI Compatible / REST                                      |
| 火山豆包 Image2Video   | REST，参考 ai_story_ref 的 `volcengine_image2video_client.py` |

具体客户端实现会在 v0.3 落地，详见 `src/core/video/`。

## 配置快照（Settings → Providers，v0.1 起）

```jsonc
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "kind": "llm",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-...",
      "model": "anthropic/claude-3.5-sonnet",
    },
    {
      "id": "302-image",
      "label": "302.AI 文生图",
      "kind": "text2image",
      "baseUrl": "https://api.302.ai/v1",
      "apiKey": "302-...",
      "model": "gpt-image-1",
    },
  ],
  "active": {
    "llm": "openrouter",
    "text2image": "302-image",
  },
}
```

## 报告新服务商

发现一个能在浏览器里直连的好服务？欢迎 PR 把它加到这份表格里：
[github.com/hyyyyyyz/dramai/blob/main/docs/PROVIDERS.md](https://github.com/hyyyyyyz/dramai/blob/main/docs/PROVIDERS.md)
