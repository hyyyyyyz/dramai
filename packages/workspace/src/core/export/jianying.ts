import JSZip from 'jszip'
import type { Project } from '@/types/domain'
import { db } from '@/core/storage/db'
import { buildSrt } from '@/core/composition/subtitles'

/**
 * 剪映草稿 ZIP（alpha）。
 *
 * 真实的剪映草稿是一组 JSON（draft_content.json + draft_meta_info.json
 * + 资源文件夹），格式由剪映官方版本决定，且时常变更。这里我们生成一个
 * **最小可用**的草稿包：
 *
 *   dramai-jianying-{slug}-{date}.zip
 *     ├─ assets/
 *     │   ├─ shot_01.mp4 / shot_01.png
 *     │   ├─ ...
 *     ├─ subtitles.srt        — 全篇字幕（按分镜 narration + durationSec）
 *     ├─ manifest.json        — dramai 自己定义的清单，方便我们后续做剪映/CapCut 适配器
 *     └─ README.txt           — 给用户看的："这是 alpha 版剪映草稿；
 *                              建议把 mp4 + srt 直接拖进剪映新建项目"。
 *
 * 之后 v0.5+ 我们会按剪映/CapCut 当时的版本格式生成真正的 .draft_content
 * 等文件。当下这个 ZIP 至少能让用户**手动**在剪映里 5 分钟拼起来。
 */
export async function buildJianyingPackage(project: Project): Promise<Blob> {
  const zip = new JSZip()
  const assets = zip.folder('assets')!

  const shots = await db.storyboards
    .where('[projectId+sequence]')
    .between([project.id, -Infinity], [project.id, Infinity], true, true)
    .toArray()

  const manifest = {
    format: 'dramai-jianying-package',
    version: 1,
    project: {
      id: project.id,
      title: project.title,
      style: project.style,
      summary: project.summary,
    },
    shots: [] as Array<{
      sequence: number
      sceneText: string
      narration?: string
      imagePrompt?: string
      durationSec?: number
      videoFile?: string
      imageFile?: string
    }>,
  }

  for (const s of shots) {
    const seqStr = String(s.sequence).padStart(2, '0')
    const entry: (typeof manifest.shots)[number] = {
      sequence: s.sequence,
      sceneText: s.sceneText,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      durationSec: s.durationSec,
    }

    if (s.videoAssetId) {
      const a = await db.assets.get(s.videoAssetId)
      if (a) {
        const ext = guessExt(a.mimeType, 'mp4')
        const name = `shot_${seqStr}.${ext}`
        assets.file(name, a.blob)
        entry.videoFile = `assets/${name}`
      }
    }
    if (s.imageAssetId) {
      const a = await db.assets.get(s.imageAssetId)
      if (a) {
        const ext = guessExt(a.mimeType, 'png')
        const name = `shot_${seqStr}.${ext}`
        assets.file(name, a.blob)
        entry.imageFile = `assets/${name}`
      }
    }

    manifest.shots.push(entry)
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('subtitles.srt', buildSrt(shots))
  zip.file(
    'README.txt',
    [
      'dramai 草稿包（alpha）',
      '',
      '内容：',
      '  - assets/         — 各分镜的视频 / 图片资源',
      '  - subtitles.srt   — 全篇字幕，时间轴按分镜 durationSec 顺序排列',
      '  - manifest.json   — dramai 自己用的清单',
      '',
      '导入剪映：',
      '  1) 新建草稿，把 assets/ 里的 mp4 按文件名顺序拖到主轨',
      '  2) 把 subtitles.srt 拖到字幕轨',
      '  3) 调整时间轴和字幕样式',
      '',
      '注：完整的剪映 .draft_content 直接打开支持会在 v0.5+ 落地。',
    ].join('\n'),
  )

  return zip.generateAsync({ type: 'blob' })
}

function guessExt(mimeType: string | undefined, fallback: string): string {
  if (!mimeType) return fallback
  const m = /^[^/]+\/([^;]+)/.exec(mimeType)
  if (!m) return fallback
  const sub = m[1].toLowerCase()
  if (sub === 'jpeg') return 'jpg'
  if (sub.startsWith('quicktime')) return 'mov'
  return sub
}
