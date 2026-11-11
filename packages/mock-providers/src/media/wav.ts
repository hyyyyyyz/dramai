const RATE = 16000

/** 说这段文字大约需要的秒数：每个字约 0.22 秒（语速 1），标点是停顿。 */
export function speechSeconds(text: string, speed = 1): number {
  let t = 0
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    t += /[，,、；;：:]/.test(ch) ? 0.18 : /[。！？!?….]/.test(ch) ? 0.32 : 0.22
  }
  return Math.max(0.8, t / Math.max(0.5, Math.min(2, speed)))
}

/**
 * 占位“语音”：每个字一个短促的音节（音高随字变化），标点处停顿。不是语音，只是听得出长短的声音。
 * 16kHz 单声道 16 位 PCM WAV。
 */
export function placeholderWav(text: string, speed = 1): Uint8Array {
  const per = Math.max(0.5, Math.min(2, speed))
  const samples: number[] = []
  const push = (seconds: number, freq: number, amp: number) => {
    const n = Math.round(seconds * RATE)
    for (let i = 0; i < n; i++) {
      const env = freq === 0 ? 0 : Math.min(1, i / 160, (n - i) / 240)
      const vib = 1 + 0.02 * Math.sin((2 * Math.PI * 5 * i) / RATE)
      samples.push(
        freq === 0
          ? 0
          : Math.sin((2 * Math.PI * freq * vib * i) / RATE) * 0.7 * amp * env +
              Math.sin((2 * Math.PI * freq * 2 * i) / RATE) * 0.25 * amp * env,
      )
    }
  }
  let any = false
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    any = true
    if (/[，,、；;：:]/.test(ch)) push(0.18 / per, 0, 0)
    else if (/[。！？!?….]/.test(ch)) push(0.32 / per, 0, 0)
    else push(0.22 / per, 150 + (ch.charCodeAt(0) % 11) * 18, 0.35)
  }
  if (!any || samples.length < RATE * 0.8) push(0.8 - samples.length / RATE, 0, 0)
  const data = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    data[i] = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767)
  const out = new Uint8Array(44 + data.length * 2)
  const v = new DataView(out.buffer)
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + data.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true)
  v.setUint32(28, RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, data.length * 2, true)
  new Uint8Array(out.buffer, 44).set(new Uint8Array(data.buffer))
  return out
}
