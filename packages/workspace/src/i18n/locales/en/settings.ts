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
    general: {
      language: {
        title: 'Language',
        hint: 'Takes effect at once and is remembered on this computer. Built-in names (style presets, provider notes) switch too; what you typed yourself doesn’t change',
      },
      theme: {
        title: 'Theme',
        dark: 'Dark',
        light: 'Light',
        hint: 'Dark is like an editing suite, light suits daytime. It only affects this browser',
      },
      subtitles: {
        title: 'Default subtitles for the cut',
        hint: 'The default when rendering the cut; you can still change it before each render. Burning in needs an ffmpeg with the subtitles filter',
      },
      cost: {
        title: 'Cost conversion',
        enable: 'Combine estimates in different currencies into one number',
        hint: 'Off by default, so each currency is written separately. Converted figures are estimates, not a bill; currencies without a rate stay as they are',
        target: 'Convert to',
        targetBad: 'Use a currency code, such as CNY or USD',
        rates: 'Rates',
        currency: 'Currency',
        currencyBad: 'That isn’t a valid currency code',
        currencyDup: 'Duplicate, or the same as the target currency',
        rate: 'How many {{target}} for 1 unit',
        rateBad: 'The rate must be above 0',
        addRow: 'Add a currency',
        removeRow: 'Remove the rate for {{currency}}',
        unset: 'Currencies without a rate stay as they are; nothing is guessed.',
      },
    },
    access: {
      token: {
        title: 'Access token',
        on: 'An access token is on',
        off: 'No access token',
        onBody:
          'Browsers that open this service need to carry the token. It is only set at startup, so it isn’t shown or changed here.',
        offBody:
          'Only this computer can reach the service (it listens on this machine only by default), so no token is needed.',
        how: 'Set it at startup with --token <at least 16 characters>, or the DRAMAI_TOKEN environment variable. Open the full address printed in the terminal at startup (with ?token=…) once and the browser remembers it.',
      },
      host: {
        title: 'Address',
        current: 'Current address',
        local:
          'You opened this from a local address, so only programs on this computer can reach it.',
        remote:
          'You opened this from {{host}}, so other devices on the same network may be able to reach this service.',
        remoteNoToken:
          'This service is reachable from other devices but has no access token: anyone on the network can read and write your projects. Restart it with --token.',
        how: 'Set the listening address with --host; a non-local address must come with a token. The service only accepts local addresses or the ones you set with --host, and rejects any other Host.',
      },
    },
    data: {
      dir: {
        title: 'Data folder',
        body: 'All projects, materials, images, videos, cuts and settings live in this folder. Back it up and you have backed up everything.',
      },
      import: {
        title: 'Import an old backup',
        sub: 'A v0.4 JSON backup',
        body: 'Imports a backup file exported by v0.4 as new projects. The old projects are not touched.',
        choose: 'Choose a backup file',
        duplicate: 'Import projects that were imported before again',
        hint: 'Old generation records and unfinished video tasks don’t come across; images and videos are registered as products against the current basis.',
        done_one: 'Imported {{count}} project',
        done_other: 'Imported {{count}} projects',
        counts:
          '{{episodes}} episodes · {{shots}} shots · {{assets}} assets · {{materials}} materials · {{images}} images · {{videos}} videos',
        skippedArtifacts: '{{count}} products were not registered',
        skipped: 'Skipped {{id}}: {{reason}}',
        dropped:
          'Not brought across: {{generations}} generation records and {{tasks}} unfinished video tasks.',
      },
      trash: {
        title: 'Trash',
        sub: 'Deleted projects wait here first',
        empty: 'The trash is empty.',
        meta: 'Deleted {{deleted}} · {{episodes}} episodes · {{shots}} shots',
        restore: 'Restore',
        restoreLabel: 'Restore project {{name}}',
        restored: 'Restored “{{name}}”',
        purge: 'Delete for good',
        purgeLabel: 'Delete project {{name}} for good',
        purgeTitle: 'Delete “{{name}}” for good?',
        purgeBody:
          'The project folder will be removed, including materials, images, videos and cuts. This can’t be undone.',
        purgeConfirm: 'Delete for good',
      },
    },
    about: {
      app: {
        title: 'Runtime',
        version: 'Version',
        node: 'Node.js',
        platform: 'System',
        started: 'Service started',
      },
      ffmpeg: {
        ok: 'Ready',
        bad: 'Unavailable',
        notFound: 'ffmpeg was not found',
        path: 'Path',
        source: 'Found via',
        sources: { option: 'Startup option', env: 'Environment variable', path: 'PATH' },
        version: 'Version',
        encoder: 'Video encoder',
        features: 'ffmpeg capabilities',
        available: 'available',
        unavailable: 'unavailable',
        required: 'required',
        optional: 'optional',
        feature: {
          h264: 'H.264 encoding',
          aac: 'AAC encoding',
          baseFilters: 'Basic filters (join, mix)',
          subtitleBurnIn: 'Burning subtitles into the picture',
          transitions: 'Transition filter (xfade)',
          loudness: 'Loudness measurement',
          probe: 'ffprobe',
        },
      },
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
    'ark-video': 'Volcengine Ark / BytePlus Seedance (video)',
    'kling-contents': 'Kling 4.0 (video)',
    'dashscope-video': 'Alibaba Model Studio Wan 3.0 (video)',
    'openai-tts': 'OpenAI-compatible (speech)',
    'minimax-t2a': 'MiniMax (speech)',
    'dashscope-cosyvoice': 'Alibaba CosyVoice (speech)',
    'openai-responses': 'OpenAI Responses (text)',
    'anthropic-messages': 'Anthropic Messages (text)',
    'volcengine-images': 'Volcengine Seedream (image)',
    'dashscope-image': 'Alibaba Qwen-Image (image)',
    'siliconflow-images': 'SiliconFlow (image)',
    'kling-image': 'Kling (image)',
    'gemini-chat': 'Gemini generateContent (text)',
  },
  providers: {
    voiceSwitch: {
      title: 'After switching to “{{name}}”, some projects need their narration voice chosen again',
      not_available:
        'The voice “{{voice}}” of “{{project}}” isn’t in the new provider’s list, so generation may fail or be blocked by the check before it.',
      required:
        '“{{project}}” has no voice yet, and this model of the new provider has no default voice.',
      unlisted:
        'The voice “{{voice}}” of “{{project}}” isn’t in the new provider’s list of common voices; if it belongs to another provider, the check before generating may block it.',
      unchecked:
        'This model of the new provider has no voice list, so whether the voice “{{voice}}” of “{{project}}” works can’t be checked here; the check before generating will say.',
      go: 'Choose the voice again',
      dismiss: 'Got it',
    },
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
    testNeedsLoginChannels: {
      'openai-chatgpt': 'Sign in with ChatGPT before testing the connection',
      openrouter: 'Sign in with OpenRouter before testing the connection',
    },
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
    minPixels: 'Minimum pixels',
    minPixelsHint:
      'A size below this many pixels is scaled up proportionally before the request is sent',
    pixels: '{{n}} pixels',
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
