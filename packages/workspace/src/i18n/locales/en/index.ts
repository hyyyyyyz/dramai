import common from './common'
import errors from './errors'
import shell from './shell'
import projects from './projects'
import overview from './overview'
import materials from './materials'
import settings from './settings'
import jobs from './jobs'

export default {
  ...common,
  errors,
  ...shell,
  ...projects,
  ...overview,
  ...materials,
  ...settings,
  ...jobs,
}
