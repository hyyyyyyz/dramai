export default {
  projects: {
    title: '项目',
    sub: '每个项目是数据目录里的一个文件夹，图片和视频可以直接用其他软件打开',
    search: '搜索项目',
    noMatch: '没有符合条件的项目',
    filter: { label: '筛选', all: '全部', active: '进行中', done: '已完成' },
    empty: {
      title: '还没有项目',
      body: '新建一个项目，放进小说或剧本，dramai 会把它拆成集、场和镜头',
    },
    card: {
      episodesShots: '{{episodes}} 集 · {{shots}} 个镜头',
      noEpisodes: '还没分集',
      draft: '草稿 · 还没分集',
      allPlanned: '{{count}} 集待拆分',
      progressLabel: '各集进度',
      episodeStatus: {
        storyboarding: '第 {{n}} 集分镜中',
        producing: '第 {{n}} 集进行中',
        composed: '第 {{n}} 集已合成',
      },
    },
    new: {
      open: '新建项目',
      title: '新建项目',
      name: '标题',
      namePlaceholder: '例如：清朝宫廷',
      nameRequired: '请填写标题',
      aspect: '画幅',
      aspectHint: '画幅是整个项目唯一的画幅，生图、生视频和合成都按它来',
      narration: '旁白怎么出声',
      narrationHint: '之后可以改。视频模型自带的人声和旁白不能同时出现在一个镜头里，所以需要先选定',
      style: '风格',
      submit: '创建并打开',
    },
  },
}
