export default {
  projects: {
    title: 'Projects',
    sub: 'Each project is a folder in the data directory; the images and videos open in any other app',
    search: 'Search projects',
    noMatch: 'No projects match',
    filter: { label: 'Filter', all: 'All', active: 'In progress', done: 'Finished' },
    empty: {
      title: 'No projects yet',
      body: 'Create a project, add a novel or script, and dramai will break it into episodes, scenes and shots',
    },
    card: {
      episodesShots: '{{episodes}} ep. · {{shots}} shots',
      noEpisodes: 'No episodes yet',
      draft: 'Draft · not planned',
      allPlanned_one: '{{count}} episode to break down',
      allPlanned_other: '{{count}} episodes to break down',
      progressLabel: 'Progress per episode',
      episodeStatus: {
        storyboarding: 'Ep. {{n}} storyboarding',
        producing: 'Ep. {{n}} in progress',
        composed: 'Ep. {{n}} composed',
      },
    },
    new: {
      open: 'New project',
      title: 'New project',
      name: 'Title',
      namePlaceholder: 'e.g. Palace Intrigue',
      nameRequired: 'Please enter a title',
      aspect: 'Aspect ratio',
      aspectHint:
        'One aspect ratio for the whole project; images, videos and the cut all follow it',
      narration: 'How narration is delivered',
      narrationHint:
        'You can change this later. A video model’s built-in voice and narration can’t both be on one shot, so decide up front',
      style: 'Style',
      submit: 'Create and open',
    },
  },
}
