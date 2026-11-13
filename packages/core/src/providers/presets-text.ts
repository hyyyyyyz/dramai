import type { TranslatedLocale } from '../i18n.ts'
import type { ProviderPreset } from './presets.ts'

/**
 * 文本（LLM）服务商预设，第一批。**全部是"按官方文档接入、未实测"**（`verification.status === 'documented'`，
 * 带官方文档出处），不会自动成为当前选择；本地模型（Ollama、LM Studio）无需鉴权。
 * 依据：research/PROVIDER_SURVEY.md（2026-11-13 核对）+ 每个协议、每家厂商的官方页面再核一遍（模型名、
 * 地址、关思考的写法以官方文档当天为准）。预设里的 `dialect.extraBody` 用来给默认开思考的模型关思考，
 * 用户可以在服务商配置里看到、修改。
 */

type Texts = Record<TranslatedLocale, { label: string; notes: string; knownLimitations: string[] }>

export interface Def {
  id: string
  /** 缺省 llm。 */
  kind?: ProviderPreset['kind']
  vendor: string
  region?: ProviderPreset['region']
  protocol: ProviderPreset['protocol']
  baseUrl: string
  baseUrlPlaceholders?: string[]
  suggestedModel: string
  auth?: ProviderPreset['auth']
  dialect?: ProviderPreset['dialect']
  source: string
  zh: { label: string; notes: string; limits: string[] }
  hant: { label: string; notes: string; limits: string[] }
  en: { label: string; notes: string; limits: string[] }
}

const THINK_ZH = '默认开启思考，预设已用"额外请求体"关闭，让 JSON 输出更快、不被思考占满输出额度。'
const THINK_HANT =
  '預設開啟思考，預設值已用「額外請求內容」關閉，讓 JSON 輸出更快、不被思考佔滿輸出額度。'
const THINK_EN =
  'Thinking is on by default; the preset turns it off through the extra request body so JSON output is faster and thinking does not use up the output budget.'
const UNTESTED_ZH = '按官方文档接入，未实测。'
const UNTESTED_HANT = '依官方文件接入，尚未實測。'
const UNTESTED_EN = 'Connected from the official documentation, not tested end to end.'

export function def(d: Def): ProviderPreset {
  const texts: Texts = {
    en: { label: d.en.label, notes: `${d.en.notes} ${UNTESTED_EN}`, knownLimitations: d.en.limits },
    'zh-Hant': {
      label: d.hant.label,
      notes: `${d.hant.notes}${UNTESTED_HANT}`,
      knownLimitations: d.hant.limits,
    },
  }
  return {
    id: d.id,
    label: d.zh.label,
    vendor: d.vendor,
    ...(d.region ? { region: d.region } : {}),
    kind: d.kind ?? 'llm',
    protocol: d.protocol,
    baseUrl: d.baseUrl,
    ...(d.baseUrlPlaceholders ? { baseUrlPlaceholders: d.baseUrlPlaceholders } : {}),
    suggestedModel: d.suggestedModel,
    auth: d.auth ?? { type: 'api_key' },
    ...(d.dialect ? { dialect: d.dialect } : {}),
    notes: `${d.zh.notes}${UNTESTED_ZH}`,
    verification: { status: 'documented', source: d.source },
    knownLimitations: d.zh.limits,
    i18n: texts,
  }
}

