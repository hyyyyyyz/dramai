/**
 * 风格预设。
 *
 * 短剧 / 漫剧 / 写实 / 美术化 / 特殊主题都是平等的选项。预设只是给用户**省手敲**，
 * 完全可以选择不用任何预设、自己手写一段风格描述、或者干脆留空让 LLM 从素材推断。
 *
 * 每条预设承担两个角色：
 * 1) 给用户看的中文 label / description（写进 project.style）
 * 2) 给 LLM 看的英文 imageKeywords（在 system prompt 里作为视觉基底关键词）
 *
 * 命中规则在 `matchStylePreset`：直接 substring 匹配 label 或 id（中文/英文）。
 */

export interface StylePreset {
  id: string
  label: string
  description: string
  imageKeywords: string
}

export interface StylePresetGroup {
  label: string
  presets: StylePreset[]
}

const ANIME: StylePreset[] = [
  {
    id: 'shonen',
    label: '少年热血漫',
    description: '少年热血漫，色彩饱和，动作幅度大，光影对比强',
    imageKeywords:
      'anime style, shonen manga, vibrant saturated colors, dynamic action pose, cel shading, dramatic rim light, motion lines',
  },
  {
    id: 'iyashikei',
    label: '治愈日常漫',
    description: '治愈日常漫，柔光，淡雅色调，温馨氛围',
    imageKeywords:
      'anime style, iyashikei slice-of-life, soft pastel colors, gentle natural lighting, warm cozy atmosphere',
  },
  {
    id: 'xianxia',
    label: '古风仙侠漫',
    description: '古风仙侠漫，水墨笔触，飘逸长袍，云雾缭绕',
    imageKeywords:
      'wuxia anime, ink wash painting style, flowing hanfu robes, misty mountains, traditional Chinese aesthetic',
  },
  {
    id: 'school',
    label: '校园青春漫',
    description: '校园青春漫，制服，朝阳/黄昏光线，明亮色彩',
    imageKeywords:
      'anime style, japanese high school uniform, golden hour lighting, bright cheerful colors, slice of life',
  },
  {
    id: 'kawaii',
    label: '萌系 Q 版',
    description: '萌系 Q 版，圆润线条，糖果色，可爱',
    imageKeywords:
      'kawaii anime, chibi style, candy pastel colors, rounded soft shapes, cute mascot characters',
  },
]

const REALISTIC: StylePreset[] = [
  {
    id: 'modern_drama',
    label: '现代都市短剧',
    description: '现代都市短剧，写实人像，自然光',
    imageKeywords:
      'cinematic photo, modern urban drama, realistic portrait, natural lighting, contemporary fashion, shot on full frame',
  },
  {
    id: 'mystery_realistic',
    label: '悬疑写实',
    description: '悬疑写实，冷色调，戏剧性阴影，电影感',
    imageKeywords:
      'cinematic photo, dark mystery thriller, cool color grading, low-key dramatic shadows, film grain',
  },
  {
    id: 'lyrical',
    label: '文艺写实',
    description: '文艺写实，柔和散景，胶片质感',
    imageKeywords:
      'cinematic photo, lyrical film aesthetic, soft bokeh, kodak film grain, golden hour, gentle composition',
  },
  {
    id: 'documentary',
    label: '纪录片 / 新闻感',
    description: '纪录片 / 新闻感，自然纪实，颗粒感',
    imageKeywords:
      'documentary photography, photojournalistic, natural lighting, candid moment, subtle film grain, neutral color grading',
  },
  {
    id: 'vlog',
    label: 'Vlog / 短视频',
    description: 'Vlog / 短视频，明亮饱和，年轻镜头语言',
    imageKeywords:
      'vlog style, bright saturated colors, wide angle, handheld feel, youthful contemporary aesthetic',
  },
]

const ART_STYLE: StylePreset[] = [
  {
    id: 'ink_wash',
    label: '水墨画',
    description: '水墨画风，留白，毛笔笔触',
    imageKeywords:
      'traditional chinese ink wash painting, sumi-e, brush strokes, negative space, monochrome with subtle ink gradient',
  },
  {
    id: 'oil_painting',
    label: '油画',
    description: '油画质感，厚涂笔触，古典构图',
    imageKeywords:
      'oil painting, thick impasto brush strokes, classical composition, painterly texture, museum lighting',
  },
  {
    id: 'cg_3d',
    label: '3D CG 动画',
    description: '3D CG 动画，皮克斯/迪士尼质感',
    imageKeywords:
      '3D CG animation, pixar disney style, subsurface scattering, soft global illumination, polished render',
  },
  {
    id: 'pixel_art',
    label: '像素艺术',
    description: '像素艺术，低分辨率方块，复古游戏感',
    imageKeywords:
      'pixel art, low-resolution sprites, 16-bit retro game aesthetic, limited palette, dithering',
  },
  {
    id: 'low_poly',
    label: '低多边形',
    description: '低多边形，简洁色块，几何感',
    imageKeywords:
      'low poly 3D, geometric flat shading, minimalist color blocks, isometric perspective',
  },
]

const THEMATIC: StylePreset[] = [
  {
    id: 'cyberpunk',
    label: 'Cyberpunk 赛博朋克',
    description: 'Cyberpunk 赛博朋克，霓虹冷光，雨夜街景',
    imageKeywords:
      'cyberpunk, neon lights, rainy night street, holographic billboards, futuristic dystopia, synthwave color palette',
  },
  {
    id: 'steampunk',
    label: 'Steampunk 蒸汽朋克',
    description: 'Steampunk 蒸汽朋克，黄铜机械，维多利亚',
    imageKeywords:
      'steampunk, brass clockwork machinery, victorian aesthetic, sepia tones, gears and pistons',
  },
  {
    id: 'fairy_tale',
    label: '童话绘本',
    description: '童话绘本，温暖手绘，柔和色彩',
    imageKeywords:
      "storybook illustration, children's picture book, warm hand-drawn texture, gentle pastel colors, whimsical",
  },
  {
    id: 'horror',
    label: '恐怖悬念',
    description: '恐怖悬念，暗调，迷雾，戏剧性光线',
    imageKeywords:
      'horror cinematic, dark eerie atmosphere, mist and fog, dramatic backlight, desaturated colors',
  },
  {
    id: 'retro_80s',
    label: '复古 80s',
    description: '复古 80s，VHS 颗粒，霓虹紫粉',
    imageKeywords:
      'retro 80s aesthetic, vhs grain, neon magenta and cyan, synthwave, vaporwave palette',
  },
]

export const STYLE_PRESET_GROUPS: StylePresetGroup[] = [
  { label: '漫剧 / 动画', presets: ANIME },
  { label: '写实短剧', presets: REALISTIC },
  { label: '美术风格', presets: ART_STYLE },
  { label: '特殊主题', presets: THEMATIC },
]

export const STYLE_PRESETS: StylePreset[] = STYLE_PRESET_GROUPS.flatMap((g) => g.presets)

/** 用 label 或 id 在 project.style 里粗略匹配一个 preset；未命中返回 undefined。 */
export function matchStylePreset(text?: string): StylePreset | undefined {
  if (!text) return undefined
  const t = text.trim()
  if (!t) return undefined
  const tLower = t.toLowerCase()
  return STYLE_PRESETS.find((p) => t.includes(p.label) || tLower.includes(p.id))
}
