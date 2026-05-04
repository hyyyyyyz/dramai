# Security Policy

## Reporting a Vulnerability

如果你发现了安全漏洞，请**不要**在公开 issue 中讨论。请通过下列方式私下报告：

- 在 GitHub 仓库中使用
  [Private Security Advisories](https://github.com/hyyyyyyz/dramai/security/advisories/new)
  功能（首选）。
- 或者通过仓库主页 `hyyyyyyz` 的 GitHub 个人主页联系方式发邮件。

我们会在 7 天内回复，并尽量在 30 天内修复。

If you find a security vulnerability, please **do not** file a public issue.
Use [private security advisories](https://github.com/hyyyyyyz/dramai/security/advisories/new)
or reach out via the maintainer's GitHub profile contact channel.
We aim to respond within 7 days.

## Scope

由于 `dramai` 是纯前端项目，主要关注以下风险面：

- 跨站脚本（XSS）：渲染用户上传文档/AI 输出时的转义问题
- 用户 API Key 在浏览器中的存储与泄露
- 第三方 AI 服务商响应注入
- 提示词注入（Prompt injection）相关风险
- 依赖库（npm package）的已知漏洞

`dramai` **不会**通过任何中间服务器代理你的 API Key 或生成内容；所有数据流都直接在
你的浏览器与你自己配置的 AI 服务商之间进行。

## Supported Versions

目前项目处于早期阶段（v0.x），我们仅对最新的 `main` 分支提供安全更新。
