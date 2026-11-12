const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  map: 'application/json',
}

export function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return TYPES[ext] ?? 'application/octet-stream'
}

/** 允许内联展示（<img>/<video>/<audio>）的只有图片、视频、音频；其余一律当附件下载。 */
export function isInlineMedia(mime: string): boolean {
  return /^(image\/(png|jpeg|webp|gif)|video\/|audio\/)/.test(mime)
}
