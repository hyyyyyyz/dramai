import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Button,
  Checkbox,
  Chip,
  Drawer,
  Field,
  Frame,
  IconButton,
  Input,
  Menu,
  Modal,
  Pill,
  Progress,
  SegmentedControl,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  Tooltip,
  cn,
  useToast,
} from '../src/v2'

describe('cn', () => {
  it('自定义字号不会和颜色互相吃掉', () => {
    expect(cn('text-title-sm text-foreground')).toBe('text-title-sm text-foreground')
    expect(cn('text-sm', 'text-base')).toBe('text-base')
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('Button', () => {
  it('loading 时禁用并标记 aria-busy，不触发点击', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        提交
      </Button>,
    )
    const btn = screen.getByRole('button', { name: '提交' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('默认 type=button，不会意外提交表单', () => {
    render(<Button>确定</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('IconButton 用 label 作为可访问名称', () => {
    render(<IconButton label="删除">x</IconButton>)
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })
})

describe('Pill / Chip', () => {
  it('Pill 圆点是装饰，文字才是状态', () => {
    render(<Pill tone="danger">失败</Pill>)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('Chip 传 pressed 就是带 aria-pressed 的按钮，否则只是文字', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<Chip>9:16</Chip>)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(
      <Chip pressed={false} onClick={onClick}>
        水墨
      </Chip>,
    )
    const chip = screen.getByRole('button', { name: '水墨' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Field', () => {
  it('标签、说明、错误都接到控件上', () => {
    render(
      <Field label="Base URL" hint="接口地址" error="格式不对" required>
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText(/Base URL/)
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const described = input.getAttribute('aria-describedby') ?? ''
    expect(described.split(' ')).toHaveLength(2)
    expect(document.getElementById(described.split(' ')[0])).toHaveTextContent('接口地址')
    expect(screen.getByRole('alert')).toHaveTextContent('格式不对')
  })
})

describe('Switch / Checkbox', () => {
  it('Switch 受控与非受控都能切换', async () => {
    const onChange = vi.fn()
    render(<Switch aria-label="局域网" onCheckedChange={onChange} />)
    const sw = screen.getByRole('switch', { name: '局域网' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it('Checkbox 的 indeterminate 写到原生属性上', () => {
    render(<Checkbox label="全选" indeterminate />)
    expect((screen.getByLabelText('全选') as HTMLInputElement).indeterminate).toBe(true)
  })
})

describe('SegmentedControl / Tabs', () => {
  it('SegmentedControl 方向键切换并移动焦点', async () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="画幅"
        defaultValue="9:16"
        onValueChange={onValueChange}
        options={[
          { value: '9:16', label: '9:16' },
          { value: '16:9', label: '16:9' },
          { value: '1:1', label: '1:1' },
        ]}
      />,
    )
    const first = screen.getByRole('radio', { name: '9:16' })
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '16:9' })).toHaveFocus()
    expect(onValueChange).toHaveBeenLastCalledWith('16:9')
  })

  it('Tabs 只渲染当前面板，方向键在标签间移动', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">甲</TabsTrigger>
          <TabsTrigger value="b" count={3}>
            乙
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">甲面板</TabsContent>
        <TabsContent value="b">乙面板</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('甲面板')
    screen.getByRole('tab', { name: '甲' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /乙/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('乙面板')
  })
})

describe('Progress / Frame', () => {
  it('确定进度写出 aria-valuenow，不确定进度不写', () => {
    const { rerender } = render(<Progress value={4} max={6} aria-label="批量" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4')
    rerender(<Progress indeterminate aria-label="视频" />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
  })

  it('Frame 按画幅设置比例，状态覆盖层写明文字', () => {
    const { container } = render(<Frame ratio="16:9" status="failed" statusLabel="生成失败" />)
    expect(container.firstElementChild).toHaveClass('aspect-video')
    expect(screen.getByRole('status')).toHaveTextContent('生成失败')
  })
})

function ModalHarness({ dismissOnBackdrop }: { dismissOnBackdrop?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>打开</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="新建项目"
        dismissOnBackdrop={dismissOnBackdrop}
        footer={<Button onClick={() => setOpen(false)}>完成</Button>}
      >
        <Input aria-label="名称" />
      </Modal>
    </>
  )
}

describe('Modal / Drawer', () => {
  it('打开后焦点进入弹窗，Tab 循环，Esc 关闭并把焦点还给触发按钮', async () => {
    render(<ModalHarness />)
    const trigger = screen.getByRole('button', { name: '打开' })
    trigger.focus()
    await userEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '新建项目' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // 弹窗里可聚焦的：关闭、输入框、完成。一直 Tab 焦点不会跑出去
    for (let i = 0; i < 7; i++) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('点遮罩关闭；dismissOnBackdrop=false 时不关闭', async () => {
    const { unmount } = render(<ModalHarness />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()

    render(<ModalHarness dismissOnBackdrop={false} />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('Drawer 同样是对话框', () => {
    render(
      <Drawer open onClose={() => {}} title="任务">
        内容
      </Drawer>,
    )
    expect(screen.getByRole('dialog', { name: '任务' })).toBeInTheDocument()
  })
})

describe('Menu / Tooltip / Toast', () => {
  it('Menu 打开后聚焦第一项，方向键移动，Enter 选择后关闭', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <Menu
        trigger={<button>更多</button>}
        items={[
          { key: 'edit', label: '修改', onSelect: onEdit },
          { key: 'off', label: '不可用', disabled: true, onSelect: () => {} },
          'separator',
          { key: 'del', label: '删除', danger: true, onSelect: onDelete },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '更多' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '修改' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}') // 跳过禁用项
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Tooltip 键盘聚焦时出现，并通过 aria-describedby 关联', async () => {
    render(
      <Tooltip content="重新生成可能再次计费">
        <button>重新生成</button>
      </Tooltip>,
    )
    await userEvent.tab()
    const tip = await screen.findByRole('tooltip')
    expect(screen.getByRole('button', { name: '重新生成' })).toHaveAttribute(
      'aria-describedby',
      tip.id,
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('Toast 显示后可手动关闭', async () => {
    function Fire() {
      const { toast } = useToast()
      return (
        <button onClick={() => toast({ title: '已复制', tone: 'success', duration: 0 })}>
          复制
        </button>
      )
    }
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('status')).toHaveTextContent('已复制')
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