export const TEXT_PRESETS: readonly ProviderPreset[] = [
  def({
    id: 'openai-responses-key',
    vendor: 'openai',
    region: 'global',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-6.1-sol',
    source: 'https://developers.openai.com/api/docs/models',
    zh: {
      label: 'OpenAI（API Key · 文本）',
      notes:
        '用 API Key 调用 Responses 接口，不保存对话（store:false）。模型名取自官方模型页，登录前可从模型列表里选。',
      limits: [
        '国内网络通常需要自备代理。',
        '推理模型可能不接受 temperature 等采样参数，建议不设置。',
      ],
    },
    hant: {
      label: 'OpenAI（API Key · 文字）',
      notes:
        '用 API Key 呼叫 Responses 介面，不儲存對話（store:false）。模型名稱取自官方模型頁，可從模型清單裡選。',
      limits: [
        '在部分地區可能需要自備代理。',
        '推理模型可能不接受 temperature 等取樣參數，建議不要設定。',
      ],
    },
    en: {
      label: 'OpenAI (API key · text)',
      notes:
        'Calls the Responses API with an API key and does not store conversations (store:false). The model name comes from the official models page; pick one from the model list.',
      limits: [
        'In some regions you may need your own proxy.',
        'Reasoning models may not accept sampling parameters such as temperature; leave them unset.',
      ],
    },
  }),
  def({
    id: 'anthropic-messages',
    vendor: 'anthropic',
    region: 'global',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    suggestedModel: 'claude-sonnet-5-5',
    source: 'https://platform.claude.com/docs/en/api/overview',
    zh: {
      label: 'Anthropic Claude（API Key）',
      notes: '官方 Messages 接口，流式。同时发送 x-api-key 和 Authorization 两种官方支持的头。',
      limits: [
        '没有 JSON 输出模式：靠提示词要求 JSON 加解析重试。',
        'Claude 5.x 默认自适应思考，思考占用输出额度，所以默认输出上限很宽（32000）；Sonnet 5.5 不能完全关闭思考，Opus 5.5 思考常开。',
        '不发送 temperature 和 top_p（官方：4.7 及以上会拒绝）。',
        '没有限定到单个工作区的 API Key 必须带 anthropic-workspace-id 请求头：在这个服务商的"额外请求头"里加上（官方总览页）。',
        '国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'Anthropic Claude（API Key）',
      notes: '官方 Messages 介面，串流。同時送出 x-api-key 和 Authorization 兩種官方支援的標頭。',
      limits: [
        '沒有 JSON 輸出模式：靠提示詞要求 JSON 加解析重試。',
        'Claude 5.x 預設自適應思考，思考佔用輸出額度，所以預設輸出上限很寬（32000）；Sonnet 5.5 不能完全關閉思考，Opus 5.5 思考常開。',
        '不傳送 temperature 和 top_p（官方：4.7 以上會拒絕）。',
        '沒有限定到單一工作區的 API Key 必須帶 anthropic-workspace-id 請求標頭：在這個服務商的「額外請求標頭」裡加上（官方總覽頁）。',
        '在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'Anthropic Claude (API key)',
      notes:
        'The official Messages API, streamed. Sends both officially supported auth headers (x-api-key and Authorization).',
      limits: [
        'No JSON mode: JSON comes from the prompt plus parse-and-retry.',
        'Claude 5.x thinks adaptively and thinking uses the output budget, so the default output limit is generous (32000); Sonnet 5.5 cannot turn thinking fully off and Opus 5.5 always thinks.',
        'temperature and top_p are not sent (the official docs say 4.7 and later reject them).',
        "An API key that is not scoped to a single workspace must send the anthropic-workspace-id header: add it under this provider's extra request headers (official overview page).",
        'In some regions you may need your own proxy.',
      ],
    },
  }),
  def({
    id: 'gemini-generate-content',
    vendor: 'google',
    region: 'global',
    protocol: 'gemini-chat',
    baseUrl: 'https://generativelanguage.googleapis.com',
    suggestedModel: 'gemini-3.8-flash',
    source: 'https://aistudio.google.com/api-reference/generate-content',
    zh: {
      label: 'Google Gemini（API Key）',
      notes: '官方 generateContent 接口（流式），不用官方主推的 Interactions API。',
      limits: [
        '官方参考页没有写流式格式和鉴权头的细节，这部分是未验证的。',
        '部分新模型默认开启思考且不能完全关闭，思考占用输出额度。',
        '忽略 temperature 和 top_p；图片输入必须是 base64。',
        '国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'Google Gemini（API Key）',
      notes: '官方 generateContent 介面（串流），不使用官方主推的 Interactions API。',
      limits: [
        '官方參考頁沒有寫串流格式和驗證標頭的細節，這部分是未驗證的。',
        '部分新模型預設開啟思考且不能完全關閉，思考佔用輸出額度。',
        '忽略 temperature 和 top_p；圖片輸入必須是 base64。',
        '在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'Google Gemini (API key)',
      notes:
        'The official generateContent API (streamed), not the Interactions API the docs now promote.',
      limits: [
        'The official reference does not describe the stream format or the auth header in detail; that part is unverified.',
        'Some newer models think by default and cannot turn it off completely; thinking uses the output budget.',
        'temperature and top_p are ignored; image input must be base64.',
        'In some regions you may need your own proxy.',
      ],
    },
  }),
  def({
    id: 'aliyun-bailian-cn',
    vendor: 'aliyun',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'qwen3.8-flash',
    dialect: { maxTokensField: 'max_completion_tokens', extraBody: { enable_thinking: false } },
    source: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    zh: {
      label: '阿里云百炼 · 通义千问（国内站）',
      notes: `OpenAI 兼容接口（北京地域）。${THINK_ZH}`,
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID。',
        'API Key 按地域绑定，国内站和国际站的 Key 不互通。',
        '个别模型是纯思考模型，不能关闭思考。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · 通義千問（中國站）',
      notes: `OpenAI 相容介面（北京地域）。${THINK_HANT}`,
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID。',
        'API Key 依地域綁定，中國站和國際站的 Key 不互通。',
        '個別模型是純思考模型，不能關閉思考。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Qwen (China site)',
      notes: `OpenAI-compatible API (Beijing region). ${THINK_EN}`,
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID.',
        'API keys are bound to a region; the China and international keys are not interchangeable.',
        'A few models only think and cannot turn it off.',
      ],
    },
  }),
  def({
    id: 'aliyun-bailian-intl',
    vendor: 'aliyun',
    region: 'global',
    protocol: 'openai-chat',
    baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'qwen3.8-flash',
    dialect: { maxTokensField: 'max_completion_tokens', extraBody: { enable_thinking: false } },
    source:
      'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    zh: {
      label: '阿里云百炼 · 通义千问（国际站，新加坡）',
      notes: `OpenAI 兼容接口（新加坡地域）。${THINK_ZH}`,
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID。',
        'API Key 按地域绑定，国际站和国内站的 Key 不互通。',
        '官方国际站页面把北京地域的地址也写成了新加坡的主机名，北京请以中文站为准。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · 通義千問（國際站，新加坡）',
      notes: `OpenAI 相容介面（新加坡地域）。${THINK_HANT}`,
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID。',
        'API Key 依地域綁定，國際站和中國站的 Key 不互通。',
        '官方國際站頁面把北京地域的網址也寫成了新加坡的主機名稱，北京請以中文站為準。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Qwen (international, Singapore)',
      notes: `OpenAI-compatible API (Singapore region). ${THINK_EN}`,
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID.',
        'API keys are bound to a region; the international and China keys are not interchangeable.',
        'The international docs page also lists the Singapore host for the Beijing region; for Beijing follow the Chinese site.',
      ],
    },
  }),
  def({
    id: 'volcengine-ark',
    vendor: 'volcengine',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    suggestedModel: 'doubao-seed-2-1-pro-260915',
    dialect: {
      maxTokensField: 'max_completion_tokens',
      extraBody: { thinking: { type: 'disabled' } },
    },
    source: 'https://www.volcengine.com/docs/82379/1298459',
    zh: {
      label: '火山方舟 · 豆包',
      notes: `数据面地址，API Key 鉴权。模型名填 Model ID 或接入点 ID（ep-…）。${THINK_ZH}`,
      limits: [
        'Coding Plan 套餐的地址和这里不同，用错地址会产生额外费用，请按官方套餐文档另行配置。',
        '模型名带日期快照，会更新，请以官方模型列表为准。',
        '国际版 BytePlus 的地址和 Key 与国内火山分开，这里只预置国内站。',
      ],
    },
    hant: {
      label: '火山方舟 · 豆包',
      notes: `資料面網址，API Key 驗證。模型名稱填 Model ID 或接入點 ID（ep-…）。${THINK_HANT}`,
      limits: [
        'Coding Plan 方案的網址和這裡不同，用錯網址會產生額外費用，請依官方方案文件另行設定。',
        '模型名稱帶日期快照，會更新，請以官方模型清單為準。',
        '國際版 BytePlus 的網址和 Key 與中國火山分開，這裡只預置中國站。',
      ],
    },
    en: {
      label: 'Volcengine Ark · Doubao',
      notes: `Data-plane address with API key auth. The model is a Model ID or an endpoint ID (ep-…). ${THINK_EN}`,
      limits: [
        'The Coding Plan uses a different address; using this one with it incurs extra charges, so configure it separately from the official plan docs.',
        'Model names carry date snapshots and change; follow the official model list.',
        'The international BytePlus site has its own address and keys; only the China site is preset here.',
      ],
    },
  }),
  def({
    id: 'zhipu-glm',
    vendor: 'zhipu',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    suggestedModel: 'glm-5.3',
    source: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
    zh: {
      label: '智谱 GLM（BigModel）',
      notes: '国内站 paas/v4 接口。',
      limits: [
        'GLM-5.3 默认开启思考且不能关闭，思考占用输出额度，请把输出长度放宽。',
        'GLM-5.3 只处理文本，不接受图片。',
        '国际站（Z.ai）地址不同，Key 是否互通文档没写，这里只预置国内站。',
      ],
    },
    hant: {
      label: '智譜 GLM（BigModel）',
      notes: '中國站 paas/v4 介面。',
      limits: [
        'GLM-5.3 預設開啟思考且不能關閉，思考佔用輸出額度，請把輸出長度放寬。',
        'GLM-5.3 只處理文字，不接受圖片。',
        '國際站（Z.ai）網址不同，Key 是否互通文件沒寫，這裡只預置中國站。',
      ],
    },
    en: {
      label: 'Zhipu GLM (BigModel)',
      notes: 'China-site paas/v4 API.',
      limits: [
        'GLM-5.3 thinks by default and cannot turn it off; thinking uses the output budget, so allow a longer output.',
        'GLM-5.3 handles text only and does not accept images.',
        'The international site (Z.ai) has a different address and the docs do not say whether keys are shared; only the China site is preset.',
      ],
    },
  }),
  def({
    id: 'moonshot-kimi',
    vendor: 'moonshot',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    suggestedModel: 'kimi-k3.1-pro',
    dialect: { maxTokensField: 'max_completion_tokens', extraBody: { reasoning_effort: 'low' } },
    source: 'https://platform.kimi.com/docs/api/chat',
    zh: {
      label: 'Moonshot Kimi（国内站）',
      notes: 'K3 系列思考始终开启、不能关闭，预设把思考强度降到 low（默认是 max）来缩短耗时。',
      limits: [
        '思考无法关闭，仍会占用一部分输出额度。',
        '旧的 K2.x 模型已标弃用，新用户不能再用。',
        '国际站（platform.kimi.ai）地址不同，这里只预置国内站。',
      ],
    },
    hant: {
      label: 'Moonshot Kimi（中國站）',
      notes: 'K3 系列思考始終開啟、不能關閉，預設值把思考強度降到 low（預設是 max）來縮短耗時。',
      limits: [
        '思考無法關閉，仍會佔用一部分輸出額度。',
        '舊的 K2.x 模型已標為棄用，新使用者不能再用。',
        '國際站（platform.kimi.ai）網址不同，這裡只預置中國站。',
      ],
    },
    en: {
      label: 'Moonshot Kimi (China site)',
      notes:
        'The K3 series always thinks and cannot turn it off; the preset lowers the thinking effort to low (the default is max) to cut latency.',
      limits: [
        'Thinking cannot be turned off and still uses part of the output budget.',
        'The older K2.x models are deprecated and closed to new users.',
        'The international site (platform.kimi.ai) has a different address; only the China site is preset.',
      ],
    },
  }),
  def({
    id: 'minimax-m',
    vendor: 'minimax',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://api.minimax.cn/v1',
    suggestedModel: 'MiniMax-M3',
    dialect: {
      maxTokensField: 'max_completion_tokens',
      jsonMode: 'prompt_only',
      extraBody: { thinking: { type: 'disabled' } },
    },
    source: 'https://platform.minimax.cn/docs/api-reference/text-openai-api',
    zh: {
      label: 'MiniMax（国内站）',
      notes: `OpenAI 兼容接口。${THINK_ZH}`,
      limits: [
        'MiniMax-M3.1-Flash 思考始终开启，关闭会返回 400：用它时请删掉额外请求体里的 thinking。',
        'temperature 和 top_p 被忽略。',
        '官方页面没写 response_format，所以 JSON 输出靠提示词加解析重试。',
        '国际站（api.minimax.io）地址不同，Key 是否互通文档没写。',
      ],
    },
    hant: {
      label: 'MiniMax（中國站）',
      notes: `OpenAI 相容介面。${THINK_HANT}`,
      limits: [
        'MiniMax-M3.1-Flash 思考始終開啟，關閉會回傳 400：使用它時請刪掉額外請求內容裡的 thinking。',
        'temperature 和 top_p 會被忽略。',
        '官方頁面沒寫 response_format，所以 JSON 輸出靠提示詞加解析重試。',
        '國際站（api.minimax.io）網址不同，Key 是否互通文件沒寫。',
      ],
    },
    en: {
      label: 'MiniMax (China site)',
      notes: `OpenAI-compatible API. ${THINK_EN}`,
      limits: [
        'MiniMax-M3.1-Flash always thinks and returns 400 if thinking is disabled: remove thinking from the extra body when using it.',
        'temperature and top_p are ignored.',
        'The official page does not document response_format, so JSON output relies on the prompt plus parse-and-retry.',
        'The international site (api.minimax.io) has a different address and the docs do not say whether keys are shared.',
      ],
    },
  }),
  def({
    id: 'siliconflow',
    vendor: 'siliconflow',
    region: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    suggestedModel: 'deepseek-ai/DeepSeek-V4-Flash',
    dialect: { extraBody: { enable_thinking: false } },
    source: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions',
    zh: {
      label: '硅基流动（国内站）',
      notes: `OpenAI 兼容接口，模型名带组织前缀。${THINK_ZH}`,
      limits: [
        'max_tokens 不含思维链，官方建议在上下文窗口下留出约 1 万 token 的余量。',
        '官方页面没写 stream_options，流式用量可能拿不到。',
        '国际站（siliconflow.com）地址不同，Key 是否互通文档没写。',
      ],
    },
    hant: {
      label: '矽基流動（中國站）',
      notes: `OpenAI 相容介面，模型名稱帶組織前綴。${THINK_HANT}`,
      limits: [
        'max_tokens 不含思維鏈，官方建議在上下文視窗下留出約 1 萬 token 的餘量。',
        '官方頁面沒寫 stream_options，串流用量可能拿不到。',
        '國際站（siliconflow.com）網址不同，Key 是否互通文件沒寫。',
      ],
    },
    en: {
      label: 'SiliconFlow (China site)',
      notes: `OpenAI-compatible API; model names carry an organization prefix. ${THINK_EN}`,
      limits: [
        'max_tokens excludes the chain of thought; the official docs advise leaving about 10k tokens of headroom below the context window.',
        'The official page does not document stream_options, so streamed usage may be missing.',
        'The international site (siliconflow.com) has a different address and the docs do not say whether keys are shared.',
      ],
    },
  }),
  def({
    id: 'openrouter',
    vendor: 'openrouter',
    region: 'global',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'anthropic/claude-sonnet-5.5',
    source: 'https://openrouter.ai/docs/api-reference/overview',
    zh: {
      label: 'OpenRouter（API Key）',
      notes:
        '一个 Key 访问多家厂商的模型，模型 id 是"组织/模型"。也可以用账号登录换取 Key，见"OpenRouter（账号登录）"。',
      limits: [
        '模型是否支持关闭思考、JSON 输出、图片因模型而异，预设没有预填额外请求体，需要时按模型自行添加。',
        '费用走你的 OpenRouter 余额。',
        '国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'OpenRouter（API Key）',
      notes:
        '一個 Key 存取多家廠商的模型，模型 id 是「組織/模型」。也可以用帳號登入換取 Key，見「OpenRouter（帳號登入）」。',
      limits: [
        '模型是否支援關閉思考、JSON 輸出、圖片因模型而異，預設值沒有預填額外請求內容，需要時依模型自行新增。',
        '費用算在你的 OpenRouter 餘額。',
        '在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'OpenRouter (API key)',
      notes:
        'One key for models from many vendors; model ids look like "organization/model". You can also sign in with an account to get a key: see "OpenRouter (account sign-in)".',
      limits: [
        'Whether a model can turn thinking off, return JSON or take images varies by model; the preset has no extra body, so add one per model when needed.',
        'Costs go against your OpenRouter credits.',
        'In some regions you may need your own proxy.',
      ],
    },
  }),
  def({
    id: 'openrouter-login',
    vendor: 'openrouter',
    region: 'global',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    suggestedModel: 'anthropic/claude-sonnet-5.5',
    auth: { type: 'account_login', channel: 'openrouter' },
    source: 'https://openrouter.ai/docs/guides/overview/auth/oauth',
    zh: {
      label: 'OpenRouter（账号登录）',
      notes:
        '用 OpenRouter 账号登录，授权后换回一把你自己的 OpenRouter API Key，存在本机，之后和 API Key 方式一样调用，不需要手动复制 Key。',
      limits: [
        '登录得到的是一把普通的 API Key，没有有效期和刷新；官方文档没有提供撤销接口，登出只清除本机的 Key，要作废它请到 OpenRouter 的 Key 管理页面。',
        '费用走你的 OpenRouter 余额，需要有账号和余额。',
        '授权回调用 localhost（官方文档只写了 localhost），登录只能在运行 dramai 的这台机器上完成。',
      ],
    },
    hant: {
      label: 'OpenRouter（帳號登入）',
      notes:
        '用 OpenRouter 帳號登入，授權後換回一把你自己的 OpenRouter API Key，存在本機，之後和 API Key 方式一樣呼叫，不需要手動複製 Key。',
      limits: [
        '登入得到的是一把一般的 API Key，沒有有效期限和更新；官方文件沒有提供撤銷介面，登出只清除本機的 Key，要作廢它請到 OpenRouter 的 Key 管理頁面。',
        '費用算在你的 OpenRouter 餘額，需要有帳號和餘額。',
        '授權回呼用 localhost（官方文件只寫了 localhost），登入只能在執行 dramai 的這台機器上完成。',
      ],
    },
    en: {
      label: 'OpenRouter (account sign-in)',
      notes:
        'Sign in with your OpenRouter account; after you approve, you get back a key of your own, stored on this machine and used exactly like an API key afterwards, with no copy and paste.',
      limits: [
        'The result is an ordinary API key with no expiry or refresh; the official documentation has no revocation endpoint, so signing out only removes the key from this machine. To invalidate it, use the key management page on OpenRouter.',
        'Costs go against your OpenRouter credits; an account and a balance are needed.',
        'The callback uses localhost (the only form the official docs mention), so sign-in can only be completed on the machine that runs dramai.',
      ],
    },
  }),
  def({
    id: '302ai-chat',
    vendor: '302ai',
    region: 'global',
    protocol: 'openai-chat',
    baseUrl: 'https://api.302.ai/v1',
    suggestedModel: 'gpt-4o-mini',
    source: 'https://doc.302.ai/147522039e0.md',
    zh: {
      label: '302.AI（对话）',
      notes: '聚合平台，模型名透传各家上游。和已有的 302.AI 生图、视频预设用同一个账号。',
      limits: [
        '默认模型名只是官方文档里的示例，请在 302.AI 的模型列表里换成你要用的文本模型。',
        '文本主力模型清单、关思考写法和 JSON 输出支持都随上游模型而异，官方文档没有逐一说明。',
        '国内环境用 api.302ai.com，Key 是否与海外互通文档没写。',
      ],
    },
    hant: {
      label: '302.AI（對話）',
      notes: '聚合平台，模型名稱透傳各家上游。和已有的 302.AI 生圖、影片預設用同一個帳號。',
      limits: [
        '預設模型名稱只是官方文件裡的範例，請在 302.AI 的模型清單裡換成你要用的文字模型。',
        '文字主力模型清單、關閉思考的寫法和 JSON 輸出支援都隨上游模型而異，官方文件沒有逐一說明。',
        '中國環境用 api.302ai.com，Key 是否與海外互通文件沒寫。',
      ],
    },
    en: {
      label: '302.AI (chat)',
      notes:
        'An aggregator: model names pass through to the upstream vendors. Uses the same account as the existing 302.AI image and video presets.',
      limits: [
        'The default model name is only the example from the official docs; replace it with the text model you want from the 302.AI model list.',
        'The main text models, how to turn thinking off and JSON support all depend on the upstream model, and the docs do not list them.',
        'The China environment uses api.302ai.com; the docs do not say whether keys are shared with the overseas one.',
      ],
    },
  }),
  def({
    id: 'ollama-local',
    vendor: 'ollama',
    region: 'local',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    suggestedModel: 'qwen3',
    auth: { type: 'none' },
    source: 'https://docs.ollama.com/api/openai-compatibility',
    zh: {
      label: 'Ollama（本机）',
      notes:
        '通过 OpenAI 兼容接口 /v1 调用本机的 Ollama，不需要 Key。模型要先在本机用 ollama pull 下载。',
      limits: [
        '需要先在本机启动 Ollama 服务并下载模型；模型名取自官方示例，请换成你已下载的模型。',
        '/v1 只支持 base64 图片，且思考内容的字段官方没写。',
        '云端 Ollama 需要 Key，不在这个预设里。',
      ],
    },
    hant: {
      label: 'Ollama（本機）',
      notes:
        '透過 OpenAI 相容介面 /v1 呼叫本機的 Ollama，不需要 Key。模型要先在本機用 ollama pull 下載。',
      limits: [
        '需要先在本機啟動 Ollama 服務並下載模型；模型名稱取自官方範例，請換成你已下載的模型。',
        '/v1 只支援 base64 圖片，且思考內容的欄位官方沒寫。',
        '雲端 Ollama 需要 Key，不在這個預設裡。',
      ],
    },
    en: {
      label: 'Ollama (local)',
      notes:
        'Calls a local Ollama through its OpenAI-compatible /v1 API; no key is needed. Pull the model first with ollama pull.',
      limits: [
        'Start the Ollama service and download a model first; the model name is the official example, so replace it with one you have pulled.',
        '/v1 only accepts base64 images, and the official docs do not name the thinking field.',
        'Ollama cloud needs a key and is not covered by this preset.',
      ],
    },
  }),
  def({
    id: 'lmstudio-local',
    vendor: 'lmstudio',
    region: 'local',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:1234/v1',
    suggestedModel: '',
    auth: { type: 'none' },
    dialect: { jsonMode: 'prompt_only' },
    source: 'https://lmstudio.ai/docs/developer/openai-compat',
    zh: {
      label: 'LM Studio（本机）',
      notes: '调用本机 LM Studio 的 OpenAI 兼容服务，不需要 Key。',
      limits: [
        '需要先在 LM Studio 里加载模型并启动本地服务；模型名要填 LM Studio 里显示的模型标识（可用"获取模型列表"选）。',
        '官方只文档化了 json_schema 形式的结构化输出，所以 JSON 输出靠提示词加解析重试。',
        '官方页面没写鉴权、图片请求格式和思考字段。',
      ],
    },
    hant: {
      label: 'LM Studio（本機）',
      notes: '呼叫本機 LM Studio 的 OpenAI 相容服務，不需要 Key。',
      limits: [
        '需要先在 LM Studio 裡載入模型並啟動本機服務；模型名稱要填 LM Studio 裡顯示的模型識別（可用「取得模型清單」選）。',
        '官方只文件化了 json_schema 形式的結構化輸出，所以 JSON 輸出靠提示詞加解析重試。',
        '官方頁面沒寫驗證、圖片請求格式和思考欄位。',
      ],
    },
    en: {
      label: 'LM Studio (local)',
      notes:
        'Calls the local LM Studio server through its OpenAI-compatible API; no key is needed.',
      limits: [
        'Load a model in LM Studio and start the local server first; enter the model identifier shown in LM Studio (the model list can help).',
        'The official docs only document structured output as json_schema, so JSON output relies on the prompt plus parse-and-retry.',
        'The official pages do not describe authentication, the image request format or the thinking field.',
      ],
    },
  }),
]
