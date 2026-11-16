# Providers

A provider is a service dramai sends requests to: a language model, an image model, a video model or a speech model. You add one in **Settings → Providers → Add provider**. This page describes the form, the interface types it offers, how authentication works and what the address and header rules are. Each statement here comes from the code under `packages/`; the file is named where it matters.

## Adding a provider

Open **Settings → Providers**, choose **Add provider** in the kind you want (language model, image, video or speech) and fill in one form:

| Field                 | What it means                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface type        | Which API the service speaks. The list depends on the kind; see [Interface types](#interface-types).                                                                                  |
| Interface address     | The base address of that API, for example `https://your-provider.example/v1`. dramai appends the request path to it. The rules are under [Interface addresses](#interface-addresses). |
| Authentication        | An API key, an account sign-in, or none. See [Authentication](#authentication).                                                                                                       |
| API key               | Write-only: once saved it is never shown again or sent back to the browser, only replaced.                                                                                            |
| Model                 | For a language model, use "fetch the model list" and choose one; for other kinds, or when the service has no list, type the model name. See [Models](#models).                        |
| Test connection / Add | Test checks the connection with the address and key you entered; Add saves the provider.                                                                                              |

After adding, choose the provider as the one in use for its kind ("Use this"). A project uses the provider chosen for each kind it generates with: language model for planning and text, image, video and speech.

## Interface types

The form's **Interface type** list offers these, in this order. The name is what the interface shows; the id is what is stored in the provider's configuration. The order and ids are `PROTOCOLS_BY_KIND` in `packages/workspace/src/features/settings/protocols.ts`, the names are the `protocol` entries of the English dictionary in `packages/workspace/src/i18n/locales/en/`, and the requests are built by the files in `packages/core/src/providers/protocols/`.

### Language models

| Name                          | Id                   | Interface                                                            | Authentication header                                                        | Model list |
| ----------------------------- | -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| OpenAI-compatible             | `openai-chat`        | Chat Completions: `POST {address}/chat/completions`, streamed        | `Authorization: Bearer`                                                      | Yes        |
| OpenAI Responses (text)       | `openai-responses`   | Responses API: `POST {address}/responses`, streamed                  | `Authorization: Bearer`                                                      | Yes        |
| Anthropic Messages (text)     | `anthropic-messages` | Messages API: `POST {address}/v1/messages`, streamed                 | `x-api-key` and `Authorization: Bearer` (same key), plus `anthropic-version` | Yes        |
| Gemini generateContent (text) | `gemini-chat`        | `POST {address}/v1beta/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key`                                                             | Yes        |

### Images

| Name                        | Id                   | Interface                                                                                                                  | Authentication header                                                                                         | Model list |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| OpenAI-compatible (images)  | `openai-images`      | `POST {address}/images/generations`; with reference images `POST {address}/images/edits`                                   | `Authorization: Bearer`                                                                                       | No         |
| Gemini native               | `gemini-image`       | `POST {address}/v1beta/models/{model}:generateContent`                                                                     | `x-goog-api-key`; `Authorization: Bearer` is also sent unless the host is `generativelanguage.googleapis.com` | No         |
| Volcengine Seedream (image) | `volcengine-images`  | `POST {address}/images/generations`                                                                                        | `Authorization: Bearer`                                                                                       | No         |
| Alibaba Qwen-Image (image)  | `dashscope-image`    | `POST {address}/api/v1/services/aigc/multimodal-generation/generation`                                                     | `Authorization: Bearer`                                                                                       | No         |
| SiliconFlow (image)         | `siliconflow-images` | `POST {address}/images/generations`                                                                                        | `Authorization: Bearer`                                                                                       | No         |
| Kling (image)               | `kling-image`        | Asynchronous: submit to `/v1/images/generations` (or `/v1/images/omni-image` for the Omni models), poll the task, download | `Authorization: Bearer`                                                                                       | No         |

### Video

| Name                                       | Id                 | Interface                                                                                                                                            | Authentication header   | Model list |
| ------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| Alibaba DashScope                          | `aliyun-video`     | Asynchronous image-to-video under an `/aliyun` path prefix: `POST {address}/aliyun/api/v1/services/aigc/video-generation/video-synthesis`, then poll | `Authorization: Bearer` | No         |
| Volcengine Ark                             | `volcengine-video` | Asynchronous under a `/volcengine` path prefix: `POST {address}/volcengine/api/v3/contents/generations/tasks`, then poll                             | `Authorization: Bearer` | No         |
| Kling                                      | `kling-video`      | Asynchronous image-to-video: `POST {address}/v1/videos/image2video`, then poll                                                                       | `Authorization: Bearer` | No         |
| Generic video API                          | `generic-video`    | A common shape with no formal standard: `POST {address}/videos/generations`, then poll `GET {address}/videos/generations/{id}`                       | `Authorization: Bearer` | No         |
| Volcengine Ark / BytePlus Seedance (video) | `ark-video`        | Asynchronous: `POST {address}/contents/generations/tasks`, then poll; the address ends at `/api/v3`                                                  | `Authorization: Bearer` | No         |
| Kling 4.0 (video)                          | `kling-contents`   | Asynchronous, chosen by task type: `/text-to-video/{model}`, `/image-to-video/{model}` or `/omni-video/{model}`                                      | `Authorization: Bearer` | No         |
| Alibaba Model Studio Wan 3.0 (video)       | `dashscope-video`  | Asynchronous: `POST {address}/api/v1/services/aigc/video-generation/video-synthesis`, then poll `GET {address}/api/v1/tasks/{id}`                    | `Authorization: Bearer` | No         |

### Speech

| Name                       | Id                    | Interface                                                    | Authentication header   | Model list |
| -------------------------- | --------------------- | ------------------------------------------------------------ | ----------------------- | ---------- |
| OpenAI-compatible (speech) | `openai-tts`          | `POST {address}/audio/speech`                                | `Authorization: Bearer` | No         |
| MiniMax (speech)           | `minimax-t2a`         | `POST {address}/t2a_v2`, synchronous                         | `Authorization: Bearer` | No         |
| Alibaba CosyVoice (speech) | `dashscope-cosyvoice` | `POST {address}/api/v1/services/audio/tts/SpeechSynthesizer` | `Authorization: Bearer` | No         |

"Model list" says whether dramai can fetch the models from the service (`modelListRequest` in `packages/core/src/providers/model-list.ts`): `GET {address}/models` for the two OpenAI types, `GET {address}/v1/models` for Anthropic and `GET {address}/v1beta/models` for Gemini. The other types have no standard listing endpoint.

Some interface types name a company because the interface is that company's own. A service that copies one of these interfaces can be used with the same type: the address is the only thing that changes.

## Authentication

Authentication is per provider (`packages/core/src/providers/auth.ts`):

- **API key.** The key is stored once and sent in the header listed above. The default.
- **Account sign-in.** Two channels exist. Both need the sign-in to be done on the computer that runs dramai, because the authorisation comes back to a local address.
  - **ChatGPT account.** Text requests use the ChatGPT plan's usage instead of an API key. It works with the OpenAI Responses type and the address `https://api.openai.com/v1`, and it covers language models only: images, video and speech still use API keys.
  - **OpenRouter account.** You sign in and OpenRouter hands dramai an API key of your own, which is then used like a key you pasted. It works with the OpenAI-compatible type and the address `https://openrouter.ai/api/v1`.

  For both channels the interface type and address are fixed by the channel (`LOGIN_CHANNEL_ENDPOINTS`): the sign-in token is only ever sent to that address, whatever else a configuration says.

- **None.** No key is stored and no `Authorization` header is sent. For services on your own machine or network that do not ask for one.

### Where keys are kept

- **WebUI:** in `secrets.json` in the data directory. The file is not encrypted; on macOS and Linux its permissions limit it to the owner (mode `0600`).
- **Desktop app:** encrypted with the operating system's key store (`safeStorage`) where one is available.

Keys are never returned by the server: the interface shows a mask, and a saved key can only be replaced.

## Interface addresses

An address is checked whenever it is written: when a provider is added, and when an existing one's address is changed. These are the rules of `checkBaseUrl` in `packages/core/src/providers/base-url.ts`:

- It must be a valid `http://` or `https://` address, with no spaces.
- It must not contain `{name}` placeholders (also in the percent-encoded form `%7Bname%7D`); fill them in first.
- It must not carry a query string (`?…`) or a fragment (`#…`), because the request path is appended to the address.
- It must not contain a user name or password; the key goes in the key field.
- Plain `http://` is accepted only for your own machine or local network: loopback addresses, private IPv4 ranges (`10.`, `127.`, `192.168.`, `172.16–31.`, `100.64.0.0/10`), IPv6 unique-local addresses, names ending in `.local`, `.lan`, `.internal` or `.home.arpa`, and single-label host names. Anything else must use `https://`.
- The link-local range (`169.254.0.0/16`, `fe80::/10`) and well-known cloud metadata hosts are never accepted over plain `http://`.

Providers saved before a rule was added are not rejected when they are read; the rules apply when something is written.

## Extra request headers

A provider's advanced settings can carry extra request headers. Headers the server manages itself are ignored if you set them (`PROTECTED_REQUEST_HEADERS` in `packages/api/src/schemas.ts`, and `mergeHeaders` in `packages/core/src/util/merge.ts`):

`authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `x-goog-api-key`, `x-key`, `api-key`, `content-type`, `content-length`, `transfer-encoding`, `connection`, `host`, `anthropic-version`.

Names may contain only letters, digits and hyphens, and a value may not contain line breaks. Two interface types also protect a header of their own: `X-DashScope-Async` (the two video types for Alibaba) and `X-DashScope-SSE` (CosyVoice).

## Models

- **Fetching the list.** For the four language-model types, "fetch the model list" asks the service for its models (see the table above) and lets you choose one.
- **Typing the name.** For the other types, and for services without a list endpoint, type the model name as the service expects it.
- **What dramai knows about a model.** Capabilities (modes, reference images, frame and duration options, aspect ratios), known limitations and prices come from the model data in `packages/core/data/models/models.json`, matched by the interface type and the model name. A model that is not in that data is used with conservative defaults, and the settings page says so.
- **Cost estimates.** The estimate shown before a batch uses the price entries in that data. A model without a price entry shows "can't be estimated". An estimate is not a bill: the service's own pricing page is authoritative.
