import { ProviderError } from '../errors.ts'
import { bytesToBase64 } from '../http.ts'
import type { MediaPayload, VideoGenInput, VideoReference } from '../types.ts'

/**
 * `content[]` 型视频协议共用的构造器：Seedance 2.x（方舟）和 MiniMax H3 的请求体同构——
 * `text` / `image_url` / `video_url` / `audio_url` 四种项，每项（除 text）带 `role`。
 * 这里只负责"输入 → content 数组"；路径、`resolution` 大小写、响应字段这些信封差异留给各协议。
 *
 * 规则（与官方一致）：首帧、首尾帧、全模态参考是**互斥**的场景——帧和参考素材同时给就抛
 * `FRAME_WITH_REFS_UNSUPPORTED`，由调用方（管线）按模型画像决定怎么取舍，协议不替人猜。
 */

export interface ContentRoles {
  first: string
  last: string
  image: string
  video: string
  audio: string
}

export const SEEDANCE_ROLES: ContentRoles = {
  first: 'first_frame',
  last: 'last_frame',
  image: 'reference_image',
  video: 'reference_video',
  audio: 'reference_audio',
}

export interface ContentArrayOptions {
  /** 把一份素材写成 url 字段的值（data URL / 公网地址 / `asset://id`）；不支持的形态抛 `REFERENCE_KIND_UNSUPPORTED`。 */
  serialize(kind: 'image' | 'video' | 'audio', media: MediaPayload): string
  roles?: ContentRoles
}

export function capabilityError(code: string, message: string): ProviderError {
  return new ProviderError('capability', message, { code })
}

export function buildContentArray(
  input: VideoGenInput,
  text: string,
  o: ContentArrayOptions,
): Array<Record<string, unknown>> {
  const roles = o.roles ?? SEEDANCE_ROLES
  const refs = input.references ?? []
  if ((input.image || input.lastImage) && refs.length > 0) {
    throw capabilityError(
      'FRAME_WITH_REFS_UNSUPPORTED',
      '这个接口里首帧 / 首尾帧和参考素材是互斥的任务类型，不能在同一次请求里同时给',
    )
  }
  if (input.lastImage && !input.image) {
    throw capabilityError('FIRST_FRAME_REQUIRED', '只给尾帧、没有首帧：这个接口不支持')
  }
  const content: Array<Record<string, unknown>> = []
  if (text) content.push({ type: 'text', text })
  const push = (kind: 'image' | 'video' | 'audio', media: MediaPayload, role: string) => {
    const type = `${kind}_url` as const
    content.push({ type, [type]: { url: o.serialize(kind, media) }, role })
  }
  if (input.image) {
    push('image', { kind: 'bytes', ...input.image }, roles.first)
    if (input.lastImage) push('image', { kind: 'bytes', ...input.lastImage }, roles.last)
  }
  for (const r of refs) push(r.kind, r.media, roles[r.kind])
  return content
}

/** 图片 / 音频的 data URL：格式部分按官方要求小写。 */
export function dataUrlOf(media: Extract<MediaPayload, { kind: 'bytes' }>, fallbackMime: string) {
  const mime = (media.mime || fallbackMime).toLowerCase()
  return `data:${mime};base64,${bytesToBase64(media.bytes)}`
}

export type { VideoReference }
