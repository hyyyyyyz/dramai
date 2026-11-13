export default {
  providerAuth: {
    label: '鑑權方式',
    chip: {
      key_saved: 'API Key',
      key_missing: '還沒有 API Key',
      none: '無需鑑權',
      login: 'ChatGPT 賬號登入',
    },
    noneNote: '這個服務商不需要鑑權（比如本機執行的模型），請求不帶任何憑據，所以沒有 Key 要填',
    keyMissingNote: '這個服務商用 API Key，但還沒有填。填了才能測試和使用',
    loginFixed: '賬號登入的介面地址和協議是固定的，不能修改',
    verification: {
      tested: '已實測 · {{date}}',
      documented: '按官方文件接入，未實測',
      source: '出處',
      note: '沒有在真實服務上測過，可能有細節不對。它不會自動成為當前選擇：試用確認沒問題後，再選用它',
    },
    preset: { documented: '未實測' },
    custom: {
      auth: '鑑權方式',
      apiKey: 'API Key',
      none: '無需鑑權',
      noneHint: '給本機或內網的模型用：請求不帶任何憑據',
    },
    added: {
      title: '已新增「{{name}}」',
      unverified:
        '它是按官方文件接入、還沒實測的，所以沒有自動設為使用。確認沒問題後，再自己選用它',
      use: '設為使用',
    },
  },
  planUsage: {
    using: '正在使用 ChatGPT 套餐',
    manage: '管理用量',
  },
  providerLogin: {
    again: '重新登入',
    newAccount: '換賬號',
    signOut: '登出',
    cancel: '取消登入',
    lastAccount: '上次登入的賬號：{{account}}',
    unavailable: {
      remote_access:
        '現在是從別的機器訪問的，登入授權的回撥到不了這裡，所以不能登入。請在執行 dramai 的那臺電腦上操作',
    },
    pending: {
      title: '請在瀏覽器裡完成授權',
      body: '已經在新窗口裡打開了授權頁。完成後回到這裡，會自動繼續。{{time}} 前都可以等',
      reopen: '沒有看到新視窗？重新開啟授權頁',
      progress: '等待授權',
    },
    needsRelogin: {
      title: '登入已失效，需要重新登入',
      body: '儲存的登入憑據已經不能用了（被撤銷，或重新整理失敗）。重新登入就好，不影響其他設定',
    },
    errors: {
      denied: '你在授權頁拒絕了登入。想用的話，可以再試一次',
      timeout: '登入超時了（授權要在 10 分鐘內完成）。再試一次',
      account_mismatch: '這次登入的賬號和之前儲存的不是同一個。要換賬號的話，請選“換賬號”',
      cancelled: '登入已取消',
      failed: '登入沒有完成，請重試',
      details: '技術詳情',
    },
    models: {
      label: '模型',
      hint: '登入後才能列出你能用的模型；也可以手動填寫',
      loading: '正在取模型清單…',
      failed: '取不到模型清單，請手動填寫模型名',
      fetch: '獲取模型列表',
      refetch: '重新獲取',
      unsupported: '這個服務商沒有模型列表，請手動填寫模型名',
      fetchHint: '從服務商取你能用的模型來選；也可以直接填寫',
    },
    channels: {
      'openai-chatgpt': {
        continue: 'Continue with ChatGPT',
        title: '使用你的 ChatGPT 套餐',
        intro:
          '用 ChatGPT 賬號登入後，符合條件的文本請求會用你自己的 ChatGPT 套餐，不需要 API Key。這和 dramai 無關，dramai 不收費',
        textOnly:
          '只覆蓋文本（規劃分集、拆分鏡頭、寫提示詞）。生成圖片、影片和配音仍然要用各自的 API Key',
        needsPlan: '需要 ChatGPT 訂閱，並受套餐用量上限限制',
        signedAs: '已登入：{{account}}',
        expiresAt: '訪問令牌約在 {{time}} 到期（會自動重新整理，僅供參考）',
        noPlanUsage: {
          title: '已登入，但還不能用',
          body: '這次登入沒有授予使用 ChatGPT 用量的範圍，所以不能呼叫。請重新登入並同意授權',
          action: '重新登入並同意授權',
        },
        refreshRejected:
          '服務端拒絕了一次令牌重新整理，原因沒有說明。登入憑據還在，可以先繼續用；如果之後出問題，再試試重新登入',
        loggedOut: {
          confirmed: '已登出，OpenAI 端的授權也已撤銷',
          unconfirmed:
            '本地的登入已清除，但沒能確認 OpenAI 端已撤銷。可以到 ChatGPT 設定裡斷開這個應用',
          nothing: '已登出（本來就沒有需要撤銷的授權）',
        },
        welcome: {
          title: '你正在使用你的 ChatGPT 套餐',
          body: '這個應用裡符合條件的用量會使用你的 ChatGPT 套餐。可以在 ChatGPT 設定中管理用量。',
          gotIt: '知道了',
        },
      },
      openrouter: {
        continue: '用 OpenRouter 賬號登入',
        title: '用 OpenRouter 賬號登入',
        intro:
          '登入後，OpenRouter 會給 dramai 一把屬於你自己的 API Key，之後的使用和填 Key 完全一樣。用量和費用記在你的 OpenRouter 賬號上，dramai 不收費',
        signedIn: '已用 OpenRouter 賬號登入',
        keyNote: '這把 Key 是登入得到的：{{mask}}',
        manage: '管理這把 Key',
        relogin: '重新登入（換一把新 Key）',
        reloginNote:
          '再登入一次會得到一把新 Key。舊的那把在 OpenRouter 上仍然有效，要讓它失效，請自己到管理頁刪除',
        pendingHint:
          '如果你已經在瀏覽器裡拒絕了授權，OpenRouter 不會通知這裡，登入會一直等到超時。請點“取消登入”',
        loggedOut: {
          unconfirmed:
            '本機的 Key 已清除，但 OpenRouter 沒有提供撤銷介面。要讓這把 Key 失效，請到管理頁刪除它',
          nothing: '已登出',
          manage: '去管理頁刪除這把 Key',
        },
      },
    },
  },
  providerErrors: {
    openSettings: '去設定服務商',
    EMPTY_OUTPUT_TRUNCATED: {
      title: '輸出被長度限制截斷，沒有拿到正文',
      body: '多半是模型把額度都用在了思考上。到這個服務商的進階設定裡關掉思考（額外請求體），或者調大輸出長度，再重試',
    },
    STREAM_INTERRUPTED: {
      title: '生成到一半，連線斷了',
      body: '沒有收到結束的訊號，結果不完整。可以直接重試這個任務',
    },
    overloaded_error: {
      title: '服務商現在太忙了',
      body: '這是服務商那邊的臨時擁堵，不是你的設定有問題。過一會兒再重試這個任務',
    },
    rate_limit_error: {
      title: '請求太頻繁，被服務商限流了',
      body: '等一會兒再重試；如果經常這樣，檢查這個服務商賬號的用量限額',
    },
    authentication_error: {
      title: '服務商沒有接受這個 Key',
      body: '請檢查 API Key 是否正確、是否還有效，在設定裡重新儲存後再重試',
    },
    invalid_request_error: {
      title: '服務商認為這次請求不合法',
      body: '多半是模型名、輸出長度或額外請求體不對。檢查這個服務商的設定；詳情在任務的技術資訊裡',
    },
    GEMINI_SAFETY: {
      title: '被 Gemini 的安全策略攔下了',
      body: '這次生成的內容觸發了安全過濾。改一下這段原文或提示詞再試，重試同樣的內容通常結果相同',
    },
    GEMINI_PROMPT_SAFETY: {
      title: '提示詞被 Gemini 的安全策略攔下了',
      body: '輸入的內容觸發了安全過濾，沒有開始生成。改一下原文或提示詞再試',
    },
    GEMINI_RECITATION: {
      title: '被 Gemini 攔下：內容和已有作品過於相似',
      body: '換一種寫法，或者縮短引用的原文再試',
    },
    GEMINI_IMAGE_URL_UNSUPPORTED: {
      title: 'Gemini 的圖片輸入只接受圖片資料本身',
      body: '這不應該發生。請把這個任務和這條提示一起反饋給我們',
    },
    INVALID_ARGUMENT: {
      title: '服務商認為這次請求的引數不對',
      body: '檢查模型名和這個服務商的設定；詳情在任務的技術資訊裡',
    },
    RESOURCE_EXHAUSTED: {
      title: '用量或頻率到了服務商的上限',
      body: '等一會兒再重試，或者到服務商的控制台檢視配額',
    },
    PERMISSION_DENIED: {
      title: '服務商拒絕了這次請求',
      body: '多半是 Key 沒有許可權，或者這個模型還沒對你的賬號開放。檢查 Key 和模型後再試',
    },
    LOGIN_REQUIRED: {
      title: '需要重新登入服務商賬號',
      body: '這個服務商用賬號登入，而登入已經失效或還沒完成。到設定裡重新登入後，再重試這個任務',
    },
    LOGIN_ENDPOINT_NOT_ALLOWED: {
      title: '介面地址不合規，登入令牌沒有發出',
      body: '賬號登入的介面地址是固定的。請在設定裡刪掉這個服務商，重新用預設新增',
    },
    subscription_sharing_usage_limit_exceeded: {
      title: '已達到用量上限',
      body: '請在 ChatGPT 設定中檢視你的套餐，或這個應用的限額。',
      note: '可能是你的套餐用量到了上限，也可能只是這個應用的上限。dramai 不會猜什麼時候重置',
    },
    subscription_sharing_user_not_eligible: {
      title: '這個賬號不能把訂閱用量給第三方應用',
      body: '重試也沒用。請換一個賬號登入，或者改用 API Key',
    },
    subscription_sharing_usage_unavailable: {
      title: '用量服務暫時不可用',
      body: '登入憑據仍然有效，過一會兒再重試這個任務',
    },
    subscription_sharing_user_unavailable: {
      title: '賬號服務暫時不可用',
      body: '登入憑據仍然有效，過一會兒再重試這個任務',
    },
    subscription_sharing_unsupported_capability: {
      title: '這次請求用了賬號登入不支援的能力',
      body: '這不應該發生。請把這個任務和這條提示一起反饋給我們',
    },
    subscription_sharing_route_not_supported: {
      title: '賬號登入不支援這個介面',
      body: '賬號登入只支援文本請求。請檢查這個服務商的介面地址',
    },
    subscription_sharing_invalid_user: {
      title: '登入身份沒有被接受',
      body: '請重新登入。如果一直這樣，先登出再登入',
    },
    chatpass_v2_scope_not_authorized: {
      title: '這次登入沒有授予使用 ChatGPT 用量的範圍',
      body: '重試沒用。請重新登入並同意授權',
    },
    chatpass_v2_invalid_authorization_context: {
      title: '登入的授權上下文無效',
      body: '重試沒用。請重新登入；如果一直這樣，請反饋給我們',
    },
  },
}
