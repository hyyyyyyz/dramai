import type { Character, Material, Project } from '@/types/domain'
import { matchStylePreset } from '@/core/prompts/style-presets'

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

const BASE_SYSTEM_PROMPT = `你是一个**短剧 / 漫剧分镜师**——你的产出会驱动后续的文生图 / 图生视频管线。请把用户提供的故事素材和指令转化成一份**结构化分镜脚本**。

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

# 风格判断（不要预设单一画风）
- **完全由用户决定**。短剧、漫剧、写实、动漫、水墨、CG、cyberpunk……都是合法选项。
- 判断顺序：
  1. 如果用户在「风格基调」里指定了具体风格 → 严格遵循。
  2. 如果用户没指定 → **从文字素材的气质里推断**（古风小说 → 古风、cyberpunk 设定 → 赛博朋克、儿童读物 → 童话/可爱、新闻稿 → 写实纪录片风等）。
  3. 整个项目的所有分镜风格保持**一致**——一个项目就一种风格，不要中途切换。
- \`image_prompt\` 里要明确写出风格关键词（如 \`anime style\`、\`photorealistic\`、\`ink wash painting\`、\`cyberpunk neon\` 等），由你根据上一条判断结果选择，不要遗漏。

# 构思要点
- 每个分镜要能**独立出图、独立成片**——不要依赖"前一镜的延续"，人物一致性后续靠参考图保证。
- \`scene_text\` 写"看到什么"，不是"发生什么"。
- \`image_prompt\` 用英文，逗号分隔关键词；描写构图（wide shot / close-up / over-the-shoulder）+ 光照 + 风格 + 服饰；**不要写中文人名**，用 \`a young swordsman in red robe\` 之类的英文描述代替。
- 推荐分镜数：6 个（除非用户指定）。
`

function buildSystemPrompt(stylePresetKeywords: string | null): string {
  if (!stylePresetKeywords) return BASE_SYSTEM_PROMPT
  return `${BASE_SYSTEM_PROMPT}
# 用户为本项目选定的视觉基底关键词
- 用户已经选了一个明确的风格预设。**每个 \`image_prompt\` 都应当包含下面这串关键词作为基底**，再结合分镜内容补充画面细节：
- \`${stylePresetKeywords}\`
- 项目内分镜风格保持一致，不要中途切换。
`
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

  const preset = matchStylePreset(project.style)
  const styleLine = preset
    ? `${project.style ?? preset.description}（已识别为预设：${preset.label}）`
    : (project.style ?? '（未指定，请按动漫通用风格自行判断）')

  const userBlock = `# 项目
- 标题：${project.title}
- 风格基调：${styleLine}
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
    {
      role: 'system' as const,
      content: buildSystemPrompt(preset?.imageKeywords ?? null),
    },
    { role: 'user' as const, content: userBlock },
  ]
}
