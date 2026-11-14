import { def } from './presets-text.ts'
import type { ProviderPreset } from './presets.ts'

/**
 * 语音合成（TTS）服务商预设（P3d 第一批）：OpenAI、硅基流动（国内 / 国际）、MiniMax（国内 / 国际）、阿里 CosyVoice。
 * 和文本 / 生图 / 视频预设一样：**全部是"按官方文档接入、未实测"**，带官方文档出处，不会自动成为当前选择。
 * 依据：设计文档 research/TTS_PROTOCOL_DESIGN.md，实现前逐家读了官方页面（2026-11-13）。
 * 每个建议型号在 `data/models/models.json` 里有画像（音色清单、单次文本上限、价目）：没实测过的能力一律标"未验证"。
 */

export const AUDIO_PRESETS: readonly ProviderPreset[] = [
  def({
    id: 'openai-tts-key',
    kind: 'tts',
    vendor: 'openai',
    region: 'global',
    protocol: 'openai-tts',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModel: 'gpt-4o-mini-tts',
    source:
      'https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create',
    zh: {
      label: 'OpenAI · 语音合成（API Key）',
      notes:
        'OpenAI 官方 /audio/speech，API Key 鉴权。默认型号 gpt-4o-mini-tts，支持用自然语言写的风格指令；tts-1 / tts-1-hd 也可以在型号里改。内置 13 个音色（alloy、ash、ballad、coral、echo、fable、onyx、nova、sage、shimmer、verse、marin、cedar）。',
      limits: [
        '官方：tts-1、tts-1-hd、gpt-4o-mini-tts 都计划在 2027-01-06 关停，官方建议迁移到 Realtime API 的 gpt-realtime-2.1-mini；长期使用请另做打算。',
        '单次输入最多 4096 字符，超过的旁白会在生成前被拦下。',
        '音色以英语优化，中文旁白的效果没有验证；自定义音色（克隆）只对受限开通的账号开放，这一版不支持。',
        'gpt-4o-mini-tts 按 token 计价，这里没有估价。国内网络通常需要自备代理。',
      ],
    },
    hant: {
      label: 'OpenAI · 語音合成（API Key）',
      notes:
        'OpenAI 官方 /audio/speech，API Key 驗證。預設型號 gpt-4o-mini-tts，支援用自然語言寫的風格指令；tts-1 / tts-1-hd 也可以在型號裡改。內建 13 個音色（alloy、ash、ballad、coral、echo、fable、onyx、nova、sage、shimmer、verse、marin、cedar）。',
      limits: [
        '官方：tts-1、tts-1-hd、gpt-4o-mini-tts 都預計在 2027-01-06 停用，官方建議遷移到 Realtime API 的 gpt-realtime-2.1-mini；長期使用請另做打算。',
        '單次輸入最多 4096 字元，超過的旁白會在產生前被擋下。',
        '音色以英語最佳化，中文旁白的效果尚未驗證；自訂音色（複製）只對受限開通的帳號開放，這一版不支援。',
        'gpt-4o-mini-tts 依 token 計價，這裡沒有估價。在部分地區可能需要自備代理。',
      ],
    },
    en: {
      label: 'OpenAI · speech (API key)',
      notes:
        'The official OpenAI /audio/speech, API key. The default model is gpt-4o-mini-tts, which takes a style instruction in plain language; tts-1 / tts-1-hd can be set in the model field. 13 built-in voices (alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar).',
      limits: [
        'Official: tts-1, tts-1-hd and gpt-4o-mini-tts are scheduled to shut down on 2027-01-06; OpenAI recommends the Realtime API model gpt-realtime-2.1-mini. Plan for a replacement if you need this long term.',
        'At most 4096 characters per request; a longer narration is stopped before generation.',
        'Voices are optimised for English; how Chinese narration sounds is unverified. Custom (cloned) voices are limited to approved accounts and are not supported in this version.',
        'gpt-4o-mini-tts is priced per token, so no estimate is shown. You may need your own proxy in some regions.',
      ],
    },
  }),
  def({
    id: 'siliconflow-tts-cn',
    kind: 'tts',
    vendor: 'siliconflow',
    region: 'cn',
    protocol: 'openai-tts',
    baseUrl: 'https://api.siliconflow.cn/v1',
    suggestedModel: 'FunAudioLLM/CosyVoice2-0.5B',
    source: 'https://docs.siliconflow.cn/docs/api/audio-speech-post',
    zh: {
      label: '硅基流动 · 语音合成（国内站）',
      notes:
        '硅基流动的 OpenAI 兼容 /audio/speech。默认型号 FunAudioLLM/CosyVoice2-0.5B，支持中英日韩和粤语、四川话等方言；音色要写成“模型名:音色名”，如 FunAudioLLM/CosyVoice2-0.5B:alex（8 个系统音色：alex、benjamin、charles、david、anna、bella、claire、diana）。',
      limits: [
        '音色写法不对（没有“模型名:”前缀）会在生成前被拦下。上传参考音频得到的 speech:… 地址也可以手填，但这一版没有上传通道。',
        '单次输入最多 128000 字符。按输入文本的 UTF-8 字节数计费，官方页面没有写单价，这里没有估价。',
        '官方提醒：支持的语音型号会变化，以平台“语音”标签下的列表为准；fish-speech 系列只能用账户余额付费。',
        '风格 / 方言指令要写在输入文本前面并用 <|endofprompt|> 隔开，这一版不会自动拼接。',
      ],
    },
    hant: {
      label: '矽基流動 · 語音合成（中國站）',
      notes:
        '矽基流動的 OpenAI 相容 /audio/speech。預設型號 FunAudioLLM/CosyVoice2-0.5B，支援中英日韓與粵語、四川話等方言；音色要寫成「型號名:音色名」，如 FunAudioLLM/CosyVoice2-0.5B:alex（8 個系統音色：alex、benjamin、charles、david、anna、bella、claire、diana）。',
      limits: [
        '音色寫法不對（沒有「型號名:」前綴）會在產生前被擋下。上傳參考音訊得到的 speech:… 位址也可以手填，但這一版沒有上傳通道。',
        '單次輸入最多 128000 字元。依輸入文字的 UTF-8 位元組數計費，官方頁面沒有寫單價，這裡沒有估價。',
        '官方提醒：支援的語音型號會變動，以平台「語音」標籤下的清單為準；fish-speech 系列只能用帳戶餘額付費。',
        '風格 / 方言指令要寫在輸入文字前面並用 <|endofprompt|> 隔開，這一版不會自動串接。',
      ],
    },
    en: {
      label: 'SiliconFlow · speech (China site)',
      notes:
        'SiliconFlow OpenAI-compatible /audio/speech. The default model is FunAudioLLM/CosyVoice2-0.5B (Chinese, English, Japanese, Korean and dialects such as Cantonese and Sichuanese). A voice is written as "model:name", e.g. FunAudioLLM/CosyVoice2-0.5B:alex (8 system voices: alex, benjamin, charles, david, anna, bella, claire, diana).',
      limits: [
        'A voice without the "model:" prefix is stopped before generation. A speech:… address from an uploaded reference audio can be typed in, but this version has no upload channel.',
        'At most 128000 characters per request. Billing is by the UTF-8 byte count of the input; the official page lists no price, so no estimate is shown.',
        'Official: the supported speech models change - use the "Speech" tag on the models page for the current list; fish-speech models can only be paid from the account balance.',
        'A style or dialect instruction goes in front of the input text, separated by <|endofprompt|>; this version does not add it for you.',
      ],
    },
  }),
  def({
    id: 'siliconflow-tts-global',
    kind: 'tts',
    vendor: 'siliconflow',
    region: 'global',
    protocol: 'openai-tts',
    baseUrl: 'https://api.siliconflow.com/v1',
    suggestedModel: 'FunAudioLLM/CosyVoice2-0.5B',
    source: 'https://docs.siliconflow.com/en/userguide/capabilities/text-to-speech',
    zh: {
      label: '硅基流动 · 语音合成（国际站）',
      notes:
        '硅基流动国际站的 OpenAI 兼容 /audio/speech，请求与国内站相同。默认型号 FunAudioLLM/CosyVoice2-0.5B；音色写成“模型名:音色名”。',
      limits: [
        '国际站与国内站的账号和 Key 按不互通处理（官方没写）。',
        '音色写法、长度上限、计费方式与国内站相同，见国内站预设的说明；官方页面没有单价，这里没有估价。',
      ],
    },
    hant: {
      label: '矽基流動 · 語音合成（國際站）',
      notes:
        '矽基流動國際站的 OpenAI 相容 /audio/speech，請求與中國站相同。預設型號 FunAudioLLM/CosyVoice2-0.5B；音色寫成「型號名:音色名」。',
      limits: [
        '國際站與中國站的帳號和 Key 按不互通處理（官方沒寫）。',
        '音色寫法、長度上限、計費方式與中國站相同，見中國站預設的說明；官方頁面沒有單價，這裡沒有估價。',
      ],
    },
    en: {
      label: 'SiliconFlow · speech (international site)',
      notes:
        'The international SiliconFlow OpenAI-compatible /audio/speech; the request is the same as on the China site. The default model is FunAudioLLM/CosyVoice2-0.5B; a voice is written as "model:name".',
      limits: [
        'Accounts and keys of the international and China sites are treated as separate (the docs do not say).',
        'Voice spelling, length limit and billing are the same as on the China site (see that preset); the official page lists no price, so no estimate is shown.',
      ],
    },
  }),
  def({
    id: 'minimax-tts-cn',
    kind: 'tts',
    vendor: 'minimax',
    region: 'cn',
    protocol: 'minimax-t2a',
    baseUrl: 'https://api.minimax.cn/v1',
    suggestedModel: 'speech-2.8-hd',
    source: 'https://platform.minimax.cn/docs/api-reference/speech-t2a-http',
    zh: {
      label: 'MiniMax · 语音合成（国内站）',
      notes:
        'MiniMax 同步语音合成（t2a_v2）。默认型号 speech-2.8-hd；speech-2.8-turbo 更便宜。音色填 voice_id（系统音色约 300 个，如 Chinese (Mandarin)_News_Anchor），克隆音色也直接填 voice_id。',
      limits: [
        '单次文本须小于 10000 字符，超过的旁白会在生成前被拦下；语速 0.5–2。',
        '官方：HTTP 200 的响应也可能是失败（看 base_resp.status_code）；音频是十六进制字符串，这里解码成字节后保存。',
        '价格：2.8 HD 3.50 元 / 万字符、2.8 Turbo 2.00 元 / 万字符；官方：1 个汉字计 2 个字符，所以估价是区间，纯中文旁白看上限。',
        '风格指令没有对应字段（情绪只有固定枚举，这一版不发）；克隆音色 7 天内没被使用会被官方删除。',
        '国内站的接口地址以官方国内文档为准（api.minimax.cn），旧域名 api.minimaxi.com 是否可用没有核实；国内外 Key 按不互通处理。',
      ],
    },
    hant: {
      label: 'MiniMax · 語音合成（中國站）',
      notes:
        'MiniMax 同步語音合成（t2a_v2）。預設型號 speech-2.8-hd；speech-2.8-turbo 更便宜。音色填 voice_id（系統音色約 300 個，如 Chinese (Mandarin)_News_Anchor），複製音色也直接填 voice_id。',
      limits: [
        '單次文字須小於 10000 字元，超過的旁白會在產生前被擋下；語速 0.5–2。',
        '官方：HTTP 200 的回應也可能是失敗（看 base_resp.status_code）；音訊是十六進位字串，這裡解碼成位元組後儲存。',
        '價格：2.8 HD 3.50 元 / 萬字元、2.8 Turbo 2.00 元 / 萬字元；官方：1 個漢字計 2 個字元，所以估價是區間，純中文旁白看上限。',
        '風格指令沒有對應欄位（情緒只有固定列舉，這一版不發）；複製音色 7 天內沒被使用會被官方刪除。',
        '中國站的介面位址以官方中國站文件為準（api.minimax.cn），舊網域 api.minimaxi.com 是否可用尚未核實；中國站與國際站的 Key 按不互通處理。',
      ],
    },
    en: {
      label: 'MiniMax · speech (China site)',
      notes:
        'MiniMax synchronous speech (t2a_v2). The default model is speech-2.8-hd; speech-2.8-turbo is cheaper. A voice is a voice_id (about 300 system voices, e.g. Chinese (Mandarin)_News_Anchor); cloned voices are typed in as voice_id too.',
      limits: [
        'Text must be under 10000 characters per request; a longer narration is stopped before generation. Speed 0.5-2.',
        'Official: an HTTP 200 response can still be a failure (see base_resp.status_code); the audio is a hex string, decoded to bytes before saving.',
        'Prices: 2.8 HD 3.50 CNY / 10k characters, 2.8 Turbo 2.00 CNY / 10k; officially one Chinese character counts as 2, so the estimate is a range - for pure Chinese narration read the upper end.',
        'There is no field for a style instruction (emotion is a fixed list, not sent in this version); the official service deletes a cloned voice that is not used for 7 days.',
        'The address follows the official China-site docs (api.minimax.cn); whether the old domain api.minimaxi.com still works is unverified; China and international keys are treated as separate.',
      ],
    },
  }),
  def({
    id: 'minimax-tts-global',
    kind: 'tts',
    vendor: 'minimax',
    region: 'global',
    protocol: 'minimax-t2a',
    baseUrl: 'https://api.minimax.io/v1',
    suggestedModel: 'speech-2.8-hd',
    source: 'https://platform.minimax.io/docs/api-reference/speech-t2a-http',
    zh: {
      label: 'MiniMax · 语音合成（国际站）',
      notes: 'MiniMax 国际站的同步语音合成（t2a_v2），请求与国内站相同。默认型号 speech-2.8-hd。',
      limits: [
        '价格：2.8 HD $100 / 1M 字符、2.8 Turbo $60 / 1M 字符；国际站页面没有写字符怎么数。',
        '单次文本、语速、响应形态、克隆音色的规则与国内站相同，见国内站预设的说明；国内外 Key 按不互通处理。',
      ],
    },
    hant: {
      label: 'MiniMax · 語音合成（國際站）',
      notes: 'MiniMax 國際站的同步語音合成（t2a_v2），請求與中國站相同。預設型號 speech-2.8-hd。',
      limits: [
        '價格：2.8 HD $100 / 1M 字元、2.8 Turbo $60 / 1M 字元；國際站頁面沒有寫字元怎麼數。',
        '單次文字、語速、回應形態、複製音色的規則與中國站相同，見中國站預設的說明；中國站與國際站的 Key 按不互通處理。',
      ],
    },
    en: {
      label: 'MiniMax · speech (international site)',
      notes:
        'The international MiniMax synchronous speech (t2a_v2); the request is the same as on the China site. The default model is speech-2.8-hd.',
      limits: [
        'Prices: 2.8 HD $100 / 1M characters, 2.8 Turbo $60 / 1M; the international page does not say how characters are counted.',
        'Text limit, speed, response form and cloned voices work as on the China site (see that preset); China and international keys are treated as separate.',
      ],
    },
  }),
  def({
    id: 'aliyun-cosyvoice-cn',
    kind: 'tts',
    vendor: 'aliyun',
    region: 'cn',
    protocol: 'dashscope-cosyvoice',
    baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'cosyvoice-v3-flash',
    source: 'https://help.aliyun.com/zh/model-studio/cosyvoice-tts-http-api',
    zh: {
      label: '阿里云百炼 · CosyVoice 语音合成（国内站）',
      notes:
        '百炼 CosyVoice 的 HTTP 非实时接口（北京地域）。地址里的 {WorkspaceId} 要换成你的业务空间 ID，模型、地址、Key 必须同一地域。默认型号 cosyvoice-v3-flash；音色填 voice，如 longanyang（龙安洋）、longanhuan（龙安欢），还有粤语、东北话、陕西话等方言音色。',
      limits: [
        '官方 HTTP 页只写了北京地域，所以只有国内站预设；新加坡地域只有 WebSocket 形态的文档，这一版不做。',
        'cosyvoice-v3.5 系列没有系统音色，只能用声音复刻 / 设计得到的音色，需要先在百炼控制台创建后手填 voice；v3-plus 只有 longanyang、longanhuan 两个系统音色。',
        '风格 / 方言 / 情绪指令最多 100 个字符，汉字算 2 个，超过会在生成前被拦下。',
        '成品是 24 小时有效的链接，生成成功后会立即下载保存。官方页面没有写单次文本长度上限和错误响应的结构，这里没有核实。',
        '价格：cosyvoice-v3-flash 北京 1 元 / 万字符；其他型号的单价没有在官方页面核对，这里没有估价。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · CosyVoice 語音合成（中國站）',
      notes:
        '百煉 CosyVoice 的 HTTP 非即時介面（北京地域）。位址裡的 {WorkspaceId} 要換成你的業務空間 ID，型號、位址、Key 必須同一地域。預設型號 cosyvoice-v3-flash；音色填 voice，如 longanyang（龍安洋）、longanhuan（龍安歡），還有粵語、東北話、陝西話等方言音色。',
      limits: [
        '官方 HTTP 頁只寫了北京地域，所以只有中國站預設；新加坡地域只有 WebSocket 形態的文件，這一版不做。',
        'cosyvoice-v3.5 系列沒有系統音色，只能用聲音複刻 / 設計得到的音色，需要先在百煉控制台建立後手填 voice；v3-plus 只有 longanyang、longanhuan 兩個系統音色。',
        '風格 / 方言 / 情緒指令最多 100 個字元，漢字算 2 個，超過會在產生前被擋下。',
        '成品是 24 小時有效的連結，產生成功後會立即下載儲存。官方頁面沒有寫單次文字長度上限和錯誤回應的結構，這裡尚未核實。',
        '價格：cosyvoice-v3-flash 北京 1 元 / 萬字元；其他型號的單價沒有在官方頁面核對，這裡沒有估價。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · CosyVoice speech (China site)',
      notes:
        'The Model Studio CosyVoice HTTP non-streaming API (Beijing region). Replace {WorkspaceId} in the address with your workspace ID; model, address and key must be in the same region. The default model is cosyvoice-v3-flash; a voice is a voice value such as longanyang or longanhuan, plus dialect voices (Cantonese, Northeastern, Shaanxi...).',
      limits: [
        'The official HTTP page only lists the Beijing region, so there is only a China-site preset; the Singapore region is documented only for WebSocket, which this version does not use.',
        'The cosyvoice-v3.5 models have no system voices - only cloned or designed voices, which you create in the console first and type in as the voice; v3-plus has only two system voices, longanyang and longanhuan.',
        'A style / dialect / emotion instruction is limited to 100 characters, a Chinese character counting as 2; a longer one is stopped before generation.',
        'The result is a link valid for 24 hours and is downloaded and saved as soon as it succeeds. The official page states neither a text length limit nor the error response shape; these are unverified.',
        'Prices: cosyvoice-v3-flash 1 CNY / 10k characters in Beijing; other models were not checked on the official pages, so no estimate is shown.',
      ],
    },
  }),
]
