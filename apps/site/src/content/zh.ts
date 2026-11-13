import { REPO } from './site.ts'
import type { Content } from './types.ts'

export const zh: Content = {
  locale: 'zh',
  htmlLang: 'zh-CN',
  name: 'dramai',
  meta: {
    title: 'dramai · 在自己电脑上运行的开源 AI 短剧工作室',
    description:
      '开源的 AI 短剧工作室，在你自己的电脑上运行：规划集、场和镜头，通过你选的 AI 服务商生成图片和视频，合成带旁白和字幕的成片。项目是磁盘上的普通文件夹，API Key 留在本机。',
    ogAlt: 'dramai：在你自己电脑上运行的开源 AI 短剧工作室',
  },
  skip: '跳到正文',
  header: {
    nav: [
      { id: 'pipeline', label: '流程' },
      { id: 'features', label: '特性' },
      { id: 'editions', label: '版本' },
      { id: 'cost', label: '成本' },
      { id: 'download', label: '下载' },
      { id: 'faq', label: '常见问题' },
    ],
    navLabel: '页面导航',
    themeLabel: '切换深色或浅色',
    github: 'GitHub',
    download: '下载',
    homeLabel: 'dramai 首页',
    languageLabel: '语言',
    otherLanguage: 'English',
  },
  hero: {
    title: ['把故事拍成短剧，', '全程在你自己的电脑上'],
    lead: 'dramai 是开源的 AI 短剧工作室。给它一部小说或一份剧本，它规划出集、场和镜头，通过你选的 AI 服务商生成图片和视频，再合成带旁白和字幕的成片。项目是磁盘上的普通文件夹，API Key 留在你的电脑上，不经过任何由我们运营的服务。',
    primary: '下载桌面版',
    secondary: '用 WebUI 运行',
    statusPrefix: '测试版',
    status: '只用自动化测试和模拟服务商验证过，还没有连过真实的 AI 服务商',
    statusLink: '看看现状',
    shotAlt: '分镜页截图：镜头按场分组，每个镜头带有图片、视频、旁白、提示词和引用的资产',
    shotCaption: '一个小型演示项目的分镜页。画面是演示模式生成的占位草图，不是生成出来的作品。',
  },
  pipeline: {
    title: '从原文到成片，六步',
    lead: '不满意的镜头只重做那一镜，新结果作为新版本保存，旧的不会被覆盖。上游内容改了，依赖它的产物只会标为过期，不会自动重新生成。',
    stageLabel: '步骤',
    stages: [
      {
        title: '素材',
        text: '上传小说或剧本，支持 docx、txt、md，也可以放参考图。长文本不截断，按章节切分成集。',
        out: '产出：原文与参考图',
      },
      {
        title: '分镜',
        text: '大模型把原文规划成集，再拆成场和镜头，每个镜头带场景描述、旁白或台词和提示词',
        out: '产出：分集与分镜脚本',
      },
      {
        title: '资产',
        text: '角色、地点、道具和服装是资产，镜头通过引用使用它们。从文中找出的候选由你确认，每个资产有一张设定图。',
        out: '产出：资产库与设定图',
      },
      {
        title: '画面',
        text: '镜头图以资产设定图为参考生成。画风在建项目时选一次：20 个预设，也可以自己描述。',
        out: '产出：每镜一张图',
      },
      {
        title: '视频与旁白',
        text: '图生视频，任务在本地服务里排队，关掉浏览器照常运行。旁白可以用 TTS 生成，也可以留到后期自己配。',
        out: '产出：每镜一段视频，旁白音轨',
      },
      {
        title: '合成与导出',
        text: '本机 ffmpeg 按时间线渲染，画幅 9:16、16:9 或 1:1，软字幕或烧录字幕。导出成片、SRT、VTT 和素材包。',
        out: '产出：成片、字幕、素材包',
      },
    ],
  },
  features: {
    title: '为什么要放到本机上跑',
    lead: '纯浏览器的版本受限于跨域、存储配额和浏览器里的视频编码。改成本地服务之后，这些限制不再存在，长任务也不会因为关掉页面而中断。',
    items: [
      {
        icon: 'shield',
        title: '本地运行，Key 在你手里',
        text: '一个监听 127.0.0.1 的本地服务完成所有工作。项目是普通文件加一个 SQLite 数据库，可以直接用别的软件打开。请求由这个服务发给服务商，没有跨域限制，中间也没有转发。',
      },
      {
        icon: 'users',
        title: '连载和可复用的资产库',
        text: '一个项目包含集，集包含场，场包含镜头。角色、地点、道具和服装放进资产库，每个资产有一张设定图，用到它的镜头都以它为参考。',
      },
      {
        icon: 'link',
        title: '花钱之前先检查',
        text: '引用了未登记资产或没有设定图的镜头会被拦下。一批任务要么整批执行，要么都不执行，确认之前会给出费用预估。',
      },
      {
        icon: 'tasks',
        title: '重启后不丢的任务队列',
        text: '关掉浏览器不会中断工作。重启后，有上游任务号的视频任务继续轮询；没有的标为「提交结果待确认」，不会被自动重新提交。取消只作用于还在排队的任务。',
      },
      {
        icon: 'film',
        title: '保留版本，不自动覆盖',
        text: '重新生成会新增一个版本，不覆盖旧的。上游内容变了，依赖它的产物标为过期，但不会自动重新生成。',
      },
      {
        icon: 'export',
        title: '原生 ffmpeg 合成',
        text: '成片由你电脑上的 ffmpeg 渲染：9:16、16:9、1:1，旁白配音，软字幕或烧录字幕，SRT 和 VTT。还能导出素材包，到别的软件里继续剪。',
      },
    ],
    locales: '工作台提供简体中文、繁体中文和英文界面，有浅色和深色两套主题',
    screensTitle: '工作台的真实界面',
    screensNote:
      '这些截图来自演示模式：服务商是本机的模拟服务，画面是占位草图，金额是演示用的虚构币种',
    screens: [
      {
        shot: 'overview',
        alt: '项目概览：当前集的下一步、分集列表和项目设置',
        title: '项目概览',
        text: '当前集的下一步，以及每一集的进度',
      },
      {
        shot: 'assets',
        alt: '资产库：角色设定图',
        title: '资产库',
        text: '角色、地点、道具和服装。这里的三视图设定图是演示模式的占位草图。',
      },
      {
        shot: 'compose',
        alt: '合成页：画面、旁白、字幕轨道的时间线和问题列表',
        title: '合成',
        text: '画面、旁白、字幕和配乐的时间线，以及会阻止渲染的问题清单',
      },
      {
        shot: 'tasks',
        alt: '打开任务面板的分镜页：一个需要处理、三个进行中、三个排队',
        title: '任务面板',
        text: '需要处理的、进行中的和排队的任务，分镜页在旁边同步更新。已经提交给服务商的任务不能取消，照常计费。',
      },
    ],
    stylesTitle: '20 个画风预设，也可以自己描述',
    stylesLead:
      '画风在建项目时选定，并作为快照保存在项目里。可以不用预设，自己描述风格；留空则由大模型从原文推断。',
    styleGroups: [
      {
        name: '漫剧 / 动画',
        presets: ['少年热血漫', '治愈日常漫', '古风仙侠漫', '校园青春漫', '萌系 Q 版'],
      },
      {
        name: '写实短剧',
        presets: ['现代都市短剧', '悬疑写实', '文艺写实', '纪录片 / 新闻感', 'Vlog / 短视频'],
      },
      { name: '美术风格', presets: ['水墨画', '油画', '3D CG 动画', '像素艺术', '低多边形'] },
      {
        name: '特殊主题',
        presets: ['Cyberpunk 赛博朋克', 'Steampunk 蒸汽朋克', '童话绘本', '恐怖悬念', '复古 80s'],
      },
    ],
  },
  editions: {
    title: '桌面版还是 WebUI',
    lead: '两种形态用的是同一个本地服务和同一个工作台，差别在怎么启动，以及少量系统集成。',
    desktop: { name: '桌面版', blurb: '独立窗口，不用开终端' },
    webui: { name: 'WebUI', blurb: '命令行启动，在浏览器里使用' },
    rows: [
      {
        label: '怎么得到',
        desktop:
          '从 GitHub Releases 下载安装包；也可以在本机从源码编译安装（`pnpm desktop:install`）',
        webui: '从源码运行：`pnpm webui`，启动服务、托管工作台并打开浏览器',
      },
      {
        label: '适合谁',
        desktop: '想要一个独立的应用窗口',
        webui: '习惯命令行；想从别的设备访问本机上的服务',
      },
      {
        label: 'ffmpeg',
        desktop: '不内置，需要自己安装',
        webui: '不内置，需要自己安装',
      },
      {
        label: 'API Key',
        desktop:
          '有系统密钥库时用它加密保存（macOS 钥匙串、Windows DPAPI、Linux libsecret 或 kwallet）',
        webui: '保存在数据目录的 `secrets.json`，只有你的系统用户可读，没有加密',
      },
      {
        label: '网络访问',
        desktop: '只在本机使用，窗口自带访问令牌',
        webui: '默认只监听 `127.0.0.1`；从别的设备访问必须同时给 `--host` 和访问令牌',
      },
      {
        label: '通知与更新',
        desktop: '有系统通知。不会自动更新，启动时会提示有没有新版本，由你去下载',
        webui: '没有通知，在任务面板里看。更新就是拉取新代码并重新构建',
      },
      {
        label: '数据位置',
        desktop: 'macOS 上默认是 `~/Library/Application Support/Dramai/data`，可以在菜单里更改',
        webui: '默认是 `~/.dramai`，用 `--data-dir` 指定',
      },
      {
        label: '验证程度',
        desktop: 'macOS Apple 芯片在真机上启动过；其余系统只经过 CI 构建',
        webui: '浏览器测试覆盖了完整流程（演示模式）',
      },
    ],
  },
  cost: {
    title: '一部短剧要花多少钱',
    lead: 'dramai 本身免费，Apache-2.0 开源。费用只来自你自己接入的 AI 服务商，按它们的计价收取。',
    headline: '整部的总价，现在还没有可靠的数字',
    headlineText:
      '我们还没有用真实的服务商完整跑过一部短剧，所以这里不给总价。随便给一个看起来很准的数字，比没有数字更误导。',
    paysTitle: '要付费的部分',
    pays: [
      '分镜拆解和提示词：大模型',
      '分镜图和设定图：生图模型',
      '镜头视频：生视频模型',
      '旁白：只有选了在 dramai 里用 TTS 才需要，留到后期自己配则不用',
    ],
    freeTitle: '不向服务商付费的部分',
    free: ['合成、字幕和导出：在你的电脑上用 ffmpeg 完成', 'dramai 本身'],
    guardTitle: '花钱的每一步，都先让你看清',
    guards: [
      {
        title: '确认之前先看预估',
        text: '批量生成前会按模型价目表给出费用预估，你确认之后才向服务商下单。预估是估算，不是账单，价格以服务商当前页面为准。',
      },
      {
        title: '整批通过，或整批不跑',
        text: '引用了未登记资产或没有设定图的镜头会被拦下。一个镜头同一时间最多只有一个视频任务。',
      },
      {
        title: '不会悄悄重复扣费',
        text: '没拿到上游任务号的视频任务，在断线或重启后标为「提交结果待确认」，请你去服务商后台核对，dramai 不会自己重新提交',
      },
    ],
    shotAlt: '批量生成视频前的确认对话框：模型、画幅、预估费用和提示',
    shotCaption: '批量生成前的确认。截图来自演示模式，金额是演示用的虚构币种。',
    fine: '四个服务商预设里的模型名和价格最后核对于 2026 年 5 月，之后没有重新核对，实际价格可能已经变化',
  },
  install: {
    title: '安装',
    lead: '用真实服务商之前，要在 设置 → 服务商 里添加大模型、生图、生视频（以及配音）的服务商，应用里可以测试连接。想先看看流程，可以用演示模式，不需要账号和 Key，也不产生费用。',
    desktop: {
      name: '桌面版',
      blurb: '一个 Electron 窗口，里面是同一个本地服务和同一个工作台',
      platforms: [
        {
          name: 'macOS · Apple 芯片',
          detail: '`.dmg` 安装镜像，或 `.zip`',
          files: ['dramai-{version}-mac-arm64.dmg', 'dramai-{version}-mac-arm64.zip'],
          tested: true,
        },
        {
          name: 'macOS · Intel',
          detail: '`.dmg` 安装镜像，或 `.zip`',
          files: ['dramai-{version}-mac-x64.dmg', 'dramai-{version}-mac-x64.zip'],
          tested: false,
        },
        {
          name: 'Windows · x64',
          detail: '`.exe` 安装程序，或免安装的 `.zip`',
          files: ['dramai-{version}-win-x64.exe', 'dramai-{version}-win-x64.zip'],
          tested: false,
        },
        {
          name: 'Linux · x64',
          detail: '`.AppImage`，或 `.tar.gz`',
          files: ['dramai-{version}-linux-x64.AppImage', 'dramai-{version}-linux-x64.tar.gz'],
          tested: false,
        },
      ],
      testedLabel: '在真机上启动过',
      untestedLabel: '只经过 CI 构建',
      releases: '到 GitHub Releases 下载',
      releasesTag: '查看这个版本的发布说明',
      note: '当前版本标为预发布，所以不是 Releases 里标着 Latest 的那个。发布页上的 `SHA256SUMS.txt` 是校验和。安装包的体积在 120 到 160 MB 之间。',
      unsignedTitle: '安装包没有代码签名',
      unsigned: [
        'macOS：首次打开会被拦下。到 系统设置 > 隐私与安全性，点 Dramai 旁的「仍要打开」；也可以在终端运行 `xattr -dr com.apple.quarantine /Applications/Dramai.app`。',
        'Windows：SmartScreen 提示时，点「更多信息」，再点「仍要运行」',
        'Linux：`chmod +x` 后运行 AppImage（需要 FUSE 2）；也可以用 `.tar.gz`',
        '想避开这些提示：从源码在本机编译安装，`pnpm desktop:install`，不需要证书，也没有下载警告',
      ],
      sizeNote: '',
    },
    webui: {
      name: 'WebUI',
      blurb: '从源码运行：启动本地服务，托管工作台，并打开浏览器',
      prerequisites: '需要 Node.js 22.22.2 或更新版本、pnpm 9，以及 ffmpeg',
      commands: [
        {
          comment: '获取代码并构建',
          command: `git clone ${REPO}.git\ncd dramai\npnpm install\npnpm build`,
        },
        { comment: '启动，默认地址 http://127.0.0.1:8787', command: 'pnpm webui' },
        { comment: '或者先用演示模式，不需要 Key', command: 'pnpm demo' },
      ],
      options: '选项：`--port`、`--data-dir`、`--no-open`。默认数据目录是 `~/.dramai`。',
      network: '默认只监听本机。要从别的设备访问，必须同时给 `--host` 和访问令牌。',
      copy: '复制命令',
      copied: '已复制',
      notYet: '还没有 npm 包和 Docker 镜像，目前只能从源码运行',
    },
    ffmpeg: {
      title: '安装 ffmpeg',
      text: '任何形态都不附带 ffmpeg，请自己安装。把字幕烧录进画面需要带 libass 的 ffmpeg；设置 → 关于 里能看到你的 ffmpeg 支持什么。',
      commands: [
        { os: 'macOS', command: 'brew install ffmpeg' },
        { os: 'Windows', command: 'winget install Gyan.FFmpeg' },
        { os: 'Linux', command: 'apt install ffmpeg' },
      ],
    },
    status: {
      title: '现状',
      lead: '这是 beta 版本。下面是写在 README 里的实际情况，没有修饰。',
      works: {
        title: '现在能用的',
        items: [
          '整条流程在演示模式下端到端可用：上传文本、规划分集、拆分镜头、确认角色和地点、生成图片和视频、合成、导出',
          '浏览器测试（Playwright）覆盖了这条路径、失败任务的恢复、英文界面和纯键盘操作',
          'macOS Apple 芯片的桌面端在真机上启动过：窗口能加载，服务健康，鉴权通过。CI 在 Linux、macOS 和 Windows 上运行。',
        ],
      },
      unverified: {
        title: '还没验证的',
        items: [
          '任何真实的 AI 服务商',
          'macOS Intel、Windows 和 Linux 的安装包：CI 构建了它们，并在 Windows 和 Linux 上跑了安装自检，但还没有人在真机上打开过',
          '角色一致性：多参考图的方案已经实现，但还没有在真实的生图服务上验证',
          'WebUI 下 API Key 没有加密',
        ],
      },
      notReleased: {
        title: '还没有的',
        items: [
          'npm 包和 Docker 镜像',
          '真正的剪映草稿文件：现在导出的是素材包，要到剪映里手动拖入',
          '自动更新：桌面端只会提示有新版本',
          '转场目前只有硬切，配乐只支持一条，浏览器里的预览不含字幕、配乐和转场',
        ],
      },
    },
    legacy: {
      title: '用过 v0.4 的网页版？',
      text: '旧版把项目存在浏览器里，新版读不到。旧版网页已经从这个网站移除，不再能在这里导出备份。如果你已经导出过一份 JSON 备份，可以在新版的 设置 → 数据与备份 里导入。最后一个纯浏览器版本是 v0.4.1',
      link: '查看 v0.4.1 的发布页',
    },
  },
  faq: {
    title: '常见问题',
    items: [
      {
        q: 'dramai 要付费吗？',
        a: [
          '软件本身免费，Apache-2.0 开源。你只需要为自己接入的 AI 服务商付费，按它们的计价收取。',
        ],
      },
      {
        q: '我的素材和 API Key 会被上传到哪里？',
        a: [
          '不会经过由我们运营的任何服务，因为没有这样的服务。素材和成片在你的数据目录里；API Key 保存在本机，桌面版有系统密钥库时用它加密，WebUI 下是数据目录里的 `secrets.json`，没有加密。',
          '生成时，素材内容和提示词会由本机的服务按你的配置发给你选的 AI 服务商，这一步无法避免。桌面版启动时还会匿名查询一次 GitHub 上有没有新版本，可以在菜单里关掉。',
        ],
      },
      {
        q: '为什么不再是打开网页就能用？',
        a: [
          '纯浏览器的版本有绕不开的限制：服务商接口的跨域限制、浏览器的存储配额、在浏览器里编码视频，以及关掉页面任务就中断。改成本地服务之后，请求由本机发出，合成用原生 ffmpeg，任务在服务里排队。',
        ],
      },
      {
        q: '支持哪些服务商？',
        a: [
          '代码里有这些协议的适配：OpenAI 兼容的对话和语音合成、OpenAI Images、Gemini 图片、阿里 DashScope 视频、火山引擎视频、可灵视频，以及一个通用视频协议。',
          '预设有四个：DeepSeek（分镜）、即梦 Seedream 5.0 和 Nano Banana（生图）、通义万相 Wan2.2 Flash（生视频），生图和生视频经 302.AI 转发。要说明的是，这四个预设里的模型名和价格最后核对于 2026 年 5 月，而且没有连过真实服务商，不保证现在还能直接用。',
        ],
      },
      {
        q: '角色一致性现在可靠吗？',
        a: [
          '还不能保证。dramai 先为每个资产出一张设定图，再用多张参考图生成镜头图。这个方案已经实现，但还没有在真实的生图服务上验证，也没有和 v0.4 的「锁定参考图」对比过。',
          '能不能用参考图取决于模型。模型数据里，经 302.AI 的 Seedream 5.0 标为不支持参考图，Nano Banana 标为「未验证」。模型缺少某项能力时，任务会失败并说明原因，不会悄悄换模型。',
        ],
      },
      {
        q: '能做连载吗？',
        a: [
          '可以。一个项目包含集，集包含场，场包含镜头，长文本按章节切分成集。资产库属于项目，各集共用同一批角色、地点、道具和服装。',
        ],
      },
      {
        q: '旁白配音怎么做？',
        a: [
          '建项目时选一种：在 dramai 里用 TTS 配音并合进成片；留到后期，导出后在剪辑软件里配；或者不要旁白。',
          '视频模型自带的人声和旁白不能同时出现：一个镜头既有台词又有旁白时，工作台会提示只保留一个。',
        ],
      },
      {
        q: '能导出到剪映吗？',
        a: [
          '导出的是素材包：视频、图片、字幕和清单的压缩包，按编号拖进剪映或别的剪辑软件。它不是剪映草稿文件：剪映对草稿加密、格式没有公开文档，直接写草稿还在计划中。',
        ],
      },
      {
        q: '安装包提示不安全，怎么办？',
        a: [
          '安装包没有代码签名，macOS 和 Windows 第一次打开都会警告，放行的步骤在上面的安装一节。也可以用 `pnpm desktop:install` 在本机编译安装，这样没有下载警告。',
        ],
      },
      {
        q: '我用过旧的网页版，数据怎么办？',
        a: [
          '旧版把数据存在浏览器里，新版读不到，而且旧版网页已经从这个网站移除，不能再在这里导出备份。如果你已经导出过 JSON 备份，到新版的 设置 → 数据与备份 里导入：每个旧项目会变成一个新项目，里面只有一集；画幅设为 16:9，旁白设为后期配。导入不会改动已有项目。',
        ],
      },
    ],
  },
  footer: {
    tagline: '开源的 AI 短剧工作室。在你自己的电脑上，把故事做成可以剪辑的短剧。',
    project: '项目',
    participate: '参与',
    language: '语言',
    links: {
      project: [
        { label: 'GitHub', href: REPO },
        { label: '发布页', href: `${REPO}/releases` },
        { label: '更新日志', href: `${REPO}/blob/main/CHANGELOG.md` },
      ],
      participate: [
        { label: '提 Issue', href: `${REPO}/issues` },
        { label: '贡献指南', href: `${REPO}/blob/main/CONTRIBUTING.md` },
        { label: '安全问题', href: `${REPO}/blob/main/SECURITY.md` },
      ],
    },
    legal:
      'Apache License 2.0。dramai 在思路上参考了 xhongc/ai_story 和 freestylefly/director_ai，是独立的 TypeScript 实现，不包含两者的源代码。「剪映」「通义万相」「即梦」「DeepSeek」「302.AI」「Gemini」等名称归各自所有者，与 dramai 无隶属关系。',
  },
  notFound: {
    title: '找不到这个页面 · dramai',
    description: '这个地址在 dramai 的网站上不存在。',
    heading: '找不到这个页面',
    text: '这个地址在网站上不存在。可以回到首页。',
    legacyHeading: '是旧版网页里的地址吗？',
    legacyText: '旧版网页（v0.4.1）已经从这个网站移除。新版是本地运行的应用，下载和安装方法在首页',
    home: '回到首页',
    legacy: '看看怎么升级',
  },
}
