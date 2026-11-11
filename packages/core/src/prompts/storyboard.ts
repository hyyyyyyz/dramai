import type { AspectRatio } from '../domain/common.ts'
import type { Asset } from '../domain/asset.ts'
import type { Project } from '../domain/project.ts'
import type { ChatMessage } from '../providers/protocols/openai-chat.ts'
import type { PromptLibrary } from './library.ts'

/**
 * 分镜师提示词（v0.4 的单批分镜）。模板在数据文件里（storyboard.system / storyboard.user），
 * 这里只负责把项目数据整理成变量。2B 起由分集 → 分场 → 分镜流水线取代。
 */

export interface StoryboardMaterial {
  name: string
  kind: 'doc' | 'txt' | 'md' | 'image'
  text: string
}

export interface StoryboardPromptInput {
  project: Pick<Project, 'name' | 'summary' | 'aspectRatio' | 'style'>
  materials: StoryboardMaterial[]
  /** 已登记的角色资产（名字在这里才进入 LLM 边界）。 */
  characters: Array<Pick<Asset, 'name' | 'description' | 'appearance'>>
  userPrompt: string
  /** 默认 6，最少 3，最多 12。 */
  targetShotCount?: number
  /** 每份素材最多带多少字，默认 4000（v0.4 的限制；长文本的分块处理在 2B）。 */
  materialCharLimit?: number
  locale?: string
}

const ASPECT_HINT: Record<AspectRatio, string> = {
  '9:16': '竖屏，主体居中偏上，上下方向留有空间',
  '16:9': '横屏，可用左右纵深和宽幅构图',
  '1:1': '方形，主体居中，构图紧凑',
}

export function buildStoryboardMessages(
  prompts: PromptLibrary,
  input: StoryboardPromptInput,
): ChatMessage[] {
  const { project } = input
  const shotCount = Math.min(12, Math.max(3, input.targetShotCount ?? 6))
  const limit = input.materialCharLimit ?? 4000
  const style = project.style
  const styleLine =
    style.source === 'none'
      ? '（未指定，请按动漫通用风格自行判断）'
      : style.source === 'template'
        ? `${style.description}（已识别为预设：${style.label}）`
        : style.description || '（以参考图为准）'

  const vars = {
    aspectRatio: project.aspectRatio,
    aspectHint: ASPECT_HINT[project.aspectRatio],
    styleKeywords: style.imageKeywords,
    projectName: project.name,
    styleLine,
    summary: project.summary ?? '（无）',
    shotCount: String(shotCount),
    charactersBlock: charactersBlock(input.characters),
    materialsBlock: materialsBlock(input.materials, limit),
    imageHint: imageHint(input.materials),
    userPrompt: input.userPrompt.trim() || '（用户未提供额外指令，按素材创作即可）',
  }
  const opts = { locale: input.locale }
  return [
    { role: 'system', content: prompts.render('storyboard.system', vars, opts) },
    { role: 'user', content: prompts.render('storyboard.user', vars, opts) },
  ]
}

function materialsBlock(materials: StoryboardMaterial[], limit: number): string {
  const texts = materials.filter((m) => m.kind !== 'image' && m.text.trim().length > 0)
  if (texts.length === 0) return '（无文档素材，仅按用户指令创作）'
  return texts
    .map((m, idx) => {
      const body = m.text.length > limit ? `${m.text.slice(0, limit)}……(已截断)` : m.text
      return `### 素材${idx + 1} 《${m.name}》\n${body}`
    })
    .join('\n\n')
}

function charactersBlock(characters: StoryboardPromptInput['characters']): string {
  if (characters.length === 0) {
    return '（暂无角色卡 —— 你可以自由命名出场人物，但请在 character_names 里写下你新建的角色名，便于后续拆分）'
  }
  return characters
    .map((c) => {
      const desc = c.appearance ?? c.description
      return `- **${c.name}**${desc ? ` · ${desc}` : ''}`
    })
    .join('\n')
}

function imageHint(materials: StoryboardMaterial[]): string {
  const images = materials.filter((m) => m.kind === 'image')
  if (images.length === 0) return ''
  const list = images.map((m, idx) => `${idx + 1}. ${m.name}`).join('\n')
  return `\n\n## 用户提供的参考图\n${list}\n（这些图会作为视觉风格参考；请在 image_prompt 里融入相符的画风、配色、镜头语言。）`
}
