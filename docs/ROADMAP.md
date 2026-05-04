# Roadmap

> 这是一份**活的文档**，会随每个里程碑刷新。打钩的代表已交付，📌 是已锁定下一步要做的事。

## v0.0.1 — Skeleton ✅ 2026-05-04

- [x] Vite + React 19 + TS 6 骨架
- [x] Path alias `@/*`
- [x] Apache 2.0 许可证 + NOTICE
- [x] README（中/EN） / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG
- [x] `.editorconfig` / `.nvmrc` / `.prettierrc`
- [x] GitHub Actions：CI + Pages Deploy
- [x] Issue 模板 + PR 模板
- [x] `vite.config.ts` 配 `base = "/dramai/"`
- [x] 初始化骨架页 + GitHub Pages 部署生效

## v0.1 — 文本到分镜 ✅ 2026-05-04

- [x] 接入 Tailwind CSS v4（`@theme` + OKLCH 暗色）
- [x] shadcn 风格原生组件（Button / Card / Badge / Input / Textarea / Label / Select / Modal）
- [x] React Router v7：Home / Projects / Project / Characters / Settings / About / NotFound
- [x] Zustand settings store + persist
- [x] **Dexie schema**：projects / characters / materials / storyboards / assets / generations
- [x] **Settings 页**：Provider 配置 / 6 个预设 / 测试连接 / 已激活切换
- [x] **文件上传 + 解析**：doc（mammoth, dynamic import）/ txt / md / image
- [x] **项目工作台**：素材区 + Prompt 输入框 + 生成按钮 + 中止
- [x] **LLM 客户端**：OpenAI 兼容 chat completions + SSE 流式（含 reader.cancel 资源释放）
- [x] **Storyboard Pipeline**：提示词模板 + 流式累积 + JSON 容错解析 + 落库
- [x] **分镜列表 UI**：序号 / 状态 / 时长 / 场景描述 / 旁白 / image_prompt / 删除
- [x] **项目导入/导出**：JSON 备份（含 Blob base64） + merge / replace 两种导入模式
- [x] **i18n**：zh-CN / en，框架接入；首页、关于、404、顶栏脚部双语；功能页保留中文 (v0.2 翻译扫尾)

## v0.2 — 角色卡 + 文生图 🚧

- [ ] **角色卡 CRUD**：名称、描述、参考图（IndexedDB Blob）、随机/锁定开关
- [ ] 分镜中标记出场角色（`@角色名` 语法 + 可视化 chip）
- [ ] **Text2Image 客户端**：OpenAI Images / SD WebUI / nano banana 兼容
- [ ] 单分镜生图 + 批量生成 + 队列
- [ ] **生成进度推送**：Pipeline 阶段事件 + UI 实时反馈
- [ ] **完整 i18n 翻译**：覆盖 Settings / Projects / ProjectDetail / 各 Modal

## v0.3 — 图生视频 + 运镜 🚧

- [ ] 运镜参数面板：static / pan / tilt / zoom / orbit
- [ ] **Image2Video 客户端**：Runway / Kling / Sora 兼容
- [ ] 视频片段播放器（HTML5）
- [ ] "一键全流程"按钮：自动跑 rewrite→storyboard→image→video

## v0.4 — 合成 + 字幕 + 剪映导出 🚧

- [ ] FFmpeg.wasm 集成
- [ ] 视频拼接（含转场）
- [ ] 字幕生成（SRT / VTT），可选 TTS 旁白
- [ ] **剪映草稿**导出（.draft_content + .draft_meta_info → ZIP）
- [ ] CapCut（海外版）兼容

## v0.5 — 打磨与文档 🚧

- [ ] 性能优化：IndexedDB 索引、批量并发、增量 JSON 渲染
- [ ] 详尽文档：QUICKSTART / PROVIDERS（增加更多服务商）/ TROUBLESHOOTING
- [ ] 项目模板库（"宝宝故事"、"宫斗剧"、"科普视频"等）
- [ ] 示例分享页（用户可以贴自己生成的短剧）
- [ ] 演示视频 + GIF / 截图
- [ ] 第一次正式 v1.0.0 release

## v1.x 之后的备选方向

- 协作模式：基于 CRDT 的双人协作（不引入服务器，靠 WebRTC / Yjs）
- BFF 选项：可选挂 Cloudflare Worker，做 API Key 托管 + 团队配额
- 桌面端：Tauri 包装，离线可用 + 本地 ComfyUI 集成
- 移动端：响应式优化 + PWA 安装
- 第三方插件：自定义 Pipeline 阶段（用户写 JS / TS 注入）

---

如果你对某个里程碑有不同想法、或者想认领某项工作，欢迎在
[Discussions](https://github.com/hyyyyyyz/dramai/discussions) 里聊。
