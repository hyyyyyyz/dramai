/**
 * 把正文里的 `<think>…</think>` 思考段去掉（流式、可以跨 chunk）。
 * MiniMax 在没开 `reasoning_split` 时把思考内联在 content 里；别的服务商不会出现，原样通过。
 * 只处理最前面的思考段之外的情况也一样：见到 `<think>` 就进入"丢弃"状态，直到 `</think>`。
 */
export class ThinkTagStripper {
  private inThink = false
  private pending = ''

  /** 喂入一段增量，返回应该显示的正文增量。 */
  push(text: string): string {
    let input = this.pending + text
    this.pending = ''
    let out = ''
    for (;;) {
      if (this.inThink) {
        const end = input.indexOf('</think>')
        if (end === -1) {
          // 可能是被切开的 `</think>`：留下可能的前缀
          this.pending = keepTagPrefix(input, '</think>')
          return out
        }
        input = input.slice(end + '</think>'.length)
        this.inThink = false
      } else {
        const start = input.indexOf('<think>')
        if (start === -1) {
          const hold = keepTagPrefix(input, '<think>')
          out += input.slice(0, input.length - hold.length)
          this.pending = hold
          return out
        }
        out += input.slice(0, start)
        input = input.slice(start + '<think>'.length)
        this.inThink = true
      }
    }
  }

  /** 流结束：把没凑成标签的尾巴放出来（思考段里没结束的丢掉）。 */
  flush(): string {
    const rest = this.inThink ? '' : this.pending
    this.pending = ''
    return rest
  }
}

/** `text` 末尾如果是 `tag` 的真前缀，返回这段前缀（要等下一个 chunk 才能判断）。 */
function keepTagPrefix(text: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return text.slice(text.length - n)
  }
  return ''
}
