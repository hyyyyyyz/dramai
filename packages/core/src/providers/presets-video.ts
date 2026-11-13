import { def } from './presets-text.ts'
import type { ProviderPreset } from './presets.ts'

/**
 * 视频生成服务商预设（P3c 第一批）：火山方舟 Seedance、BytePlus Seedance、可灵 4.0、通义万相 3.0。
 * 和文本 / 生图预设一样：**全部是"按官方文档接入、未实测"**，带官方文档出处，不会自动成为当前选择。
 * 已实测的 302.AI 通义万相 Wan2.2 Flash 预设（`302-i2v-wan-flash`）一字不改。
 * 依据：设计文档 research/VIDEO_PROTOCOL_DESIGN.md，实现前逐家再读了官方页面（2026-11-13）。
 * 每个建议型号在 `data/models/models.json` 里都有画像：没实测过的能力一律标"未验证"。
 */

export const VIDEO_PRESETS: readonly ProviderPreset[] = [
  def({
    id: 'volcengine-seedance',
    kind: 'video',
    vendor: 'volcengine',
    region: 'cn',
    protocol: 'ark-video',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    suggestedModel: 'doubao-seedance-2-0-260128',
    source: 'https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh',
    zh: {
      label: '火山方舟 · Seedance 视频（国内站）',
      notes:
        '方舟官方视频生成接口：文生视频、首帧、首尾帧、多张参考图。默认型号是 Seedance 2.0；2.5（doubao-seedance-2-5-260628）最多 30 张参考图、单次最长 30 秒，2.0 fast / mini 更便宜，都可以在型号里改。',
      limits: [
        '首帧、首尾帧、参考图是互斥的三种任务：开启参考图后，镜头图只能作为第 1 张参考图，不再是严格的首帧。',
        '官方：Seedance 2.5 / 2.0 不接受含真人人脸的参考图（预置数字人库、本账号 30 天内由 Seedance / Seedream 5 生成的原始产物除外）；被拦时返回 InputImageSensitiveContentDetected.PrivacyInformation。插画 / 动漫角色是否会被拦没有验证，压缩过的副本是否还算“原始产物”也没有验证。',
        '结果地址 24 小时有效（2.5 每个地址最多下载 100 次），任务号 7 天；生成成功后会立即下载保存。',
        '开通 2.5 / 2.0 需要账户余额超过 200 元，或购买节省计划 / 资源包。按 token 计价，这里没有估价。',
        '这一版不传参考视频和参考音频（本地文件没有上传通道）。',
      ],
    },
    hant: {
      label: '火山方舟 · Seedance 影片（中國站）',
      notes:
        '方舟官方影片生成介面：文字生影片、首影格、首尾影格、多張參考圖。預設型號是 Seedance 2.0；2.5（doubao-seedance-2-5-260628）最多 30 張參考圖、單次最長 30 秒，2.0 fast / mini 更便宜，都可以在型號裡改。',
      limits: [
        '首影格、首尾影格、參考圖是互斥的三種任務：開啟參考圖後，鏡頭圖只能作為第 1 張參考圖，不再是嚴格的首影格。',
        '官方：Seedance 2.5 / 2.0 不接受含真人臉孔的參考圖（預置數位人庫、本帳號 30 天內由 Seedance / Seedream 5 產生的原始產出除外）；被攔時回傳 InputImageSensitiveContentDetected.PrivacyInformation。插畫 / 動漫角色是否會被攔尚未驗證，壓縮過的副本是否還算「原始產出」也尚未驗證。',
        '結果網址 24 小時有效（2.5 每個網址最多下載 100 次），任務編號 7 天；產生成功後會立即下載儲存。',
        '開通 2.5 / 2.0 需要帳戶餘額超過 200 元，或購買節省計畫 / 資源包。依 token 計價，這裡沒有估價。',
        '這一版不傳參考影片與參考音訊（本機檔案沒有上傳通道）。',
      ],
    },
    en: {
      label: 'Volcengine Ark · Seedance video (China site)',
      notes:
        'The official Ark video API: text to video, first frame, first and last frame, several reference images. The default model is Seedance 2.0; 2.5 (doubao-seedance-2-5-260628) takes up to 30 reference images and up to 30 seconds, and 2.0 fast / mini are cheaper - change the model to pick them.',
      limits: [
        'First frame, first and last frame, and reference images are three mutually exclusive task types: with reference images on, the shot image can only be the first reference image, not a strict first frame.',
        'Official: Seedance 2.5 / 2.0 refuse reference images that contain a real human face (except the preset digital-human library and original outputs of Seedance / Seedream 5 from the same account in the last 30 days); a block returns InputImageSensitiveContentDetected.PrivacyInformation. Whether illustrated or anime characters are blocked, and whether a compressed copy still counts as an original output, are unverified.',
        'Result URLs are valid for 24 hours (2.5: at most 100 downloads per URL) and task IDs for 7 days; the video is downloaded and saved as soon as it succeeds.',
        'Opening 2.5 / 2.0 needs an account balance above 200 CNY or a savings plan / resource package. Pricing is per token; no estimate is shown here.',
        'Reference videos and reference audio are not sent in this version (local files have no upload channel).',
      ],
    },
  }),
  def({
    id: 'byteplus-seedance',
    kind: 'video',
    vendor: 'byteplus',
    region: 'global',
    protocol: 'ark-video',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    suggestedModel: 'dreamina-seedance-2-0-260128',
    source: 'https://docs.byteplus.com/en/docs/modelark/seedance-portrait-asset-guide',
    zh: {
      label: 'BytePlus ModelArk · Seedance 视频（国际站）',
      notes:
        '方舟的国际站（BytePlus），请求体与国内站相同，型号名是 dreamina-seedance-…。默认型号是 Seedance 2.0；2.5 是 dreamina-seedance-2-5-260628（型号 ID 来自调研，没有在官方页面核对）。',
      limits: [
        '首帧、首尾帧、参考图是互斥的三种任务：开启参考图后，镜头图只能作为第 1 张参考图，不再是严格的首帧。',
        '官方：Seedance 2.5 / 2.0 不接受含真人人脸的参考图（预置数字人库、本账号 30 天内的 Seedance / Seedream 5 原始产物除外）；被拦时返回 InputImageSensitiveContentDetected.PrivacyInformation。插画 / 动漫角色是否会被拦没有验证。',
        '国际站账号与国内站的 Key 不互通（按不互通处理）；国际站的价格页没有读到，这里没有估价。',
        '结果地址 24 小时有效，任务号 7 天；生成成功后会立即下载保存。这一版不传参考视频和参考音频。',
      ],
    },
    hant: {
      label: 'BytePlus ModelArk · Seedance 影片（國際站）',
      notes:
        '方舟的國際站（BytePlus），請求內容與中國站相同，型號名是 dreamina-seedance-…。預設型號是 Seedance 2.0；2.5 是 dreamina-seedance-2-5-260628（型號 ID 來自調研，沒有在官方頁面核對）。',
      limits: [
        '首影格、首尾影格、參考圖是互斥的三種任務：開啟參考圖後，鏡頭圖只能作為第 1 張參考圖，不再是嚴格的首影格。',
        '官方：Seedance 2.5 / 2.0 不接受含真人臉孔的參考圖（預置數位人庫、本帳號 30 天內的 Seedance / Seedream 5 原始產出除外）；被攔時回傳 InputImageSensitiveContentDetected.PrivacyInformation。插畫 / 動漫角色是否會被攔尚未驗證。',
        '國際站帳號與中國站的 Key 不互通（按不互通處理）；國際站的價格頁沒有讀到，這裡沒有估價。',
        '結果網址 24 小時有效，任務編號 7 天；產生成功後會立即下載儲存。這一版不傳參考影片與參考音訊。',
      ],
    },
    en: {
      label: 'BytePlus ModelArk · Seedance video (international)',
      notes:
        'The international site of Ark (BytePlus); the request body is the same as the China site and the model names are dreamina-seedance-…. The default model is Seedance 2.0; 2.5 is dreamina-seedance-2-5-260628 (that ID comes from the survey and was not checked on an official page).',
      limits: [
        'First frame, first and last frame, and reference images are three mutually exclusive task types: with reference images on, the shot image can only be the first reference image, not a strict first frame.',
        'Official: Seedance 2.5 / 2.0 refuse reference images that contain a real human face (except the preset digital-human library and original outputs of Seedance / Seedream 5 from the same account in the last 30 days); a block returns InputImageSensitiveContentDetected.PrivacyInformation. Whether illustrated or anime characters are blocked is unverified.',
        'Accounts and keys are treated as not shared with the China site; the international price page could not be read, so no estimate is shown.',
        'Result URLs are valid for 24 hours and task IDs for 7 days; the video is downloaded and saved as soon as it succeeds. Reference videos and audio are not sent in this version.',
      ],
    },
  }),
  def({
    id: 'kling-video-cn',
    kind: 'video',
    vendor: 'kling',
    region: 'cn',
    protocol: 'kling-contents',
    baseUrl: 'https://api-beijing.klingai.com',
    suggestedModel: 'kling-4.0',
    source: 'https://klingai.com/document-api/api/get-started/authentication',
    zh: {
      label: '可灵 4.0 视频（国内站，API Key）',
      notes:
        '可灵新接口（Kling 4.0 / 4.0 Flash）：文生视频、首帧、首尾帧、多张参考图，首帧可以和参考图同时用。Flash 更便宜，但只有 720p、最长 20 秒。',
      limits: [
        '无法关闭原生音频（官方 Omni 的音频选项只有 native / original）：不需要人声的镜头，成片合成时会把视频自带的声音静音。',
        '结果地址是防盗链地址，保留 30 天，生成成功后会立即下载保存；并发按账号和型号计，超过上限返回 1303。',
        '新接口的 base64 是否带 data: 前缀文档没写，这里先发不带前缀的；首帧与参考图同发的效果没有验证。',
        '国内站只核对了鉴权页的域名（api-beijing.klingai.com），各接口路径与国际站相同是推断；价格按资源包“单位”计，这里没有估价。',
        '这一版不支持主体库（element）、音色、参考视频和多镜头。',
      ],
    },
    hant: {
      label: '可靈 4.0 影片（中國站，API Key）',
      notes:
        '可靈新介面（Kling 4.0 / 4.0 Flash）：文字生影片、首影格、首尾影格、多張參考圖，首影格可以和參考圖同時使用。Flash 更便宜，但只有 720p、最長 20 秒。',
      limits: [
        '無法關閉原生音訊（官方 Omni 的音訊選項只有 native / original）：不需要人聲的鏡頭，成片合成時會把影片自帶的聲音靜音。',
        '結果網址是防盜連網址，保留 30 天，產生成功後會立即下載儲存；並行數依帳號和型號計算，超過上限回傳 1303。',
        '新介面的 base64 是否帶 data: 前綴文件沒寫，這裡先傳不帶前綴的；首影格與參考圖同時傳送的效果尚未驗證。',
        '中國站只核對了驗證頁的網域（api-beijing.klingai.com），各介面路徑與國際站相同是推斷；價格依資源包「單位」計算，這裡沒有估價。',
        '這一版不支援主體庫（element）、音色、參考影片與多鏡頭。',
      ],
    },
    en: {
      label: 'Kling 4.0 video (China site, API key)',
      notes:
        'The new Kling interface (Kling 4.0 / 4.0 Flash): text to video, first frame, first and last frame, several reference images; the first frame can be used together with reference images. Flash is cheaper but only offers 720p and up to 20 seconds.',
      limits: [
        'Native audio cannot be switched off (the official Omni audio options are only native / original): for shots that should not carry model voice, the sound the video comes with is muted when the cut is composed.',
        'Result URLs are hotlink-protected and kept for 30 days; the video is downloaded and saved as soon as it succeeds. Concurrency is counted per account and model; above the limit the API returns 1303.',
        'The new docs do not say whether base64 should carry a data: prefix, so it is sent without one for now; first frame plus reference images in one request is unverified.',
        'Only the host on the authentication page was checked for the China site (api-beijing.klingai.com); that the endpoint paths equal the international ones is an inference. Prices are per resource-pack unit; no estimate is shown here.',
        'Elements (subject library), voices, reference videos and multi-shot are not supported in this version.',
      ],
    },
  }),
  def({
    id: 'kling-video-global',
    kind: 'video',
    vendor: 'kling',
    region: 'global',
    protocol: 'kling-contents',
    baseUrl: 'https://api-singapore.klingai.com',
    suggestedModel: 'kling-4.0',
    source: 'https://kling.ai/document-api/api/video/4-0/video-omni',
    zh: {
      label: '可灵 4.0 视频（国际站，API Key）',
      notes:
        '可灵新接口（Kling 4.0 / 4.0 Flash）：文生视频、首帧、首尾帧、多张参考图，首帧可以和参考图同时用。Flash 更便宜，但只有 720p、最长 20 秒。',
      limits: [
        '无法关闭原生音频（官方 Omni 的音频选项只有 native / original）：不需要人声的镜头，成片合成时会把视频自带的声音静音。',
        '结果地址是防盗链地址，保留 30 天，生成成功后会立即下载保存；并发按账号和型号计，超过上限返回 1303。',
        '新接口的 base64 是否带 data: 前缀文档没写，这里先发不带前缀的；首帧与参考图同发的效果没有验证。',
        '国内站与国际站的账号 / Key 是否互通文档没写，按不互通处理；价格按资源包“单位”计，这里没有估价。',
        '这一版不支持主体库（element）、音色、参考视频和多镜头。',
      ],
    },
    hant: {
      label: '可靈 4.0 影片（國際站，API Key）',
      notes:
        '可靈新介面（Kling 4.0 / 4.0 Flash）：文字生影片、首影格、首尾影格、多張參考圖，首影格可以和參考圖同時使用。Flash 更便宜，但只有 720p、最長 20 秒。',
      limits: [
        '無法關閉原生音訊（官方 Omni 的音訊選項只有 native / original）：不需要人聲的鏡頭，成片合成時會把影片自帶的聲音靜音。',
        '結果網址是防盜連網址，保留 30 天，產生成功後會立即下載儲存；並行數依帳號和型號計算，超過上限回傳 1303。',
        '新介面的 base64 是否帶 data: 前綴文件沒寫，這裡先傳不帶前綴的；首影格與參考圖同時傳送的效果尚未驗證。',
        '中國站與國際站的帳號 / Key 是否互通文件沒寫，按不互通處理；價格依資源包「單位」計算，這裡沒有估價。',
        '這一版不支援主體庫（element）、音色、參考影片與多鏡頭。',
      ],
    },
    en: {
      label: 'Kling 4.0 video (international, API key)',
      notes:
        'The new Kling interface (Kling 4.0 / 4.0 Flash): text to video, first frame, first and last frame, several reference images; the first frame can be used together with reference images. Flash is cheaper but only offers 720p and up to 20 seconds.',
      limits: [
        'Native audio cannot be switched off (the official Omni audio options are only native / original): for shots that should not carry model voice, the sound the video comes with is muted when the cut is composed.',
        'Result URLs are hotlink-protected and kept for 30 days; the video is downloaded and saved as soon as it succeeds. Concurrency is counted per account and model; above the limit the API returns 1303.',
        'The new docs do not say whether base64 should carry a data: prefix, so it is sent without one for now; first frame plus reference images in one request is unverified.',
        'The docs do not say whether accounts and keys are shared between the China and international sites, so they are treated as separate; prices are per resource-pack unit and no estimate is shown here.',
        'Elements (subject library), voices, reference videos and multi-shot are not supported in this version.',
      ],
    },
  }),
  def({
    id: 'aliyun-wan3-cn',
    kind: 'video',
    vendor: 'aliyun',
    region: 'cn',
    protocol: 'dashscope-video',
    baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'wan3.0-video',
    source: 'https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference',
    zh: {
      label: '阿里云百炼 · 通义万相 3.0 视频（国内站）',
      notes:
        '万相 3.0 新接口：文生视频、首帧、首尾帧、最多 10 张参考图，单次最长 30 秒。wan3.0-video-prime 是高速版。按秒计价（北京地域，wan3.0-video 720P 0.6 元/秒，官方标“限时7折”，所列为原价）。',
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID；模型、地址、API Key 必须同一地域，国际站和国内站不能混用。',
        '首帧、尾帧和参考图互斥：开启参考图后，镜头图只能作为第 1 张参考图，不再是严格的首帧。',
        '任务号和结果地址只保留 24 小时，过期后查询返回 UNKNOWN（按失败处理）；生成成功后会立即下载保存。',
        '官方：提示词智能改写默认开启，它是否会改写掉提示词里的“图1”引用没有验证。',
        '这一版不传参考视频和参考音频（官方只收公网地址或 oss:// 临时地址，本地文件没有上传通道）。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · 通義萬相 3.0 影片（中國站）',
      notes:
        '萬相 3.0 新介面：文字生影片、首影格、首尾影格、最多 10 張參考圖，單次最長 30 秒。wan3.0-video-prime 是高速版。依秒計價（北京地域，wan3.0-video 720P 0.6 元/秒，官方標「限時7折」，所列為原價）。',
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID；型號、網址、API Key 必須同一地域，國際站和中國站不能混用。',
        '首影格、尾影格和參考圖互斥：開啟參考圖後，鏡頭圖只能作為第 1 張參考圖，不再是嚴格的首影格。',
        '任務編號和結果網址只保留 24 小時，過期後查詢會回傳 UNKNOWN（按失敗處理）；產生成功後會立即下載儲存。',
        '官方：提示詞智慧改寫預設開啟，它是否會改寫掉提示詞裡的「圖1」引用尚未驗證。',
        '這一版不傳參考影片與參考音訊（官方只收公開網址或 oss:// 臨時網址，本機檔案沒有上傳通道）。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Wan 3.0 video (China site)',
      notes:
        'The new Wan 3.0 interface: text to video, first frame, first and last frame, up to 10 reference images, up to 30 seconds per video. wan3.0-video-prime is the faster version. Priced per second (Beijing region, wan3.0-video 720P 0.6 CNY/s; the page marks a limited 30% discount and the figure listed is the original price).',
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID; the model, the address and the API key must belong to the same region, so the international and China sites cannot be mixed.',
        'First/last frame and reference images are mutually exclusive: with reference images on, the shot image can only be the first reference image, not a strict first frame.',
        'Task IDs and result URLs are kept for 24 hours only; after that a query returns UNKNOWN (treated as a failure). The video is downloaded and saved as soon as it succeeds.',
        'Official: prompt rewriting is on by default; whether it rewrites away the "image 1" references in the prompt is unverified.',
        'Reference videos and audio are not sent in this version (the API only takes public or oss:// temporary URLs and local files have no upload channel).',
      ],
    },
  }),
  def({
    id: 'aliyun-wan3-intl',
    kind: 'video',
    vendor: 'aliyun',
    region: 'global',
    protocol: 'dashscope-video',
    baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com',
    baseUrlPlaceholders: ['WorkspaceId'],
    suggestedModel: 'wan3.0-video',
    source: 'https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference',
    zh: {
      label: '阿里云百炼 · 通义万相 3.0 视频（国际站，新加坡）',
      notes:
        '万相 3.0 新接口：文生视频、首帧、首尾帧、最多 10 张参考图，单次最长 30 秒。wan3.0-video-prime 是高速版。国际站的价格页没有读到，这里没有估价。',
      limits: [
        '地址里的 {WorkspaceId} 要换成你的业务空间 ID；模型、地址、API Key 必须同一地域，国际站和国内站不能混用。',
        '首帧、尾帧和参考图互斥：开启参考图后，镜头图只能作为第 1 张参考图，不再是严格的首帧。',
        '任务号和结果地址只保留 24 小时，过期后查询返回 UNKNOWN（按失败处理）；生成成功后会立即下载保存。',
        '官方页面的地域切换里有新加坡，但只读了北京地域的示例；新加坡的地址写法与生图预设一致。',
        '这一版不传参考视频和参考音频（官方只收公网地址或 oss:// 临时地址，本地文件没有上传通道）。',
      ],
    },
    hant: {
      label: '阿里雲百煉 · 通義萬相 3.0 影片（國際站，新加坡）',
      notes:
        '萬相 3.0 新介面：文字生影片、首影格、首尾影格、最多 10 張參考圖，單次最長 30 秒。wan3.0-video-prime 是高速版。國際站的價格頁沒有讀到，這裡沒有估價。',
      limits: [
        '網址裡的 {WorkspaceId} 要換成你的業務空間 ID；型號、網址、API Key 必須同一地域，國際站和中國站不能混用。',
        '首影格、尾影格和參考圖互斥：開啟參考圖後，鏡頭圖只能作為第 1 張參考圖，不再是嚴格的首影格。',
        '任務編號和結果網址只保留 24 小時，過期後查詢會回傳 UNKNOWN（按失敗處理）；產生成功後會立即下載儲存。',
        '官方頁面的地域切換裡有新加坡，但只讀了北京地域的範例；新加坡的網址寫法與生圖預設一致。',
        '這一版不傳參考影片與參考音訊（官方只收公開網址或 oss:// 臨時網址，本機檔案沒有上傳通道）。',
      ],
    },
    en: {
      label: 'Alibaba Cloud Model Studio · Wan 3.0 video (international, Singapore)',
      notes:
        'The new Wan 3.0 interface: text to video, first frame, first and last frame, up to 10 reference images, up to 30 seconds per video. wan3.0-video-prime is the faster version. The international price page could not be read, so no estimate is shown here.',
      limits: [
        'Replace {WorkspaceId} in the address with your workspace ID; the model, the address and the API key must belong to the same region, so the international and China sites cannot be mixed.',
        'First/last frame and reference images are mutually exclusive: with reference images on, the shot image can only be the first reference image, not a strict first frame.',
        'Task IDs and result URLs are kept for 24 hours only; after that a query returns UNKNOWN (treated as a failure). The video is downloaded and saved as soon as it succeeds.',
        'The official page offers a Singapore region, but only the Beijing example was read; the Singapore address form follows the image presets.',
        'Reference videos and audio are not sent in this version (the API only takes public or oss:// temporary URLs and local files have no upload channel).',
      ],
    },
  }),
]
