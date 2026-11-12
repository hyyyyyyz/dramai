# Contributing to dramai

感谢你愿意为 dramai 出一份力！本文档说明如何参与这个项目。
For contributors who prefer English, scroll to the bottom.

## 🧭 我能怎么贡献

- 报告 bug：[Bug Issue 模板](https://github.com/hyyyyyyz/dramai/issues/new?template=bug_report.yml)
- 提议特性：[Feature Issue 模板](https://github.com/hyyyyyyz/dramai/issues/new?template=feature_request.yml)
- 提交 PR：见下文工作流
- 文档/翻译：欢迎补充 `docs/` 与 `README_EN.md`
- 测试新 OpenAI 兼容服务商：在 [docs/PROVIDERS.md](./docs/PROVIDERS.md) 增加配置示例

## 🛠️ 本地开发流程

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
nvm use      # 或确保 Node ≥ 20
pnpm install
pnpm dev
```

提交前请保证：

```bash
pnpm typecheck      # 类型检查
pnpm lint           # ESLint
pnpm format:check   # Prettier
pnpm build          # 生产构建无错
```

## 🌳 分支与 PR 规范

- 默认分支是 `main`，请基于 `main` 创建特性分支：`feat/<topic>` / `fix/<topic>` / `docs/<topic>`。
- PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/)（CI 会检查标题，不符合会失败），例如：
  - `feat(storyboard): add JSON streaming parser`
  - `fix(deploy): correct base path in vite.config`
  - `docs(providers): add 302.AI example`
- 提交类型和版本号的对应关系（发版时据此判断该升哪一位）：

  | 提交类型                                                           | 对应                                                   |
  | ------------------------------------------------------------------ | ------------------------------------------------------ |
  | `fix:`、`perf:`                                                    | 修订号（`0.5.1 → 0.5.2`）                              |
  | `feat:`                                                            | 次版本（`0.5.2 → 0.6.0`）                              |
  | 类型后带 `!`，或正文里有 `BREAKING CHANGE:`                        | 主版本；1.0.0 之前改次版本，并在更新日志写“不兼容变更” |
  | `docs:`、`test:`、`ci:`、`chore:`、`refactor:`、`style:`、`build:` | 不单独触发发版                                         |

  贡献者**不需要**自己改版本号：版本在发版时统一改。完整规则（含预发布版本、tag、更新日志要求、版本工具）见
  [docs/VERSIONING.md](./docs/VERSIONING.md)，发版步骤见 [docs/RELEASING.md](./docs/RELEASING.md)，CI 说明见 [docs/CI.md](./docs/CI.md)。

- PR 描述请说明：**做了什么、为什么、如何测试**。涉及 UI 变化请附截图或动图。
- 请保持 PR 小而聚焦，一个 PR 解决一件事。

## 🧹 代码规范

- TypeScript 严格模式，避免 `any`；公共类型放在 `src/types/`。
- 组件使用函数式 + Hooks；不引入 class 组件。
- 业务逻辑放在 `src/core/`，UI 放在 `src/components/` 与 `src/pages/`。
- 副作用与异步 IO 通过明确的接口注入，便于在浏览器以外的环境中测试。
- 一切对外暴露的接口（AI 客户端、Pipeline 阶段、Provider）都要有 TS 接口契约。

## 🔐 安全

请不要在 issue 里直接讨论安全漏洞。流程见 [SECURITY.md](./SECURITY.md)。

## 📝 行为准则

参与本项目即表示你同意 [Code of Conduct](./CODE_OF_CONDUCT.md)。

---

## English

Thanks for considering a contribution!

- Report bugs / request features through the issue templates.
- Branch from `main`, name like `feat/<topic>` or `fix/<topic>`.
- Use Conventional Commits in PR titles.
- Run `pnpm typecheck && pnpm lint && pnpm build` before pushing.
- Keep PRs small and focused.
- Add yourself to `package.json` `contributors` if you wish.
- Don't open public issues for security problems — see [SECURITY.md](./SECURITY.md).
