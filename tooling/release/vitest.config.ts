import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // CLI 和 git 相关的用例会起子进程；整仓测试并行跑、机器忙的时候默认的 5 秒不够
    testTimeout: 30_000,
  },
})
