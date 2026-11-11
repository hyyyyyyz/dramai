/** 查询键。集中在一处，事件处理（events.ts）按这里的前缀失效。 */
export const qk = {
  system: ['system'] as const,
  settings: ['settings'] as const,
  styles: ['styles'] as const,
  presets: ['presets'] as const,
  providers: ['providers'] as const,
  providerCapability: (id: string) => ['providers', 'capability', id] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  episodes: (projectId: string) => ['episodes', projectId] as const,
  episode: (id: string) => ['episode', id] as const,
  materials: (projectId: string) => ['materials', projectId] as const,
  assets: (projectId: string) => ['assets', projectId] as const,
  candidates: (projectId: string) => ['candidates', projectId] as const,
  artifacts: ['artifacts'] as const,
  timeline: ['timeline'] as const,
  jobs: ['jobs'] as const,
}
