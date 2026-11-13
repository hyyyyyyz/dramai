export default {
  providerCatalog: {
    title: 'Add a provider',
    loading: 'Loading the presets…',
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
      model: 'Model',
      model_missing: 'The model name is required',
    },
  },
  providerDialect: {
    title: 'Advanced settings',
    listSeparator: ', ',
    fixToSave: 'Something in the advanced settings needs fixing before you can save',
    onlyHeaders:
      'This protocol only reads extra headers; the extra body, output length field and JSON output mode don’t apply to it',
    headers: {
      label: 'Extra request headers',
      hint: 'Sent with every request, for example the anthropic-workspace-id header Anthropic asks for with a key that isn’t limited to one workspace. Authorization, x-api-key, x-goog-api-key, x-key, api-key, Content-Type and anthropic-version are managed by dramai and can’t be overridden',
      name: 'Name',
      value: 'Value',
      add: 'Add a header',
      remove: 'Remove header {{name}}',
      invalid: 'A header name can only contain letters, digits and hyphens',
      protected: 'dramai manages this header; it can’t be overridden',
      duplicate: 'This name is already used',
      empty: 'A value is required',
      valueNewline: 'The value can’t contain a line break',
    },
    intro:
      'You usually don’t need these. Some providers’ APIs differ slightly from OpenAI’s, and this is where to adjust for that',
    extraBody: {
      label: 'Extra request body (JSON)',
      hint: 'Merged into every request body. A typical use: turn thinking off for a model that thinks by default, for example {"enable_thinking": false}.',
      protectedMany: 'The core fields {{fields}} are never overridden',
      protectedOne: 'The core field {{fields}} is never overridden',
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
