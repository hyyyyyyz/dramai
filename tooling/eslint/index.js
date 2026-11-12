import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/** 所有包通用：TS + eslint 推荐规则。 */
export const base = defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
])

/** 浏览器 + React（workspace、ui、site 的 React 部分）。 */
export const react = defineConfig([
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },
])

/** Node 服务端 / CLI / Electron main（core、server、webui、desktop）。 */
export const node = defineConfig([
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])

export default { base, react, node }
