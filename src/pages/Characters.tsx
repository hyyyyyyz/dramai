import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CharacterCard } from '@/components/character/CharacterCard'
import { CharacterEditDialog } from '@/components/character/CharacterEditDialog'
import { db } from '@/core/storage/db'
import type { Character, Project } from '@/types/domain'

export function CharactersPage() {
  const { projectId } = useParams<{ projectId: string }>()

  const project = useLiveQuery<Project | undefined, null>(
    async () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
    null,
  )
  const characters = useLiveQuery<Character[], Character[]>(
    async () => (projectId ? db.characters.where('projectId').equals(projectId).toArray() : []),
    [projectId],
    [],
  )

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Character | null>(null)

  if (!projectId) return null

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <Link to={`/projects/${projectId}`} className="self-start">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted">
            <ArrowLeft className="h-3.5 w-3.5" /> 项目
          </Button>
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">角色卡</h1>
            <p className="mt-1 text-sm text-muted">
              {project?.title && (
                <>
                  项目「<span className="text-foreground">{project.title}</span>」 ·{' '}
                </>
              )}
              共 {characters.length} 个角色
            </p>
          </div>
          <Button onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> 新建角色
          </Button>
        </div>
      </div>

      {characters.length === 0 ? (
        <Card className="border-dashed bg-background-soft/50">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Users className="h-5 w-5" />
            </div>
            <CardTitle>还没有角色</CardTitle>
            <CardDescription>
              新建一个角色，给主角上传一张你心目中的形象图，然后开启「锁定」——
              生图阶段会用它作为图生图源图，保持所有分镜里同一个角色长得一样。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCreating(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> 创建第一个角色
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <Badge variant="success" className="gap-1">
              已锁定 {characters.filter((c) => c.locked).length}
            </Badge>
            <Badge variant="muted">
              有参考图 {characters.filter((c) => !!c.referenceAssetId).length}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {characters.map((c) => (
              <CharacterCard key={c.id} character={c} onEdit={() => setEditing(c)} />
            ))}
          </div>
        </>
      )}

      <CharacterEditDialog
        open={creating}
        onClose={() => setCreating(false)}
        projectId={projectId}
      />
      <CharacterEditDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        projectId={projectId}
        initial={editing ?? undefined}
      />
    </section>
  )
}
