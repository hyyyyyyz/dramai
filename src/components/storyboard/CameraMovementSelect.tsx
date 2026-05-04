import { Select } from '@/components/ui/select'
import { updateStoryboard } from '@/core/storage/storyboards'
import type { CameraMovement, CameraSpeed, Storyboard } from '@/types/domain'

const MOVEMENT_LABEL: Record<CameraMovement, string> = {
  static: '🚫 静态',
  pan_left: '⇐ 左横摇',
  pan_right: '⇒ 右横摇',
  tilt_up: '⇑ 上抬',
  tilt_down: '⇓ 下俯',
  zoom_in: '🔍 推进',
  zoom_out: '🔎 拉远',
  orbit_left: '↺ 左环绕',
  orbit_right: '↻ 右环绕',
  dolly_in: '⏵ 推轨',
  dolly_out: '⏴ 拉轨',
}

const SPEED_LABEL: Record<CameraSpeed, string> = {
  slow: '慢',
  normal: '正常',
  fast: '快',
}

interface Props {
  shot: Storyboard
}

export function CameraMovementSelect({ shot }: Props) {
  const movement = shot.cameraParams?.movement ?? 'static'
  const speed = shot.cameraParams?.speed ?? 'normal'

  const onMovement = (m: CameraMovement) => {
    void updateStoryboard(shot.id, {
      cameraParams: m === 'static' ? { movement: 'static' } : { movement: m, speed },
    })
  }
  const onSpeed = (s: CameraSpeed) => {
    void updateStoryboard(shot.id, {
      cameraParams: { movement, speed: s },
    })
  }

  return (
    <div className="flex items-center gap-1">
      <Select
        value={movement}
        onChange={(e) => onMovement(e.target.value as CameraMovement)}
        className="h-7 w-32 px-2 text-xs"
        title="运镜"
      >
        {(Object.keys(MOVEMENT_LABEL) as CameraMovement[]).map((m) => (
          <option key={m} value={m}>
            {MOVEMENT_LABEL[m]}
          </option>
        ))}
      </Select>
      {movement !== 'static' && (
        <Select
          value={speed}
          onChange={(e) => onSpeed(e.target.value as CameraSpeed)}
          className="h-7 w-16 px-2 text-xs"
          title="速度"
        >
          {(Object.keys(SPEED_LABEL) as CameraSpeed[]).map((s) => (
            <option key={s} value={s}>
              {SPEED_LABEL[s]}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}
