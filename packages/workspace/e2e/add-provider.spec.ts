import { expect, test } from '@playwright/test'
import { MOCK } from './env'
import { expectNoHorizontalScroll, setLocale } from './helpers'

// "Add provider" against the demo mode's simulated provider: ask it for its models, choose one, test, add.
test('en: add a provider by fetching its model list and then add it; asking creates nothing', async ({
  page,
}) => {
  await setLocale(page, 'en')
  await page.goto('/settings/providers')
  const section = page.getByRole('region', { name: /Language model/ })
  // the demo mode has a simulated provider of each kind already
  await expect(section.getByRole('article').first()).toBeVisible()
  const before = await section.getByRole('article').count()
  await section.getByRole('button', { name: 'Add provider' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Name/ }).fill('E2E simulated text provider')
  await dialog.getByRole('textbox', { name: /Base URL/ }).fill(`${MOCK}/v1`)
  await dialog.getByLabel('API Key').fill('sk-e2e-fake-123456789012')
  await expect(dialog.getByRole('button', { name: 'Get model list' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Get model list' }).click()
  // The simulated provider answers its model list with both the OpenAI shape and the Gemini shape in one body, and
  // the server reads the second one, so the list can come back empty here; either way the form says what came back
  // and the model can be typed.
  await expect(
    dialog.getByRole('status').filter({ hasText: /models found|empty model list/ }),
  ).toBeVisible()
  await dialog.getByLabel(/^Model/).fill('mock-llm')

  await dialog.getByRole('button', { name: 'Test connection' }).click()
  await expect(dialog.getByText('Connected')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // asking created nothing: the list behind the dialog is unchanged
  expect(await section.getByRole('article').count()).toBe(before)
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(section.getByRole('article', { name: 'E2E simulated text provider' })).toBeVisible()
  expect(await section.getByRole('article').count()).toBe(before + 1)
})
