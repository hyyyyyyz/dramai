# Roadmap

> 这是一份**活的文档**，会随每个里程碑刷新。打钩的代表已交付，箭头指向当前
> 正在做的部分，📌 是已锁定下一步要做的事。

## v0.0.1 — Skeleton（进行中）

- [x] Vite + React 19 + TS 6 骨架
- [x] Path alias `@/*`
- [x] Apache 2.0 许可证 + NOTICE
- [x] README（中/EN） / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG
- [x] `.editorconfig` / `.nvmrc` / `.prettierrc`
- [x] GitHub Actions：CI + Pages Deploy
- [x] Issue 模板 + PR 模板
- [x] `vite.config.ts` 配 `base = "/dramai/"`
- [x] 初始化骨架页（无业务逻辑）
- [ ] 推上 GitHub，Pages 验证通过

## v0.1 — 文本到分镜

📌 接下来要做：

- [ ] 接入 Tailwind CSS + shadcn/ui
- [ ] 路由（React Router v7）：Home / Projects / Project / Settings / About
- [ ] Zustand store：settings / projects / pipeline
- [ ] **Dexie schema**：projects / characters / materials / storyboards / assets / generations / settings
- [ ] **Settings 页**：Provider 配置（base URL / key / model），测试连接
- [ ] **文件上传 + 解析**：doc（mammoth.js）/ txt / md（remark）/ image
- [ ] **项目工作台**：参考图缩略图、文本输入框、生成按钮
- [ ] **LLM 客户端**：OpenAI 兼容 chat、SSE 流式解析
- [ ] **Storyboard Pipeline 阶段**：提示词模板 + 流式 JSON 解析 + 增量渲染
- [ ] **分镜列表 UI**：编辑、重排、单条重生
- [ ] **项目导入/导出**：JSON 备份与还原
- [ ] **i18n**：zh-CN / en

## v0.2 — 角色卡 + 文生图

- [ ] **角色卡 CRUD**：名称、描述、参考图（IndexedDB Blob）
- [ ] 分镜中标记出场角色
- [ ] **Text2Image 客户端**：OpenAI Images / SD WebUI / nano banana 兼容
- [ ] 单分镜生图 + 批量生成 + 队列
- [ ] **生成进度推送**：Pipeline 阶段事件 + UI 反馈

## v0.3 — 图生视频 + 运镜

- [ ] 运镜参数面板：static / pan / tilt / zoom / orbit
- [ ] **Image2Video 客户端**：Runway / Kling / Sora 兼容
- [ ] 视频片段播放器（HTML5）
- [ ] "一键全流程"按钮：自动跑 rewrite→storyboard→image→video

## v0.4 — 合成 + 字幕 + 剪映导出

- [ ] FFmpeg.wasm 集成
- [ ] 视频拼接（含转场）
- [ ] 字幕生成（SRT / VTT），可选 TTS 旁白
- [ ] **剪映草稿**导出（.draft_content + .draft_meta_info → ZIP）
- [ ] CapCut（海外版）兼容

## v0.5 — 打磨与文档

- [ ] 性能优化：IndexedDB 索引、批量并发、增量渲染
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
