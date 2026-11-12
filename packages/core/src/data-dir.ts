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

/**
 * 随包发布的字幕字体目录（`data/fonts`）：烧录字幕时交给 libass 的 `fontsdir`，字幕不再依赖系统装了什么字体。
 * 桌面版打包时这个目录必须能被 ffmpeg 当普通文件读到（Electron 里要 `asarUnpack`）。
 */
export function bundledFontsDir(): string {
  return join(bundledDataDir(), 'fonts')
}

/** 随包字体的字族名（libass 的 `FontName` 要和字体文件里的名字一致）。 */
export const SUBTITLE_FONT_FAMILY = 'Noto Sans SC'

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
