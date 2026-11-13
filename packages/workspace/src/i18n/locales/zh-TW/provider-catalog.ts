export default {
  providerCatalog: {
    title: '新增服務商',
    search: '搜尋服務商',
    empty: '這一類還沒有預設，可以新增自定義服務商',
    noMatch: '沒有匹配“{{query}}”的預設。可以換個詞，或者新增自定義服務商',
    region: { cn: '國內站', global: '國際站', local: '本機' },
    localShort: '本機服務：要先在這臺電腦上啟動它',
    localNote:
      '這是本機執行的服務：先在這臺電腦上啟動它（並載入好模型），再回來測試連線。dramai 不會替你啟動',
    needsInput: '新增時需要你填一點資訊',
    fill: {
      title: '新增「{{name}}」',
      back: '返回',
      placeholderHint: '把地址裡的 {{name}} 換成你自己的值（在這個服務商的控制台裡能找到）',
      missing: '要填寫 {{name}}，不填的話這個服務商連不上',
      invalid: '{{name}} 只能包含字母、數字和 . _ ~ -',
      modelHint: '這個服務商沒有預設模型：填你在本機載入的那個模型名，新增後也可以從列表裡選',
      model_missing: '要填寫模型名',
    },
  },
  providerDialect: {
    title: '進階設定',
    intro: '一般不用動。有些服務商的介面和 OpenAI 的寫法略有不同，可以在這裡對應調整',
    extraBody: {
      label: '額外請求體（JSON）',
      hint: '每次請求都會並進請求體。典型用途：給預設開啟思考的模型關掉思考，例如 {"enable_thinking": false}。model、messages、stream 這些核心欄位不會被覆蓋',
      invalid: '這不是合法的 JSON，改好才能儲存',
      notObject: '要寫成 JSON 物件，例如 {"key": "value"}',
    },
    maxTokensField: {
      label: '輸出長度欄位',
      hint: '限制輸出長度時用哪個欄位名。多數服務商用 max_tokens，OpenAI 較新的模型要用 max_completion_tokens',
      auto: '預設（按協議）',
    },
    jsonMode: {
      label: 'JSON 輸出方式',
      hint: '需要結構化輸出時怎麼要求：用服務商自帶的 JSON 模式，或者只在提示詞裡要求再自己解析',
      auto: '預設（按協議）',
      json_object: '服務商的 JSON 模式（json_object）',
      prompt_only: '僅靠提示詞',
    },
  },
}
