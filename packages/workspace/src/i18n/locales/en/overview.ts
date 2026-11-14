export default {
  overview: {
    episodeCount_one: '{{count}} episode',
    episodeCount_other: '{{count}} episodes',
    materialsAndPlan: 'Materials & episode plan',
    nextStepsLabel: 'Next steps',
    nextSteps: 'Episode {{n}} · {{title}} · next steps',
    inProgress: '{{active}} of {{total}} episodes in progress',
    stale_one: '{{count}} stale',
    stale_other: '{{count}} stale',
    cutStale: 'cut is stale',
    stepState: { done: 'done', now: 'current', todo: 'not started' },
    steps: {
      split: {
        title: 'Break into shots',
        done: '{{scenes}} scenes · {{shots}} shots',
        todo: 'This episode has no shots yet',
      },
      candidates: {
        title: 'Confirm candidates',
        pending_one: '{{count}} to confirm; shots aren’t ready until they’re handled',
        pending_other: '{{count}} to confirm; shots aren’t ready until they’re handled',
        notExtracted:
          'No candidates extracted yet. Extract characters, locations and props from the shots first',
        empty: 'Candidates are extracted after the shots exist',
        done_one: '{{count}} handled',
        done_other: '{{count}} handled',
      },
      sheets: {
        title: 'Asset sheets',
        none: 'No assets yet',
        count: '{{done}} / {{total}} assets have a sheet',
      },
      images: {
        title: 'Shot images',
        none: 'Starts after the shots exist',
        count: '{{done}} / {{total}} generated',
      },
      videos: {
        title: 'Videos',
        none: 'Starts once the shot images are done',
        count: '{{done}} / {{total}} generated',
      },
      compose: { title: 'Compose', todo: 'Starts once the videos are done', done: 'Composed' },
    },
    actions: {
      breakdown: 'Break into shots',
      extract: 'Extract candidates',
      goCandidates: 'Review',
      goAssets: 'Open assets',
      goStoryboard: 'Open storyboard',
      goCompose: 'Open compose',
    },
    episodes: {
      title: 'Episodes',
      shotsTotal_one: '{{count}} shot broken down',
      shotsTotal_other: '{{count}} shots broken down',
      colEpisode: 'Ep',
      colTitle: 'Title & source',
      colStatus: 'Status',
      colCut: 'Cut',
      shotProgress: '{{total}} shots: {{images}} images and {{videos}} videos generated',
      cut: 'Cut',
      cutCurrent: 'Current',
      cutStale: 'Stale',
      noCut: 'No cut yet',
      view: 'View',
      continue: 'Continue',
    },
    empty: {
      noMaterialTitle: 'Start with the source text',
      noMaterialBody:
        'Upload a novel or script (docx, txt, md). Long works are handled by chapter and never truncated',
      uploadAction: 'Upload materials',
      noEpisodesTitle: 'Plan the episodes',
      noEpisodesBody:
        'The text is in. Let the model split it into episodes by chapter, then break each one into shots',
      planAction: 'Plan episodes',
    },
    settings: {
      open: 'Project settings',
      title: 'Project settings',
      aspectChangeWarn:
        'Changing the aspect ratio only affects what is generated from now on; existing images and videos are not redone',
    },
    kv: {
      aspect: 'Aspect',
      aspectNote: 'Images, videos and the cut all follow it',
      style: 'Style',
      styleNote:
        'Expanded into a snapshot at creation; later template updates won’t change this project',
      narration: 'Narration',
      models: 'Models',
      noModels: 'Not configured. Set up providers',
      candidatesPending_one: '{{count}} to confirm',
      candidatesPending_other: '{{count}} to confirm',
      sourceText: 'Text',
      textSummary: '{{files}} file(s) · {{chapters}} chapters',
      referenceImages: 'References',
      imageCount_one: '{{count}} image',
      imageCount_other: '{{count}} images',
      none: 'None yet',
    },
  },
  narrationVoice: {
    title: 'Narration voice',
    for: 'Uses the current speech provider: {{name}} ({{model}})',
    noProvider:
      'No speech provider is selected yet. Add and select one in Settings first, then come back to pick a voice',
    label: 'Voice',
    typed: 'Voice name (typed)',
    choose: 'Choose a voice',
    useDefault: 'Default ({{voice}})',
    defaultIs: 'If you choose none, the model’s default voice is used: {{voice}}',
    required:
      '{{model}} has no default voice, so you have to choose one before narration can be generated',
    voiceNeeded:
      'To write a style instruction or a language hint, choose a voice first (this model has no default voice)',
    closedHint: 'This model has only the voices in the list; choose one of them',
    openHint:
      'Only the common voices are listed here. For another voice (your own cloned voice, say) choose “Type another voice…” and write it',
    typeOther: 'Type another voice…',
    noneHint:
      'This model has no system voices, so a voice name can only be typed (leave it empty if you don’t need one)',
    unknownHint: 'This model has no voice list, so type the voice name as the provider writes it',
    siliconflowFormat:
      'SiliconFlow voices are written “model:voice”, for example {{model}}:alex; choosing from the list writes it for you',
    formatBad:
      'That isn’t the right form: write “model:voice” (or a speech:… address from an uploaded reference audio)',
    documented:
      'The voice list comes from the official documentation and hasn’t been tested; the provider’s own list is what counts',
    notInList:
      '{{model}} doesn’t have this voice. Choose another from the list, or generation will be blocked',
    unlisted:
      'This voice isn’t in the list of common ones. That’s fine for your own cloned or custom voice; if it doesn’t exist the provider refuses and doesn’t charge',
    instructions: 'Style instruction (optional)',
    instructionsHint:
      'Describe the tone and mood in plain words, for example “calm, with a hint of a smile”',
    instructionsTooLong:
      'The style instruction is too long: at most {{max}} characters, a Chinese character counts as 2, and it is {{n}} now',
    ignoredInstructions: '{{model}} ignores style instructions; what you typed will not be used',
    language: 'Language hint (optional)',
    languageHint: 'For example zh, en, ja',
    ignoredLanguage: '{{model}} ignores the language hint; what you typed will not be used',
  },
}
