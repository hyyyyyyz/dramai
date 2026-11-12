import { describe, expect, it } from 'vitest'
import { extractChangelogSection } from '../src/notes.ts'

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.5.0-beta.1] - 2026-12-01

### Added

- A thing

## [0.5.0] - 2026-12-20

### Added

- Desktop app

### Fixed

- Bug

## [0.4.1] - 2026-05-04

Hot patch.

[Unreleased]: https://example.com/compare/v0.5.0...HEAD
[0.5.0]: https://example.com/releases/tag/v0.5.0
[0.4.1]: https://example.com/releases/tag/v0.4.1
`

describe('extractChangelogSection', () => {
  it('returns the section body without its heading', () => {
    expect(extractChangelogSection(CHANGELOG, '0.5.0')).toBe(
      '### Added\n\n- Desktop app\n\n### Fixed\n\n- Bug',
    )
  })

  it('does not confuse a prerelease with its stable version', () => {
    expect(extractChangelogSection(CHANGELOG, '0.5.0-beta.1')).toBe('### Added\n\n- A thing')
  })

  it('drops the trailing link definitions from the last section', () => {
    expect(extractChangelogSection(CHANGELOG, '0.4.1')).toBe('Hot patch.')
  })

  it('returns null for missing or empty sections', () => {
    expect(extractChangelogSection(CHANGELOG, '9.9.9')).toBeNull()
    expect(extractChangelogSection(CHANGELOG, 'Unreleased')).toBeNull()
    expect(extractChangelogSection('## [1.0.0] - x\n\n## [0.9.0]\n\nHi', '1.0.0')).toBeNull()
  })

  it('handles CRLF files', () => {
    expect(
      extractChangelogSection('## [1.0.0]\r\n\r\n- a\r\n\r\n## [0.9.0]\r\n- b\r\n', '1.0.0'),
    ).toBe('- a')
  })
})
