import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// GitHub Pages serves this repository at https://hyyyyyyz.github.io/dramai/.
// The build output (dist/) is the root of that path: dist/index.html is /dramai/.
export default defineConfig({
  site: 'https://hyyyyyyz.github.io',
  base: '/dramai/',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory', assets: '_astro' },
  devToolbar: { enabled: false },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'zh', locales: { zh: 'zh-CN', en: 'en' } },
      // 404 is not a page worth indexing; the sitemap integration already skips 404 and 500.
    }),
  ],
})
