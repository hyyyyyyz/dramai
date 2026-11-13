export default {
  providerAuth: {
    label: '鉴权方式',
    chip: {
      key_saved: 'API Key',
      key_missing: '还没有 API Key',
      none: '无需鉴权',
      channels: { 'openai-chatgpt': 'ChatGPT 账号登录', openrouter: 'OpenRouter 账号登录' },
    },
    noneNote: '这个服务商不需要鉴权（比如本机运行的模型），请求不带任何凭据，所以没有 Key 要填',
    keyMissingNote: '这个服务商用 API Key，但还没有填。填了才能测试和使用',
    loginFixed: '账号登录的接口地址和协议是固定的，不能修改',
    verification: {
      tested: '已实测 · {{date}}',
      documented: '按官方文档接入，未实测',
      source: '出处',
      note: '没有在真实服务上测过，可能有细节不对。它不会自动成为当前选择：试用确认没问题后，再选用它',
    },
    preset: { documented: '未实测' },
    custom: {
      auth: '鉴权方式',
      apiKey: 'API Key',
      none: '无需鉴权',
      noneHint: '给本机或内网的模型用：请求不带任何凭据',
    },
    added: {
      title: '已添加「{{name}}」',
      unverified:
        '它是按官方文档接入、还没实测的，所以没有自动设为使用。确认没问题后，再自己选用它',
      use: '设为使用',
    },
  },
  planUsage: {
    using: '正在使用 ChatGPT 套餐',
    manage: '管理用量',
  },
  providerLogin: {
    again: '重新登录',
    newAccount: '换账号',
    signOut: '登出',
    cancel: '取消登录',
    unsafeUrl:
      '服务端给的授权地址不是 http 或 https 网址，没有打开。请重试；如果一直这样，请反馈给我们',
    lastAccount: '上次登录的账号：{{account}}',
    unavailable: {
      remote_access:
        '现在是从别的机器访问的，登录授权的回调到不了这里，所以不能登录。请在运行 dramai 的那台电脑上操作',
    },
    pending: {
      title: '请在浏览器里完成授权',
      body: '已经在新窗口里打开了授权页。完成后回到这里，会自动继续。{{time}} 前都可以等',
      reopen: '没有看到新窗口？重新打开授权页',
      progress: '等待授权',
    },
    needsRelogin: {
      title: '登录已失效，需要重新登录',
      body: '保存的登录凭据已经不能用了（被撤销，或刷新失败）。重新登录就好，不影响其他设置',
    },
    errors: {
      denied: '你在授权页拒绝了登录。想用的话，可以再试一次',
      timeout: '登录超时了（授权要在 10 分钟内完成）。再试一次',
      account_mismatch: '这次登录的账号和之前保存的不是同一个。要换账号的话，请选“换账号”',
      cancelled: '登录已取消',
      failed: '登录没有完成，请重试',
      details: '技术详情',
    },
    models: {
      label: '模型',
      hint: '登录后才能列出你能用的模型；也可以手动填写',
      loading: '正在取模型清单…',
      failed: '取不到模型清单，请手动填写模型名',
      fetch: '获取模型列表',
      refetch: '重新获取',
      unsupported: '这个服务商没有模型列表，请手动填写模型名',
      fetchHint: '从服务商取你能用的模型来选；也可以直接填写',
    },
    channels: {
      'openai-chatgpt': {
        continue: 'Continue with ChatGPT',
        title: '使用你的 ChatGPT 套餐',
        intro:
          '用 ChatGPT 账号登录后，符合条件的文本请求会用你自己的 ChatGPT 套餐，不需要 API Key。这和 dramai 无关，dramai 不收费',
        textOnly:
          '只覆盖文本（规划分集、拆分镜头、写提示词）。生成图片、视频和配音仍然要用各自的 API Key',
        needsPlan: '需要 ChatGPT 订阅，并受套餐用量上限限制',
        signedAs: '已登录：{{account}}',
        expiresAt: '访问令牌约在 {{time}} 到期（会自动刷新，仅供参考）',
        noPlanUsage: {
          title: '已登录，但还不能用',
          body: '这次登录没有授予使用 ChatGPT 用量的范围，所以不能调用。请重新登录并同意授权',
          action: '重新登录并同意授权',
        },
        refreshRejected:
          '服务端拒绝了一次令牌刷新，原因没有说明。登录凭据还在，可以先继续用；如果之后出问题，再试试重新登录',
        loggedOut: {
          confirmed: '已登出，OpenAI 端的授权也已撤销',
          unconfirmed:
            '本地的登录已清除，但没能确认 OpenAI 端已撤销。可以到 ChatGPT 设置里断开这个应用',
          nothing: '已登出（本来就没有需要撤销的授权）',
        },
        welcome: {
          title: '你正在使用你的 ChatGPT 套餐',
          body: '这个应用里符合条件的用量会使用你的 ChatGPT 套餐。可以在 ChatGPT 设置中管理用量。',
          gotIt: '知道了',
        },
      },
      openrouter: {
        continue: '用 OpenRouter 账号登录',
        title: '用 OpenRouter 账号登录',
        intro:
          '登录后，OpenRouter 会给 dramai 一把属于你自己的 API Key，之后的使用和填 Key 完全一样。用量和费用记在你的 OpenRouter 账号上，dramai 不收费',
        signedIn: '已用 OpenRouter 账号登录',
        keyNote: '这把 Key 是登录得到的：{{mask}}',
        manage: '管理这把 Key',
        relogin: '重新登录（换一把新 Key）',
        reloginNote:
          '再登录一次会得到一把新 Key。旧的那把在 OpenRouter 上仍然有效，要让它失效，请自己到管理页删除',
        pendingHint:
          '如果你已经在浏览器里拒绝了授权，OpenRouter 不会通知这里，登录会一直等到超时。请点“取消登录”',
        loggedOut: {
          unconfirmed:
            '本机的 Key 已清除，但 OpenRouter 没有提供撤销接口。要让这把 Key 失效，请到管理页删除它',
          nothing: '已登出',
          manage: '去管理页删除这把 Key',
        },
      },
    },
  },
  providerErrors: {
    openSettings: '去设置服务商',
    EMPTY_OUTPUT_TRUNCATED: {
      title: '输出被长度限制截断，没有拿到正文',
      body: '多半是模型把额度都用在了思考上。到这个服务商的高级设置里关掉思考（额外请求体），或者调大输出长度，再重试',
    },
    STREAM_INTERRUPTED: {
      title: '生成到一半，连接断了',
      body: '没有收到结束的信号，结果不完整。可以直接重试这个任务',
    },
    overloaded_error: {
      title: '服务商现在太忙了',
      body: '这是服务商那边的临时拥堵，不是你的设置有问题。过一会儿再重试这个任务',
    },
    rate_limit_error: {
      title: '请求太频繁，被服务商限流了',
      body: '等一会儿再重试；如果经常这样，检查这个服务商账号的用量限额',
    },
    authentication_error: {
      title: '服务商没有接受这个 Key',
      body: '请检查 API Key 是否正确、是否还有效，在设置里重新保存后再重试',
    },
    invalid_request_error: {
      title: '服务商认为这次请求不合法',
      body: '多半是模型名、输出长度或额外请求体不对。检查这个服务商的设置；详情在任务的技术信息里',
    },
    GEMINI_SAFETY: {
      title: '被 Gemini 的安全策略拦下了',
      body: '这次生成的内容触发了安全过滤。改一下这段原文或提示词再试，重试同样的内容通常结果相同',
    },
    GEMINI_PROMPT_SAFETY: {
      title: '提示词被 Gemini 的安全策略拦下了',
      body: '输入的内容触发了安全过滤，没有开始生成。改一下原文或提示词再试',
    },
    GEMINI_RECITATION: {
      title: '被 Gemini 拦下：内容和已有作品过于相似',
      body: '换一种写法，或者缩短引用的原文再试',
    },
    GEMINI_IMAGE_URL_UNSUPPORTED: {
      title: 'Gemini 的图片输入只接受图片数据本身',
      body: '这不应该发生。请把这个任务和这条提示一起反馈给我们',
    },
    INVALID_ARGUMENT: {
      title: '服务商认为这次请求的参数不对',
      body: '检查模型名和这个服务商的设置；详情在任务的技术信息里',
    },
    RESOURCE_EXHAUSTED: {
      title: '用量或频率到了服务商的上限',
      body: '等一会儿再重试，或者到服务商的控制台查看配额',
    },
    PERMISSION_DENIED: {
      title: '服务商拒绝了这次请求',
      body: '多半是 Key 没有权限，或者这个模型还没对你的账号开放。检查 Key 和模型后再试',
    },
    LOGIN_REQUIRED: {
      title: '需要重新登录服务商账号',
      body: '这个服务商用账号登录，而登录已经失效或还没完成。到设置里重新登录后，再重试这个任务',
      bodyHere:
        '这个服务商用账号登录，而登录已经失效或还没完成。请在这张卡片的登录区域重新登录，再测试一次',
    },
    NETWORK: {
      title: '没能连上服务商',
      body: '检查这台电脑的网络、代理，以及接口地址是否写对（域名、端口、https）。服务商那边临时不可达时，过一会儿再试',
    },
    TIMEOUT: {
      title: '服务商太久没有响应',
      body: '可能是网络慢，也可能是服务商正忙。过一会儿再试；如果一直这样，检查接口地址和网络',
    },
    UNREADABLE_RESPONSE: {
      title: '服务商返回的内容不是预期的格式',
      body: '多半是接口地址指到了一个网页或别的服务，而不是这个服务商的 API。检查接口地址是否带有正确的路径',
    },
    BASE_URL_INVALID: {
      title: '接口地址不可用',
      body: '地址是空的或写法不对。填写完整的地址，例如 https://api.example.com/v1',
    },
    HTTP_AUTH: {
      title: '服务商没有接受这个 Key，或者这个 Key 没有权限',
      body: '检查 API Key 是否正确、是否还有效、有没有开通这个模型的权限，重新保存后再试',
    },
    HTTP_NOT_FOUND: {
      title: '服务商找不到这个接口或模型',
      body: '多半是接口地址的路径不对，或者模型名写错了。对照服务商的文档检查接口地址和模型',
    },
    HTTP_RATE_LIMIT: {
      title: '请求太频繁，或者额度用完了',
      body: '等一会儿再试；如果一直这样，到服务商的控制台看看这个账号的用量和余额',
    },
    HTTP_SERVER: {
      title: '服务商那边出错了',
      body: '这是服务商的问题，不是你的设置。过一会儿再试',
    },
    LOGIN_ENDPOINT_NOT_ALLOWED: {
      title: '接口地址不合规，登录令牌没有发出',
      body: '账号登录的接口地址是固定的。请在设置里删掉这个服务商，重新用预设添加',
    },
    subscription_sharing_usage_limit_exceeded: {
      title: '已达到用量上限',
      body: '请在 ChatGPT 设置中查看你的套餐，或这个应用的限额。',
      note: '可能是你的套餐用量到了上限，也可能只是这个应用的上限。dramai 不会猜什么时候重置',
    },
    subscription_sharing_user_not_eligible: {
      title: '这个账号不能把订阅用量给第三方应用',
      body: '重试也没用。请换一个账号登录，或者改用 API Key',
    },
    subscription_sharing_usage_unavailable: {
      title: '用量服务暂时不可用',
      body: '登录凭据仍然有效，过一会儿再重试这个任务',
    },
    subscription_sharing_user_unavailable: {
      title: '账号服务暂时不可用',
      body: '登录凭据仍然有效，过一会儿再重试这个任务',
    },
    subscription_sharing_unsupported_capability: {
      title: '这次请求用了账号登录不支持的能力',
      body: '这不应该发生。请把这个任务和这条提示一起反馈给我们',
    },
    subscription_sharing_route_not_supported: {
      title: '账号登录不支持这个接口',
      body: '账号登录只支持文本请求。请检查这个服务商的接口地址',
    },
    subscription_sharing_invalid_user: {
      title: '登录身份没有被接受',
      body: '请重新登录。如果一直这样，先登出再登录',
    },
    chatpass_v2_scope_not_authorized: {
      title: '这次登录没有授予使用 ChatGPT 用量的范围',
      body: '重试没用。请重新登录并同意授权',
    },
    chatpass_v2_invalid_authorization_context: {
      title: '登录的授权上下文无效',
      body: '重试没用。请重新登录；如果一直这样，请反馈给我们',
    },
  },
}
