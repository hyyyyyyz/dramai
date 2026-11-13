export default {
  providerAuth: {
    label: '鑑權方式',
    chip: {
      key_saved: 'API Key',
      key_missing: '還沒有 API Key',
      none: '無需鑑權',
      channels: { 'openai-chatgpt': 'ChatGPT 帳號登入', openrouter: 'OpenRouter 帳號登入' },
    },
    noneNote: '這個服務商不需要鑑權（比如本機執行的模型），請求不帶任何憑據，所以沒有 Key 要填',
    keyMissingNote: '這個服務商用 API Key，但還沒有填。填了才能測試和使用',
    loginFixed: '帳號登入的介面地址和協議是固定的，不能修改',
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
    newAccount: '換帳號',
    signOut: '登出',
    cancel: '取消登入',
    unsafeUrl:
      '服務端給的授權地址不是 http 或 https 網址，沒有開啟。請重試；如果一直這樣，請回饋給我們',
    lastAccount: '上次登入的帳號：{{account}}',
    unavailable: {
      remote_access:
        '現在是從別的機器訪問的，登入授權的回呼到不了這裡，所以不能登入。請在執行 dramai 的那臺電腦上操作',
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
      account_mismatch: '這次登入的帳號和之前儲存的不是同一個。要換帳號的話，請選“換帳號”',
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
          '用 ChatGPT 帳號登入後，符合條件的文字請求會用你自己的 ChatGPT 套餐，不需要 API Key。這和 dramai 無關，dramai 不收費',
        textOnly:
          '只覆蓋文字（規劃分集、拆分鏡頭、寫提示詞）。生成圖片、影片和配音仍然要用各自的 API Key',
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
        continue: '用 OpenRouter 帳號登入',
        title: '用 OpenRouter 帳號登入',
        intro:
          '登入後，OpenRouter 會給 dramai 一把屬於你自己的 API Key，之後的使用和填 Key 完全一樣。用量和費用記在你的 OpenRouter 帳號上，dramai 不收費',
        signedIn: '已用 OpenRouter 帳號登入',
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
      body: '等一會兒再重試；如果經常這樣，檢查這個服務商帳號的用量限額',
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
      body: '這不應該發生。請把這個任務和這條提示一起回饋給我們',
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
      body: '多半是 Key 沒有權限，或者這個模型還沒對你的帳號開放。檢查 Key 和模型後再試',
    },
    LOGIN_REQUIRED: {
      title: '需要重新登入服務商帳號',
      body: '這個服務商用帳號登入，而登入已經失效或還沒完成。到設定裡重新登入後，再重試這個任務',
      bodyHere:
        '這個服務商用帳號登入，而登入已經失效或還沒完成。請在這張卡片的登入區域重新登入，再測試一次',
    },
    NETWORK: {
      title: '沒能連上服務商',
      body: '檢查這臺電腦的網路、代理，以及介面地址是否寫對（網域名稱、連接埠、https）。服務商那邊臨時不可達時，過一會兒再試',
    },
    TIMEOUT: {
      title: '服務商太久沒有回應',
      body: '可能是網路慢，也可能是服務商正忙。過一會兒再試；如果一直這樣，檢查介面地址和網路',
    },
    UNREADABLE_RESPONSE: {
      title: '服務商回傳的內容不是預期的格式',
      body: '多半是介面地址指到了一個網頁或別的服務，而不是這個服務商的 API。檢查介面地址是否帶有正確的路徑',
    },
    BASE_URL_INVALID: {
      title: '介面地址不可用',
      body: '地址是空的或寫法不對。填寫完整的地址，例如 https://api.example.com/v1',
    },
    HTTP_AUTH: {
      title: '服務商沒有接受這個 Key，或者這個 Key 沒有權限',
      body: '檢查 API Key 是否正確、是否還有效、有沒有開通這個模型的權限，重新儲存後再試',
    },
    HTTP_NOT_FOUND: {
      title: '服務商找不到這個介面或模型',
      body: '多半是介面地址的路徑不對，或者模型名寫錯了。對照服務商的文件檢查介面地址和模型',
    },
    HTTP_RATE_LIMIT: {
      title: '請求太頻繁，或者額度用完了',
      body: '等一會兒再試；如果一直這樣，到服務商的控制台看看這個帳號的用量和餘額',
    },
    HTTP_SERVER: {
      title: '服務商那邊出錯了',
      body: '這是服務商的問題，不是你的設定。過一會兒再試',
    },
    VIDEO_FACE_REJECTED: {
      title: '這個模型不接受含真人人臉的圖片',
      body: '服務商拒絕了輸入的圖片，多半因為裡面有真人人臉。請換模型，或者關閉“用角色設定圖作參考”，用沒有真人人臉的圖片再試',
    },
    CONTENT_REJECTED: {
      title: '被服務商的內容稽核攔下了',
      body: '輸入的圖片或提示詞沒有通過稽核。改一下提示詞或換一張圖再試，原樣重試通常結果相同',
    },
    BALANCE_INSUFFICIENT: {
      title: '服務商帳號欠費，或者資源包用完了',
      body: '到服務商的控制台充值或購買資源包，然後再重試這個任務',
    },
    TASK_EXPIRED: {
      title: '服務商那邊的任務已經過期',
      body: '任務在服務商那裡保留的時間到了，拿不到結果了。重新生成這個鏡頭',
    },
    TASK_CANCELLED: {
      title: '任務在服務商那邊被取消了',
      body: '重新生成這個鏡頭即可',
    },
    TASK_UNKNOWN: {
      title: '服務商不認識這個任務了',
      body: '任務號已經失效（過了保留期）。重新生成這個鏡頭',
    },
    FIRST_FRAME_REQUIRED: {
      title: '這個影片模型必須有鏡頭圖作為首幀，這個鏡頭還沒有',
      body: '先給這個鏡頭生成鏡頭圖，再生成影片',
    },
    LOGIN_ENDPOINT_NOT_ALLOWED: {
      title: '介面地址不合規，登入令牌沒有發出',
      body: '帳號登入的介面地址是固定的。請在設定裡刪掉這個服務商，重新用預設新增',
    },
    subscription_sharing_usage_limit_exceeded: {
      title: '已達到用量上限',
      body: '請在 ChatGPT 設定中檢視你的套餐，或這個應用的限額。',
      note: '可能是你的套餐用量到了上限，也可能只是這個應用的上限。dramai 不會猜什麼時候重置',
    },
    subscription_sharing_user_not_eligible: {
      title: '這個帳號不能把訂閱用量給第三方應用',
      body: '重試也沒用。請換一個帳號登入，或者改用 API Key',
    },
    subscription_sharing_usage_unavailable: {
      title: '用量服務暫時不可用',
      body: '登入憑據仍然有效，過一會兒再重試這個任務',
    },
    subscription_sharing_user_unavailable: {
      title: '帳號服務暫時不可用',
      body: '登入憑據仍然有效，過一會兒再重試這個任務',
    },
    subscription_sharing_unsupported_capability: {
      title: '這次請求用了帳號登入不支援的能力',
      body: '這不應該發生。請把這個任務和這條提示一起回饋給我們',
    },
    subscription_sharing_route_not_supported: {
      title: '帳號登入不支援這個介面',
      body: '帳號登入只支援文字請求。請檢查這個服務商的介面地址',
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
      body: '重試沒用。請重新登入；如果一直這樣，請回饋給我們',
    },
  },
}
