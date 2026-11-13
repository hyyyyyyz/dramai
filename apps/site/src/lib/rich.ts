/** Content strings are plain text with `code` spans. Returns safe HTML. */
export function rich(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>')
}
