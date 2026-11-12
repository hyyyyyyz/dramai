/**
 * Text read from files written on Windows: a UTF-8 byte-order mark (Notepad adds one) and CRLF line endings
 * (git's autocrlf on checkout). Data files and user-supplied JSON must read the same either way.
 */
export const stripBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

export const toLf = (text: string): string => text.replace(/\r\n?/g, '\n')

/** Parse JSON that may start with a BOM. */
export const parseJsonText = (text: string): unknown => JSON.parse(stripBom(text))

/**
 * Decode the bytes of a text file whose encoding we do not know. Windows users very often have `.txt` files saved as
 * GBK (Simplified Chinese "ANSI") or Big5 (Traditional), not UTF-8 — decoding those as UTF-8 gives mojibake.
 *
 * UTF-8 (strict) first; UTF-16 when there is a BOM; then GB18030 (a superset of GBK / GB2312); then Big5. The first
 * that decodes cleanly wins; if none does, UTF-8 with replacements (as before). "Cleanly" also means no private-use
 * characters: GB18030 maps many Big5 byte pairs into the private-use area instead of failing, so Big5 text would
 * otherwise be taken for GBK and come out as blanks.
 */
const PRIVATE_USE = /[\uE000-\uF8FF]/

export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  const attempts: Array<[string, () => string]> = []
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    attempts.push(['utf-16le', () => new TextDecoder('utf-16le', { fatal: true }).decode(bytes)])
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    attempts.push(['utf-16be', () => new TextDecoder('utf-16be', { fatal: true }).decode(bytes)])
  }
  for (const encoding of ['utf-8', 'gb18030', 'big5']) {
    attempts.push([encoding, () => new TextDecoder(encoding, { fatal: true }).decode(bytes)])
  }
  for (const [encoding, decode] of attempts) {
    try {
      const text = stripBom(decode())
      if (PRIVATE_USE.test(text)) continue
      return { text, encoding }
    } catch {
      /* not this encoding */
    }
  }
  return { text: stripBom(new TextDecoder('utf-8').decode(bytes)), encoding: 'utf-8' }
}
