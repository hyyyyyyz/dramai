import common from './common'
import errors from './errors'
import shell from './shell'
import projects from './projects'
import overview from './overview'
import materials from './materials'
import settings from './settings'
import jobs from './jobs'
import production from './production'
import compose from './compose'
import providerAuth from './provider-auth'
import exportPage from './export'

/** 繁體中文：由 zh-CN 轉換而來（台灣用語），之後手工維護；鍵必須和 zh-CN 一致（tests/i18n.test.ts 逐鍵核對）。 */
export default {
  ...common,
  errors,
  ...shell,
  ...projects,
  ...overview,
  ...materials,
  ...settings,
  ...jobs,
  ...production,
  ...compose,
  ...providerAuth,
  ...exportPage,
}
