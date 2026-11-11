/**
 * 中文短文本的轻量启发式：找人名 / 地点 / 道具 / 服装，切句，认对白。
 * 不是 NER——只求对一篇普通的中文短篇给出“说得过去”的结果，并且对同一输入永远给出同一输出。
 */

const SURNAMES = new Set(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫房缪解应宗丁宣邓郁单杭洪包左石崔吉龚程邢裴陆荣翁荀羊惠甄封芮储靳段富巫焦巴牧山谷车侯全班仰秋仲伊宫宁仇栾甘厉戎祖武符刘景詹束龙叶幸司韶黎薄印白蒲赖卓蒙池乔阴胥苍闻党翟谭劳姬申冉雍桑桂牛寿边燕冀尚农温庄晏柴瞿阎慕连茹艾鱼容向古易廖庾耿满弘国文寇广东欧沃利蔚越隆师巩聂晁勾敖冷辛简饶曾沙关查游',
)

/** 名字后面紧跟的动作 / 言语词：出现在“某某 + 动作”里的两三个字才算人名候选。 */
const VERBS = [
  '低声',
  '轻声',
  '冷冷',
  '淡淡',
  '缓缓',
  '微微',
  '忽然',
  '突然',
  '猛地',
  '慢慢',
  '轻轻',
  '笑道',
  '叹道',
  '问道',
  '答道',
  '喊道',
  '怒道',
  '冷笑',
  '苦笑',
  '微笑',
  '点头',
  '摇头',
  '转身',
  '回头',
  '低头',
  '抬头',
  '皱眉',
  '沉默',
  '开口',
  '起身',
  '推开',
  '拿起',
  '放下',
  '接过',
  '打开',
  '关上',
  '伸手',
  '看着',
  '望着',
  '盯着',
  '看向',
  '走进',
  '走到',
  '走过',
  '说',
  '道',
  '问',
  '答',
  '喊',
  '笑',
  '叹',
  '哭',
  '怒',
  '看',
  '望',
  '盯',
  '走',
  '站',
  '坐',
  '推',
  '拿',
  '握',
  '抬',
  '愣',
  '冲',
  '跑',
  '拉',
  '递',
  '抱',
  '扶',
  '听',
  '想',
  '喝',
  '吃',
  '躺',
  '靠',
  '跪',
  '拍',
  '指',
  '来',
  '去',
  '又',
  '也',
  '却',
  '才',
  '没',
  '把',
  '被',
  '的',
].sort((a, b) => b.length - a.length)

const NOT_NAMES = new Set([
  '高兴',
  '明白',
  '安静',
  '平静',
  '常常',
  '白天',
  '黄昏',
  '方向',
  '时候',
  '时间',
  '成了',
  '万一',
  '路上',
  '白色',
  '黑色',
  '红色',
  '黄色',
  '高高',
  '明明',
  '文字',
  '安全',
  '于是',
  '和气',
  '关上',
  '山上',
  '车上',
  '谷底',
  '石头',
  '白纸',
  '田野',
  '云朵',
  '林子',
  '江水',
  '金色',
  '周围',
  '何必',
  '还是',
  '何况',
  '白白',
  '王道',
  '成为',
  '常见',
  '可以',
  '应该',
  '时刻',
  '平时',
  '包括',
  '段落',
])

const TITLES =
  '先生|小姐|夫人|老师|医生|大夫|师傅|掌柜|老板|公子|姑娘|将军|大人|太太|少爷|婆婆|爷爷|奶奶|妈妈|爸爸|队长|局长|总管|管家|店小二|伙计'

