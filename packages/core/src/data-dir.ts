import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModelRegistryFromDir, ModelRegistry } from './providers/catalog.ts'
import { PromptLibrary } from './prompts/library.ts'
import { loadStyleCatalog, StyleCatalog } from './prompts/styles.ts'

/** 随包发布的数据目录（`packages/core/data`）。源码和 dist 都在包根下一层，所以相对路径相同。 */
export function bundledDataDir(): string {
  return fileURLToPath(new URL('../data/', import.meta.url))
}

export interface Catalog {
  prompts: PromptLibrary
  models: ModelRegistry
  styles: StyleCatalog
}

/**
 * 加载数据目录。先加载内置，再按顺序加载额外目录（用户覆盖），后者按 id 覆盖前者。
 * 每个目录可含：`prompts/`（*.prompt）、`models/`（*.json）、`styles.json`。
 */
export function loadCatalog(
  options: { extraDirs?: string[]; includeBundled?: boolean } = {},
): Catalog {
  const dirs = [
    ...(options.includeBundled === false ? [] : [bundledDataDir()]),
    ...(options.extraDirs ?? []),
  ]
  const prompts = new PromptLibrary()
  const models = new ModelRegistry()
  let styles = new StyleCatalog([])
  for (const dir of dirs) {
    const p = join(dir, 'prompts')
    if (existsSync(p)) prompts.loadDir(p)
    const m = join(dir, 'models')
    if (existsSync(m)) loadModelRegistryFromDir(m, models)
    const s = join(dir, 'styles.json')
    if (existsSync(s)) styles = styles.merged(loadStyleCatalog(s))
  }
  return { prompts, models, styles }
}
