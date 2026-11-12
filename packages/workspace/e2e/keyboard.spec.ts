import { expect, test, type Page } from '@playwright/test'
import { mock, seedProject, setLocale } from './helpers'

test.beforeAll(async () => {
  await mock.clear()
  await mock.fastStream()
})

/** 一直按 Tab，直到焦点落在满足条件的元素上（有上限，免得死循环）。 */
async function tabTo(page: Page, match: (label: string) => boolean, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null
      return (
        el?.getAttribute('aria-label') ??
        el?.labels?.[0]?.textContent?.trim() ??
        el?.textContent?.trim() ??
        ''
      )
    })
    if (match(label)) return label
  }
  throw new Error('Tab 走了 80 次也没有落到目标上')
}

test('keyboard only: pick a clip on the timeline, change its volume, and close a dialog with Esc', async ({
  page,
}) => {
  const { projectId, episodeId } = await seedProject(page, '键盘操作', { videos: true })
  await setLocale(page, 'zh-CN')
  await page.goto(`/projects/${projectId}/episodes/${episodeId}/compose`)
  await expect(page.getByRole('group', { name: '时间线' })).toBeVisible()

  // 时间线上的片段是按钮：Tab 走到，Enter 选中
  await tabTo(page, (l) => l.startsWith('片段 c1'))
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: '片段设置' })).toBeVisible()

  // 改原声音量：Tab 到输入框，输入，Tab 离开就提交，修订历史多出一条
  await tabTo(page, (l) => l === '原声音量（0 到 1）')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('0.7')
  await page.keyboard.press('Tab')
  await expect(page.getByText('调整 c1 的原声音量')).toBeVisible()

  // 弹窗：Esc 关闭，焦点回到触发它的按钮
  await page.goto('/projects')
  await page.getByRole('button', { name: '新建项目' }).first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: '新建项目' }).first()).toBeFocused()
})
