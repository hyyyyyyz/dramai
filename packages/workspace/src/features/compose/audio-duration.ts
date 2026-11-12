/** 读音频文件的时长（微秒）：浏览器解码元数据就够，不上传也能知道。 */
export function audioDurationUs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const done = () => URL.revokeObjectURL(url)
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      done()
      if (Number.isFinite(a.duration) && a.duration > 0) resolve(Math.round(a.duration * 1_000_000))
      else reject(new Error('duration'))
    }
    a.onerror = () => {
      done()
      reject(new Error('decode'))
    }
    a.src = url
  })
}
