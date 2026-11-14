import type { CountingMode } from './types.ts'

/**
 * 长度怎么数（见 `CountingMode`）。服务端所有“超长”判断都用它，界面拿到的数字也是它算的。
 *
 * 规则（阿里百炼“非实时语音合成”指南，2026-11-13 原文：“计数时，汉字（包括简体、繁体汉字、日文汉字和韩文汉字）按 2 个字符计算，
 * 其他字符（包括标点符号、字母、数字、假名和谚文）按 1 个字符计算。”）：汉字 = Unicode 文字 `Han`（含补充平面）算 2，其余算 1。
 * 页面没写全角标点 / 全角字母数字 / 半角片假名 / emoji 怎么算：按“不会误拦”的方向都算 1。
 *
 * **和 `@dramai/api` 的 `countText` 是同一个规则的两份实现**（核心不依赖接口包：核心按 `dist` 单独构建和打包，
 * 不为一个纯函数加依赖方向）；服务端的测试用一张大样本表保证两份逐项相同。
 */
const HAN = /^\p{Script=Han}$/u

export function countText(mode: CountingMode, text: string): number {
  if (mode === 'characters') return [...text].length
  let n = 0
  for (const ch of text) n += HAN.test(ch) ? 2 : 1
  return n
}
