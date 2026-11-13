import { node } from '@dramai/eslint-config'
import astro from 'eslint-plugin-astro'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.astro', 'node_modules']),
  ...node,
  ...astro.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
])
