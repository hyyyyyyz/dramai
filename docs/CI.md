# CI 说明

工作流在 `.github/workflows/`。发布流程见 [RELEASING.md](RELEASING.md)。

## 有哪些工作流

| 工作流                | 什么时候触发                                                                      | 作用                                                                                  |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ci.yml`              | 推送到 `main` 或 `refactor/**`；任何拉取请求；手动；被 `release-desktop.yml` 调用 | 日常检查，见下表                                                                      |
| `release-desktop.yml` | 推送 `v*.*.*` tag；手动（只演练，不发布）                                         | 构建各系统安装包并创建 GitHub Release                                                 |
| `deploy.yml`          | 仅手动                                                                            | 旧的 Pages 部署，已停用自动触发（旧工作台没有本地服务无法独立运行），宣传页做好后替换 |

Dependabot（`.github/dependabot.yml`）每周为 GitHub Actions 和 npm 依赖开更新拉取请求。

## ci.yml 里的 job

| job                     | 内容                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck | 所有包版本一致（`pnpm version:check`）、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`（Linux）                                                    |
| Test                    | `pnpm test`，在 Linux（Node 24 和 22.13）、macOS（arm64）、Windows 上各跑一次。ffmpeg 由 job 自己安装；Linux 上必须有 libass，保证字幕烧录测试真的运行 |
| Build                   | `pnpm build`                                                                                                                                           |
| Desktop                 | 在 Linux、macOS、Windows 上各跑 `pnpm desktop:build`；有 `pnpm desktop:check-install` 时再跑一次无人值守的安装、校验、卸载                             |
| Lint workflows          | actionlint 检查 `.github/workflows/` 里的语法、表达式和内嵌 shell                                                                                      |
| E2E (browser)           | 根 `package.json` 有 `test:e2e` 脚本时运行 Playwright，没有就空过                                                                                      |
| CI passed               | 汇总以上所有 job；分支保护只需要把它设为必需检查。被跳过的 job 不算失败                                                                                |

同一个分支或拉取请求上有新的提交时，旧的运行会被取消（`main` 上不取消）。

## 失败了怎么看

1. 打开 PR 的 Checks 或仓库的 **Actions** 页，找到红色的 job，展开出错的步骤。
2. 同样的命令在本地都能跑，先在根目录复现：

   | 失败的步骤             | 本地命令                                                                                 |
   | ---------------------- | ---------------------------------------------------------------------------------------- |
   | Check package versions | `pnpm version:check`，不一致时 `pnpm version:set <版本>`                                 |
   | Format check           | `pnpm format:check`，自动修复 `pnpm format`                                              |
   | Lint / Typecheck       | `pnpm lint`（`pnpm lint:fix`）、`pnpm typecheck`                                         |
   | Test                   | `pnpm test`，只跑一个包：`pnpm --filter <包名> test`                                     |
   | Build desktop app      | `pnpm desktop:build`                                                                     |
   | Lint workflows         | 本地装 [actionlint](https://github.com/rhysd/actionlint) 后在仓库根目录运行 `actionlint` |

3. **某个系统独有的失败**（比如只有 Windows 红）：job 名字里带系统。常见原因是路径分隔符、换行符
   （仓库用 `.gitattributes` 统一为 LF）、文件被占用、ffmpeg 的构建差异。macOS 的 Homebrew ffmpeg 和
   Windows 的 Chocolatey ffmpeg 不一定带 libass，字幕烧录的测试在那里会改走“报错检查”（日志里有 warning），Linux 上必须带。
4. 测试失败时 Vitest 的输出在 `Test` 步骤里；E2E 失败时报告在这次运行底部的 Artifacts（`e2e-report`）。
5. 没有改动却突然失败：多半是外部服务（apt / Homebrew / Chocolatey 下载）或 runner 镜像升级，重跑一次，仍失败再查日志。
   工作流里 action 都固定到了提交 SHA，不会因为 action 自己更新而变化。
