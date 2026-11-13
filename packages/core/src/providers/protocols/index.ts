import type { MediaProtocol, ProtocolId } from '../types.ts'
import { aliyunVideo } from './aliyun-video.ts'
import { geminiImage } from './gemini-image.ts'
import { genericVideo } from './generic-video.ts'
import { klingVideo } from './kling-video.ts'
import { openaiImages } from './openai-images.ts'
import { openaiTts } from './openai-tts.ts'
import { volcengineVideo } from './volcengine-video.ts'

export {
  aliyunVideo,
  geminiImage,
  genericVideo,
  klingVideo,
  openaiImages,
  openaiTts,
  volcengineVideo,
}
export * from './openai-chat.ts'
export * from './openai-responses.ts'
export * from './anthropic-messages.ts'
export * from './gemini-chat.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MEDIA_PROTOCOLS: Partial<Record<ProtocolId, MediaProtocol<any>>> = {
  'openai-images': openaiImages,
  'gemini-image': geminiImage,
  'aliyun-video': aliyunVideo,
  'volcengine-video': volcengineVideo,
  'kling-video': klingVideo,
  'generic-video': genericVideo,
  'openai-tts': openaiTts,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMediaProtocol(id: ProtocolId): MediaProtocol<any> {
  const p = MEDIA_PROTOCOLS[id]
  if (!p) throw new Error(`no media protocol registered for "${id}"`)
  return p
}

export const MEDIA_PROTOCOL_IDS = Object.keys(MEDIA_PROTOCOLS) as ProtocolId[]
