import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, mock, seedProject, setLocale } from './helpers'

const story = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/story.txt')

test.beforeAll(async () => {
  await mock.clear()
  await mock.fastStream()
})

test('en: create a project, upload a text and plan episodes, all in English', async ({ page }) => {
  await setLocale(page, 'en')
  await page.goto('/projects')
  await expect(page.getByText('Demo mode').first()).toBeVisible()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByLabel('Title').fill('English demo')
  await page.getByRole('button', { name: 'Create and open' }).click()
  await expect(page.getByRole('heading', { name: 'English demo' })).toBeVisible()

  await page.getByRole('link', { name: 'Materials', exact: true }).first().click()
  await page.locator('input[type=file]').first().setInputFiles(story)
  await expect(page.getByText('story.txt').first()).toBeVisible()
  await page.getByRole('button', { name: 'Plan episodes' }).click()
  await expect(page.getByText(/Planning finished: \d+ new episodes?/)).toBeVisible()

  // 还没有分镜，合成页要说明白，而不是空着
  await page.getByRole('link', { name: 'Compose', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'No shots to compose yet' })).toBeVisible()
  await expectNoHorizontalScroll(page)
})

test('en: compose blocks rendering while clips have no video, and says what the backend does not do', async ({
  page,
}) => {
  const { projectId, episodeId } = await seedProject(page, 'Compose in English', { images: true })
  // 只有图、没有视频：时间线排得出来，但每个片段都缺视频，是阻断问题，不能渲染
  await setLocale(page, 'en')
  await page.goto(`/projects/${projectId}/episodes/${episodeId}/compose`)
  await expect(page.getByRole('group', { name: 'Timeline' })).toBeVisible()
  await expect(
    page.getByText(/Transitions are hard cuts only and there is a single music track/),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: /Blocking:\s*c1 has no video/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Render the cut' }).first()).toBeDisabled()
  await expectNoHorizontalScroll(page)
  await page.goto(`/projects/${projectId}/episodes/${episodeId}/export`)
  await expect(page.getByRole('heading', { name: 'Cut (mp4)' })).toBeVisible()
  const pkg = page
    .getByRole('heading', { name: 'Material package (zip)' })
    .locator('xpath=ancestor::li')
  await expect(pkg.getByText('Blocked')).toBeVisible()
  await expect(pkg.getByRole('link', { name: 'Go fix' })).toBeVisible()
  await expect(pkg.getByRole('link', { name: /Download package/ })).toHaveCount(0)
})

test('trash: a deleted project goes to the trash and can be restored', async ({ page }) => {
  await seedProject(page, 'Trash me')
  await setLocale(page, 'en')
  await page.goto('/projects')
  await page.getByRole('button', { name: 'More actions for project Trash me' }).click()
  await page.getByRole('menuitem', { name: /Delete project/ }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(page.getByRole('link', { name: /Trash me/ })).toBeHidden()

  await page.goto('/settings/data')
  await expect(page.getByText('Trash me')).toBeVisible()
  await page.getByRole('button', { name: 'Restore project Trash me' }).click()
  await expect(page.getByText('The trash is empty.')).toBeVisible()
  await page.goto('/projects')
  await expect(page.getByRole('link', { name: /Trash me/ })).toBeVisible()
})

test('settings: language (English, Simplified and Traditional Chinese) and theme switch at once, and nothing scrolls sideways at 375px in the light theme', async ({
  page,
}) => {
  await setLocale(page, 'en')
  await page.goto('/settings/general')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('radio', { name: '简体中文' }).click()
  await expect(page.getByRole('heading', { name: '界面语言' })).toBeVisible()
  await page.getByRole('radio', { name: '繁體中文' }).click()
  await expect(page.getByRole('heading', { name: '介面語言' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')

  await page.setViewportSize({ width: 375, height: 812 })
  for (const tab of ['general', 'access', 'data', 'about', 'providers']) {
    await page.goto(`/settings/${tab}`)
    await expect(page.locator('main')).toBeVisible()
    await expectNoHorizontalScroll(page)
  }
  await page.goto('/projects')
  await expectNoHorizontalScroll(page)
})
