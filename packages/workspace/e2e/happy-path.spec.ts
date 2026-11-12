import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, mock, setLocale, waitJobsIdle } from './helpers'

const story = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/story.txt')

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  await mock.clear()
  await mock.fastStream()
})

test('zh: from uploading a text to downloading the cut, without leaving the UI', async ({
  page,
}) => {
  await setLocale(page, 'zh-CN')
  await page.goto('/projects')
  await expect(page.getByText('演示模式', { exact: false }).first()).toBeVisible()

  // 新建项目
  await page.getByRole('button', { name: '新建项目' }).first().click()
  await page.getByLabel('标题').fill('端到端演示')
  await page.getByRole('button', { name: '创建并打开' }).click()
  await expect(page.getByRole('heading', { name: '端到端演示' })).toBeVisible()

  // 上传原文，规划分集
  await page.getByRole('link', { name: '素材', exact: true }).first().click()
  await page.locator('input[type=file]').first().setInputFiles(story)
  await expect(page.getByText('story.txt').first()).toBeVisible()
  await page.getByRole('button', { name: '规划分集' }).click()
  await expect(page.getByText(/规划完成：新增 \d+ 集/)).toBeVisible()

  // 拆分镜头、补提示词
  await page.getByRole('link', { name: '分镜', exact: true }).first().click()
  await page.getByRole('button', { name: '拆分镜头' }).click()
  await expect(page.getByTestId('shot-1')).toBeVisible()
  await page.getByRole('button', { name: '补全镜头提示词' }).first().click()
  await waitJobsIdle(page)
  await expect(page.getByLabel('本集状态')).not.toContainText(/[1-9]\d*不能生成/)

  // 批量出图，再批量出视频：每次都先过确认弹窗
  await page.getByRole('button', { name: '批量生成分镜图' }).click()
  await page.getByRole('button', { name: '确认并加入队列' }).click()
  await waitJobsIdle(page)
  await page.getByRole('button', { name: '批量生成视频' }).click()
  await page.getByRole('button', { name: '确认并加入队列' }).click()
  await waitJobsIdle(page)
  await expect(page.getByLabel('本集状态')).toContainText('34视频已生成')

  // 合成：带旁白的镜头先要配音，没有配音的旁白会挡住渲染
  await page.getByRole('link', { name: '合成', exact: true }).first().click()
  await expect(page.getByRole('group', { name: '时间线' })).toBeVisible()
  await expect(page.getByRole('button', { name: '渲染成片' }).first()).toBeDisabled()
  await page.getByRole('button', { name: '生成旁白配音' }).click()
  await page.getByRole('button', { name: '确认并加入队列' }).click()
  await waitJobsIdle(page)
  await expect(page.getByRole('button', { name: '渲染成片' }).first()).toBeEnabled()

  // 渲染成片
  await page.getByRole('button', { name: '渲染成片' }).first().click()
  await page.getByRole('button', { name: '开始渲染' }).click()
  await waitJobsIdle(page)
  await expect(page.getByText('成片是最新的，可以去导出。')).toBeVisible()

  // 导出：下载成片
  await page.getByRole('link', { name: '去导出' }).click()
  const cutRow = page.getByRole('heading', { name: '成片 mp4' }).locator('xpath=ancestor::li')
  await expect(cutRow.getByText('最新')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    cutRow.getByRole('link', { name: '下载' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.mp4$/)
  expect(statSync(await download.path()).size).toBeGreaterThan(1000)
  await expectNoHorizontalScroll(page)
})
