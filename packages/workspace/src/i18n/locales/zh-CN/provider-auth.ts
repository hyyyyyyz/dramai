export default {
  providerAuth: {
    label: '鉴权方式',
    chip: {
      key_saved: 'API Key',
      key_missing: '还没有 API Key',
      none: '无需鉴权',
      login: 'ChatGPT 账号登录',
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
    continue: 'Continue with ChatGPT',
    title: '使用你的 ChatGPT 套餐',
    intro:
      '用 ChatGPT 账号登录后，符合条件的文本请求会用你自己的 ChatGPT 套餐，不需要 API Key。这和 dramai 无关，dramai 不收费',
    textOnly:
      '只覆盖文本（规划分集、拆分镜头、写提示词）。生成图片、视频和配音仍然要用各自的 API Key',
    needsPlan: '需要 ChatGPT 订阅，并受套餐用量上限限制',
    unavailable: {
      remote_access:
        '现在是从别的机器访问的，登录授权的回调到不了这里，所以不能登录。请在运行 dramai 的那台电脑上操作',
    },
    signedAs: '已登录：{{account}}',
    expiresAt: '访问令牌约在 {{time}} 到期（会自动刷新，仅供参考）',
    lastAccount: '上次登录的账号：{{account}}',
    again: '重新登录',
    newAccount: '换账号',
    signOut: '登出',
    signingOut: '正在登出…',
    cancel: '取消登录',
    pending: {
      title: '请在浏览器里完成授权',
      body: '已经在新窗口里打开了授权页。完成后回到这里，会自动继续。{{time}} 前都可以等',
      reopen: '没有看到新窗口？重新打开授权页',
      starting: '正在发起登录…',
      progress: '等待授权',
    },
    noPlanUsage: {
      title: '已登录，但还不能用',
      body: '这次登录没有授予使用 ChatGPT 用量的范围，所以不能调用。请重新登录并同意授权',
      action: '重新登录并同意授权',
    },
    needsRelogin: {
      title: '登录已失效，需要重新登录',
      body: '保存的登录凭据已经不能用了（被撤销，或刷新失败）。重新登录就好，不影响其他设置',
    },
    refreshRejected:
      '服务端拒绝了一次令牌刷新，原因没有说明。登录凭据还在，可以先继续用；如果之后出问题，再试试重新登录',
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
    },
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
      note: '符合条件的请求会用你的 ChatGPT 套餐；用量可以在 ChatGPT 设置里管理',
    },
  },
  providerErrors: {
    openSettings: '去设置服务商',
    LOGIN_REQUIRED: {
      title: '需要重新登录 OpenAI 账号',
      body: '这个服务商用 ChatGPT 账号登录，而登录已经失效或还没完成。到设置里重新登录后，再重试这个任务',
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
