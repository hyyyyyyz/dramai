import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ReferenceImageUploader } from '@/components/character/ReferenceImageUploader'
import { createCharacter, updateCharacter } from '@/core/storage/characters'
import type { Character, CharacterRole } from '@/types/domain'

const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: '主角',
  supporting: '配角',
  extra: '群演 / 路人',
}

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  /** 编辑模式：传入现有 Character；新建模式：留空。 */
  initial?: Character
}

/**
 * 外层只负责打开/关闭 Modal；表单状态住在内层 `EditForm`。
 * 用 `key` 把 form 在 open 状态变化时重置——避免在 useEffect 里重新 setState
 * 来同步 props。
 */
export function CharacterEditDialog({ open, onClose, projectId, initial }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑角色' : '新建角色'}
      description="给角色绑定一张参考图后开启「锁定」，分镜生图时会以这张图作为图生图源图，保持人物形象一致。"
      className="max-w-lg"
    >
      {open && (
        <EditForm
          key={initial?.id ?? 'new'}
          projectId={projectId}
          initial={initial}
          onClose={onClose}
        />
      )}
    </Modal>
  )
}

interface FormProps {
  projectId: string
  initial?: Character
  onClose: () => void
}

function EditForm({ projectId, initial, onClose }: FormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [role, setRole] = useState<CharacterRole>(initial?.role ?? 'supporting')
  const [referenceAssetId, setReferenceAssetId] = useState<string | undefined>(
    initial?.referenceAssetId,
  )
  const [locked, setLocked] = useState(initial?.locked ?? false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      if (initial) {
        await updateCharacter(initial.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          role,
          referenceAssetId,
          locked,
        })
      } else {
        await createCharacter({
          projectId,
          name,
          description,
          role,
          referenceAssetId,
          locked,
        })
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex gap-5">
        <ReferenceImageUploader
          projectId={projectId}
          value={referenceAssetId}
          onChange={setReferenceAssetId}
        />
        <div className="flex flex-1 flex-col gap-4">
          <Label>
            名字
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：小狐狸"
              required
              maxLength={40}
              autoFocus
            />
          </Label>
          <Label>
            戏份
            <Select value={role} onChange={(e) => setRole(e.target.value as CharacterRole)}>
              {(Object.keys(ROLE_LABEL) as CharacterRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              disabled={!referenceAssetId}
            />
            <span>
              锁定参考图（保持形象一致）
              {!referenceAssetId && (
                <span className="ml-1 text-xs text-muted">需先上传参考图</span>
              )}
            </span>
          </label>
        </div>
      </div>

      <Label>
        角色描述（可选）
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="发型、服饰、性格…会拼到分镜的 image_prompt 里"
        />
      </Label>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={!name.trim() || submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
      </div>
    </form>
  )
}
