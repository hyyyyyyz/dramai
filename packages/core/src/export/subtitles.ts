import { cuesFromShots, buildSrt, buildVtt } from '../subtitles/index.ts'
import type { PipelineDeps } from '../pipeline/deps.ts'
import { episodeShots } from '../pipeline/entities.ts'
import { cuesFromPlacement, readEpisodeTimeline } from '../pipeline/compose.ts'

export interface EpisodeSubtitles {
  srt: string
  vtt: string
  /** timeline：从时间线摆放（旁白按配音实测时长）；shots：时间线还没有素材时按镜头时长铺。 */
  source: 'timeline' | 'shots'
}

/** 字幕导出：和成片用同一份摆放。还没有任何视频时退回按镜头时长铺开。 */
export async function buildEpisodeSubtitles(
  deps: PipelineDeps,
  episodeId: string,
): Promise<EpisodeSubtitles> {
  const reading = await readEpisodeTimeline(deps, episodeId)
  if (reading.placement.totalUs > 0 && reading.placement.subtitles.length > 0) {
    const cues = cuesFromPlacement(reading.placement)
    return { srt: buildSrt(cues), vtt: buildVtt(cues), source: 'timeline' }
  }
  const shots = await episodeShots(deps.store, episodeId)
  const cues = cuesFromShots(
    shots.map((s) => ({ narration: s.narration, durationSec: s.durationSec })),
  )
  return { srt: buildSrt(cues), vtt: buildVtt(cues), source: 'shots' }
}
