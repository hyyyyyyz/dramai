import { expect, test, type Page } from '@playwright/test'
import { MOCK } from './env'
import { expectNoHorizontalScroll, setLocale } from './helpers'

// "Add provider" against the demo mode's simulated provider: ask it for its models, choose one, test, add.
async function addByListing(page: Page, region: RegExp, name: string, protocol?: string) {
  await setLocale(page, 'en')
  await page.goto('/settings/providers')
  const section = page.getByRole('region', { name: region })
  // the demo mode has a simulated provider of each kind already
  await expect(section.getByRole('article').first()).toBeVisible()
  const before = await section.getByRole('article').count()
  await section.getByRole('button', { name: 'Add provider' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Name/ }).fill(name)
  if (protocol) await dialog.getByRole('combobox', { name: /API protocol/ }).selectOption(protocol)
  await dialog.getByRole('textbox', { name: /Base URL/ }).fill(`${MOCK}/v1`)
  await dialog.getByLabel('API Key').fill('sk-e2e-fake-123456789012')

  await dialog.getByRole('button', { name: 'Get model list' }).click()
  await expect(dialog.getByRole('status').filter({ hasText: /5 models found/ })).toBeVisible()
  // the model is a drop-down now: "Choose a model", the five models, "Type it in…"
  const model = dialog.getByLabel(/^Model/)
  await expect(model).toHaveJSProperty('tagName', 'SELECT')
  const ids = await model
    .locator('option')
    .evaluateAll((os) =>
      os.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== '' && !v.startsWith('__')),
    )
  expect(ids).toHaveLength(5)
  await model.selectOption(ids[1]!)

  await dialog.getByRole('button', { name: 'Test connection' }).click()
  await expect(dialog.getByText('Connected')).toBeVisible()
  await expectNoHorizontalScroll(page)

  // asking created nothing: the list behind the dialog is unchanged
  expect(await section.getByRole('article').count()).toBe(before)
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const card = section.getByRole('article', { name })
  await expect(card).toBeVisible()
  await expect(section.getByRole('article', { name })).toHaveCount(1)
  expect(await section.getByRole('article').count()).toBe(before + 1)
  await expect(card).toContainText(ids[1]!)
}

test('en: add a language-model provider by getting its model list and choosing one', async ({
  page,
}) => {
  await addByListing(page, /Language model/, 'E2E simulated text provider')
})

test('en: add an image provider by getting its model list and choosing one', async ({ page }) => {
  await addByListing(page, /Text-to-image/, 'E2E simulated image provider', 'openai-images')
})
