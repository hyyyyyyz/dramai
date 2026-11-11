import { useState } from 'react'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'

export interface Upload {
  key: string
  name: string
  status: 'uploading' | 'error'
  error?: unknown
}

export const SOURCE_ACCEPT =
  '.docx,.txt,.md,.markdown,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

/** 依次上传多个文件；每个文件有自己的状态，失败的留在列表里写明原因（按错误码）。 */
export function useUploads(projectId: string) {
  const upload = useCall('materials.upload', {
    invalidate: [qk.materials(projectId), qk.projects, qk.episodes(projectId)],
  })
  const [items, setItems] = useState<Upload[]>([])
  const start = async (files: File[]) => {
    const added = files.map((f, i) => ({
      key: `${Date.now()}-${i}-${f.name}`,
      name: f.name,
      status: 'uploading' as const,
    }))
    setItems((cur) => [...cur, ...added])
    for (const [i, file] of files.entries()) {
      const key = added[i]!.key
      const form = new FormData()
      form.append('file', file)
      try {
        await upload.mutateAsync({ params: { projectId }, form })
        setItems((cur) => cur.filter((x) => x.key !== key))
      } catch (error) {
        setItems((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'error', error } : x)))
      }
    }
  }
  const dismiss = (key: string) => setItems((cur) => cur.filter((x) => x.key !== key))
  return { items, start, dismiss, busy: items.some((i) => i.status === 'uploading') }
}
