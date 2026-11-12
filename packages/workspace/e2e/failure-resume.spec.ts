import { expect, test } from '@playwright/test'
import { mock, seedProject, setLocale, waitJobsIdle } from './helpers'

test.beforeAll(async () => {
  await mock.clear()
  await mock.fastStream()
})
test.afterEach(async () => {
  await mock.clear()
  await mock.heal()
})

test('zh: a video that fails after being submitted can be resumed, not paid for twice', async ({
  page,
}) => {
  const { projectId, episodeId } = await seedProject(page, '失败再恢复', { images: true })
  await setLocale(page, 'zh-CN')
  await page.goto(`/projects/${projectId}/episodes/${episodeId}/storyboard`)

  // 上游查询出错：视频已经提交，但拿不到结果
  await mock.rule({ fault: 'poll_error', on: 'video', times: 50 })
  const first = page.getByTestId('shot-1')
  await first.getByRole('button', { name: '生成视频' }).click()
  await page.getByRole('button', { name: '确认并加入队列' }).click()

  // 失败要写明白：是哪一种、能做什么；任务面板里有“恢复原任务”
  await expect(first.getByText('视频生成失败')).toBeVisible()
  // 镜头卡和任务面板是同一个任务的两个入口，这里用镜头卡上的
  const resume = first.getByRole('button', { name: '恢复原任务' })
  await expect(resume).toBeVisible()
  await expect(first.getByRole('button', { name: /重新生成（可能再次计费）/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复原任务' })).toHaveCount(2)

  // 上游恢复后，恢复原任务：同一个上游任务，不再提交一次
  await mock.clear()
  await mock.heal()
  await resume.click()
  await waitJobsIdle(page)
  await expect(first.getByText('视频生成失败')).toBeHidden()
  await expect(page.getByLabel('本集状态')).toContainText('1视频已生成')
})