const LOCATION_SUFFIXES = [
  '咖啡馆',
  '咖啡厅',
  '办公室',
  '茶馆',
  '茶楼',
  '客栈',
  '酒楼',
  '酒馆',
  '饭店',
  '餐厅',
  '教室',
  '医院',
  '学校',
  '公司',
  '房间',
  '卧室',
  '客厅',
  '厨房',
  '书房',
  '庭院',
  '院子',
  '花园',
  '街道',
  '小巷',
  '巷子',
  '马路',
  '车站',
  '机场',
  '码头',
  '山洞',
  '山谷',
  '森林',
  '河边',
  '海边',
  '城门',
  '宫殿',
  '大殿',
  '皇宫',
  '府邸',
  '寺庙',
  '道观',
  '祠堂',
  '牢房',
  '地牢',
  '酒店',
  '商场',
  '公园',
  '广场',
  '天台',
  '楼顶',
  '走廊',
  '当铺',
  '药铺',
  '书店',
  '后院',
  '大堂',
  '花厅',
  '大厅',
  '站台',
  '车厢',
  '病房',
  '仓库',
  '工厂',
  '实验室',
]
const LOCATION_MODIFIERS = new Set('老旧小大新破古深后前内外东南西北中')

const PROP_SUFFIXES = [
  '玉佩',
  '钥匙',
  '戒指',
  '手机',
  '照片',
  '令牌',
  '地图',
  '匕首',
  '灯笼',
  '账本',
  '门票',
  '车票',
  '项链',
  '手镯',
  '杯',
  '信',
  '剑',
  '刀',
  '盒',
  '书',
  '镜',
  '玉',
  '簪',
  '伞',
  '灯',
  '瓶',
  '碗',
  '箱',
  '枪',
  '琴',
  '扇',
  '笛',
  '铃',
  '画',
  '包',
  '盘',
  '锁',
]
const MEASURES = '只把封块枚张件盏杯本支个串条副顶面根颗粒'

export const COSTUME_WORDS = [
  '婚服',
  '嫁衣',
  '战甲',
  '铠甲',
  '西装',
  '礼服',
  '校服',
  '睡衣',
  '制服',
  '旗袍',
  '长袍',
  '龙袍',
  '白大褂',
  '风衣',
  '蓑衣',
  '斗篷',
]

const verbAlt = VERBS.join('|')
const cjk = '[\\u4e00-\\u9fff]'

function* nameCandidates(text: string): Generator<string> {
  const re = new RegExp(`(${cjk}{2,3}?)(?=${verbAlt})`, 'g')
  // 逐个起点试：避免“看见林夏转身”被前面的字吃掉
  for (let i = 0; i < text.length; i++) {
    if (!/[一-鿿]/.test(text[i]!)) continue
    const c = text[i]!
    const slice = text.slice(i, i + 4)
    const isTitled = new RegExp(`^(?:${TITLES})`).test(text.slice(i + 1, i + 4)) // “陈先生”
    if (SURNAMES.has(c) || '小阿老'.includes(c)) {
      for (const len of [2, 3]) {
        const cand = slice.slice(0, len)
        if (cand.length < len || !/^[一-鿿]+$/.test(cand)) continue
        if (NOT_NAMES.has(cand)) continue
        re.lastIndex = 0
        const after = text.slice(i + len, i + len + 4)
        if (new RegExp(`^(?:${verbAlt})`).test(after)) {
          yield cand
          break
        }
      }
    }
    if (isTitled) {
      const m = new RegExp(`^(${cjk})(${TITLES})`).exec(text.slice(i, i + 5))
      if (m) yield m[1]! + m[2]!
    }
  }
}

export interface Entities {
  characters: string[]
  locations: string[]
  props: string[]
  costumes: string[]
}

