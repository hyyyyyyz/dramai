import type { AuthContext, MediaProtocol, OutputRef } from '../providers/types.ts'
import { runGeneration } from '../providers/executor.ts'
import type { ExecutorDeps, GenerateOptions, GenerateResult } from '../providers/executor.ts'
import type { JobContext } from './worker.ts'

/**
 * 把“执行器 + 任务上下文”接起来：提交拿到上游任务号就立刻落检查点，
 * 重启恢复时（ctx.resume）跳过提交直接续轮询。2B 的图/视频/音频处理器都用它。
 */
export async function runProviderJob<I>(
  ctx: JobContext,
  protocol: MediaProtocol<I>,
  auth: AuthContext,
  input: I,
  deps: ExecutorDeps = {},
  options: Omit<
    GenerateOptions,
    'signal' | 'onSubmitted' | 'onPoll' | 'resumeTaskId' | 'resumeOutputs' | 'onResult'
  > = {},
): Promise<GenerateResult> {
  const { job } = ctx
  let resumeOutputs: OutputRef[] | undefined
  if (ctx.resume === 'download' && job.resultUrl) {
    resumeOutputs = [{ kind: 'url', url: job.resultUrl }]
  }
  const resumeTaskId = ctx.resume ? job.providerJobId : undefined
  if (ctx.resume === 'poll' && !resumeTaskId) {
    throw new Error('resume=poll 但任务没有上游任务号')
  }
  return runGeneration(protocol, auth, input, deps, {
    ...options,
    signal: ctx.signal,
    resumeTaskId,
    resumeOutputs,
    onSubmitted: async (taskId) => {
      await ctx.checkpoint({ providerJobId: taskId })
      await ctx.setStage('polling')
    },
    onPoll: async (state) => {
      if (state.status === 'processing' && state.progress !== undefined) {
        await ctx.setStage('polling', state.progress)
      }
    },
    onResult: async (outputs) => {
      const url = outputs.find((o): o is Extract<OutputRef, { kind: 'url' }> => o.kind === 'url')
      if (url) await ctx.checkpoint({ resultUrl: url.url })
      await ctx.setStage('downloading')
    },
  })
}
