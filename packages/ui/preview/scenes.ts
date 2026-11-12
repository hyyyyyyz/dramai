// 预览用的示意画面：纯色渐变 SVG，只是为了看 Frame 的各状态，不代表任何真实生成结果。
const palettes = [
  ['#2f3e46', '#52796f', '#cad2c5'],
  ['#3d2c2e', '#a4553c', '#f0d9c0'],
  ['#1f2a44', '#4a6fa5', '#dbe7f5'],
]

export function scene(i: number) {
  const [a, b, c] = palettes[i % palettes.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="90" height="160" fill="url(#g)"/><circle cx="62" cy="40" r="10" fill="${c}" opacity="0.85"/><path d="M0 120 L30 92 L52 112 L72 86 L90 108 V160 H0Z" fill="${a}" opacity="0.9"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
