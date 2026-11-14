import type { CountingMode } from './types.ts'

/** 长度怎么数（见 `CountingMode`）。服务端所有“超长”判断都用它，界面拿到的数字也是它算的。 */
export function countText(mode: CountingMode, text: string): number {
  if (mode === 'characters') return [...text].length
  let n = 0
  for (const ch of text) n += /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 2 : 1
  return n
}
