export default {
  providerCatalog: {
    title: 'Add a provider',
    search: 'Search providers',
    empty: 'There are no presets for this kind yet. You can add a custom provider',
    noMatch: 'No preset matches “{{query}}”. Try another word, or add a custom provider',
    region: { cn: 'China site', global: 'International site', local: 'On this machine' },
    localShort: 'Runs on this machine: start it here first',
    localNote:
      'This runs on your own machine: start it here first (and load a model), then come back and test the connection. dramai doesn’t start it for you',
    needsInput: 'Needs a little information from you when adding',
    fill: {
      title: 'Add “{{name}}”',
      back: 'Back',
      placeholderHint:
        'Replace {{name}} in the address with your own value (you can find it in this provider’s console)',
      missing: '{{name}} is required, otherwise this provider can’t be reached',
      invalid: '{{name}} can only contain letters, digits and . _ ~ -',
      modelHint:
        'This provider has no default model: enter the name of the model you loaded locally. You can also pick it from a list after adding',
      model_missing: 'The model name is required',
    },
  },
  providerDialect: {
    title: 'Advanced settings',
    intro:
      'You usually don’t need these. Some providers’ APIs differ slightly from OpenAI’s, and this is where to adjust for that',
    extraBody: {
      label: 'Extra request body (JSON)',
      hint: 'Merged into every request body. A typical use: turn thinking off for a model that thinks by default, for example {"enable_thinking": false}. Core fields such as model, messages and stream are never overridden',
      invalid: 'That isn’t valid JSON. Fix it to be able to save',
      notObject: 'Write it as a JSON object, for example {"key": "value"}',
    },
    maxTokensField: {
      label: 'Output length field',
      hint: 'Which field name limits the output length. Most providers use max_tokens; newer OpenAI models need max_completion_tokens',
      auto: 'Default (by protocol)',
    },
    jsonMode: {
      label: 'JSON output mode',
      hint: 'How structured output is requested: the provider’s own JSON mode, or only asking in the prompt and parsing it ourselves',
      auto: 'Default (by protocol)',
      json_object: 'The provider’s JSON mode (json_object)',
      prompt_only: 'Prompt only',
    },
  },
}
