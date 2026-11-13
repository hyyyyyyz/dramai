import { def } from './presets-text.ts'
import type { ProviderPreset } from './presets.ts'

/**
 * 生图（文生图 / 图生图 / 多参考图）服务商预设，第一批。和文本预设一样：**全部是"按官方文档接入、未实测"**，
 * 带官方文档出处，不会自动成为当前选择。已实测的只有 v0.4 的 302.AI 三个预设（行为不变）。
 * 依据：research/PROVIDER_SURVEY.md 第三部分，并逐家再读了官方文档（2026-11）。每个建议型号在
 * `data/models/models.json` 里都有画像：没实测过的能力一律标"未验证"，带官方声称的值。
 */

const SIZE_NOTE_ZH = '尺寸由画幅和默认清晰度算出，不传分辨率档位。'
const SIZE_NOTE_HANT = '尺寸由畫幅和預設清晰度算出，不傳解析度檔位。'
const SIZE_NOTE_EN =
  'The size is derived from the aspect ratio and the default sharpness; no resolution tier is sent.'

export const IMAGE_PRESETS: readonly ProviderPreset[] = [
  def({
    id: 'openai-gpt-image',
    kind: 'image',
    vendor: 'openai',
    region: 'global',
    protocol: 'openai-images',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-image-2.5-sunburst',
    source: 'https://developers.openai.com/api/docs/guides/image-generation',
    zh: {
      label: 'OpenAI GPT Image（API Key）',
      notes: `官方生图接口。没有参考图时走 /images/generations，有参考图走 /images/edits（最多 16 张，multipart）。${SIZE_NOTE_ZH}`,
      limits: [
        '官方：GPT image 系列不支持 response_format 和 negative_prompt，这里都不发；没有 seed，没有专用的角色参考字段，多参考图靠提示词说明每张图的作用。',
        '官方自述：重复角色跨次生成可能有差异；被审核拦截会返回 moderation_blocked，不要原样重试。',
        '按 token 计价（官方），这里没有预估价；复杂提示最长约 2 分钟；可能需要组织验证。',
        '国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'OpenAI GPT Image（API Key）',
      notes: `官方生圖介面。沒有參考圖時走 /images/generations，有參考圖走 /images/edits（最多 16 張，multipart）。${SIZE_NOTE_HANT}`,
      limits: [
        '官方：GPT image 系列不支援 response_format 和 negative_prompt，這裡都不傳；沒有 seed，沒有專用的角色參考欄位，多參考圖靠提示詞說明每張圖的作用。',
        '官方自述：重複角色跨次生成可能有差異；被審核攔截會回傳 moderation_blocked，不要原樣重試。',
        '依 token 計價（官方），這裡沒有預估價；複雜提示最長約 2 分鐘；可能需要組織驗證。',
        '在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'OpenAI GPT Image (API key)',
      notes: `The official image API. Without references it calls /images/generations; with references it calls /images/edits (up to 16, multipart). ${SIZE_NOTE_EN}`,
      limits: [
        'Per the official docs the GPT image models do not support response_format or negative_prompt, so neither is sent; there is no seed and no dedicated character-reference field, so say in the prompt what each image is for.',
        'The docs say repeating a character across generations can drift; a moderation block returns moderation_blocked and should not be retried as is.',
        'Pricing is per token (official); no estimate is shown here. Complex prompts can take about 2 minutes; organization verification may be required.',
        'In some regions you may need your own proxy.',
      ],
    },
  }),
  def({
    id: 'volcengine-seedream',
    kind: 'image',
    vendor: 'volcengine',
    region: 'cn',
    protocol: 'volcengine-images',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    suggestedModel: 'doubao-seedream-5-5-261028',
    source: 'https://www.volcengine.com/docs/82379/1541523',
    zh: {
      label: '火山方舟 · 即梦 Seedream（直连）',
      notes: `方舟官方图片生成接口。参考图用 image 字段传 data URI（最多 10 张，5.0 lite / 4.5 最多 14 张）。${SIZE_NOTE_ZH}`,
      limits: [
        '这是方舟直连，和已实测的 302.AI Seedream 预设不是同一条路径：直连接受 data URI 参考图，302 的 /doubao 路径期望 URL。',
        '官方：不支持 n（一次一张），没有 quality / negative_prompt；水印默认开，这里显式关闭。',
        '提示词建议少于约 300 个汉字；限流 500 IPM。',
        '国际版 BytePlus 的官方文档页正文读不到，这里不预置国际站。',
      ],
    },
    hant: {
      label: '火山方舟 · 即夢 Seedream（直連）',
      notes: `方舟官方圖片生成介面。參考圖用 image 欄位傳 data URI（最多 10 張，5.0 lite / 4.5 最多 14 張）。${SIZE_NOTE_HANT}`,
      limits: [
        '這是方舟直連，和已實測的 302.AI Seedream 預設不是同一條路徑：直連接受 data URI 參考圖，302 的 /doubao 路徑期望網址。',
        '官方：不支援 n（一次一張），沒有 quality / negative_prompt；浮水印預設開啟，這裡明確關閉。',
        '提示詞建議少於約 300 個漢字；限流 500 IPM。',
        '國際版 BytePlus 的官方文件頁正文讀不到，這裡不預置國際站。',
      ],
    },
    en: {
      label: 'Volcengine Ark · Seedream (direct)',
      notes: `The official Ark image API. References go in the image field as data URIs (up to 10; up to 14 for 5.0 lite / 4.5). ${SIZE_NOTE_EN}`,
      limits: [
        'This is the direct Ark route, not the tested 302.AI Seedream preset: direct accepts data-URI references, while the 302 /doubao path expects URLs.',
        'Official: no n (one image per call), no quality or negative_prompt; the watermark is on by default and is switched off here.',
        'Keep prompts under about 300 Chinese characters; the rate limit is 500 IPM.',
        'The BytePlus international docs page body could not be read, so no international preset is included.',
      ],
    },
  }),
  def({
    id: 'minimax-h3-image',
    kind: 'image',
    vendor: 'minimax',
    region: 'global',
    protocol: 'openai-images',
    baseUrl: 'https://api.minimax.io/v1',
    suggestedModel: 'MiniMax-H3-Image',
    source: 'https://platform.minimax.io/docs/api-reference/image-generation-h3-generations.md',
    zh: {
      label: 'MiniMax H3 Image（国际站）',
      notes: `OpenAI 形态的 /images/generations 和 /images/edits（参考图最多 16 张，JSON）。${SIZE_NOTE_ZH}`,
      limits: [
        '官方：服务端最长等 600 秒；接口不幂等，断连或重试都会再次计费，所以失败后不要反复重试。',
        '提示词增强始终开启，改写后的提示词在响应的 revised_prompt 里；没有 seed 和 negative_prompt。',
        '只要有一张成功 HTTP 就是 200，每张图的失败原因要逐项看。',
        '官方文档页只读到国际站（api.minimax.io）；国内站（api.minimax.cn）的图像页面没读到，Key 是否互通文档没写。',
      ],
    },
    hant: {
      label: 'MiniMax H3 Image（國際站）',
      notes: `OpenAI 形態的 /images/generations 和 /images/edits（參考圖最多 16 張，JSON）。${SIZE_NOTE_HANT}`,
      limits: [
        '官方：伺服器端最長等 600 秒；介面不具冪等性，斷線或重試都會再次計費，所以失敗後不要反覆重試。',
        '提示詞增強一律開啟，改寫後的提示詞在回應的 revised_prompt 裡；沒有 seed 和 negative_prompt。',
        '只要有一張成功 HTTP 就是 200，每張圖的失敗原因要逐項看。',
        '官方文件頁只讀到國際站（api.minimax.io）；中國站（api.minimax.cn）的圖像頁面沒讀到，Key 是否互通文件沒寫。',
      ],
    },
    en: {
      label: 'MiniMax H3 Image (international site)',
      notes: `OpenAI-shaped /images/generations and /images/edits (up to 16 references, JSON). ${SIZE_NOTE_EN}`,
      limits: [
        'Official: the server may wait up to 600 seconds, and the endpoint is not idempotent (a dropped connection or a retry is billed again), so do not retry failures repeatedly.',
        'Prompt enhancement is always on (the rewritten prompt is in revised_prompt); there is no seed or negative_prompt.',
        "HTTP is 200 as soon as one image succeeds, so each image's failure reason must be checked.",
        'Only the international docs (api.minimax.io) could be read; the China site (api.minimax.cn) image pages were not, and the docs do not say whether keys are shared.',
      ],
    },
  }),
  def({
    id: 'gemini-image-direct',
    kind: 'image',
    vendor: 'google',
    region: 'global',
    protocol: 'gemini-image',
    baseUrl: 'https://generativelanguage.googleapis.com',
    suggestedModel: 'gemini-3.1-flash-image',
    source: 'https://aistudio.google.com/docs/image-generation',
    zh: {
      label: 'Google Gemini 生图（Nano Banana，官方直连）',
      notes: `官方地址，只发 x-goog-api-key。参考图是 base64 内联；官方给出的参考图额度合计最多 14 张（对象图和角色图各有上限）。${SIZE_NOTE_ZH}`,
      limits: [
        '官方当前的生图指南只写了 Interactions API，generateContent 被称为 legacy 但"完全支持"；这里用 generateContent，图片请求的字段名在官方当前页面没有确认，是未验证的。',
        '输出带 SynthID 水印，输出张数可能与请求不符，没有 seed。',
        '模型名取自官方模型页当天（gemini-nano-banana-2.1 是官方对新项目的推荐，gemini-3-pro-image 带思考）。',
        '已有的 302.AI Nano Banana 预设（已实测）不受影响。国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'Google Gemini 生圖（Nano Banana，官方直連）',
      notes: `官方網址，只送 x-goog-api-key。參考圖是 base64 內嵌；官方給出的參考圖額度合計最多 14 張（物件圖和角色圖各有上限）。${SIZE_NOTE_HANT}`,
      limits: [
        '官方目前的生圖指南只寫了 Interactions API，generateContent 被稱為 legacy 但「完全支援」；這裡用 generateContent，圖片請求的欄位名稱在官方目前頁面沒有確認，是未驗證的。',
        '輸出帶 SynthID 浮水印，輸出張數可能與請求不符，沒有 seed。',
        '模型名稱取自官方模型頁當天（gemini-nano-banana-2.1 是官方對新專案的建議，gemini-3-pro-image 帶思考）。',
        '已有的 302.AI Nano Banana 預設（已實測）不受影響。在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'Google Gemini image (Nano Banana, official)',
      notes: `The official address; only x-goog-api-key is sent. References are inline base64; the official reference quota is up to 14 in total (objects and characters each have a cap). ${SIZE_NOTE_EN}`,
      limits: [
        'The current official image guide only describes the Interactions API; generateContent is called legacy but "fully supported". This uses generateContent, and its image request field names are not confirmed on the current official pages, so they are unverified.',
        'Output carries a SynthID watermark, the number of images can differ from the request, and there is no seed.',
        'Model names are from the official models page that day (gemini-nano-banana-2.1 is the official recommendation for new projects; gemini-3-pro-image thinks).',
        'The existing tested 302.AI Nano Banana preset is unaffected. In some regions you may need your own proxy.',
      ],
    },
  }),
  def({
    id: 'aliyun-qwen-image-cn',
    kind: 'image',
    vendor: 'aliyun',
    region: 'cn',
    protocol: 'dashscope-image',
    baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'qwen-image-2.0-pro',
    source: 'https://help.aliyun.com/zh/model-studio/qwen-image-api',
    zh: {
      label: '阿里云百炼 · Qwen-Image（国内站）',
      notes: `同步的文生图和编辑（最多 3 张参考图）。${SIZE_NOTE_ZH}`,
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID；API Key 按地域绑定，国内站和国际站不能混用。',
        '结果是 24 小时有效的图片地址，生成成功后会立即下载保存。',
        '官方：文字语言只保证简体中文和英文；服务端的提示词改写已关闭；n 最多 6，按成功张数计费。',
        '只接了同步的 Qwen-Image 2.0 系列；wan 系列的异步形态和 9 张参考图的 wan2.7 还没接。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · Qwen-Image（中國站）',
      notes: `同步的文生圖和編輯（最多 3 張參考圖）。${SIZE_NOTE_HANT}`,
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID；API Key 依地域綁定，中國站和國際站不能混用。',
        '結果是 24 小時有效的圖片網址，生成成功後會立即下載儲存。',
        '官方：文字語言只保證簡體中文和英文；伺服器端的提示詞改寫已關閉；n 最多 6，依成功張數計費。',
        '只接了同步的 Qwen-Image 2.0 系列；wan 系列的非同步形態和 9 張參考圖的 wan2.7 還沒接。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Qwen-Image (China site)',
      notes: `Synchronous text-to-image and editing (up to 3 references). ${SIZE_NOTE_EN}`,
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID; API keys are bound to a region, so the China and international sites cannot be mixed.',
        'Results are image addresses valid for 24 hours; they are downloaded and saved as soon as generation succeeds.',
        'Official: text rendering is only guaranteed for Simplified Chinese and English; server-side prompt rewriting is switched off; n is at most 6 and billing is per successful image.',
        'Only the synchronous Qwen-Image 2.0 family is connected; the asynchronous wan models and wan2.7 (9 references) are not.',
      ],
    },
  }),
  def({
    id: 'aliyun-qwen-image-intl',
    kind: 'image',
    vendor: 'aliyun',
    region: 'global',
    protocol: 'dashscope-image',
    baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'qwen-image-2.0-pro',
    source: 'https://help.aliyun.com/zh/model-studio/qwen-image-api',
    zh: {
      label: '阿里云百炼 · Qwen-Image（国际站，新加坡）',
      notes: `同步的文生图和编辑（最多 3 张参考图）。${SIZE_NOTE_ZH}`,
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID；API Key 按地域绑定，国际站和国内站不能混用。',
        '结果是 24 小时有效的图片地址，生成成功后会立即下载保存。',
        '官方：文字语言只保证简体中文和英文；服务端的提示词改写已关闭。',
        '只接了同步的 Qwen-Image 2.0 系列；wan 系列还没接。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · Qwen-Image（國際站，新加坡）',
      notes: `同步的文生圖和編輯（最多 3 張參考圖）。${SIZE_NOTE_HANT}`,
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID；API Key 依地域綁定，國際站和中國站不能混用。',
        '結果是 24 小時有效的圖片網址，生成成功後會立即下載儲存。',
        '官方：文字語言只保證簡體中文和英文；伺服器端的提示詞改寫已關閉。',
        '只接了同步的 Qwen-Image 2.0 系列；wan 系列還沒接。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Qwen-Image (international, Singapore)',
      notes: `Synchronous text-to-image and editing (up to 3 references). ${SIZE_NOTE_EN}`,
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID; API keys are bound to a region, so the international and China sites cannot be mixed.',
        'Results are image addresses valid for 24 hours; they are downloaded and saved as soon as generation succeeds.',
        'Official: text rendering is only guaranteed for Simplified Chinese and English; server-side prompt rewriting is switched off.',
        'Only the synchronous Qwen-Image 2.0 family is connected; the wan models are not.',
      ],
    },
  }),
  def({
    id: 'siliconflow-image',
    kind: 'image',
    vendor: 'siliconflow',
    region: 'cn',
    protocol: 'siliconflow-images',
    baseUrl: 'https://api.siliconflow.cn/v1',
    suggestedModel: 'Qwen/Qwen-Image',
    source: 'https://docs.siliconflow.com/en/api-reference/images/images-generations',
    zh: {
      label: '硅基流动 · 生图（国内站）',
      notes: `同步，响应是 images[].url，地址一小时有效，生成成功后会立即下载保存。${SIZE_NOTE_ZH}`,
      limits: [
        '参考图只有一张（base64），字段名因型号而异：Qwen-Image-Edit 和 FLUX.1-Kontext 支持，Qwen-Image 文生图不传；多角色一致性弱于直连厂商。',
        'Qwen-Image 的尺寸按画幅取官方推荐的几档；FLUX.2 等型号的尺寸是固定枚举，这里没有逐一适配。',
        '官方页面只读到了国际站（docs.siliconflow.com）；国内站页面当天读不到，国内地址 api.siliconflow.cn 来自惯例。两站 Key 是否互通文档没写。',
        '模型清单会变化，请以官方为准。',
      ],
    },
    hant: {
      label: '矽基流動 · 生圖（中國站）',
      notes: `同步，回應是 images[].url，網址一小時有效，生成成功後會立即下載儲存。${SIZE_NOTE_HANT}`,
      limits: [
        '參考圖只有一張（base64），欄位名稱因型號而異：Qwen-Image-Edit 和 FLUX.1-Kontext 支援，Qwen-Image 文生圖不傳；多角色一致性弱於直連廠商。',
        'Qwen-Image 的尺寸依畫幅取官方建議的幾檔；FLUX.2 等型號的尺寸是固定列舉，這裡沒有逐一適配。',
        '官方頁面只讀到了國際站（docs.siliconflow.com）；中國站頁面當天讀不到，中國網址 api.siliconflow.cn 來自慣例。兩站 Key 是否互通文件沒寫。',
        '模型清單會變動，請以官方為準。',
      ],
    },
    en: {
      label: 'SiliconFlow · image (China site)',
      notes: `Synchronous; the response is images[].url, valid for one hour, and the image is downloaded and saved as soon as generation succeeds. ${SIZE_NOTE_EN}`,
      limits: [
        'Only one reference image (base64), and the field name depends on the model: Qwen-Image-Edit and FLUX.1-Kontext take it, plain Qwen-Image text-to-image does not; character consistency is weaker than with the direct vendors.',
        'Qwen-Image uses the officially recommended sizes per aspect ratio; models such as FLUX.2 use fixed size enums that are not mapped one by one here.',
        'Only the international docs page (docs.siliconflow.com) could be read; the China page could not, and api.siliconflow.cn is the usual convention. The docs do not say whether keys are shared.',
        'The model list changes; follow the official one.',
      ],
    },
  }),
  def({
    id: 'kling-image',
    kind: 'image',
    vendor: 'kling',
    region: 'global',
    protocol: 'kling-image',
    baseUrl: 'https://api-singapore.klingai.com',
    suggestedModel: 'kling-image-o1',
    source: 'https://kling.ai/document-api/api/image/3-0-omni/image-omni.md',
    zh: {
      label: '可灵 图像（Omni，API Key）',
      notes: `异步：提交后轮询，成功后立即下载（结果 30 天后清除）。Omni 型号参考图和元素合计最多 10 张。${SIZE_NOTE_ZH}`,
      limits: [
        '参考图是不带 data: 前缀的 base64；提示词里用 <<<image_1>>> 指称第几张图（官方示例里另有 <<element_1>>，写法前后不一致，需要实测）。',
        '地址用官方示例的 api-singapore.klingai.com（写明给服务器在境外的用户）；中国大陆域名页面没写，国内外账号是否互通也没写。',
        '官方文档里 model_name 的缺省值自相矛盾（空值走 V1，缺省 kling-v3），这里总是显式传。',
        '元素库（角色持久化）和组图（series）这一版没接。',
      ],
    },
    hant: {
      label: '可靈 圖像（Omni，API Key）',
      notes: `非同步：送出後輪詢，成功後立即下載（結果 30 天後清除）。Omni 型號參考圖和元素合計最多 10 張。${SIZE_NOTE_HANT}`,
      limits: [
        '參考圖是不帶 data: 前綴的 base64；提示詞裡用 <<<image_1>>> 指稱第幾張圖（官方範例裡另有 <<element_1>>，寫法前後不一致，需要實測）。',
        '網址用官方範例的 api-singapore.klingai.com（寫明給伺服器在境外的使用者）；中國大陸網域頁面沒寫，中國與海外帳號是否互通也沒寫。',
        '官方文件裡 model_name 的預設值自相矛盾（空值走 V1，預設 kling-v3），這裡一律明確傳入。',
        '元素庫（角色持久化）和組圖（series）這一版沒接。',
      ],
    },
    en: {
      label: 'Kling image (Omni, API key)',
      notes: `Asynchronous: submit, poll, and download as soon as it succeeds (results are cleared after 30 days). Omni models take up to 10 references and elements combined. ${SIZE_NOTE_EN}`,
      limits: [
        'References are base64 without a data: prefix; the prompt refers to image N as <<<image_N>>> (the official examples also show <<element_1>>, which is inconsistent and needs testing).',
        'The address is the official example api-singapore.klingai.com (stated for servers outside China); the docs give no mainland China host and do not say whether accounts are shared.',
        'The official docs contradict themselves on the default model_name (empty means V1, the default is kling-v3), so it is always sent explicitly.',
        'The element library (persistent characters) and series output are not connected in this version.',
      ],
    },
  }),
]