/** 在一段文字里找实体。`known` 是已经确定的名字（资产库 / 之前的拆解结果），出现就算。 */
export function findEntities(text: string, known: readonly string[] = []): Entities {
  const counts = new Map<string, number>()
  for (const n of nameCandidates(text)) counts.set(n, (counts.get(n) ?? 0) + 1)
  // 说话人（“……”X说）一次就算；其余需要出现两次以上，压住偶然的误判
  const speakers = new Set<string>()
  for (const q of text.matchAll(/[”」]\s*[，,]?\s*(\S{2,3}?)(?:说|道|问|答|喊|叹)/g)) {
    if (counts.has(q[1]!)) speakers.add(q[1]!)
  }
  const characters = new Set<string>()
  for (const [n, c] of counts) if (c >= 2 || speakers.has(n)) characters.add(n)
  for (const k of known) if (text.includes(k)) characters.add(k)

  const locations = new Set<string>()
  const locRe = new RegExp(`(${cjk})?(${LOCATION_SUFFIXES.join('|')})`, 'g')
  for (const m of text.matchAll(locRe)) {
    const mod = m[1] && LOCATION_MODIFIERS.has(m[1]) ? m[1] : ''
    locations.add(mod + m[2])
  }
  const props = new Set<string>()
  const propRe = new RegExp(
    `[一二三四五六七八九十两这那]?[${MEASURES}](${cjk}{0,3}?)(${PROP_SUFFIXES.join('|')})`,
    'g',
  )
  for (const m of text.matchAll(propRe)) {
    const name = (m[1] ?? '') + m[2]
    if (name.length >= 1 && name.length <= 5) props.add(name)
  }
  for (const k of known) if (text.includes(k) && !characters.has(k)) props.add(k)

  // 带地点 / 道具后缀的不是人（“老茶馆”）；“周先生”这类称呼若是另一个人物的简称就并进去
  for (const c of [...characters]) {
    if (LOCATION_SUFFIXES.some((x) => c.endsWith(x)) || PROP_SUFFIXES.some((x) => c.endsWith(x)))
      characters.delete(c)
  }
  for (const c of [...characters]) {
    const titled = new RegExp(`^${cjk}(?:${TITLES})$`).test(c)
    if (
      titled &&
      [...characters].some(
        (o) =>
          o !== c &&
          o[0] === c[0] &&
          o.length > c.length - 1 &&
          !new RegExp(`(?:${TITLES})$`).test(o),
      )
    ) {
      characters.delete(c)
    }
  }
  // 道具里去掉被别的道具包含的（“信”⊂“旧信”）
  for (const p of [...props]) {
    if ([...props].some((o) => o !== p && o.endsWith(p))) props.delete(p)
  }
  const costumes = COSTUME_WORDS.filter((w) => text.includes(w))
  // 地点 / 道具里剔除已识别为人物的
  for (const c of characters) {
    locations.delete(c)
    props.delete(c)
  }
  return {
    characters: [...characters],
    locations: [...locations],
    props: [...props],
    costumes,
  }
}

/** 按句号 / 问号 / 感叹号切句（保留标点和引号配对）。 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (const ch of text) {
    cur += ch
    if ('“「'.includes(ch)) depth++
    if ('”」'.includes(ch)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /[。！？!?…]/.test(ch)) {
      out.push(cur.trim())
      cur = ''
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

export interface Quote {
  speaker?: string
  text: string
}

/** 取出文字里的对白，并尽量认出说话人。 */
export function findQuotes(text: string, names: readonly string[]): Quote[] {
  const out: Quote[] = []
  const sorted = [...names].sort((a, b) => b.length - a.length)
  for (const m of text.matchAll(/[“「]([^”」]+)[”」]/g)) {
    const start = m.index!
    const end = start + m[0].length
    const before = text.slice(Math.max(0, start - 16), start)
    const after = text.slice(end, end + 12)
    let speaker: string | undefined
    let bestPos = -1
    for (const n of sorted) {
      const p = before.lastIndexOf(n)
      if (p > bestPos) {
        bestPos = p
        speaker = n
      }
    }
    // 引号前有别的句子结束了，就不算前面的人
    if (speaker && /[。！？]/.test(before.slice(bestPos + speaker.length))) speaker = undefined
    if (!speaker) {
      let bestAfter = Infinity
      for (const n of sorted) {
        const p = after.indexOf(n)
        if (p !== -1 && p < bestAfter) {
          bestAfter = p
          speaker = n
        }
      }
    }
    out.push({ speaker, text: m[1]!.trim() })
  }
  return out
}

/** 去掉标点和空白后的字数。 */
export function charCount(text: string): number {
  return text.replace(/[\s，。！？、；：“”‘’「」『』（）()《》…—,.!?;:'"-]/g, '').length
}

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

export function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}
