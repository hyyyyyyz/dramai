export default {
  jobs: {
    title: 'Tasks',
    collapse: 'Collapse task panel',
    footer: 'Tasks live in the local service and keep running after you close the browser',
    empty:
      'No tasks yet. Progress shows up here when you generate images or videos or plan episodes',
    emptyFilter: 'Nothing in this group right now',
    workerError: 'The job runner hit an error',
    notice: {
      dismiss: 'Got it',
      native_audio_default_failed: {
        title: 'The timeline’s default mute wasn’t set',
        body: 'The video was generated and saved; nothing failed. Only the step that starts this new clip’s own audio muted didn’t finish, so the clip’s audio volume stays as it was: if its model has its own audio, check the clip’s audio volume on the timeline',
      },
      audio_decode_warnings: {
        title: 'This narration may be incomplete or damaged',
        body: 'The narration is saved and the task succeeded, but problems turned up when decoding it, so the audio may be incomplete or damaged. Listen to it first, and regenerate it if needed',
      },
      transient:
        'These notes are shown only while you have the app open; they won’t be here after a refresh',
    },
    workerErrorBody:
      'The background runner reported an error, so some jobs may not advance. Details are in the server log; restarting the service usually recovers it',
    triggerRunning: '{{n}} running',
    triggerAttention: '{{n}} need action',
    tabs: { all: 'All', running: 'Running', queued: 'Queued', attention: 'Needs action' },
    groups: {
      attention: 'Needs action',
      running: 'Running',
      queued: 'Queued',
      recent: 'Recently finished',
    },
    lane: { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio', render: 'Render' },
    op: {
      episodes_plan: 'Plan episodes',
      episode_breakdown: 'Break into shots',
      entities_extract: 'Extract candidates',
      shot_frames: 'Write shot prompts',
      asset_sheet: 'Generate asset sheet',
      shot_image: 'Generate shot image',
      shot_video: 'Generate video',
      shot_audio: 'Narration voice-over',
      compose: 'Render cut',
      unknown: 'Job · {{operation}}',
    },
    target: { shot: 'shot {{n}}', removed: 'a deleted item', edit: 'edit by instruction' },
    ignoredNote:
      'Result marked as ignored: it runs to completion and is billed as usual, and lands in the version history without becoming current',
    ignoredInputs: 'Inputs that were not used this time: {{list}}',
    ignoredInput: {
      instructions: 'style instruction (this model doesn’t take it, so it was not used)',
      language: 'language hint (this model doesn’t take it, so it was not used)',
      speed: 'speed (outside the provider’s range, adjusted into it)',
    },
    ignoredLabel: 'result ignored',
    queuePosition: 'Position {{n}} in line',
    elapsed: '{{duration}} so far',
    tookTime: 'Took {{duration}}',
    cancelledLabel: 'Cancelled',
    attempt: 'Attempt {{n}}',
    streamedChars_one: '{{n}} char generated',
    streamedChars_other: '{{n}} chars generated',
    runningNotCancellable:
      'Submitted to the provider and can’t be cancelled; calls already sent run to completion and are billed as usual',
    runningLocal: 'Running; it can’t be cancelled',
    failure: {
      generation_failed:
        'The provider refused the request or generation failed. This can’t be resumed, only regenerated',
      delivery_failed:
        'Generation finished but fetching the result failed. The upstream job still exists and can be resumed',
      submission_unknown:
        'Submission unconfirmed: no upstream job id was received before the restart or disconnect, so it is unknown whether it was submitted or billed',
      recovery_failed:
        'After the restart this job couldn’t be restored with its original configuration',
      invalid_input:
        'Something about the input is wrong (e.g. a file couldn’t be read). No paid call was made',
      internal: 'An internal error occurred, with no more information',
    },
    failureUnknownNote: 'Check the provider’s dashboard first. dramai never resubmits on its own',
    actions: {
      ignoreResult: 'Ignore result',
      undoIgnore: 'Don’t ignore',
      cancelQueued: 'Cancel (queued)',
      resume: 'Resume original task',
      regenerate: 'Regenerate',
      regenerateRecharge: 'Regenerate (may be charged again)',
      retryLocal: 'Retry',
      acknowledge: 'Dismiss',
      acknowledgeChecked: 'I’ve checked, dismiss',
    },
    confirm: {
      title: 'Regenerating may be charged again',
      action: 'Regenerate (may be charged again)',
      bodyUnknown:
        'The submission result for this job is unknown: the provider may have received the request and billed it. Regenerating sends a new request, which may be charged again. Check the provider’s dashboard before deciding',
      bodyUpstream:
        'This job already has an upstream job id at the provider. Regenerating abandons it and sends a new request, which may be charged again',
      preferResume:
        'If only fetching the result failed, it is cheaper to cancel this dialog and choose “Resume original task”',
    },
  },
}
