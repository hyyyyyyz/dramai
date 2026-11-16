import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Text in the bundled model data is shown to users (capability notes, price notes, quirks, voice notes) or kept as
 * provenance. None of it talks about whether something was "tested", "never used" or "from a preset": the capability
 * state itself (`supported` / `unsupported` / `unverified`) says what is known, and the pre-generation confirmation is
 * driven by that state alone.
 */
const raw = JSON.parse(
  readFileSync(new URL('../data/models/models.json', import.meta.url), 'utf8'),
) as { models: unknown[] }

const WORDS = /实测|没用过|预设|验证于|端到端|已验证|经验证|验证过|没验证|未验证|本项目.{0,6}验证/

function strings(o: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof o === 'string') out.push([path, o])
  else if (Array.isArray(o)) o.forEach((v, i) => strings(v, `${path}[${i}]`, out))
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) strings(v, `${path}.${k}`, out)
}

describe('the wording of the bundled model data', () => {
  it('has no talk of testing, of never having used a model, or of presets, anywhere', () => {
    const all: Array<[string, string]> = []
    raw.models.forEach((m, i) => strings(m, `models[${i}]`, all))
    expect(all.length).toBeGreaterThan(500)
    expect(all.filter(([, s]) => WORDS.test(s))).toEqual([])
  })

  it('still carries the facts the notes are for: limits and cautions that change what a user does', () => {
    const text = JSON.stringify(raw)
    // a few of the cautions that must survive the rewording
    expect(text).toContain('锁定角色参考图当前不通') // reference images do not work on that route
    expect(text).toContain('服务商可能不严格遵守') // the provider may not honour the aspect ratio
    expect(text).toContain('可能会改写掉提示词里的') // prompt_extend may rewrite the prompt
    expect(text).toContain('取决于上游的内容审核') // whether illustrated faces are blocked depends on moderation
  })
})
