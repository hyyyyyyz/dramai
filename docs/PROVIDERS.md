# Providers

A provider is a service dramai sends requests to: a language model, an image model, a video model or a speech model. You add one in **Settings → Providers → Add provider**. This page describes the form, the API protocols it offers, how authentication works and what the address and header rules are. The statements here follow the code under `packages/`; the file is named where it matters.

## Adding a provider

Open **Settings → Providers** and choose **Add provider** in the kind you want: language model, text-to-image, image-to-video or voice-over. One form opens:

| Field           | What it means                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name            | The name shown in the settings and in the project's model list.                                                                                                                                                                                            |
| API protocol    | Which API the service speaks. The list depends on the kind; see [API protocols](#api-protocols).                                                                                                                                                           |
| Base URL        | The base address of that API, for example `https://your-service-address/v1`. dramai appends the request path to it. The rules are under [Base URLs](#base-urls).                                                                                           |
| Authentication  | **API key**, **Account sign-in** (only offered when a sign-in channel exists for the chosen protocol) or **No authentication**. See [Authentication](#authentication).                                                                                     |
| API key         | Write-only: once saved it is never shown again or sent back to the browser, only replaced.                                                                                                                                                                 |
| Get model list  | Asks the service for its models before anything is saved. See [Models](#models).                                                                                                                                                                           |
| Model           | A drop-down of the listed models, or of the models dramai knows for this kind and protocol. The **Type it in** button next to it turns the drop-down into a box where any model name can be entered; **Choose from the list** under the box switches back. |
| Test connection | Checks the address and key before anything is saved, where the protocol has a read-only request to check with. See [Test connection](#test-connection).                                                                                                    |
| Cancel / Add    | Cancel saves nothing. Add saves the provider; choose **Use this** afterwards to make it the one in use for its kind.                                                                                                                                       |

Get model list and Test connection need the Base URL, and the API key when the authentication is an API key. They create nothing: the draft is only sent as the request.

## API protocols

The **API protocol** list offers these, in this order. The name is what the interface shows; the id is what is stored in the provider's configuration. The order and ids are `PROTOCOLS_BY_KIND` in `packages/workspace/src/features/settings/protocols.ts`, the names are the `protocol` entries of the English dictionary in `packages/workspace/src/i18n/locales/en/`, and the requests are built by the files in `packages/core/src/providers/protocols/`.

"Models" says whether dramai can ask the service for its model list (`modelListRequest` in `packages/core/src/providers/model-list.ts`, the same set as `LISTS_MODELS` in the workspace): **List** means it can, **Known** means the form offers the models dramai has data for as suggestions, and **Type** means the model name is typed in. A list is fetched with `GET {address}/models` (OpenAI types), `GET {address}/v1/models?limit=1000` (Anthropic) or `GET {address}/v1beta/models` (Gemini types).

### Language models

| Name                          | Id                   | Interface                                                            | Authentication header                                                        | Models |
| ----------------------------- | -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| OpenAI-compatible             | `openai-chat`        | Chat Completions: `POST {address}/chat/completions`, streamed        | `Authorization: Bearer`                                                      | List   |
| OpenAI Responses (text)       | `openai-responses`   | Responses API: `POST {address}/responses`, streamed                  | `Authorization: Bearer`                                                      | List   |
| Anthropic Messages (text)     | `anthropic-messages` | Messages API: `POST {address}/v1/messages`, streamed                 | `x-api-key` and `Authorization: Bearer` (same key), plus `anthropic-version` | List   |
| Gemini generateContent (text) | `gemini-chat`        | `POST {address}/v1beta/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key`                                                             | List   |

### Images

| Name                        | Id                   | Interface                                                                                                                                                                                                                                                                                                                                                             | Authentication header                                                                                         | Models |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| OpenAI-compatible (images)  | `openai-images`      | `POST {address}/images/generations`. With reference images the model name decides: `gpt-image*` and `chatgpt-image*` use `POST {address}/images/edits` (multipart), `MiniMax-H3-Image*` uses `/images/edits` (JSON), and other names send the references in the `/images/generations` body; the image style in a provider's advanced settings can set this explicitly | `Authorization: Bearer`                                                                                       | List   |
| Gemini native               | `gemini-image`       | `POST {address}/v1beta/models/{model}:generateContent`                                                                                                                                                                                                                                                                                                                | `x-goog-api-key`; `Authorization: Bearer` is also sent unless the host is `generativelanguage.googleapis.com` | List   |
| Volcengine Seedream (image) | `volcengine-images`  | `POST {address}/images/generations`                                                                                                                                                                                                                                                                                                                                   | `Authorization: Bearer`                                                                                       | Known  |
| Alibaba Qwen-Image (image)  | `dashscope-image`    | `POST {address}/api/v1/services/aigc/multimodal-generation/generation`                                                                                                                                                                                                                                                                                                | `Authorization: Bearer`                                                                                       | Known  |
| SiliconFlow (image)         | `siliconflow-images` | `POST {address}/images/generations`                                                                                                                                                                                                                                                                                                                                   | `Authorization: Bearer`                                                                                       | Known  |
| Kling (image)               | `kling-image`        | Asynchronous: submit to `/v1/images/generations` (or `/v1/images/omni-image` for the Omni models), poll the task, download                                                                                                                                                                                                                                            | `Authorization: Bearer`                                                                                       | Known  |

### Video

| Name                                       | Id                | Interface                                                                                                                         | Authentication header   | Models |
| ------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ |
| Generic video API                          | `generic-video`   | A common shape with no formal standard: `POST {address}/videos/generations`, then poll `GET {address}/videos/generations/{id}`    | `Authorization: Bearer` | Type   |
| Volcengine Ark / BytePlus Seedance (video) | `ark-video`       | Asynchronous: `POST {address}/contents/generations/tasks`, then poll; the address ends at `/api/v3`                               | `Authorization: Bearer` | Known  |
| Kling 4.0 (video)                          | `kling-contents`  | Asynchronous, chosen by task type: `/text-to-video/{model}`, `/image-to-video/{model}` or `/omni-video/{model}`                   | `Authorization: Bearer` | Known  |
| Alibaba Model Studio Wan 3.0 (video)       | `dashscope-video` | Asynchronous: `POST {address}/api/v1/services/aigc/video-generation/video-synthesis`, then poll `GET {address}/api/v1/tasks/{id}` | `Authorization: Bearer` | Known  |

### Speech

| Name                       | Id                    | Interface                                                    | Authentication header   | Models |
| -------------------------- | --------------------- | ------------------------------------------------------------ | ----------------------- | ------ |
| OpenAI-compatible (speech) | `openai-tts`          | `POST {address}/audio/speech`                                | `Authorization: Bearer` | List   |
| MiniMax (speech)           | `minimax-t2a`         | `POST {address}/t2a_v2`, synchronous                         | `Authorization: Bearer` | Known  |
| Alibaba CosyVoice (speech) | `dashscope-cosyvoice` | `POST {address}/api/v1/services/audio/tts/SpeechSynthesizer` | `Authorization: Bearer` | Known  |

Some protocol names carry a company name because the interface is that company's own. A service that copies one of these interfaces can be used with the same protocol: the Base URL is the only thing that changes.

### Kept for providers that were saved earlier

Three video protocols are no longer offered when adding a provider. Their requests are shaped for services that relay the interface, not for the companies' own addresses; the first two put a path prefix (`/aliyun/…`, `/volcengine/…`) in front of it. A provider saved with one of them is shown, edited, tested and generated with as before, and its name stays in the list.

| Name              | Id                 | Interface                                                                                |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Alibaba DashScope | `aliyun-video`     | `POST {address}/aliyun/api/v1/services/aigc/video-generation/video-synthesis`, then poll |
| Volcengine Ark    | `volcengine-video` | `POST {address}/volcengine/api/v3/contents/generations/tasks`, then poll                 |
| Kling             | `kling-video`      | `POST {address}/v1/videos/image2video`, then poll                                        |

For Volcengine's and Alibaba's own video interfaces, use the Volcengine Ark / BytePlus Seedance and Alibaba Model Studio Wan 3.0 protocols above.

## Authentication

Authentication is per provider (`packages/core/src/providers/auth.ts`):

- **API key.** The key is stored once and sent in the header listed above. The default.
- **Account sign-in.** Two channels exist. A channel fixes the API protocol and the Base URL, so the Base URL box is read-only once it is chosen. The provider is added first and the sign-in is done on its card; before that, Get model list and Test connection are not available. Both channels need the sign-in to be done on the computer that runs dramai, because the authorisation comes back to a local address.
  - **ChatGPT account.** Text requests use the ChatGPT plan's usage instead of an API key. It works with the OpenAI Responses protocol and the address `https://api.openai.com/v1`, and it covers language models only: images, video and speech still use API keys.
  - **OpenRouter account.** You sign in and OpenRouter hands dramai an API key of your own, which is then used like a key you pasted. It works with the OpenAI-compatible protocol and the address `https://openrouter.ai/api/v1`.

  The channels come from `LOGIN_CHANNEL_ENDPOINTS` (`providers.loginChannels` serves them to the form): the sign-in token is only ever sent to the channel's own address, whatever else a configuration says.

- **No authentication.** No key is stored and no `Authorization` header is sent. For services on your own machine or network that do not ask for one.

### Where keys are kept

- **WebUI:** in `secrets.json` in the data directory. The file is not encrypted; on macOS and Linux its permissions limit it to the owner (mode `0600`).
- **Desktop app:** encrypted with the operating system's key store (`safeStorage`) where one is available.

Keys are never returned by the server: the interface shows a mask, and a saved key can only be replaced. If a service repeats the key in an error message, the key is removed from the connection-test result, from task records and events, and from logs before they are stored or shown.

## Base URLs

A Base URL is checked whenever it is written: when a provider is added, and when an existing one's address is changed. These are the rules of `checkBaseUrl` in `packages/core/src/providers/base-url.ts`:

- It must be a valid `http://` or `https://` address, with no spaces.
- It must not contain `{name}` placeholders (also in the percent-encoded form `%7Bname%7D`); fill them in first.
- It must not carry a query string (`?…`) or a fragment (`#…`), because the request path is appended to the address.
- It must not contain a user name or password; the key goes in the key field.
- Plain `http://` is accepted only for your own machine or local network: loopback addresses, private IPv4 ranges (`10.`, `127.`, `192.168.`, `172.16–31.`, `100.64.0.0/10`), IPv6 unique-local addresses, names ending in `.local`, `.lan`, `.internal` or `.home.arpa`, and single-label host names. Anything else must use `https://`.
- The link-local range (`169.254.0.0/16`, `fe80::/10`) and well-known cloud metadata hosts are never accepted over plain `http://`.

Providers saved before a rule was added are not rejected when they are read; the rules apply when something is written.

## Extra request headers

A provider's advanced settings (on its card, after adding) can carry extra request headers. Headers the server manages itself are ignored if you set them (`PROTECTED_REQUEST_HEADERS` in `packages/api/src/schemas.ts`, and `mergeHeaders` in `packages/core/src/util/merge.ts`):

`authorization`, `proxy-authorization`, `cookie`, `x-api-key`, `x-goog-api-key`, `x-key`, `api-key`, `content-type`, `content-length`, `transfer-encoding`, `connection`, `host`, `anthropic-version`.

Names may contain only letters, digits and hyphens, and a value may not contain line breaks. Two protocols also protect a header of their own: `X-DashScope-Async` (the two Alibaba video protocols) and `X-DashScope-SSE` (CosyVoice).

## Models

- **Get model list.** For the seven protocols marked **List** above, the form asks the service for its models (`providers.probe` with the action `models`, which saves nothing) and fills the Model drop-down with their ids. If the service answers with an empty list, the suggestions stay. The card of a saved provider has the same button (`providers.models`); both go through one implementation in `packages/server/src/services/providers.ts`.
- **Suggestions.** Where dramai has model data for the chosen kind and protocol, the drop-down also offers those model names (`models.known`, from `packages/core/data/models/models.json`); the protocols marked **Known** have data. They are a convenience, not a limit: **Type it in** (a button next to the drop-down) turns it into a box that accepts any model name, as the service expects it. With more than 30 choices, the drop-down has a filter box.
- **What dramai knows about a model.** Capabilities (modes, reference images, frame and duration options, aspect ratios), known limitations and prices come from the model data, matched by the protocol and the model name. A model that is not in that data is used with conservative defaults, and the settings page says so.
- **Cost estimates.** The estimate shown before a batch uses the price entries in that data. A model without a price entry shows "Can't be estimated". An estimate is not a bill: the service's own pricing page is authoritative.

## Test connection

Test connection (`probeTest` and `testProvider` in `packages/server/src/services/providers.ts` and `packages/core/src/providers/test-connection.ts`) never sends a generation request.

- For the seven protocols marked **List**, it sends the same read-only `GET` as the model list and reports whether the service answered, how many models it listed, and, when a model name was entered, whether that model is among them.
- For the other protocols there is no standard read-only endpoint, so nothing is sent and the result says the connection cannot be verified automatically.
- A failure carries the HTTP status and a stable code, and the first part of the service's answer with the key removed.
