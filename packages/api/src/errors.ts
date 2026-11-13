/**
 * 稳定错误码。错误响应是 `{ error: { code, message, details? } }`：
 * - **前端按 `code` 分支，不要按 `message`**（文案是给人看的，会改）；
 * - `status` 是这个码固定对应的 HTTP 状态；
 * - 业务分类（core 的 `DomainError.kind`）：not_found → 404，conflict / precondition → 409，invalid → 400。
 */
export interface ErrorCodeInfo {
  status: number
  /** 一句话说明，以及 `details` 里有什么。 */
  summary: string
}

export const ERROR_CODES = {
  // —— 通用 / 传输层 ——
  BAD_REQUEST: { status: 400, summary: '请求格式不合法（不是合法 JSON 等）' },
  VALIDATION_ERROR: {
    status: 400,
    summary: '路径 / 查询 / 请求体不符合契约；details 是 [{ path, message }]',
  },
  UNAUTHORIZED: { status: 401, summary: '需要访问令牌，或令牌无效' },
  HOST_NOT_ALLOWED: { status: 403, summary: 'Host 头不在允许列表（防 DNS rebinding）' },
  CROSS_ORIGIN: { status: 403, summary: '跨源 / 跨站请求被拒绝' },
  NOT_FOUND: {
    status: 404,
    summary: '引用的东西不存在；details 通常是 { entity, id }（entity 见下）',
  },
  PAYLOAD_TOO_LARGE: { status: 413, summary: '请求体超过上限' },
  INTERNAL: { status: 500, summary: '服务内部错误（细节只在服务端日志里）' },
  NOT_IMPLEMENTED: { status: 501, summary: '这个接口尚未实现' },
  RESPONSE_SHAPE_MISMATCH: { status: 500, summary: '（仅测试模式）响应与契约不符' },

  // —— core 业务错误（DomainError）——
  ASSET_NAME_TAKEN: { status: 409, summary: '同类型已有同名资产；details.assetId 指向它' },
  CANDIDATE_ALREADY_HANDLED: { status: 409, summary: '候选已处理过' },
  CANDIDATE_NOT_LINKED: { status: 409, summary: '候选当前不是“已关联”状态，不能撤销关联' },
  VERSION_EXISTS: { status: 409, summary: '媒体版本 id 重复' },
  KIND_MISMATCH: { status: 400, summary: '候选与要关联的资产类型不同' },
  UNKNOWN_STYLE_TEMPLATE: { status: 400, summary: '画风模板不存在；details.templateId' },
  MATERIAL_PARSE_FAILED: { status: 400, summary: '素材文件无法解析（如旧版 .doc）' },
  EPISODE_HAS_NO_SHOTS: { status: 409, summary: '这一集还没有分镜' },
  EPISODE_HAS_NO_SOURCE: { status: 409, summary: '这一集没有可拆解的原文' },
  ARTIFACT_INPUTS_BLOCKED: { status: 409, summary: '产物的依据被阻断（缺必需输入）' },
  ARTIFACT_UPSTREAM_MISSING: { status: 409, summary: '产物缺必需的上游产物' },

  // —— 项目 / 素材 / 分集 / 镜头 ——
  STYLE_REFERENCE_MISSING: {
    status: 400,
    summary: '参考图风格需要先上传图片（projects.setStyleReference）；创建项目时不能直接选',
  },
  NOT_IN_TRASH: { status: 409, summary: '只能彻底删除已在回收站的项目' },
  BUSY: { status: 409, summary: '有任务正在运行，先等它结束' },
  MATERIAL_TOO_LARGE: { status: 413, summary: '素材文件超过 20MB' },
  UNSUPPORTED_MATERIAL: { status: 400, summary: '不支持的素材类型' },
  MATERIAL_IN_USE: { status: 409, summary: '已有分集由这份素材规划出来，不能删除' },
  NO_SOURCE_MATERIAL: { status: 409, summary: '项目还没有可用的原文素材' },
  NO_SHOTS: { status: 409, summary: '这一集还没有分镜' },
  BREAKDOWN_WOULD_DISCARD_MEDIA: {
    status: 409,
    summary: '“替换”式分镜拆解会丢掉已生成的图 / 视频；改用追加，或先删除这些镜头',
  },
  UNSUPPORTED_IMAGE: { status: 400, summary: '只接受 png / jpg / webp 图片' },
  IMAGE_TOO_LARGE: { status: 413, summary: '图片超过 20MB' },
  UNKNOWN_VERSION: { status: 404, summary: '媒体版本不存在' },

  // —— LLM / ffmpeg / 合成 ——
  PROVIDER_REQUEST_FAILED: { status: 502, summary: '向服务商发请求失败；details 是上游状态' },
  LOGIN_NOT_SUPPORTED: { status: 409, summary: '这个服务商不是账号登录方式' },
  LOGIN_UNAVAILABLE_REMOTE: {
    status: 409,
    summary: '当前访问方式下不能登录：授权回调只能到达服务所在机器的 127.0.0.1',
  },
  KEY_NOT_APPLICABLE: { status: 409, summary: '账号登录的服务商没有 API Key，不能设置或清除' },
  AUTH_NOT_ALLOWED: { status: 400, summary: '这个协议不支持所选的鉴权方式（账号登录只覆盖文本）' },
  MODEL_LIST_UNSUPPORTED: { status: 409, summary: '这个服务商的协议没有模型列表' },
  NO_LLM_PROVIDER: { status: 409, summary: '还没有选中可用的大模型服务商，先到设置里配置' },
  FFMPEG_MISSING: { status: 409, summary: '没有找到 ffmpeg；details 里有安装建议' },
  FFMPEG_INCOMPATIBLE: { status: 409, summary: 'ffmpeg 缺少合成所需的能力' },
  SUBTITLE_BURN_UNAVAILABLE: { status: 409, summary: '当前 ffmpeg 不支持烧录字幕，请改用软字幕' },
  TIMELINE_BLOCKED: { status: 409, summary: '时间线有阻断问题；details.issues' },
  EXPORT_BLOCKED: { status: 409, summary: '时间线有阻断问题，不能导出素材包；details.issues' },
  NO_CUT: { status: 404, summary: '这一集还没有合成成片' },
  UNSAFE_PATH: { status: 400, summary: '文件路径不合法' },

  // —— 资产 / 变体 / 时间线 ——
  SHEET_TO_EDIT_MISSING: {
    status: 409,
    summary: '（预检拒绝原因，不是 HTTP 错误）要修改的设定图还没有当前图',
  },
  EDIT_INSTRUCTION_EMPTY: { status: 409, summary: '（预检拒绝原因）修改设定图需要一句指令' },
  ASSET_NAME_INVALID: { status: 400, summary: '资产名不合法' },
  NAME_INVALID: { status: 400, summary: '名称不合法' },
  ASSET_IN_USE: {
    status: 409,
    summary: '资产仍被引用，不能删除；details: { shotIds, costumeOfAssetIds, sceneIds }',
  },
  VARIANT_NAME_INVALID: { status: 400, summary: '变体名不合法' },
  VARIANT_NAME_DUPLICATE: { status: 400, summary: '变体名重复（写入时的校验）' },
  VARIANT_NAME_TAKEN: { status: 409, summary: '该资产已有同名变体' },
  VARIANT_IN_USE: { status: 409, summary: '变体仍被镜头引用，不能删除' },
  COSTUME_NOT_FOUND: { status: 400, summary: '指定的服装资产不存在' },
  COSTUME_NOT_COSTUME_KIND: { status: 400, summary: '指定的资产不是服装类型' },
  VOICE_NOT_ALLOWED: { status: 400, summary: '只有角色资产可以设置声音' },
  INVALID_TIMELINE: { status: 400, summary: '时间线内容不合法；message 指出哪里' },
  REVISION_CONFLICT: {
    status: 409,
    summary: '时间线已被别处修改（baseRevision 过期），重新读取后再改',
  },

  // —— 任务 ——
  RUNNING_NOT_CANCELLABLE: { status: 409, summary: '任务已在运行，已发出的调用无法撤回' },
  ALREADY_FINISHED: { status: 409, summary: '任务已经结束' },
  NOT_FAILED: { status: 409, summary: '只有失败的任务才能这样操作' },
  NOTHING_TO_RESUME: { status: 409, summary: '没有可续接的上游任务，请直接重新生成' },
  ARTIFACT_NOT_STALE: {
    status: 409,
    summary: '“保持现状”只对过期的产物；details: { key, status }',
  },
  NOT_RUNNING: {
    status: 409,
    summary: '“忽略结果”只对运行中的任务：排队中的任务（还没花钱）直接取消',
  },
  NOT_APPLICABLE: {
    status: 409,
    summary: '这个任务没有“忽略结果”（只有生成图片 / 视频 / 配音的付费任务才有）',
  },
  CONFIRM_RECHARGE_REQUIRED: {
    status: 409,
    summary:
      '重新生成可能再次计费；带 confirmRecharge: true 重试。details.requires = "confirmRecharge"',
  },
} as const satisfies Record<string, ErrorCodeInfo>

export type ErrorCode = keyof typeof ERROR_CODES

/** `NOT_FOUND` 的 `details.entity` 取值。 */
export const NOT_FOUND_ENTITIES = [
  'project',
  'episode',
  'scene',
  'shot',
  'asset',
  'candidate',
  'timeline_revision',
  'timeline_clip',
  'media_version',
  'variant',
  'material',
  'job',
  'provider',
  'provider_preset',
  'file',
  /** 没有这个接口（`id` 是请求路径）。 */
  'route',
  'artifact',
] as const

export const isErrorCode = (code: string): code is ErrorCode => code in ERROR_CODES
