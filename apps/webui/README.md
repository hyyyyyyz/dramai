# @dramai/webui

WebUI 形态的命令行启动器：起本地服务（`@dramai/server`），托管构建好的工作台（`@dramai/workspace`），并在浏览器里打开它。

```bash
pnpm build           # 先构建（启动器本身、服务端、工作台）
pnpm webui           # 在仓库里运行；等价于 node apps/webui/bin/dramai.js
pnpm webui --no-open --port 9000 --data-dir /tmp/dramai
```

Pass options directly: `pnpm webui --no-open --port 9000`. pnpm 9 forwards a `--` to the launcher as it is; the
launcher accepts one leading `--` (so `pnpm webui -- --no-open` works too) and refuses stray positional arguments.

| 选项                | 说明                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `-p, --port <n>`    | 端口，默认 8787；0 = 系统分配                                               |
| `--host <addr>`     | 监听地址，默认 `127.0.0.1`。**非回环地址必须同时给令牌**                    |
| `--data-dir <path>` | 数据目录，默认 `~/.dramai`（数据库、项目文件夹、密钥）                      |
| `--token <t>`       | 访问令牌，至少 16 个字符；也可用环境变量 `DRAMAI_TOKEN`，不会出现在进程列表 |
| `--no-open`         | 不自动打开浏览器                                                            |
| `--static-dir <p>`  | 工作台构建产物目录（高级；默认用随仓库构建的那一份）                        |
| `-v` / `-h`         | 版本 / 帮助                                                                 |

环境变量：`DRAMAI_PORT`、`DRAMAI_HOST`、`DRAMAI_DATA_DIR`、`DRAMAI_TOKEN`、`DRAMAI_LANG`（`zh` / `en`，终端提示的语言，默认跟随系统）。命令行优先于环境变量。

## 局域网访问

```bash
dramai --host 0.0.0.0 --token "$(openssl rand -base64 24)"
```

启动后终端会打印一个带 `?token=…` 的地址；第一次用它打开，服务端会种下 HttpOnly cookie 并跳转去掉令牌。没有令牌的请求一律 401。

## 启动失败

只打印一行原因，退出码非零（不打调用栈）：非回环地址没给令牌、令牌太短、端口被占用、数据目录被另一个 dramai 占用、没有构建产物。

## 演示模式

启动器不带演示模式。要无费用地体验，用仓库根的 `pnpm demo`（见 `packages/mock-providers`）。

## 还没做

npm 包发布和 Docker 镜像（后面的阶段）。

## Windows notes

- Paths follow the platform: a relative `--data-dir` (or `DRAMAI_DATA_DIR`, `--static-dir`) is resolved against the
  current directory with the platform's rules (drive letters, backslashes, UNC paths); the default data directory is
  `.dramai` under the user profile (`%USERPROFILE%`).
- A leading `~` is expanded by the launcher itself (`~\dramai` or `~/dramai`), because cmd.exe and PowerShell do not
  expand it the way POSIX shells do.
- The browser is opened with `rundll32 url.dll,FileProtocolHandler <url>` rather than `cmd /c start`, so a URL with
  `%`, `&` or `^` (for example a percent-encoded token) is passed through untouched.
- Closing the console window or pressing Ctrl+Break stops the server cleanly (`SIGBREAK`), releasing the data
  directory lock.
- The path rules are covered by tests that run on every system by injecting Windows path operations
  (`test/args.test.ts`).
