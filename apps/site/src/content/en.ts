import { REPO } from './site.ts'
import type { Content } from './types.ts'

export const en: Content = {
  locale: 'en',
  htmlLang: 'en',
  name: 'dramai',
  meta: {
    title: 'dramai · an open-source AI short-drama studio that runs on your own computer',
    description:
      'An open-source AI short-drama studio that runs on your own computer: plan episodes, scenes and shots, generate images and video through the AI providers you choose, and compose a cut with narration and subtitles. Projects are plain folders and API keys stay on your machine.',
    ogAlt: 'dramai, an open-source AI short-drama studio that runs on your own computer',
  },
  skip: 'Skip to content',
  header: {
    nav: [
      { id: 'pipeline', label: 'Workflow' },
      { id: 'features', label: 'Features' },
      { id: 'editions', label: 'Editions' },
      { id: 'cost', label: 'Cost' },
      { id: 'download', label: 'Download' },
      { id: 'faq', label: 'FAQ' },
    ],
    navLabel: 'Page sections',
    themeLabel: 'Switch between dark and light',
    github: 'GitHub',
    download: 'Download',
    homeLabel: 'dramai home',
    languageLabel: 'Language',
    otherLanguage: '简体中文',
  },
  hero: {
    title: ['Turn stories into short dramas,', 'on your own computer'],
    lead: 'dramai is an open-source AI short-drama studio. Give it a novel or a script and it plans episodes, scenes and shots, generates images and video through the AI providers you choose, and composes a finished cut with narration and subtitles. Projects are ordinary folders on your disk, your API keys stay on your machine, and nothing passes through a service we run.',
    primary: 'Download the desktop app',
    secondary: 'Run the WebUI',
    statusPrefix: 'Beta',
    status:
      'Verified with automated tests and simulated providers only. Not yet run against a real AI provider.',
    statusLink: 'See where it stands',
    shotAlt:
      'The storyboard page: shots grouped by scene, each with its image, video, narration, prompt and the assets it uses',
    shotCaption:
      'The storyboard of a small demo project. The pictures are placeholder sketches made by demo mode, not generated art.',
  },
  pipeline: {
    title: 'From source text to a finished cut, in six steps',
    lead: 'Redo a single shot without touching the rest: a new result is saved as a new version and the old one is kept. When something upstream changes, what depends on it is marked out of date, and nothing is regenerated on its own.',
    stageLabel: 'Step',
    stages: [
      {
        title: 'Materials',
        text: 'Upload a novel or a script (docx, txt or md), and reference images if you have them. Long texts are not truncated; they are split into episodes by chapter.',
        out: 'Produces: source text and references',
      },
      {
        title: 'Storyboard',
        text: 'A language model plans the text into episodes, then breaks them into scenes and shots, each with a scene description, narration or dialogue, and a prompt',
        out: 'Produces: episodes and a shot list',
      },
      {
        title: 'Assets',
        text: 'Characters, locations, props and costumes are assets that shots refer to. You confirm the candidates found in the text, and each asset gets one reference sheet.',
        out: 'Produces: the asset library and reference sheets',
      },
      {
        title: 'Pictures',
        text: 'Shot images are generated with the asset reference sheets as references. Pick the look once, when you create the project: 20 presets, or describe your own.',
        out: 'Produces: one image per shot',
      },
      {
        title: 'Video and narration',
        text: 'Image-to-video jobs queue in the local server and keep running when you close the browser. Narration can be voiced by TTS, or left for you to record later.',
        out: 'Produces: one clip per shot, and narration',
      },
      {
        title: 'Compose and export',
        text: 'Your own ffmpeg renders the timeline in 9:16, 16:9 or 1:1, with soft or burned-in subtitles. Export the cut, SRT, VTT and an asset package.',
        out: 'Produces: the cut, subtitles and an asset package',
      },
    ],
  },
  features: {
    title: 'Why it runs on your machine',
    lead: 'A browser-only app is limited by CORS, storage quotas and in-browser video encoding. With a local server those limits are gone, and long jobs no longer stop when you close the tab.',
    items: [
      {
        icon: 'shield',
        title: 'Local, with your keys',
        text: 'A server on 127.0.0.1 does all the work. Projects are ordinary files plus a SQLite database, so other software can open them. Provider requests are made by that server: no CORS limit, no relay in between.',
      },
      {
        icon: 'users',
        title: 'Serials and a reusable library',
        text: 'A project holds episodes, episodes hold scenes, scenes hold shots. Characters, locations, props and costumes live in an asset library, each with one reference sheet that every shot using it is generated from.',
      },
      {
        icon: 'link',
        title: 'Checks before paid generation',
        text: 'Shots that refer to an unregistered asset, or one without a reference image, are blocked. A batch runs completely or not at all, and a cost estimate is shown before you confirm.',
      },
      {
        icon: 'tasks',
        title: 'A task queue that survives restarts',
        text: 'Closing the browser does not stop work. After a restart a video task with an upstream task id resumes polling; one without it is marked “submission unconfirmed” and is never resubmitted automatically. Cancelling only affects tasks that are still queued.',
      },
      {
        icon: 'film',
        title: 'Versions kept, nothing overwritten',
        text: 'Regenerating adds a version and does not overwrite the previous one. When something upstream changes, what depends on it is marked out of date, and nothing is regenerated on its own.',
      },
      {
        icon: 'export',
        title: 'Native ffmpeg composition',
        text: 'The cut is rendered with the ffmpeg installed on your machine: 9:16, 16:9 or 1:1, narration voice, soft or burned-in subtitles, SRT and VTT. An asset package lets you keep editing elsewhere.',
      },
    ],
    locales:
      'The workspace speaks English, Simplified Chinese and Traditional Chinese, in a light and a dark theme',
    screensTitle: 'The workspace, as it looks today',
    screensNote:
      'These screenshots come from demo mode: the providers are simulators on your machine, the pictures are placeholder sketches, and the amounts are in a fictional currency',
    screens: [
      {
        shot: 'overview',
        alt: 'Project overview with the next steps of the current episode, the episode list and project settings',
        title: 'Project overview',
        text: 'The next steps for the current episode, and the state of every episode',
      },
      {
        shot: 'assets',
        alt: 'The asset library with character reference sheets',
        title: 'Asset library',
        text: 'Characters, locations, props and costumes. The three-view sheets shown here are placeholder sketches from demo mode.',
      },
      {
        shot: 'compose',
        alt: 'The compose page with a timeline of picture, narration and subtitle tracks and a list of issues',
        title: 'Compose',
        text: 'A timeline of picture, narration, subtitles and music, with a list of issues that would block rendering',
      },
      {
        shot: 'tasks',
        alt: 'The storyboard with the task panel open: one task needing action, three running and three queued',
        title: 'Task panel',
        text: 'Tasks that need action, running tasks and the queue, with the storyboard updating beside it. Tasks already submitted to a provider cannot be cancelled and are billed as usual.',
      },
    ],
    stylesTitle: '20 style presets, or describe your own',
    stylesLead:
      'The look is chosen when the project is created and kept as a snapshot. You can skip the presets and describe a style yourself; leave it empty and the language model infers one from the text.',
    styleGroups: [
      {
        name: 'Anime',
        presets: [
          'Shonen action manga',
          'Healing slice-of-life',
          'Classical xianxia',
          'School romance manga',
          'Cute chibi',
        ],
      },
      {
        name: 'Live-action look',
        presets: [
          'Modern urban drama',
          'Suspense realism',
          'Lyrical realism',
          'Documentary / news look',
          'Vlog / short video',
        ],
      },
      {
        name: 'Art styles',
        presets: ['Ink wash painting', 'Oil painting', '3D CG animation', 'Pixel art', 'Low poly'],
      },
      {
        name: 'Themes',
        presets: [
          'Cyberpunk',
          'Steampunk',
          'Fairy-tale picture book',
          'Horror suspense',
          'Retro 80s',
        ],
      },
    ],
  },
  editions: {
    title: 'Desktop app or WebUI',
    lead: 'Both run the same local server and the same workspace. The difference is how you start it, and a few system integrations.',
    desktop: { name: 'Desktop app', blurb: 'Its own window, no terminal needed' },
    webui: { name: 'WebUI', blurb: 'Started from the command line, used in your browser' },
    rows: [
      {
        label: 'How you get it',
        desktop:
          'Download an installer from GitHub Releases, or build and install it from source on your machine (`pnpm desktop:install`)',
        webui:
          'Run from source: `pnpm webui` starts the server, serves the workspace and opens your browser',
      },
      {
        label: 'Good for',
        desktop: 'Anyone who wants a separate application window',
        webui:
          'People at home on the command line, or who want to reach the server from another device',
      },
      {
        label: 'ffmpeg',
        desktop: 'Not bundled; install it yourself',
        webui: 'Not bundled; install it yourself',
      },
      {
        label: 'API keys',
        desktop:
          'Encrypted with the operating system key store where one exists (macOS Keychain, Windows DPAPI, Linux libsecret or kwallet)',
        webui:
          'Kept in `secrets.json` in the data directory, readable only by your operating system user, not encrypted',
      },
      {
        label: 'Network access',
        desktop: 'Local to your machine; the window carries its own access token',
        webui:
          'Listens on `127.0.0.1` only; to reach it from another device you must pass `--host` together with an access token',
      },
      {
        label: 'Notifications and updates',
        desktop:
          'System notifications. No automatic updates: it tells you at launch when a newer version exists and you download it yourself',
        webui:
          'No notifications; look at the task panel. Updating means pulling the new code and rebuilding',
      },
      {
        label: 'Where data lives',
        desktop:
          'On macOS `~/Library/Application Support/Dramai/data` by default; changeable from the menu',
        webui: '`~/.dramai` by default; set it with `--data-dir`',
      },
      {
        label: 'How well tested',
        desktop:
          'Started on a real macOS Apple silicon machine; the other systems have only been built by CI',
        webui: 'Browser tests cover the whole workflow (in demo mode)',
      },
    ],
  },
  cost: {
    title: 'What a short drama costs',
    lead: 'dramai itself is free and open source under Apache-2.0. The cost comes only from the AI providers you connect, at their prices.',
    headline: 'There is no trustworthy figure for a whole drama yet',
    headlineText:
      'We have not yet run a complete drama against real providers, so we do not quote a total. A precise-looking number would mislead more than no number.',
    paysTitle: 'What you pay a provider for',
    pays: [
      'The storyboard breakdown and prompts: a language model',
      'Shot images and reference sheets: an image model',
      'Shot videos: a video model',
      'Narration: only if you choose TTS inside dramai; not if you record it later',
    ],
    freeTitle: 'What costs the providers nothing',
    free: ['Composing, subtitles and export: ffmpeg on your own machine', 'dramai itself'],
    guardTitle: 'Every paid step shows you first',
    guards: [
      {
        title: 'An estimate before you confirm',
        text: 'Before a batch runs, you see an estimate from the model’s price table, and nothing is ordered from a provider until you confirm. It is an estimate, not a bill; prices are whatever the provider’s page says today.',
      },
      {
        title: 'Complete batches or none',
        text: 'Shots that refer to an unregistered asset, or one without a reference image, are blocked. A shot has at most one video task in flight.',
      },
      {
        title: 'No quiet double charges',
        text: 'A video task cut off before the provider confirmed it is marked “submission unconfirmed”. dramai asks you to check the provider’s dashboard and never resubmits on its own.',
      },
    ],
    shotAlt:
      'The confirmation dialog before a batch video job, with the model, aspect ratio, estimated cost and warnings',
    shotCaption:
      'The confirmation before a batch. A demo-mode screenshot: the amount is in the demo’s fictional currency.',
    fine: 'The model ids and prices in the four provider presets were last checked in May 2026 and have not been checked since, so real prices may have changed',
  },
  install: {
    title: 'Install',
    lead: 'To use real providers, add a language model, an image model, a video model (and a voice) under Settings → Providers; the app can test a connection. To see the workflow first, use demo mode: no account, no key and no cost.',
    desktop: {
      name: 'Desktop app',
      blurb: 'An Electron window around the same local server and workspace',
      platforms: [
        {
          name: 'macOS · Apple silicon',
          detail: '`.dmg` disk image, or `.zip`',
          files: ['dramai-{version}-mac-arm64.dmg', 'dramai-{version}-mac-arm64.zip'],
          tested: true,
        },
        {
          name: 'macOS · Intel',
          detail: '`.dmg` disk image, or `.zip`',
          files: ['dramai-{version}-mac-x64.dmg', 'dramai-{version}-mac-x64.zip'],
          tested: false,
        },
        {
          name: 'Windows · x64',
          detail: '`.exe` installer, or a portable `.zip`',
          files: ['dramai-{version}-win-x64.exe', 'dramai-{version}-win-x64.zip'],
          tested: false,
        },
        {
          name: 'Linux · x64',
          detail: '`.AppImage`, or `.tar.gz`',
          files: ['dramai-{version}-linux-x64.AppImage', 'dramai-{version}-linux-x64.tar.gz'],
          tested: false,
        },
      ],
      testedLabel: 'Started on a real machine',
      untestedLabel: 'Only built by CI',
      releases: 'Download from GitHub Releases',
      releasesTag: 'Release notes for this version',
      note: 'This version is marked as a pre-release, so it is not the one labelled Latest on the Releases page. `SHA256SUMS.txt` on the release lists the checksums. The installers are between 120 and 160 MB.',
      unsignedTitle: 'The installers are not code-signed',
      unsigned: [
        'macOS: the first launch is blocked. Open System Settings > Privacy & Security and click “Open Anyway” next to Dramai, or run `xattr -dr com.apple.quarantine /Applications/Dramai.app` in Terminal.',
        'Windows: when SmartScreen warns you, click “More info”, then “Run anyway”',
        'Linux: `chmod +x` the AppImage and run it (it needs FUSE 2), or use the `.tar.gz`',
        'To avoid all of this, build and install from source on your own machine with `pnpm desktop:install`: no certificate and no download warnings',
      ],
      sizeNote: '',
    },
    webui: {
      name: 'WebUI',
      blurb:
        'Run from source: starts the local server, serves the workspace and opens your browser',
      prerequisites: 'You need Node.js 22.22.2 or newer, pnpm 9 and ffmpeg',
      commands: [
        {
          comment: 'Get the code and build it',
          command: `git clone ${REPO}.git\ncd dramai\npnpm install\npnpm build`,
        },
        { comment: 'Start it, at http://127.0.0.1:8787 by default', command: 'pnpm webui' },
        { comment: 'Or try demo mode first, no key needed', command: 'pnpm demo' },
      ],
      options:
        'Options: `--port`, `--data-dir`, `--no-open`. The default data directory is `~/.dramai`.',
      network:
        'It listens on this machine only. To reach it from another device you must pass `--host` together with an access token.',
      copy: 'Copy commands',
      copied: 'Copied',
      notYet:
        'There is no npm package or Docker image yet, so running from source is the only way for now',
    },
    ffmpeg: {
      title: 'Install ffmpeg',
      text: 'ffmpeg is not bundled in any form; install it yourself. Burning subtitles into the picture needs a build with libass; Settings → About shows what your ffmpeg can do.',
      commands: [
        { os: 'macOS', command: 'brew install ffmpeg' },
        { os: 'Windows', command: 'winget install Gyan.FFmpeg' },
        { os: 'Linux', command: 'apt install ffmpeg' },
      ],
    },
    status: {
      title: 'Where it stands',
      lead: 'This is a beta. What follows is the actual situation as written in the README, without polish.',
      works: {
        title: 'Works today',
        items: [
          'The whole workflow runs end to end in demo mode: upload a text, plan episodes, break down shots, confirm characters and locations, generate images and video, compose, export',
          'Browser tests (Playwright) cover that path, a failed task being resumed, the English interface and keyboard-only use',
          'The macOS Apple silicon desktop build has been started on a real machine: the window loads, the server is healthy and authentication works. CI runs on Linux, macOS and Windows.',
        ],
      },
      unverified: {
        title: 'Not verified',
        items: [
          'Any real AI provider',
          'The macOS Intel, Windows and Linux installers: CI builds them and runs an install self-check on Windows and Linux, but nobody has opened them on a real machine yet',
          'Character consistency: the multi-reference approach is implemented but has not been tried on a real image service',
          'API keys are not encrypted in the WebUI',
        ],
      },
      notReleased: {
        title: 'Not there yet',
        items: [
          'An npm package and a Docker image',
          'A real JianYing draft file: today the export is an asset package that you drag into JianYing by hand',
          'Automatic updates: the desktop app only tells you when a newer version exists',
          'Transitions are hard cuts, there is a single music track, and the in-browser preview leaves out subtitles, music and transitions',
        ],
      },
    },
    legacy: {
      title: 'Used the v0.4 web app?',
      text: 'It kept your projects inside the browser, so the new version cannot see them. The old web app has been removed from this site, so you can no longer export a backup here. If you already exported a JSON backup, import it in the new version under Settings → Data & backup. The last browser-only version is v0.4.1',
      link: 'See the v0.4.1 release',
    },
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        q: 'Does dramai cost money?',
        a: [
          'The software is free and open source under Apache-2.0. You only pay the AI providers you connect, at their prices.',
        ],
      },
      {
        q: 'Where do my materials and API keys go?',
        a: [
          'Nothing passes through a service we run, because there is none. Materials and finished cuts live in your data directory. API keys stay on your machine: the desktop app encrypts them with the system key store where one exists, and in the WebUI they are in `secrets.json` in the data directory, not encrypted.',
          'When you generate, the text of your materials and the prompts are sent by the local server to the AI providers you chose; that cannot be avoided. The desktop app also makes one anonymous request to GitHub at launch to see whether a newer version exists; you can turn that off in the menu.',
        ],
      },
      {
        q: 'Why is it no longer a page you just open?',
        a: [
          'A browser-only app has limits it cannot get around: provider APIs that refuse cross-origin requests, the browser’s storage quota, encoding video inside the browser, and jobs that stop when you close the tab. With a local server the requests come from your machine, composition uses native ffmpeg, and jobs queue in the server.',
        ],
      },
      {
        q: 'Which providers are supported?',
        a: [
          'The code has adapters for OpenAI-compatible chat and text-to-speech, OpenAI Images, Gemini images, Alibaba DashScope video, Volcengine video, Kling video, and a generic video protocol.',
          'There are four presets: DeepSeek (storyboard), Seedream 5.0 and Nano Banana (images), and Wan2.2 Flash (video), with the image and video ones reached through the 302.AI relay. Note that their model ids and prices were last checked in May 2026, and none of them has been used against a real provider with this version, so they may need adjusting.',
        ],
      },
      {
        q: 'Is character consistency reliable?',
        a: [
          'Not yet guaranteed. dramai makes one reference sheet per asset and then generates shot images from several reference images. That is implemented, but it has not been tried on a real image service or compared with the old “locked reference image” of v0.4.',
          'Whether reference images work depends on the model. In the model data, Seedream 5.0 through 302.AI is marked as not supporting them and Nano Banana as unverified. When a model lacks a capability the task fails with an explanation; it never switches models quietly.',
        ],
      },
      {
        q: 'Can I make a series?',
        a: [
          'Yes. A project holds episodes, episodes hold scenes, scenes hold shots, and long texts are split into episodes by chapter. The asset library belongs to the project, so every episode shares the same characters, locations, props and costumes.',
        ],
      },
      {
        q: 'How does narration work?',
        a: [
          'You choose when you create the project: voice it with TTS inside dramai and mix it into the cut, leave it for later and record it in your video editor after exporting, or have no narration.',
          'A video model’s built-in voice and narration cannot both appear: when a shot has both dialogue and narration, the workspace asks you to keep only one.',
        ],
      },
      {
        q: 'Can I export to JianYing?',
        a: [
          'The export is an asset package: a zip of videos, images, subtitles and a manifest, which you drag into JianYing or another editor in order. It is not a JianYing draft file: JianYing encrypts drafts and the format is undocumented, so writing a real draft is still planned.',
        ],
      },
      {
        q: 'The installer says it is unsafe. What now?',
        a: [
          'The installers are not code-signed, so macOS and Windows both warn the first time; the steps to open them are in the Install section above. You can also build and install from source with `pnpm desktop:install`, which has no download warnings.',
        ],
      },
      {
        q: 'I used the old web app. What about my data?',
        a: [
          'The old version kept data inside the browser, so the new version cannot see it, and the old web app has been removed from this site, so you can no longer export a backup here. If you already exported a JSON backup, import it in the new version under Settings → Data & backup: each old project becomes a new project with a single episode, with the aspect ratio set to 16:9 and narration set to “added in post”. Importing never changes existing projects.',
        ],
      },
    ],
  },
  footer: {
    tagline:
      'An open-source AI short-drama studio. On your own computer, it turns a story into a short drama you can edit.',
    project: 'Project',
    participate: 'Get involved',
    language: 'Language',
    links: {
      project: [
        { label: 'GitHub', href: REPO },
        { label: 'Releases', href: `${REPO}/releases` },
        { label: 'Changelog', href: `${REPO}/blob/main/CHANGELOG.md` },
      ],
      participate: [
        { label: 'Open an issue', href: `${REPO}/issues` },
        { label: 'Contributing', href: `${REPO}/blob/main/CONTRIBUTING.md` },
        { label: 'Security', href: `${REPO}/blob/main/SECURITY.md` },
      ],
    },
    legal:
      'Apache License 2.0. dramai draws on xhongc/ai_story and freestylefly/director_ai for ideas and is an independent TypeScript implementation that contains no source code from either. JianYing, Tongyi Wanxiang, Jimeng, DeepSeek, 302.AI, Gemini and other names belong to their owners and are not affiliated with dramai.',
  },
  notFound: {
    title: 'Page not found · dramai',
    description: 'This address does not exist on the dramai website.',
    heading: 'Page not found',
    text: 'This address does not exist on the site. Go back to the home page.',
    legacyHeading: 'An address from the old web app?',
    legacyText:
      'The old web app (v0.4.1) has been removed from this site. The new version runs on your own computer; how to download and install it is on the home page',
    home: 'Back to the home page',
    legacy: 'See how to upgrade',
  },
}
