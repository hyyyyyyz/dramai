import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Lock, Pencil, Trash2, Unlock, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/core/storage/db'
import { getObjectURL, releaseObjectURL } from '@/core/storage/assets'
import { deleteCharacter, updateCharacter } from '@/core/storage/characters'
import type { Asset, Character, CharacterRole } from '@/types/domain'

const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: '主角',
  supporting: '配角',
  extra: '群演',
}

interface Props {
  character: Character
  onEdit: () => void
}

export function CharacterCard({ character, onEdit }: Props) {
  const asset = useLiveQuery<Asset | undefined, null>(
    async () =>
      character.referenceAssetId ? db.assets.get(character.referenceAssetId) : undefined,
    [character.referenceAssetId],
    null,
  )
  const previewUrl = useMemo(() => (asset ? getObjectURL(asset) : null), [asset])

  useEffect(() => {
    if (!asset) return
    return () => releaseObjectURL(asset.id)
  }, [asset])

  const handleDelete = async () => {
    if (!window.confirm(`确认删除角色「${character.name}」？`)) return
    await deleteCharacter(character.id)
  }

  const toggleLock = () => {
    if (!character.referenceAssetId) {
      window.alert('要锁定形象，请先上传参考图')
      return
    }
    void updateCharacter(character.id, { locked: !character.locked })
  }

  return (
    <div className="flex gap-4 rounded-xl border border-border bg-background-soft p-4">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-background-soft-2">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={character.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Users className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{character.name}</h3>
          <Badge variant="muted">{ROLE_LABEL[character.role]}</Badge>
          {character.locked && (
            <Badge variant="success" className="gap-1">
              <Lock className="h-3 w-3" /> 已锁定
            </Badge>
          )}
        </div>
        {character.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{character.description}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLock}
            className="gap-1.5 text-xs"
            title={
              character.referenceAssetId
                ? character.locked
                  ? '解锁：分镜不再强制使用参考图'
                  : '锁定：分镜会以参考图为图生图源图'
                : '需先上传参考图'
            }
          >
            {character.locked ? (
              <>
                <Unlock className="h-3.5 w-3.5" /> 解锁
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" /> 锁定
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1 text-xs">
            <Pencil className="h-3.5 w-3.5" /> 编辑
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="ml-auto text-muted hover:text-destructive"
            aria-label="删除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
