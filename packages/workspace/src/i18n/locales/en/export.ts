export default {
  export: {
    title: 'Episode {{n}} · {{title}} · Export',
    sub: 'Every product remembers what it was made from. When something upstream changes, what comes after is marked out of date, but it can still be downloaded',
    goCompose: 'Go to compose',
    block: { episode: 'This episode’s products' },
    ffmpeg: { ok: 'ffmpeg ready', bad: 'ffmpeg unavailable, the cut can’t be rendered' },
    status: {
      current: 'Latest',
      stale: 'Out of date',
      missing: 'Missing',
      blocked: 'Blocked',
      ready: 'Ready',
    },
    download: 'Download',
    downloadAnyway: 'Download anyway',
    cut: {
      title: 'Cut (mp4)',
      basis: {
        current: 'The cut matches the current timeline and shots',
        stale:
          'The timeline or shots changed after rendering. It can still be downloaded; dramai never re-renders on its own',
        missing: 'No cut has been rendered yet',
        blocked: 'The timeline has blocking issues, so it can’t be rendered',
      },
      render: 'Go render',
      rerender: 'Render again',
    },
    subs: {
      title: 'Subtitles (SRT / VTT)',
      basis: 'Built live from the narration text and the timeline, so always the current one',
      basisEmpty: 'The timeline is empty, so there are no subtitles to export',
    },
    narration: {
      title: 'Narration voice-over',
      basis: '{{current}} of {{total}} shots have an up-to-date voice-over',
      none: 'This episode has no narration voice-over',
      go: 'Go generate voice',
    },
    package: {
      title: 'Material package (zip)',
      basis:
        'Clip videos, narration, subtitles and more, organised by the timeline, to keep working on in an editor',
      basisBlocked: 'Needs a timeline with no blocking issues; there are {{count}} now',
      fix: 'Go fix',
      download: 'Download package',
      options: 'The package includes',
      images: 'Storyboard images',
      cut: 'The rendered cut',
      note: 'Downloading the package marks this episode as “exported”. It is a zip you import into your editor yourself; whether it imports cleanly depends on your editor’s version.',
    },
    project: {
      before: 'Backing up a whole project and importing an old backup:',
      link: 'Settings · Data and backup',
    },
  },
}
