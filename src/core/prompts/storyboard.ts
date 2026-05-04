import type { Character, Material, Project } from '@/types/domain'

/**
 * 单个分镜的目标 schema —— 这是 LLM 必须吐出的 JSON 单元。
 * 它跟 Storyboard 域模型有意保持一一对应，方便落库。
 */
export interface StoryboardDraft {
  /** 1-based 序号；LLM 自己安排。 */
  sequence: number
  /** 整段画面文字描述（中文）。 */
  scene_text: string
  /** 旁白（中文，可省略）。 */
  narration?: string
  /** 给文生图的 prompt（英文优先，简洁可执行）。 */
  image_prompt?: string
  /** 出场角色名字（必须在 character_names 列表里，否则忽略）。 */
  character_names?: string[]
  /** 该镜头建议时长，秒。 */
  duration_sec?: number
}

interface BuildOptions {
  project: Project
  materials: Material[]
  characters: Character[]
  userPrompt: string
  /** 默认 6，最少 3，最多 12。 */
  targetShotCount?: number
}

const SYSTEM_PROMPT = `你是一个短剧分镜师。你的任务是把用户提供的故事素材和指令，转化成一份**结构化分镜脚本**，让后续的文生图 / 图生视频管线可以无缝执行。

# 输出契约（**必须严格遵守**）
- 只输出 **一个 JSON 对象**；不要包含任何解释文字、不要 Markdown 代码围栏。
- JSON 顶层必须是 \`{"shots": [...]}\`，shots 为分镜数组。
- 每个分镜对象的字段：
  - \`sequence\` (number): 1 起的序号
  - \`scene_text\` (string): 中文，1-3 句完整画面描述
  - \`narration\` (string, 可省略): 中文旁白，简短一句
  - \`image_prompt\` (string, 可省略): 英文文生图提示词，描述视觉细节、风格、氛围
  - \`character_names\` (string[], 可省略): 出场角色的中文名（必须来自下方 \`已登记的角色\` 列表，否则会被忽略）
  - \`duration_sec\` (number, 可省略): 该镜头建议时长，整数秒，默认 5

# 构思要点
- 每个分镜要能独立出图、独立成片，**避免依赖前一镜画面信息**（角色一致性由参考图保证）。
- \`scene_text\` 写"看到什么"而不是"发生什么"。
- \`image_prompt\` 写英文、用逗号分隔关键词、描述构图（远景/特写）、光照、风格、不要写人名（用'a young woman'之类）。
- 尽量与用户指定的「风格基调」呼应。
- 推荐分镜数：6 个（除非用户另行指定）。
`

function buildSystemPrompt(): string {
  return SYSTEM_PROMPT
}

function buildMaterialsBlock(materials: Material[]): string {
  if (materials.length === 0) return '（无文档素材，仅按用户指令创作）'
  return materials
    .filter((m) => m.kind !== 'image' && m.text.trim().length > 0)
    .map((m, idx) => {
      const tag = `《${m.name}》`
      const body = m.text.length > 4000 ? `${m.text.slice(0, 4000)}……(已截断)` : m.text
      return `### 素材${idx + 1} ${tag}\n${body}`
    })
    .join('\n\n')
}

function buildCharactersBlock(characters: Character[]): string {
  if (characters.length === 0)
    return '（暂无角色卡 —— 你可以自由命名出场人物，但请在 character_names 里写下你新建的角色名，便于后续拆分）'
  return characters
    .map((c) => {
      const role = c.role === 'protagonist' ? '主角' : c.role === 'supporting' ? '配角' : '群演'
      const desc = c.description ? ` · ${c.description}` : ''
      const lock = c.locked && c.referenceAssetId ? '（已绑定参考图）' : ''
      return `- **${c.name}**（${role}${lock}）${desc}`
    })
    .join('\n')
}

function buildImageMaterialsHint(materials: Material[]): string {
  const images = materials.filter((m) => m.kind === 'image')
  if (images.length === 0) return ''
  const list = images.map((m, idx) => `${idx + 1}. ${m.name}`).join('\n')
  return `\n\n## 用户提供的参考图\n${list}\n（这些图会作为视觉风格参考；请在 image_prompt 里融入相符的画风、配色、镜头语言。）`
}

export function buildStoryboardMessages(opts: BuildOptions) {
  const { project, materials, characters, userPrompt, targetShotCount } = opts
  const shotCount = Math.min(12, Math.max(3, targetShotCount ?? 6))

  const userBlock = `# 项目
- 标题：${project.title}
- 风格基调：${project.style ?? '（未指定 —— 你可以根据素材自行判断）'}
- 一句话简介：${project.summary ?? '（无）'}
- 期望分镜数：${shotCount}

# 已登记的角色
${buildCharactersBlock(characters)}

# 文字素材
${buildMaterialsBlock(materials)}${buildImageMaterialsHint(materials)}

# 用户本次指令
${userPrompt.trim() || '（用户未提供额外指令，按素材创作即可）'}

请按系统提示输出 \`{"shots": [...]}\` JSON。`

  return [
    { role: 'system' as const, content: buildSystemPrompt() },
    { role: 'user' as const, content: userBlock },
  ]
}
