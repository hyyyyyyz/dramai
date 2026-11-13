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
