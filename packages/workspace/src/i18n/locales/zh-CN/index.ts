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
import providerCatalog from './provider-catalog'
import exportPage from './export'

/** zh-CN 是文案的“源”：类型从这里推出来，en 必须有同样的键（tests/i18n.test.ts 逐键核对）。 */
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
  ...providerCatalog,
  ...exportPage,
}
