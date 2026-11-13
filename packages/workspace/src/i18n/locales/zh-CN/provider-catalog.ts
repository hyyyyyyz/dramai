export default {
  providerCatalog: {
    title: '添加服务商',
    search: '搜索服务商',
    empty: '这一类还没有预设，可以添加自定义服务商',
    noMatch: '没有匹配“{{query}}”的预设。可以换个词，或者添加自定义服务商',
    region: { cn: '国内站', global: '国际站', local: '本机' },
    localShort: '本机服务：要先在这台电脑上启动它',
    localNote:
      '这是本机运行的服务：先在这台电脑上启动它（并加载好模型），再回来测试连接。dramai 不会替你启动',
    needsInput: '添加时需要你填一点信息',
    fill: {
      title: '添加「{{name}}」',
      back: '返回',
      placeholderHint: '把地址里的 {{name}} 换成你自己的值（在这个服务商的控制台里能找到）',
      missing: '要填写 {{name}}，不填的话这个服务商连不上',
      invalid: '{{name}} 只能包含字母、数字和 . _ ~ -',
      modelHint: '这个服务商没有默认模型：填你在本机加载的那个模型名，添加后也可以从列表里选',
      model_missing: '要填写模型名',
    },
  },
  providerDialect: {
    title: '高级设置',
    intro: '一般不用动。有些服务商的接口和 OpenAI 的写法略有不同，可以在这里对应调整',
    extraBody: {
      label: '额外请求体（JSON）',
      hint: '每次请求都会并进请求体。典型用途：给默认开启思考的模型关掉思考，例如 {"enable_thinking": false}。model、messages、stream 这些核心字段不会被覆盖',
      invalid: '这不是合法的 JSON，改好才能保存',
      notObject: '要写成 JSON 对象，例如 {"key": "value"}',
    },
    maxTokensField: {
      label: '输出长度字段',
      hint: '限制输出长度时用哪个字段名。多数服务商用 max_tokens，OpenAI 较新的模型要用 max_completion_tokens',
      auto: '默认（按协议）',
    },
    jsonMode: {
      label: 'JSON 输出方式',
      hint: '需要结构化输出时怎么要求：用服务商自带的 JSON 模式，或者只在提示词里要求再自己解析',
      auto: '默认（按协议）',
      json_object: '服务商的 JSON 模式（json_object）',
      prompt_only: '仅靠提示词',
    },
  },
}
