import { PUBLISHED_VERSION, REPO } from './site.ts'
import { PROVIDER_FACTS as F, STYLE_PRESET_COUNT, kindTotal } from './facts.ts'
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
    status: `当前版本是 ${PUBLISHED_VERSION}，已发布的安装包对应这一版；之后的新功能先从源码运行。`,
    statusLink: '看看现在有什么',
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
        text: `镜头图以资产设定图为参考生成。画风在建项目时选一次：${STYLE_PRESET_COUNT} 个预设，也可以自己描述。`,
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
        icon: 'alert',
        title: '花钱之前先检查',
        text: '引用了未登记资产或没有设定图的镜头会被拦下。一批任务要么整批执行，要么都不执行；有价目的模型会在确认前给出费用预估。',
      },
      {
        icon: 'tasks',
        title: '重启后不丢的任务队列',
        text: '关掉浏览器不会中断工作。重启后，有上游任务号的视频任务继续轮询；没有的标为「提交结果待确认」，不会被自动重新提交。取消只作用于还在排队的任务。',
      },
      {
        icon: 'link',
        title: '多家服务商，每个都标明验证状态',
        tag: '源码',
        text: `内置 ${F.total} 个预设，覆盖 ${F.vendors} 个厂商的大模型、图片、视频和配音。其中 ${F.tested} 个经过端到端实测，其余 ${F.documented} 个按官方文档接入。设置页按厂商分组，每个预设都标明验证状态。OpenAI 和 OpenRouter 还可以用账号登录。`,
      },
    ],
    locales: '工作台提供简体中文、繁体中文和英文界面，有浅色和深色两套主题',
    providers: {
      sourceTag: '源码',
      title: `服务商：内置 ${F.total} 个预设，覆盖 ${F.vendors} 个厂商`,
      lead: `预设分大模型、图片、视频和配音四类，在 设置 → 服务商 里按厂商分组，每个都标明验证状态：${F.tested} 个经过端到端实测（2026 年 5 月，在 v0.4 中跑通），其余 ${F.documented} 个按各厂商的官方文档接入。按官方文档接入的预设不会自动成为当前选择，由你自己选。标着「源码」的内容是 ${PUBLISHED_VERSION} 之后加入的，已发布的安装包对应 ${PUBLISHED_VERSION}，要用它们先从源码运行。`,
      testedLabel: '端到端实测',
      untestedLabel: '按官方文档接入',
      kindCount: '{n} 个预设',
      kinds: {
        llm: { name: '大模型', testedChips: ['DeepSeek'] },
        image: { name: '图片', testedChips: ['302.AI：Seedream、Nano Banana'] },
        video: { name: '视频', testedChips: ['302.AI：Wan 2.2 Flash'] },
        speech: { name: '配音', testedChips: [] },
      },
      kindsNote:
        '同一厂商可以有多个预设（例如国内站和国际站、API Key 和账号登录各算一个），所以预设数比厂商数多。Ollama 和 LM Studio 在你自己的机器上跑模型，不需要认证。',
      accountTitle: `账号登录（${F.accountSignIn} 个预设）`,
      accountLead:
        '代替粘贴 Key。登录要在运行 dramai 的那台电脑上操作，因为授权结果会回到一个本地地址。',
      account: [
        {
          name: 'OpenAI',
          text: '用 ChatGPT 账号登录，文本请求走你的 ChatGPT 订阅用量。它覆盖大模型，图片、视频和配音用 API Key。',
        },
        {
          name: 'OpenRouter',
          text: '登录后 OpenRouter 把你自己的一把 API Key 交给 dramai，之后和你粘贴的 Key 用法一样，用量记在你的 OpenRouter 账号上。',
        },
      ],
      optionsTitle: '另外两个选项',
      options: [
        {
          title: '视频参考图（默认关闭）',
          text: '可以把镜头引用的角色、场景和道具设定图作为参考图交给视频模型。有的模型文档里参考图与首帧互斥，开启后镜头图成为第 1 张参考图，不再严格作首帧，确认对话框会在下单之前说明。',
        },
        {
          title: '旁白音色',
          text: '项目的旁白音色可以选，服务商支持时还能带风格指令和语言提示。生成前会检查音色和文本长度。',
        },
      ],
    },
    screensTitle: '工作台的真实界面',
    screensNote:
      '这些截图来自演示模式：用的是内置的模拟服务商，画面是占位草图，金额是演示用的虚构币种',
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
    stylesTitle: `${STYLE_PRESET_COUNT} 个画风预设，也可以自己描述`,
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
        desktop: `从 GitHub Releases 下载安装包（${PUBLISHED_VERSION} 的快照，不含之后的改动）；也可以在本机从源码编译安装（\`pnpm desktop:install\`），那样包含全部`,
        webui: '从源码运行：`pnpm webui`，启动服务、托管工作台并打开浏览器',
      },
      {
        label: '适合谁',
        desktop: '想要一个独立的应用窗口',
        webui: '习惯命令行；想从别的设备访问本机上的服务',
      },
      {
        label: 'ffmpeg',
        desktop: '使用你电脑上安装的 ffmpeg',
        webui: '使用你电脑上安装的 ffmpeg',
      },
      {
        label: 'API Key',
        desktop:
          '有系统密钥库时用它加密保存（macOS 钥匙串、Windows DPAPI、Linux libsecret 或 kwallet）',
        webui: '保存在数据目录的 `secrets.json` 里；macOS 和 Linux 上文件权限设为仅本人可读',
      },
      {
        label: '网络访问',
        desktop: '只在本机使用，窗口自带访问令牌',
        webui: '默认只监听 `127.0.0.1`；从别的设备访问必须同时给 `--host` 和访问令牌',
      },
      {
        label: '通知与更新',
        desktop: '有系统通知。启动时会检查有没有新版本，由你去下载更新',
        webui: '在任务面板里查看进度。更新就是拉取新代码并重新构建',
      },
      {
        label: '数据位置',
        desktop: 'macOS 上默认是 `~/Library/Application Support/Dramai/data`，可以在菜单里更改',
        webui: '默认是 `~/.dramai`，用 `--data-dir` 指定',
      },
      {
        label: '构建和检查',
        desktop:
          'macOS Apple 芯片的安装包在真机上启动过；CI 在 macOS、Windows 和 Linux 上构建桌面应用，并各跑一次沙箱里的安装、启动检查和卸载',
        webui: '浏览器测试覆盖了完整流程（演示模式）',
      },
    ],
  },
  cost: {
    title: '一部短剧要花多少钱',
    lead: 'dramai 本身免费开源（Apache-2.0）。费用只来自你自己接入的 AI 服务商，按它们的计价收取。',
    headline: '费用跟着你选的服务商走',
    headlineText:
      '总价取决于你选的模型、镜头数和时长，所以这里不给固定的数字。有价目的模型，批量生成之前会给出预估金额，你确认之后才会下单。',
    paysTitle: '要付费的部分',
    pays: [
      '分镜拆解和提示词：大模型',
      '分镜图和设定图：生图模型',
      '镜头视频：生视频模型',
      '旁白：只有选了在 dramai 里用 TTS 才需要，留到后期自己配则不用',
      '账号登录的预设：用量记在对应的账号上，OpenAI 是你的 ChatGPT 订阅用量，OpenRouter 是你的 OpenRouter 账号',
    ],
    freeTitle: '不向服务商付费的部分',
    free: ['合成、字幕和导出：在你的电脑上用 ffmpeg 完成', 'dramai 本身'],
    guardTitle: '花钱的每一步，都先让你看清',
    guards: [
      {
        title: '确认之前先看预估',
        text: '批量生成前，有价目的模型会给出预估金额，你确认之后才向服务商下单。预估是估算，不是账单，价格以服务商当前页面为准。开启视频参考图时，对话框还会先说明放弃了什么。',
      },
      {
        title: '整批通过，或整批不跑',
        text: '引用了未登记资产或没有设定图的镜头会被拦下。一个镜头同一时间最多只有一个视频任务。旁白的音色和文本长度也会在生成前检查。',
      },
      {
        title: '不会自动重新提交',
        text: '没拿到上游任务号的视频任务，在断线或重启后标为「提交结果待确认」，请你去服务商后台核对，dramai 不会自己重新提交',
      },
    ],
    shotAlt: '批量生成视频前的确认对话框：参考图开关、模型、画幅、预估费用和提示',
    shotCaption:
      '批量生成前的确认。截图来自演示模式，金额是演示用的虚构币种。最上面的选项会把角色、场景和道具设定图作为参考图交给视频模型；它默认关闭，在这里也打不开，因为演示用的视频模型不接受参考图。',
    fine: `预估按各模型的价目表计算，价格以服务商当前页面为准。${F.tested} 个已实测预设的模型名和价格核对于 2026 年 5 月。`,
  },
  install: {
    title: '安装',
    lead: '接入自己的服务商：在 设置 → 服务商 里添加大模型、生图、生视频（以及配音）的服务商，点「测试连接」。想先看看流程，可以用演示模式：内置的模拟服务商跑完整个工作室，不需要账号和 Key。',
    desktop: {
      name: '桌面版',
      blurb: '一个 Electron 窗口，里面是同一个本地服务和同一个工作台',
      platforms: [
        {
          name: 'macOS · Apple 芯片',
          detail: '`.dmg` 安装镜像，或 `.zip`',
          files: ['dramai-{version}-mac-arm64.dmg', 'dramai-{version}-mac-arm64.zip'],
        },
        {
          name: 'macOS · Intel',
          detail: '`.dmg` 安装镜像，或 `.zip`',
          files: ['dramai-{version}-mac-x64.dmg', 'dramai-{version}-mac-x64.zip'],
        },
        {
          name: 'Windows · x64',
          detail: '`.exe` 安装程序，或免安装的 `.zip`',
          files: ['dramai-{version}-win-x64.exe', 'dramai-{version}-win-x64.zip'],
        },
        {
          name: 'Linux · x64',
          detail: '`.AppImage`，或 `.tar.gz`',
          files: ['dramai-{version}-linux-x64.AppImage', 'dramai-{version}-linux-x64.tar.gz'],
        },
      ],
      releases: '到 GitHub Releases 下载',
      releasesTag: '查看这个版本的发布说明',
      note: `目前只发布了 ${PUBLISHED_VERSION}，它在 Releases 里标为预发布（Pre-release）。发布页上的 \`SHA256SUMS.txt\` 是校验和。安装包的体积约 115 到 150 MB。`,
      snapshotTitle: `安装包对应 ${PUBLISHED_VERSION}`,
      snapshot:
        '之后加入的内容先从源码运行：新增的文本、图片、视频和配音服务商，OpenAI 和 OpenRouter 账号登录，按厂商分组的预设目录，视频的参考图，以及旁白音色选项。可以用下面的 WebUI 从源码运行，也可以在本机编译桌面端（`pnpm desktop:install`），两种都包含全部内容。',
      unsignedTitle: '第一次打开安装包',
      unsigned: [
        '安装包未做代码签名，macOS 和 Windows 第一次打开时会有系统提示，按下面的步骤放行',
        'macOS：首次打开会被拦下。到 系统设置 > 隐私与安全性，点 Dramai 旁的「仍要打开」；也可以在终端运行 `xattr -dr com.apple.quarantine /Applications/Dramai.app`。',
        'Windows：SmartScreen 提示时，点「更多信息」，再点「仍要运行」',
        'Linux：`chmod +x` 后运行 AppImage（需要 FUSE 2）；也可以用 `.tar.gz`',
        '想避开这些提示：从源码在本机编译安装，`pnpm desktop:install`，不需要证书，也没有下载警告',
      ],
      sizeNote: '',
    },
    webui: {
      name: 'WebUI',
      blurb: '从源码运行，包含本页描述的全部内容：启动本地服务，托管工作台，并打开浏览器',
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
      notYet: 'WebUI 目前从源码运行',
    },
    ffmpeg: {
      title: '安装 ffmpeg',
      text: '任何形态都使用你电脑上的 ffmpeg，请自己安装。没有它应用仍能启动，渲染成片时会提示缺少 ffmpeg。把字幕烧录进画面需要带 libass 的 ffmpeg，软字幕不需要；设置 → 关于 里能看到你的 ffmpeg 支持什么。',
      commands: [
        { os: 'macOS', command: 'brew install ffmpeg' },
        { os: 'Windows', command: 'winget install Gyan.FFmpeg' },
        { os: 'Linux', command: 'apt install ffmpeg' },
      ],
    },
    status: {
      title: '现在有什么',
      lead: `当前版本是 ${PUBLISHED_VERSION}。已发布的安装包对应这一版，之后的新功能先从源码运行。`,
      can: {
        title: '能做的事',
        items: [
          '整条流程：上传文本、规划分集、拆分镜头、确认角色和地点、生成图片和视频、合成、导出，用演示模式可以从头走到尾',
          '浏览器测试（Playwright）覆盖这条路径、失败任务的恢复、英文界面和纯键盘操作；服务商协议、登录流程和生成前的检查有自动化测试，CI 在 Linux、macOS 和 Windows 上运行',
        ],
      },
      providers: {
        title: '服务商',
        items: [
          `内置 ${F.total} 个预设，覆盖 ${F.vendors} 个厂商的大模型、图片、视频和配音`,
          `其中 ${F.tested} 个经过端到端实测，其余 ${F.documented} 个按官方文档接入，设置页里每个预设都标明验证状态`,
          '用 ChatGPT 账号（覆盖大模型）或 OpenRouter 账号登录，代替粘贴 Key',
          '视频参考图（默认关闭）和旁白音色选项',
        ],
      },
      install: {
        title: '安装方式',
        items: [
          `桌面版安装包，对应 ${PUBLISHED_VERSION}：macOS（Apple 芯片和 Intel）、Windows、Linux；macOS Apple 芯片的安装包在真机上启动过；CI 在 macOS、Windows 和 Linux 上构建应用，并各跑一次安装和启动检查`,
          '桌面版和 WebUI 都可以从源码运行，包含全部内容；`pnpm desktop:install` 在本机编译安装，没有下载警告',
          '演示模式 `pnpm demo`：不需要账号和 Key',
        ],
      },
      nextTitle: '正在做',
      next: 'npm 包和 Docker 镜像，以及真正的剪映草稿文件',
    },
    legacy: {
      title: '用过 v0.4 的网页版？',
      text: '旧版把项目存在浏览器里，新版读不到。旧版网页已经下线，不能再在这个网站上导出备份；浏览器按网址隔离数据，本机运行 v0.4.1 也读不到旧网址下的数据。如果你已经导出过一份 JSON 备份，可以在新版的 设置 → 数据与备份 里导入。最后一个纯浏览器版本是 v0.4.1',
      link: '查看 v0.4.1 标签',
    },
  },
  faq: {
    title: '常见问题',
    items: [
      {
        q: 'dramai 要付费吗？',
        a: [
          'dramai 本身免费开源（Apache-2.0）。费用来自你接入的 AI 服务商，按它们的计价收取；用账号登录的预设，用量记在对应的账号上。',
        ],
      },
      {
        q: '我的素材和 API Key 会被上传到哪里？',
        a: [
          '不会经过由我们运营的任何服务，因为没有这样的服务。素材和成片在你的数据目录里；API Key 保存在本机，桌面版有系统密钥库时用它加密，WebUI 下是数据目录里的 `secrets.json`（macOS 和 Linux 上文件权限设为仅本人可读）。',
          '生成时，素材内容和提示词会由本机的服务按你的配置发给你选的 AI 服务商，这一步无法避免。桌面版启动时还会匿名查询一次 GitHub 上有没有新版本，可以在菜单里关掉。',
          '用账号登录时，登录得到的令牌或 Key 不会出现在接口响应、日志和地址里，只有 OpenRouter 的 Key 会以遮罩的形式显示。',
        ],
      },
      {
        q: '为什么不再是打开网页就能用？',
        a: [
          '纯浏览器的版本有绕不开的限制：服务商接口的跨域限制、浏览器的存储配额、在浏览器里编码视频，以及关掉页面任务就中断。改成本地服务之后，请求由本机发出，合成用原生 ffmpeg，任务在服务里排队。',
        ],
      },
      {
        q: '内置了哪些服务商？',
        a: [
          `内置 ${F.total} 个预设，覆盖 ${F.vendors} 个厂商，分大模型（${kindTotal('llm')}）、图片（${kindTotal('image')}）、视频（${kindTotal('video')}）和配音（${kindTotal('speech')}）四类，在 设置 → 服务商 里按厂商分组，每个都标明验证状态。`,
          `其中 ${F.tested} 个经过端到端实测：DeepSeek，302.AI 上的 Seedream 和 Nano Banana，以及 302.AI 上的 Wan 2.2 Flash（2026 年 5 月，在 v0.4 中跑通）。其余 ${F.documented} 个按各厂商的官方文档接入，不会自动成为当前选择，由你自己选。`,
          '也可以用 ChatGPT 订阅或 OpenRouter 账号登录来代替粘贴 Key：OpenAI 的登录覆盖大模型，图片、视频和配音用 API Key；OpenRouter 登录后会把你自己的一把 Key 交给 dramai。账号登录在 0.5.0-beta.1 之后加入，先从源码运行。dramai 只访问 OpenAI 的公开接口，不碰 ChatGPT 的后端接口。',
        ],
      },
      {
        q: '角色怎么在镜头之间保持一致？',
        a: [
          'dramai 的做法是：先为每个资产出一张设定图，再用多张参考图生成镜头图，同一个资产的所有镜头都以它为参考。',
          '能不能用参考图取决于生图模型，设置页标明了每个模型的参考图支持情况。模型缺少某项能力时，任务会失败并说明原因，不会悄悄换模型。',
          '视频这边，也可以把设定图作为参考图一起发给视频模型，默认关闭。有的模型开启后不再严格使用首帧，确认对话框会先说明。这个选项在 0.5.0-beta.1 之后加入，先从源码运行。',
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
          `音色可以在项目设置里选，服务商支持时还能带风格指令和语言提示；生成前会检查音色和文本长度。配音服务商有 OpenAI、硅基流动、MiniMax 和阿里 CosyVoice，共 ${kindTotal('speech')} 个预设，按官方文档接入，在 0.5.0-beta.1 之后加入，先从源码运行。`,
        ],
      },
      {
        q: '能导出到剪映吗？',
        a: [
          '导出的是素材包：视频、图片、字幕和清单的压缩包，按编号拖进剪映或别的剪辑软件。它不是剪映草稿文件，真正的草稿文件在做。',
        ],
      },
      {
        q: '安装包有什么要注意的？',
        a: [
          '安装包未做代码签名，macOS 和 Windows 第一次打开时会有系统提示，放行的步骤在上面的安装一节。也可以用 `pnpm desktop:install` 在本机编译安装，这样没有下载警告。',
          `已发布的安装包对应 ${PUBLISHED_VERSION}，之后加入的内容（新增的服务商、账号登录、预设目录、视频参考图和旁白音色选项）先从源码运行。`,
        ],
      },
      {
        q: '我用过旧的网页版，数据怎么办？',
        a: [
          '旧版把数据存在浏览器里，新版读不到。旧版网页已经下线，不能再在这个网站上导出备份，浏览器按网址隔离数据，本机运行 v0.4.1 也读不到旧网址下的数据。如果你已经导出过 JSON 备份，到新版的 设置 → 数据与备份 里导入：每个旧项目会变成一个新项目，里面只有一集；画幅设为 16:9，旁白设为后期配。导入不会改动已有项目。',
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
      'Apache License 2.0。dramai 在思路上参考了 xhongc/ai_story 和 freestylefly/director_ai，是独立的 TypeScript 实现，不包含两者的源代码。本页提到的第三方厂商、产品和服务名称，如「剪映」「通义万相」「即梦」「DeepSeek」「302.AI」「OpenAI」「OpenRouter」，归各自所有者，只作事实提及，与 dramai 无隶属关系。',
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
