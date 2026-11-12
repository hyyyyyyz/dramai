import { isAppUrl } from './navigation.ts'

/**
 * 权限请求默认全部拒绝。只放行应用自己的页面需要的两项：
 * - `fullscreen`：视频播放器的全屏按钮；
 * - `clipboard-sanitized-write`：复制文本（提示词、错误信息）。
 * 摄像头、麦克风、定位、通知（系统通知走桥接）、USB / 串口 / 蓝牙等都不给。
 */
const ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write'])

export function isPermissionAllowed(
  permission: string,
  requestingUrl: string,
  appOrigins: ReadonlySet<string>,
): boolean {
  return ALLOWED.has(permission) && isAppUrl(requestingUrl, appOrigins)
}
