export default {
  settings: {
    tabsLabel: 'Settings sections',
    tabs: {
      providers: 'Providers',
      general: 'General',
      access: 'Access & security',
      data: 'Data & backup',
      about: 'About',
    },
  },
  protocol: {
    'openai-chat': 'OpenAI-compatible',
    'openai-images': 'OpenAI-compatible (images)',
    'gemini-image': 'Gemini native',
    'aliyun-video': 'Alibaba DashScope',
    'volcengine-video': 'Volcengine Ark',
    'kling-video': 'Kling',
    'generic-video': 'Generic video API',
    'openai-tts': 'OpenAI-compatible (speech)',
  },
  providers: {
    intro:
      'API keys are stored only on the computer running dramai and are never shown again after saving; you can only replace them. Every request is sent by the local service with no relay in between. If a model lacks a capability, generation fails and says why; it never silently switches to another model',
    kinds: {
      llm: {
        title: 'Language model · storyboard writing',
        desc: 'Plans episodes, scenes and shots; extracts characters, locations and props',
        empty: 'No language-model provider yet. Add one to plan episodes and break them into shots',
      },
      image: {
        title: 'Text-to-image · sheets and shot images',
        desc: 'Asset sheets first; shot images then use them as references',
        empty: 'No image provider yet',
      },
      video: {
        title: 'Image-to-video · shot clips',
        desc: 'The slowest and most expensive step',
        empty: 'No video provider yet',
      },
      tts: {
        title: 'Voice-over · narration',
        desc: 'Reads the narration aloud and mixes it into the cut',
        empty:
          'No voice provider yet. You can also set a project to “Dub later” and record in your editor',
      },
    },
    current: 'In use: {{name}}',
    notConfigured: 'Not configured',
    llmMissing:
      'No language-model provider is selected: planning episodes and breaking down shots both need one',
    ttsMissing_one:
      '“{{name}}” delivers narration by TTS, but there is no voice provider yet, so shots with narration can’t be rendered',
    ttsMissing_other:
      '“{{name}}” and {{count}} other projects deliver narration by TTS, but there is no voice provider yet, so shots with narration can’t be rendered',
    ttsMissingGo: 'View project',
    active: 'In use',
    setActive: 'Use this',
    noKey: 'No API key yet',
    expand: 'Expand {{name}}',
    collapse: 'Collapse {{name}}',
    form: { name: 'Name', protocol: 'API protocol' },
    key: {
      saved: 'Saved · {{mask}}',
      replace: 'Replace',
      placeholder: 'Paste a new key',
      save: 'Save key',
      hint: 'Keys are write-only: once saved they are never shown or sent back to the browser, only replaced',
    },
    undeclared:
      'This model isn’t in dramai’s model profiles, so the capabilities below are conservative defaults, not what the model can really do',
    capabilities: 'Model capabilities',
    pricing: 'Pricing',
    pricingNote:
      'An estimate, not a bill. The cost shown before a batch uses this table; the provider’s current page is authoritative',
    limitations: 'Known limitations',
    verifiedAt: 'Preset verified {{date}}',
    acceptedUnverified_one:
      'You accepted {{count}} unverified capability, so it isn’t confirmed separately when generating',
    acceptedUnverified_other:
      'You accepted {{count}} unverified capabilities, so they aren’t confirmed separately when generating',
    testSaveFirst: 'Save your changes before testing the connection',
    testNeedsKey: 'Save an API key before testing the connection',
    test: {
      action: 'Test connection',
      ok: 'Connected',
      modelCount_one: '{{count}} model',
      modelCount_other: '{{count}} models',
      modelNotListed: 'But the model you entered isn’t in the provider’s list. Check Model',
      failed: 'Connection failed',
      unverifiable:
        'This protocol has no standard listing endpoint, so it can’t be verified automatically. Confirm with one real generation',
      details: 'Technical details',
    },
    delete: {
      title: 'Delete this provider?',
      body: '“{{name}}” and its saved key will be deleted. Jobs already queued are unaffected',
    },
    add: {
      label: 'Add provider',
      custom: 'Custom provider',
      customTitle: 'Add a custom provider',
      create: 'Add',
    },
  },
  capability: {
    state: { supported: 'Supported', unsupported: 'Not supported', unverified: 'Unverified' },
    mode: {
      t2i: 'Text-to-image',
      i2i: 'Image-to-image',
      i2v: 'Image-to-video',
      t2v: 'Text-to-video',
      tts: 'Speech synthesis',
    },
    refImages: 'Reference images',
    upTo: 'Up to {{n}}',
    refImagesChip: 'Up to {{n}} reference images',
    refImagesUnverified: 'Reference images: unverified',
    firstFrame: 'First frame',
    lastFrame: 'Last frame',
    nativeAudio: 'Built-in voice',
    nativeAudioChip: 'Built-in voice',
    noNativeAudioChip: 'No built-in voice',
    durations: 'Duration',
    seconds: '{{n}} s',
    secondsRange: '{{min}}–{{max}} s',
    resolutions: 'Resolution',
    resolutionNone: 'Not selectable',
    aspectRatios: 'Aspect ratios',
    unit: {
      per_image: 'Per image',
      per_second: 'Per second',
      per_call: 'Per call',
      per_1k_chars: 'Per 1k chars',
    },
    unpriced: 'Unpriced: no unit price could be found for this model, and dramai doesn’t guess',
    priceMetric: 'Metric',
    priceAmount: 'Price',
  },
}
