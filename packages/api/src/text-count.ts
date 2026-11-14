/**
 * 按计数方式数长度——**界面实时显示“已写多少”和服务端判断“超长”用的是同一个规则**。
 *
 * - `characters`：按字符（Unicode 码点）数，一个码点算 1（组合字符、emoji 的每个码点各算 1；不按 UTF-16 单元，也不按字素簇）；
 * - `cjk_double`：汉字算 2，其余算 1。依据阿里百炼“非实时语音合成”指南（help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide，2026-11-13）原文：
 *   “计数时，汉字（包括简体、繁体汉字、日文汉字和韩文汉字）按 2 个字符计算，其他字符（包括标点符号、字母、数字、假名和谚文）按 1 个字符计算。”
 *   汉字 = Unicode 文字 `Han`（含补充平面的汉字，如 U+20000）。页面**没有写**全角标点、全角字母数字、半角片假名、emoji 等怎么算：
 *   按“不会误拦”的方向都算 1（页面没写）。
 *
 * `packages/core/src/providers/text-count.ts` 里有同样的实现（核心不依赖本包：它按 `dist` 单独构建和打包，不为一个纯函数加依赖方向）；
 * 服务端有一个测试用一张大样本表保证两份逐项相同，改一处不改另一处会红。
 */
export type CountingMode = 'characters' | 'cjk_double'

export const COUNTING_MODES: readonly CountingMode[] = ['characters', 'cjk_double']

const HAN = /^\p{Script=Han}$/u

export function countText(mode: CountingMode, text: string): number {
  if (mode === 'characters') return [...text].length
  let n = 0
  for (const ch of text) n += HAN.test(ch) ? 2 : 1
  return n
}
