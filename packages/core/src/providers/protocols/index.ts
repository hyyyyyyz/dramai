import type { MediaProtocol, ProtocolId } from '../types.ts'
import { aliyunVideo } from './aliyun-video.ts'
import { geminiImage } from './gemini-image.ts'
import { genericVideo } from './generic-video.ts'
import { klingContents } from './kling-contents.ts'
import { klingVideo } from './kling-video.ts'
import { dashscopeImage } from './dashscope-image.ts'
import { dashscopeVideo } from './dashscope-video.ts'
import { klingImage } from './kling-image.ts'
import { openaiImages } from './openai-images.ts'
import { siliconflowImages } from './siliconflow-images.ts'
import { volcengineImages } from './volcengine-images.ts'
import { dashscopeCosyvoice } from './dashscope-cosyvoice.ts'
import { minimaxT2a } from './minimax-t2a.ts'
import { openaiTts } from './openai-tts.ts'
import { arkVideo } from './ark-video.ts'
import { volcengineVideo } from './volcengine-video.ts'

export {
  aliyunVideo,
  arkVideo,
  dashscopeImage,
  dashscopeVideo,
  klingContents,
  klingImage,
  siliconflowImages,
  volcengineImages,
  geminiImage,
  genericVideo,
  klingVideo,
  openaiImages,
  minimaxT2a,
  dashscopeCosyvoice,
  openaiTts,
  volcengineVideo,
}
export * from './content-array.ts'
export { hexToBytes } from './minimax-t2a.ts'
export { instructionLength } from './dashscope-cosyvoice.ts'
export * from './openai-chat.ts'
export { openAiImageStyle, parseImagesData } from './openai-images.ts'
export { seedreamMinPixels } from './volcengine-images.ts'
export { siliconflowRefField, SILICONFLOW_QWEN_SIZES } from './siliconflow-images.ts'
export * from './openai-responses.ts'
export * from './anthropic-messages.ts'
export * from './gemini-chat.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MEDIA_PROTOCOLS: Partial<Record<ProtocolId, MediaProtocol<any>>> = {
  'openai-images': openaiImages,
  'gemini-image': geminiImage,
  'aliyun-video': aliyunVideo,
  'volcengine-video': volcengineVideo,
  'ark-video': arkVideo,
  'kling-contents': klingContents,
  'dashscope-video': dashscopeVideo,
  'kling-video': klingVideo,
  'generic-video': genericVideo,
  'openai-tts': openaiTts,
  'minimax-t2a': minimaxT2a,
  'dashscope-cosyvoice': dashscopeCosyvoice,
  'volcengine-images': volcengineImages,
  'dashscope-image': dashscopeImage,
  'siliconflow-images': siliconflowImages,
  'kling-image': klingImage,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMediaProtocol(id: ProtocolId): MediaProtocol<any> {
  const p = MEDIA_PROTOCOLS[id]
  if (!p) throw new Error(`no media protocol registered for "${id}"`)
  return p
}

export const MEDIA_PROTOCOL_IDS = Object.keys(MEDIA_PROTOCOLS) as ProtocolId[]
