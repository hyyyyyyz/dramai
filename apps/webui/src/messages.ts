/** 启动器的终端文案：中文优先，英文其次。按环境变量 / 系统语言选择，没有第三种。 */
export type Lang = 'zh' | 'en'

export function detectLang(env: Record<string, string | undefined>): Lang {
  const forced = env.DRAMAI_LANG?.toLowerCase()
  if (forced?.startsWith('zh')) return 'zh'
  if (forced?.startsWith('en')) return 'en'
  const sys =
    env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale
  return /^zh/i.test(sys ?? '') ? 'zh' : 'en'
}

const zh = {
  help: `用法：dramai [选项]

启动本地服务，托管工作台，并在浏览器里打开它。

选项：
  -p, --port <n>       端口（默认 8787；0 = 系统分配）
      --host <addr>    监听地址（默认 127.0.0.1）。非回环地址必须同时给 --token
      --data-dir <p>   数据目录（默认 ~/.dramai）：数据库、项目文件夹、密钥
      --token <t>      访问令牌，至少 16 个字符。也可用环境变量 DRAMAI_TOKEN（不会出现在进程列表里）
      --no-open        不自动打开浏览器
      --static-dir <p> 前端构建产物目录（高级：默认用随仓库构建的那一份）
  -v, --version        显示版本
  -h, --help           显示这段帮助

环境变量：DRAMAI_PORT、DRAMAI_HOST、DRAMAI_DATA_DIR、DRAMAI_TOKEN、DRAMAI_LANG（zh / en）

例：
  dramai                                   本机使用
  dramai --host 0.0.0.0 --token <令牌>     让局域网里的其他设备访问（需要令牌）`,
  started: '已启动',
  address: '地址',
  dataDir: '数据目录',
  tokenOpen: '带令牌的访问地址（只有持有它的人能打开）',
  stopHint: '按 Ctrl+C 停止',
  stopping: '正在停止…',
  cannotStart: '无法启动：',
  badOption: (name: string, value: string, hint: string) =>
    `选项 ${name} 的值 "${value}" 不合法：${hint}`,
  hintPort: '需要 0–65535 的整数',
  hintToken: '至少 16 个字符',
  unknownOption: (msg: string) => `不认识的选项或缺少参数（${msg}）。运行 dramai --help 查看用法`,
  tokenRequired: (host: string) =>
    `监听 ${host}（非回环地址）必须设置访问令牌，否则同一网络里的任何人都能读写你的项目。加 --token <至少 16 个字符>，或设置环境变量 DRAMAI_TOKEN`,
  tokenTooShort: '访问令牌太短：至少 16 个字符',
  dataDirLocked: (dir: string) =>
    `数据目录 ${dir} 已被另一个 dramai 占用。关掉那一个，或用 --data-dir 指定别的目录`,
  portInUse: (port: number) => `端口 ${port} 已被占用。换一个 --port，或用 --port 0 让系统分配`,
  noStatic: (dir: string) =>
    `找不到前端构建产物：${dir}。从仓库运行时请先执行 pnpm build；也可以用 --static-dir 指定`,
  openFailed: '没能自动打开浏览器，请手动访问上面的地址',
}

const en: typeof zh = {
  help: `Usage: dramai [options]

Starts the local server, serves the workspace and opens it in your browser.

Options:
  -p, --port <n>       Port (default 8787; 0 = let the system pick)
      --host <addr>    Address to listen on (default 127.0.0.1). A non-loopback address requires --token
      --data-dir <p>   Data directory (default ~/.dramai): database, project folders, secrets
      --token <t>      Access token, at least 16 characters. Or set DRAMAI_TOKEN (keeps it out of the process list)
      --no-open        Don't open the browser automatically
      --static-dir <p> Built workspace directory (advanced: defaults to the one built with the repository)
  -v, --version        Print the version
  -h, --help           Print this help

Environment: DRAMAI_PORT, DRAMAI_HOST, DRAMAI_DATA_DIR, DRAMAI_TOKEN, DRAMAI_LANG (zh / en)

Examples:
  dramai                                   local use
  dramai --host 0.0.0.0 --token <token>    let other devices on the LAN in (token required)`,
  started: 'started',
  address: 'Address',
  dataDir: 'Data dir',
  tokenOpen: 'Address with the token (only whoever holds it can open the app)',
  stopHint: 'Press Ctrl+C to stop',
  stopping: 'Stopping…',
  cannotStart: 'cannot start: ',
  badOption: (name, value, hint) => `Invalid value "${value}" for ${name}: ${hint}`,
  hintPort: 'expected an integer from 0 to 65535',
  hintToken: 'at least 16 characters',
  unknownOption: (msg) => `Unknown option or missing value (${msg}). Run dramai --help for usage`,
  tokenRequired: (host) =>
    `Listening on ${host} (a non-loopback address) requires an access token; otherwise anyone on the network can read and write your projects. Add --token <at least 16 characters> or set DRAMAI_TOKEN`,
  tokenTooShort: 'The access token is too short: at least 16 characters',
  dataDirLocked: (dir) =>
    `The data directory ${dir} is in use by another dramai. Stop that one, or pick another with --data-dir`,
  portInUse: (port) =>
    `Port ${port} is already in use. Pick another with --port, or use --port 0 to let the system choose`,
  noStatic: (dir) =>
    `Built workspace not found: ${dir}. When running from the repository, run pnpm build first; or pass --static-dir`,
  openFailed: 'Could not open the browser automatically. Open the address above yourself',
}

export const messages: Record<Lang, typeof zh> = { zh, en }
