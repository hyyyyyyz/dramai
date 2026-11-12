import { randomBytes } from 'node:crypto'

/** 每次启动生成一个新令牌（256 位随机数）。只在主进程和服务进程的内存里，不落盘、不进环境变量、不出现在地址里。 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}
