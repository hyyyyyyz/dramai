import { useEffect, useState, type ReactNode } from 'react'
import {
  Bell,
  ChevronDown,
  Copy,
  Film,
  Image as ImageIcon,
  Monitor,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
} from 'lucide-react'
import {
  BrandMark,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Chip,
  CopyField,
  CropMarks,
  Drawer,
  EmptyState,
  Field,
  Frame,
  IconButton,
  Input,
  Menu,
  Modal,
  Notice,
  Pill,
  Popover,
  Progress,
  SecretField,
  SegmentedControl,
  SegmentedProgress,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToastProvider,
  Tooltip,
  Wordmark,
  iconProps,
  useToast,
} from '../src/v2'
import { scene } from './scenes'

type ThemeChoice = 'system' | 'dark' | 'light'

function readParam(name: string) {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

function applyRootTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function App() {
  const initial = (readParam('theme') as ThemeChoice | null) ?? 'dark'
  const [theme, setTheme] = useState<ThemeChoice>(initial)
  const [compare, setCompare] = useState(readParam('compare') === '1')

  useEffect(() => applyRootTheme(theme), [theme])

  return (
    <ToastProvider dismissLabel="关闭" regionLabel="通知">
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-3 md:px-6">
            <Wordmark className="h-6 w-auto" />
            <span className="text-sm text-subtle">组件预览 · 设计系统 v2</span>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <Switch
                aria-label="并排对比深浅两套"
                checked={compare}
                onCheckedChange={setCompare}
              />
              <span className="text-sm text-muted-foreground">并排</span>
              <SegmentedControl<ThemeChoice>
                aria-label="主题"
                value={theme}
                onValueChange={setTheme}
                options={[
                  { value: 'dark', label: '深色', icon: <Moon {...iconProps} aria-hidden /> },
                  { value: 'light', label: '浅色', icon: <Sun {...iconProps} aria-hidden /> },
                  { value: 'system', label: '系统', icon: <Monitor {...iconProps} aria-hidden /> },
                ]}
              />
            </div>
          </div>
        </header>

        <main
          className={
            compare
              ? 'mx-auto grid max-w-[1600px] gap-0 lg:grid-cols-2'
              : 'mx-auto max-w-[1100px] px-4 md:px-6'
          }
        >
          {compare ? (
            <>
              <ThemePane theme="dark">
                <Gallery />
              </ThemePane>
              <ThemePane theme="light">
                <Gallery />
              </ThemePane>
            </>
          ) : (
            <Gallery />
          )}
        </main>
      </div>
    </ToastProvider>
  )
}

function ThemePane({ theme, children }: { theme: 'dark' | 'light'; children: ReactNode }) {
  return (
    <div data-theme={theme} className="bg-background px-4 text-foreground md:px-6">
      <p className="pt-6 font-mono text-xs text-subtle">data-theme=&quot;{theme}&quot;</p>
      {children}
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-8 last:border-b-0">
      <h2 className="font-display text-title-md font-bold">{title}</h2>
      {note && <p className="mt-1 mb-4 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      {!note && <div className="mb-4" />}
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <p className="font-mono text-xs text-subtle">{label}</p>}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const swatches = [
  'background',
  'surface',
  'surface-2',
  'sunken',
  'border',
  'border-strong',
  'foreground',
  'muted-foreground',
  'subtle',
  'accent',
  'accent-text',
  'accent-hover',
  'accent-soft',
  'accent-foreground',
  'success',
  'success-soft',
  'warn',
  'warn-soft',
  'danger',
  'danger-soft',
  'info',
  'info-soft',
]

function Gallery() {
  return (
    <div className="pb-24">
      <Section title="色板" note="全部来自 theme.css 的 CSS 变量；切换主题只改变量。">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {swatches.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 rounded-md border border-border bg-surface p-2"
            >
              <span
                className="size-8 shrink-0 rounded-sm border border-border"
                style={{ background: `var(--${name})` }}
              />
              <span className="truncate font-mono text-xs text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="字体"
        note="标题 Noto Sans SC 700（自托管），正文系统中文字体 + Inter，等宽 JetBrains Mono。"
      >
        <div className="flex flex-col gap-3">
          <p className="font-display text-title-xl font-bold">一个常驻的任务面板 · Title XL 32</p>
          <p className="font-display text-title-lg font-bold">分镜稿与时间线 · Title LG 26</p>
          <p className="font-display text-title-md font-bold">批量生成前的确认 · Title MD 18</p>
          <p className="font-display text-title-sm font-bold">第 3 集 · 雨夜码头 · Title SM 16</p>
          <p className="text-md">宣传页正文 16px：把小说章节拆成场与镜头，再逐镜生成画面与视频。</p>
          <p className="text-base">
            工作台正文 14px：本地服务已连接，数据目录在 ~/dramai。Inter 0123456789
          </p>
          <p className="text-sm text-muted-foreground">次要信息 13px：更新于 2 分钟前</p>
          <p className="text-xs text-subtle">说明与时间 12px</p>
          <p className="font-mono text-sm">
            mono 13px · https://api.example.com/v1 · gpt-image-1 · 00:00:05.120
          </p>
        </div>
      </Section>

      <Section
        title="品牌"
        note="BrandMark 与 Wordmark 的颜色来自 token：朱砂两个主题一样，字母跟随文字色。"
      >
        <Row>
          <BrandMark className="h-12 w-auto" />
          <BrandMark className="h-6 w-auto" />
          <BrandMark className="h-4 w-auto" />
          <Wordmark className="h-10 w-auto" />
          <Wordmark className="h-5 w-auto" />
        </Row>
      </Section>

      <Section title="按钮">
        <Row label="variant（md / 36）">
          <Button variant="primary">生成视频</Button>
          <Button variant="secondary">保存</Button>
          <Button variant="ghost">取消</Button>
          <Button variant="danger">删除项目</Button>
          <Button variant="danger-solid">确认删除</Button>
          <Button variant="link">查看文档</Button>
        </Row>
        <Row label="size：sm 28 / md 36 / lg 44 / icon 32">
          <Button variant="primary" size="sm">
            小
          </Button>
          <Button variant="primary">中</Button>
          <Button variant="primary" size="lg">
            大
          </Button>
          <Button variant="secondary" size="icon" aria-label="新建">
            <Plus {...iconProps} aria-hidden />
          </Button>
        </Row>
        <Row label="带图标 / loading / disabled">
          <Button variant="primary">
            <Film {...iconProps} aria-hidden />
            生成全部视频
          </Button>
          <Button variant="secondary">
            <RefreshCw {...iconProps} aria-hidden />
            重新生成
          </Button>
          <Button variant="primary" loading>
            提交中
          </Button>
          <Button variant="secondary" loading>
            测试连接
          </Button>
          <Button variant="primary" disabled>
            不可用
          </Button>
          <Button variant="secondary" disabled>
            不可用
          </Button>
          <Button variant="danger" disabled>
            不可用
          </Button>
        </Row>
        <Row label="IconButton（必带 label）">
          <IconButton label="搜索">
            <Search {...iconProps} aria-hidden />
          </IconButton>
          <IconButton label="编辑">
            <Pencil {...iconProps} aria-hidden />
          </IconButton>
          <IconButton label="复制" variant="secondary">
            <Copy {...iconProps} aria-hidden />
          </IconButton>
          <IconButton label="删除" size="sm">
            <Trash2 {...iconProps} aria-hidden />
          </IconButton>
          <IconButton label="不可用" disabled>
            <Bell {...iconProps} aria-hidden />
          </IconButton>
        </Row>
      </Section>

      <Section
        title="Pill 与 Chip"
        note="Pill 是状态（圆点加文字，24px 高）；Chip 是标签与可选项（4px 圆角）。"
      >
        <Row label="Pill">
          <Pill hollow>未开始</Pill>
          <Pill>已排队</Pill>
          <Pill tone="accent">进行中</Pill>
          <Pill tone="info">图已生成</Pill>
          <Pill tone="success">视频已生成</Pill>
          <Pill tone="warn">已过期</Pill>
          <Pill tone="danger">失败</Pill>
          <Pill tone="neutral" dot={false}>
            仅文字
          </Pill>
        </Row>
        <Row label="Chip：静态标签 / 可选（aria-pressed）">
          <Chip>9:16</Chip>
          <Chip>电影感</Chip>
          <ChipDemo />
        </Row>
      </Section>

      <Section title="卡片" note="没有阴影，表面色加 1px 发丝线，圆角 8。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>雨夜码头</CardTitle>
              <CardDescription>水墨 · 9:16 · 24 镜 · 2 分 08 秒</CardDescription>
            </CardHeader>
            <CardContent>
              <SegmentedProgress
                aria-label="24 个镜头：6 个未开始，8 个已出图，9 个已出视频，1 个失败"
                segments={[
                  ...Array(6).fill('none'),
                  ...Array(8).fill('info'),
                  ...Array(9).fill('success'),
                  'danger',
                ]}
              />
            </CardContent>
            <CardFooter>
              <Pill tone="accent">进行中</Pill>
              <span className="ml-auto text-xs text-subtle">更新于 2 分钟前</span>
            </CardFooter>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">不带分区的卡片，内边距由使用处决定。</p>
          </Card>
        </div>
      </Section>

      <Section
        title="表单"
        note="输入框 sunken 底、border-strong 边框、36 高、2px 朱砂焦点环；Field 自动接上 id 与 aria。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="项目名称" hint="显示在项目列表和导出文件名里">
            <Input placeholder="例如：雨夜码头" />
          </Field>
          <Field label="Base URL" hint="服务商的接口地址，等宽字体">
            <Input mono defaultValue="https://api.example.com/v1" />
          </Field>
          <Field label="模型" required>
            <Select mono defaultValue="image-1">
              <option value="image-1">gpt-image-1</option>
              <option value="video-1">video-model-1</option>
            </Select>
          </Field>
          <Field label="API Key" error="Key 无效，请检查后重试">
            <Input mono defaultValue="sk-invalid" />
          </Field>
          <Field label="提示词" className="sm:col-span-2">
            <Textarea mono placeholder="一个穿黑色风衣的人站在码头，雨夜，低机位" />
          </Field>
          <Field label="已禁用" disabled>
            <Input defaultValue="不能修改" />
          </Field>
          <Field label="只读的已保存 Key">
            <SecretField
              status="已保存，只能替换"
              action={<Button variant="secondary">替换</Button>}
            />
          </Field>
        </div>
        <Row label="Switch / Checkbox">
          <SwitchDemo />
          <Switch aria-label="已关闭" />
          <Switch aria-label="禁用" disabled defaultChecked />
          <Checkbox label="自动重试" defaultChecked />
          <Checkbox label="部分选中" indeterminate />
          <Checkbox label="未选中" />
          <Checkbox label="禁用" disabled />
        </Row>
        <CopyField
          value="npx dramai@latest start"
          aria-label="启动命令"
          copyLabel="复制"
          copiedLabel="已复制"
        />
      </Section>

      <Section title="分段控件与标签页">
        <Row label="SegmentedControl（画幅）">
          <SegmentedControl
            aria-label="画幅"
            defaultValue="9:16"
            options={[
              { value: '9:16', label: '9:16', icon: <RatioIcon w={8} h={14} /> },
              { value: '16:9', label: '16:9', icon: <RatioIcon w={14} h={8} /> },
              { value: '1:1', label: '1:1', icon: <RatioIcon w={11} h={11} /> },
            ]}
          />
        </Row>
        <Tabs defaultValue="running">
          <TabsList>
            <TabsTrigger value="running" count={3} needsAttention>
              进行中
            </TabsTrigger>
            <TabsTrigger value="failed" count={1}>
              失败
            </TabsTrigger>
            <TabsTrigger value="done" count={12}>
              已完成
            </TabsTrigger>
            <TabsTrigger value="off" disabled>
              已禁用
            </TabsTrigger>
          </TabsList>
          <TabsContent value="running" className="pt-4 text-sm text-muted-foreground">
            3 个任务正在处理。
          </TabsContent>
          <TabsContent value="failed" className="pt-4 text-sm text-muted-foreground">
            1 个任务失败。
          </TabsContent>
          <TabsContent value="done" className="pt-4 text-sm text-muted-foreground">
            12 个已完成。
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        title="进度"
        note="确定进度；不确定进度只用于服务商在处理的视频任务；分段进度每段一个镜头。"
      >
        <div className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-subtle">确定 4 / 6</p>
            <Progress value={4} max={6} aria-label="批量 4/6" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-subtle">
              不确定（循环动画；reduce-motion 下为静态半透明满条）
            </p>
            <Progress indeterminate aria-label="视频生成中" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-subtle">
              分段：未开始 / 图已生成 / 视频已生成 / 失败 / 进行中
            </p>
            <SegmentedProgress
              aria-label="分段进度"
              segments={[
                'none',
                'none',
                'info',
                'info',
                'success',
                'success',
                'success',
                'danger',
                'accent',
              ]}
            />
          </div>
        </div>
      </Section>

      <Section
        title="画幅与取景框"
        note="Frame 按画幅比例渲染并带状态覆盖层；CropMarks 只标记「当前」的画面。"
      >
        <Row label="待生图（虚线空框）/ 图已生成 / 视频已生成 / 生成中 / 排队 / 失败">
          <Frame
            className="w-24"
            placeholder={<ImageIcon {...iconProps} size={20} aria-hidden />}
          />
          <Frame className="w-24" src={scene(0)} alt="示意画面" version="v2" />
          <Frame className="w-24" src={scene(1)} alt="示意画面" duration="0:05" />
          <Frame
            className="w-24"
            src={scene(2)}
            alt="示意画面"
            status="running"
            statusLabel="生成中"
          />
          <Frame
            className="w-24"
            src={scene(0)}
            alt="示意画面"
            status="queued"
            statusLabel="排队中"
          />
          <Frame
            className="w-24"
            src={scene(1)}
            alt="示意画面"
            status="failed"
            statusLabel="生成失败"
          />
        </Row>
        <Row label="画幅 16:9 / 1:1，以及当前镜头外包 CropMarks">
          <Frame ratio="16:9" className="w-44" src={scene(1)} alt="示意画面" duration="0:08" />
          <Frame ratio="1:1" className="w-28" src={scene(2)} alt="示意画面" />
          <div className="p-2">
            <CropMarks>
              <Frame className="w-24" src={scene(0)} alt="当前镜头" version="v3" />
            </CropMarks>
          </div>
          <div className="p-2">
            <CropMarks color="var(--danger)">
              <Frame
                className="w-24"
                src={scene(2)}
                alt="失败镜头"
                status="failed"
                statusLabel="生成失败"
              />
            </CropMarks>
          </div>
        </Row>
      </Section>

      <Section
        title="浮层"
        note="Tooltip、Popover、Menu 用 portal + 自带定位；Modal、Drawer 有焦点陷阱、Esc、焦点归还。"
      >
        <OverlayDemo />
      </Section>

      <Section title="提示条" note="行内提示：已过期、说明、不能生成。图标加文字，操作放在下面。">
        <div className="flex max-w-2xl flex-col gap-3">
          <Notice
            tone="warn"
            title="已过期：角色设定图在这个镜头生成后更新过"
            actions={
              <>
                <Button size="sm" variant="secondary">
                  用新设定图重新生成
                </Button>
                <Button size="sm" variant="ghost">
                  保持现状
                </Button>
              </>
            }
          >
            上游的「林夏」设定图从 v2 变成了 v3。
          </Notice>
          <Notice tone="info">重新生成不会覆盖旧图，旧版本留在版本历史里。</Notice>
          <Notice
            tone="danger"
            title="不能生成：还缺 2 项"
            actions={
              <Button size="sm" variant="secondary">
                去补齐
              </Button>
            }
          >
            场景「码头」没有设定图；角色「老周」未登记。
          </Notice>
        </div>
      </Section>

      <Section title="空状态与骨架">
        <div className="grid gap-4 sm:grid-cols-2">
          <EmptyState
            icon={<Film {...iconProps} size={24} aria-hidden />}
            title="这一集还没有镜头"
            description="先在素材里放入这一集的原文，再生成分镜。"
            action={<Button variant="primary">生成分镜</Button>}
          />
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-16 w-9" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </Section>
    </div>
  )
}

function RatioIcon({ w, h }: { w: number; h: number }) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-xs border-[1.5px] border-current"
      style={{ width: w, height: h }}
    />
  )
}

function ChipDemo() {
  const [on, setOn] = useState<string[]>(['水墨'])
  const toggle = (s: string) => setOn((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))
  return (
    <>
      {['水墨', '赛博朋克', '胶片'].map((s) => (
        <Chip key={s} pressed={on.includes(s)} onClick={() => toggle(s)}>
          {s}
        </Chip>
      ))}
    </>
  )
}

function SwitchDemo() {
  const [on, setOn] = useState(true)
  return (
    <label className="inline-flex items-center gap-2 text-base">
      <Switch checked={on} onCheckedChange={setOn} aria-label="开放局域网" />
      开放局域网访问
    </label>
  )
}

function OverlayDemo() {
  const [modal, setModal] = useState(false)
  const [danger, setDanger] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const { toast } = useToast()
  return (
    <>
      <Row label="Tooltip / Popover / Menu">
        <Tooltip content="重新生成可能再次计费">
          <Button variant="secondary">
            <RefreshCw {...iconProps} aria-hidden />
            悬停或聚焦
          </Button>
        </Tooltip>
        <Popover trigger={<Button variant="secondary">弹出层</Button>} aria-label="筛选">
          <div className="flex w-64 flex-col gap-3 p-3">
            <Field label="状态">
              <Select>
                <option>全部</option>
                <option>进行中</option>
                <option>失败</option>
              </Select>
            </Field>
            <Checkbox label="只看当前集" defaultChecked />
          </div>
        </Popover>
        <Menu
          aria-label="镜头操作"
          trigger={
            <IconButton label="更多操作" variant="secondary">
              <MoreHorizontal {...iconProps} aria-hidden />
            </IconButton>
          }
          items={[
            {
              key: 'edit',
              label: '用指令修改',
              icon: <Pencil {...iconProps} aria-hidden />,
              onSelect: () => toast({ title: '已选择：用指令修改' }),
            },
            {
              key: 'regen',
              label: '重新生成',
              icon: <RefreshCw {...iconProps} aria-hidden />,
              onSelect: () => toast({ title: '已选择：重新生成' }),
            },
            { key: 'off', label: '不可用项', disabled: true, onSelect: () => {} },
            'separator',
            {
              key: 'del',
              label: '删除镜头',
              danger: true,
              icon: <Trash2 {...iconProps} aria-hidden />,
              onSelect: () => toast({ title: '已选择：删除镜头' }),
            },
          ]}
        />
      </Row>
      <Row label="Popover block + matchAnchorWidth（侧栏里的集切换器：触发元素撑满父容器，浮层同宽）">
        <div className="w-60 rounded-lg border border-border bg-surface p-2">
          <Popover
            block
            matchAnchorWidth
            placement="bottom-start"
            aria-label="切换集"
            trigger={
              <Button variant="secondary" className="w-full justify-between">
                第 3 集 · 雨夜码头
                <ChevronDown {...iconProps} aria-hidden />
              </Button>
            }
          >
            <ul className="text-base">
              {['第 1 集', '第 2 集', '第 3 集'].map((t) => (
                <li key={t} className="rounded-sm px-2 py-1.5 hover:bg-surface-2">
                  {t}
                </li>
              ))}
            </ul>
          </Popover>
        </div>
      </Row>
      <Row label="Modal / Drawer / Toast">
        <Button variant="secondary" onClick={() => setModal(true)}>
          打开弹窗
        </Button>
        <Button variant="secondary" onClick={() => setDanger(true)}>
          危险确认
        </Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>
          打开抽屉
        </Button>
        <Button variant="secondary" onClick={() => toast({ title: '已复制', tone: 'success' })}>
          成功提示
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ title: '已保存', description: '设置会在下次生成时生效', tone: 'info' })
          }
        >
          带说明的提示
        </Button>
      </Row>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        closeLabel="关闭"
        title="新建项目"
        description="项目的画幅和风格之后仍可修改。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => setModal(false)}>
              创建
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="项目名称">
            <Input data-autofocus placeholder="例如：雨夜码头" />
          </Field>
          <Field label="简介">
            <Textarea />
          </Field>
        </div>
      </Modal>
      <Modal
        open={danger}
        onClose={() => setDanger(false)}
        size="sm"
        dismissOnBackdrop={false}
        closeLabel="关闭"
        title="删除项目？"
        description="项目的全部镜头、资产和版本都会删除，无法恢复。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDanger(false)}>
              取消
            </Button>
            <Button variant="danger-solid" onClick={() => setDanger(false)}>
              确认删除
            </Button>
          </>
        }
      />
      <Drawer
        open={drawer}
        onClose={() => setDrawer(false)}
        closeLabel="关闭"
        padding="none"
        title="任务"
        description="3 个进行中，1 个失败"
      >
        <ul className="divide-y divide-border">
          {['第 3 集 · 镜头 4 视频', '第 3 集 · 镜头 5 视频', '角色「林夏」设定图'].map((t) => (
            <li key={t} className="flex flex-col gap-2 px-6 py-3">
              <span className="text-base">{t}</span>
              <Progress indeterminate aria-label={t} />
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  )
}
