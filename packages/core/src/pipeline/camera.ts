import type { CameraMovement } from '../domain/shot.ts'

/** 运镜词表 → 一句话描述（用于镜头没有自己写运镜时补上）。 */
export const CAMERA_PHRASE_ZH: Record<CameraMovement, string> = {
  static: '固定机位，画面稳定不动',
  pan_left: '镜头缓慢向左平移',
  pan_right: '镜头缓慢向右平移',
  tilt_up: '镜头缓慢向上仰摇',
  tilt_down: '镜头缓慢向下俯摇',
  zoom_in: '镜头缓慢推近变焦',
  zoom_out: '镜头缓慢拉远变焦',
  orbit_left: '镜头绕主体向左环绕',
  orbit_right: '镜头绕主体向右环绕',
  dolly_in: '镜头平稳向前推进',
  dolly_out: '镜头平稳向后拉出',
}
