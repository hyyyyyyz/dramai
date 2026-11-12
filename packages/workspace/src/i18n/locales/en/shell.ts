export default {
  desktop: {
    reveal: 'Show in folder',
    revealProject: 'Show project in folder',
    revealMissing: 'That file wasn’t found. It may have been moved',
    dataDirHint:
      'To use another data folder, use “Change Data Folder…” in the app menu. Existing data is not moved',
    plainSecrets:
      'This computer has no usable system key store, so API keys are protected by file permissions only, not encrypted by the system. They are encrypted automatically once a key store is available',
    notifications: {
      title: 'Desktop notifications',
      label: 'Notify me when tasks finish or need attention',
      hint: 'Only shown while the window is not in front; tasks that end together become one notification',
    },
    notify: {
      done_one: '{{count}} task finished',
      done_other: '{{count}} tasks finished',
      attention_one: '{{count}} task needs attention',
      attention_other: '{{count}} tasks need attention',
    },
  },
  shell: {
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
    language: 'Language',
    demoTitle: 'Demo mode',
    demoNotice: 'Providers are local simulators: nothing is charged and the content is placeholder',
    serviceOk: 'Local service running',
    serviceConnecting: 'Connecting to the local service…',
    serviceDown: 'Disconnected from the local service, reconnecting',
    ffmpegOk: 'ffmpeg ready',
    ffmpegLimited: 'ffmpeg is missing features',
    ffmpegMissing: 'ffmpeg not found',
    dataDir: 'Data directory {{dir}}',
    currentEpisode: 'Current episode',
    noEpisodes: 'No episodes yet',
    switchEpisode: 'Switch episode',
    allProjects: 'All projects',
    projectNav: 'Project navigation',
    episodeNav: 'Current episode navigation',
    mainNav: 'Main navigation',
    groupProject: 'Project',
  },
}
