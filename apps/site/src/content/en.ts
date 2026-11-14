import { PUBLISHED_VERSION, REPO } from './site.ts'
import { PROVIDER_FACTS as F, STYLE_PRESET_COUNT, kindTotal } from './facts.ts'
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
    status: `The current version is ${PUBLISHED_VERSION}. The published installers match it; newer features run from source first.`,
    statusLink: 'See what is there today',
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
        text: `Shot images are generated with the asset reference sheets as references. Pick the look once, when you create the project: ${STYLE_PRESET_COUNT} presets, or describe your own.`,
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
        icon: 'alert',
        title: 'Checks before paid generation',
        text: 'Shots that refer to an unregistered asset, or one without a reference image, are blocked. A batch runs completely or not at all, and models with a price list get a cost estimate before you confirm.',
      },
      {
        icon: 'tasks',
        title: 'A task queue that survives restarts',
        text: 'Closing the browser does not stop work. After a restart a video task with an upstream task id resumes polling; one without it is marked “submission unconfirmed” and is never resubmitted automatically. Cancelling only affects tasks that are still queued.',
      },
      {
        icon: 'link',
        title: 'Many providers, each with its verification status',
        tag: 'Source',
        text: `${F.total} built-in presets covering ${F.vendors} vendors, for language models, images, video and speech. ${F.tested} of them have been run end to end and the other ${F.documented} are connected from official documentation. Settings groups them by vendor and labels every preset with its verification status. OpenAI and OpenRouter can also be used by signing in with an account.`,
      },
    ],
    locales:
      'The workspace speaks English, Simplified Chinese and Traditional Chinese, in a light and a dark theme',
    providers: {
      sourceTag: 'Source',
      title: `Providers: ${F.total} built-in presets covering ${F.vendors} vendors`,
      lead: `Presets come in four kinds, language models, images, video and speech, grouped by vendor in Settings → Providers, and each one carries its verification status: ${F.tested} have been run end to end (May 2026, in v0.4) and the other ${F.documented} are connected from the vendors’ official documentation. A preset connected from documentation never becomes the current choice on its own; you pick it. Items marked “Source” were added after ${PUBLISHED_VERSION}; the published installers match ${PUBLISHED_VERSION}, so to use them run from source first.`,
      testedLabel: 'Run end to end',
      untestedLabel: 'From official docs',
      kindCount: '{n} presets',
      kinds: {
        llm: { name: 'Language models', testedChips: ['DeepSeek'] },
        image: { name: 'Images', testedChips: ['302.AI: Seedream, Nano Banana'] },
        video: { name: 'Video', testedChips: ['302.AI: Wan 2.2 Flash'] },
        speech: { name: 'Speech', testedChips: [] },
      },
      kindsNote:
        'A vendor can have several presets (for example one for the China site and one for the international site, or one for an API key and one for account sign-in), so there are more presets than vendors. Ollama and LM Studio run models on your own machine and need no authentication.',
      accountTitle: `Account sign-in (${F.accountSignIn} presets)`,
      accountLead:
        'Instead of pasting a key. Sign-in must be done on the computer that runs dramai, because the authorisation comes back to a local address.',
      account: [
        {
          name: 'OpenAI',
          text: 'Sign in with a ChatGPT account and text requests use your ChatGPT plan. It covers language models; images, video and speech use API keys.',
        },
        {
          name: 'OpenRouter',
          text: 'You sign in and OpenRouter hands dramai an API key of your own, which is then used like a key you pasted; usage is billed to your OpenRouter account.',
        },
      ],
      optionsTitle: 'Two more options',
      options: [
        {
          title: 'Reference images for video (off by default)',
          text: 'A shot’s character, scene and prop sheets can be sent to the video model as reference images. Where a model’s documentation makes them exclusive with a first frame, the shot image becomes reference image no. 1 and the strict first frame is given up; the confirmation dialog says so before anything is ordered.',
        },
        {
          title: 'Narration voice',
          text: 'A project’s narration voice can be chosen, and where the provider takes them it can carry a style instruction and a language hint. Before generating, the voice and the text length are checked.',
        },
      ],
    },
    screensTitle: 'The workspace, as it looks today',
    screensNote:
      'These screenshots come from demo mode: it uses the built-in simulated providers, the pictures are placeholder sketches, and the amounts are in a fictional currency',
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
    stylesTitle: `${STYLE_PRESET_COUNT} style presets, or describe your own`,
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
        desktop: `Download an installer from GitHub Releases (a snapshot of ${PUBLISHED_VERSION}, without later changes), or build and install it from source on your machine (\`pnpm desktop:install\`), which includes everything`,
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
        desktop: 'Uses the ffmpeg installed on your computer',
        webui: 'Uses the ffmpeg installed on your computer',
      },
      {
        label: 'API keys',
        desktop:
          'Encrypted with the operating system key store where one exists (macOS Keychain, Windows DPAPI, Linux libsecret or kwallet)',
        webui:
          'Kept in `secrets.json` in the data directory; on macOS and Linux the file permissions limit it to you',
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
          'System notifications. It checks at launch whether a newer version exists, and you download the update yourself',
        webui: 'Progress is in the task panel. Updating means pulling the new code and rebuilding',
      },
      {
        label: 'Where data lives',
        desktop:
          'On macOS `~/Library/Application Support/Dramai/data` by default; changeable from the menu',
        webui: '`~/.dramai` by default; set it with `--data-dir`',
      },
      {
        label: 'Build and checks',
        desktop:
          'The macOS Apple silicon installer has been started on a real machine; CI builds the desktop app on macOS, Windows and Linux and runs one sandboxed install, start-up check and uninstall on each',
        webui: 'Browser tests cover the whole workflow (in demo mode)',
      },
    ],
  },
  cost: {
    title: 'What a short drama costs',
    lead: 'dramai itself is free and open source under Apache-2.0. The cost comes only from the AI providers you connect, at their prices.',
    headline: 'The cost follows the providers you choose',
    headlineText:
      'A total depends on the models you pick, the number of shots and their length, so there is no fixed figure here. For models with a price list, dramai gives an estimate before a batch runs, and nothing is ordered until you confirm.',
    paysTitle: 'What you pay a provider for',
    pays: [
      'The storyboard breakdown and prompts: a language model',
      'Shot images and reference sheets: an image model',
      'Shot videos: a video model',
      'Narration: only if you choose TTS inside dramai; not if you record it later',
      'Presets that sign in with an account: usage is billed to that account, your ChatGPT plan for OpenAI and your OpenRouter account for OpenRouter',
    ],
    freeTitle: 'What costs the providers nothing',
    free: ['Composing, subtitles and export: ffmpeg on your own machine', 'dramai itself'],
    guardTitle: 'Every paid step shows you first',
    guards: [
      {
        title: 'An estimate before you confirm',
        text: 'For models with a price list, you see an estimated amount before a batch runs, and nothing is ordered from a provider until you confirm. It is an estimate, not a bill; prices are whatever the provider’s page says today. With reference images for video turned on, the dialog also says what is given up first.',
      },
      {
        title: 'Complete batches or none',
        text: 'Shots that refer to an unregistered asset, or one without a reference image, are blocked. A shot has at most one video task in flight. The narration voice and text length are also checked before generating.',
      },
      {
        title: 'Nothing is resubmitted automatically',
        text: 'A video task cut off before the provider confirmed it is marked “submission unconfirmed”. dramai asks you to check the provider’s dashboard and never resubmits on its own.',
      },
    ],
    shotAlt:
      'The confirmation dialog before a batch video job, with the reference-sheet option, the model, aspect ratio, estimated cost and warnings',
    shotCaption:
      'The confirmation before a batch. A demo-mode screenshot: the amount is in the demo’s fictional currency. The option at the top sends character, scene and prop sheets to the video model as references; it is off by default and cannot be turned on here because the demo’s video model does not take references.',
    fine: `Estimates follow each model’s price table; prices are whatever the provider’s page says today. The model ids and prices of the ${F.tested} tested presets were checked in May 2026.`,
  },
  install: {
    title: 'Install',
    lead: 'To connect your own providers, add a language model, an image model, a video model (and a voice) under Settings → Providers and run “test connection”. To see the workflow first, use demo mode: the built-in simulated providers run the whole studio, with no account and no key.',
    desktop: {
      name: 'Desktop app',
      blurb: 'An Electron window around the same local server and workspace',
      platforms: [
        {
          name: 'macOS · Apple silicon',
          detail: '`.dmg` disk image, or `.zip`',
          files: ['dramai-{version}-mac-arm64.dmg', 'dramai-{version}-mac-arm64.zip'],
        },
        {
          name: 'macOS · Intel',
          detail: '`.dmg` disk image, or `.zip`',
          files: ['dramai-{version}-mac-x64.dmg', 'dramai-{version}-mac-x64.zip'],
        },
        {
          name: 'Windows · x64',
          detail: '`.exe` installer, or a portable `.zip`',
          files: ['dramai-{version}-win-x64.exe', 'dramai-{version}-win-x64.zip'],
        },
        {
          name: 'Linux · x64',
          detail: '`.AppImage`, or `.tar.gz`',
          files: ['dramai-{version}-linux-x64.AppImage', 'dramai-{version}-linux-x64.tar.gz'],
        },
      ],
      releases: 'Download from GitHub Releases',
      releasesTag: 'Release notes for this version',
      note: `Only ${PUBLISHED_VERSION} is published, and it is marked as a Pre-release on the Releases page. \`SHA256SUMS.txt\` on the release lists the checksums. The installers are about 115 to 150 MB.`,
      snapshotTitle: `The installers match ${PUBLISHED_VERSION}`,
      snapshot:
        'What was added afterwards runs from source first: the additional text, image, video and speech providers, sign-in with OpenAI and OpenRouter, the preset catalog grouped by vendor, reference images for video and the narration voice options. Use the WebUI below from source, or build the desktop app on your machine (`pnpm desktop:install`); both include everything.',
      unsignedTitle: 'Opening an installer for the first time',
      unsigned: [
        'The installers are not code-signed, so macOS and Windows show a system prompt the first time; follow the steps below to open them',
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
        'Run from source, which includes everything described on this page: starts the local server, serves the workspace and opens your browser',
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
      notYet: 'The WebUI runs from source for now',
    },
    ffmpeg: {
      title: 'Install ffmpeg',
      text: 'Every form uses the ffmpeg installed on your computer, so install it yourself. Without it the app still starts and tells you ffmpeg is missing when you render a cut. Burning subtitles into the picture needs a build with libass; soft subtitles do not. Settings → About shows what your ffmpeg can do.',
      commands: [
        { os: 'macOS', command: 'brew install ffmpeg' },
        { os: 'Windows', command: 'winget install Gyan.FFmpeg' },
        { os: 'Linux', command: 'apt install ffmpeg' },
      ],
    },
    status: {
      title: 'What there is today',
      lead: `The current version is ${PUBLISHED_VERSION}. The published installers match it; newer features run from source first.`,
      can: {
        title: 'What you can do',
        items: [
          'The whole workflow: upload a text, plan episodes, break down shots, confirm characters and locations, generate images and video, compose and export; demo mode takes you from start to finish',
          'Browser tests (Playwright) cover that path, a failed task being resumed, the English interface and keyboard-only use; the provider protocols, the sign-in flows and the checks before generating have automated tests, and CI runs on Linux, macOS and Windows',
        ],
      },
      providers: {
        title: 'Providers',
        items: [
          `${F.total} built-in presets covering ${F.vendors} vendors, for language models, images, video and speech`,
          `${F.tested} of them have been run end to end and the other ${F.documented} are connected from official documentation; Settings labels every preset with its verification status`,
          'Sign-in with a ChatGPT account (language models) or an OpenRouter account instead of pasting a key',
          'Reference images for video (off by default) and narration voice options',
        ],
      },
      install: {
        title: 'Ways to install',
        items: [
          `Desktop installers matching ${PUBLISHED_VERSION}: macOS (Apple silicon and Intel), Windows and Linux; the macOS Apple silicon installer has been started on a real machine; CI builds the app on macOS, Windows and Linux and runs an install and start-up check on each`,
          'The desktop app and the WebUI can both run from source with everything included; `pnpm desktop:install` builds and installs on your machine without download warnings',
          'Demo mode, `pnpm demo`: no account and no key',
        ],
      },
      nextTitle: 'In progress',
      next: 'An npm package and a Docker image, and a real JianYing draft file',
    },
    legacy: {
      title: 'Used the v0.4 web app?',
      text: 'It kept your projects inside the browser, so the new version cannot see them. The old web app is gone from this site, so you can no longer export a backup here, and because browsers keep data per address, running v0.4.1 on your own machine cannot read what was stored under the old address. If you already exported a JSON backup, import it in the new version under Settings → Data & backup. The last browser-only version is v0.4.1',
      link: 'See the v0.4.1 tag',
    },
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        q: 'Does dramai cost money?',
        a: [
          'dramai itself is free and open source under Apache-2.0. The cost comes from the AI providers you connect, at their prices; for presets that sign in with an account, usage is billed to that account.',
        ],
      },
      {
        q: 'Where do my materials and API keys go?',
        a: [
          'Nothing passes through a service we run, because there is none. Materials and finished cuts live in your data directory. API keys stay on your machine: the desktop app encrypts them with the system key store where one exists, and in the WebUI they are in `secrets.json` in the data directory (on macOS and Linux the file permissions limit it to you).',
          'When you generate, the text of your materials and the prompts are sent by the local server to the AI providers you chose; that cannot be avoided. The desktop app also makes one anonymous request to GitHub at launch to see whether a newer version exists; you can turn that off in the menu.',
          'When you sign in with an account, the token or key you get does not appear in an API response, a log or an address; an OpenRouter key is shown only as a mask.',
        ],
      },
      {
        q: 'Why is it no longer a page you just open?',
        a: [
          'A browser-only app has limits it cannot get around: provider APIs that refuse cross-origin requests, the browser’s storage quota, encoding video inside the browser, and jobs that stop when you close the tab. With a local server the requests come from your machine, composition uses native ffmpeg, and jobs queue in the server.',
        ],
      },
      {
        q: 'Which providers are built in?',
        a: [
          `There are ${F.total} built-in presets covering ${F.vendors} vendors: ${kindTotal('llm')} for language models, ${kindTotal('image')} for images, ${kindTotal('video')} for video and ${kindTotal('speech')} for speech, grouped by vendor in Settings → Providers, each with its verification status.`,
          `${F.tested} of them have been run end to end: DeepSeek, Seedream and Nano Banana through 302.AI, and Wan 2.2 Flash through 302.AI (May 2026, in v0.4). The other ${F.documented} are connected from the vendors’ official documentation and never become the current choice on their own; you pick them.`,
          'You can also sign in with a ChatGPT plan or an OpenRouter account instead of pasting a key. OpenAI sign-in covers language models; images, video and speech use API keys. OpenRouter hands dramai an API key of your own. Account sign-in was added after 0.5.0-beta.1, so run from source first. dramai calls only OpenAI’s public API, never a ChatGPT back-end endpoint.',
        ],
      },
      {
        q: 'How do characters stay consistent between shots?',
        a: [
          'dramai’s approach is to make one reference sheet per asset and then generate shot images from several reference images, so every shot that uses an asset is generated from the same sheet.',
          'Whether reference images can be used depends on the image model, and Settings shows each model’s reference-image support. When a model lacks a capability the task fails with an explanation; it never switches models quietly.',
          'For video, the sheets can also be sent to the video model as reference images (off by default). With some models, turning that on means the strict first frame is not used, and the confirmation dialog says so first. This option was added after 0.5.0-beta.1, so run from source first.',
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
          `The voice can be chosen in the project settings and, where the provider takes them, carry a style instruction and a language hint; before generating, the voice and the text length are checked. Speech providers are OpenAI, SiliconFlow, MiniMax and Alibaba CosyVoice, ${kindTotal('speech')} presets in all, connected from official documentation and added after 0.5.0-beta.1, so run from source first.`,
        ],
      },
      {
        q: 'Can I export to JianYing?',
        a: [
          'The export is an asset package: a zip of videos, images, subtitles and a manifest, which you drag into JianYing or another editor in order. It is not a JianYing draft file; a real draft file is in progress.',
        ],
      },
      {
        q: 'What should I know about the installers?',
        a: [
          'The installers are not code-signed, so macOS and Windows show a system prompt the first time; the steps to open them are in the Install section above. You can also build and install from source with `pnpm desktop:install`, which has no download warnings.',
          `The published installers match ${PUBLISHED_VERSION}; what was added afterwards (the added providers, account sign-in, the preset catalog, reference images for video and the narration voice options) runs from source first.`,
        ],
      },
      {
        q: 'I used the old web app. What about my data?',
        a: [
          'The old version kept data inside the browser, so the new version cannot see it. The old web app is gone from this site, so you can no longer export a backup here, and because browsers keep data per address, running v0.4.1 on your own machine cannot read what was stored under the old address. If you already exported a JSON backup, import it in the new version under Settings → Data & backup: each old project becomes a new project with a single episode, with the aspect ratio set to 16:9 and narration set to “added in post”. Importing never changes existing projects.',
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
      'Apache License 2.0. dramai draws on xhongc/ai_story and freestylefly/director_ai for ideas and is an independent TypeScript implementation that contains no source code from either. The third-party vendor, product and service names on this page, such as JianYing, Tongyi Wanxiang, Jimeng, DeepSeek, 302.AI, OpenAI and OpenRouter, belong to their owners, are mentioned only as facts and are not affiliated with dramai.',
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
