const features = [
  {
    title: '文本到分镜',
    desc: '上传 doc / txt / md、贴入文本或参考图，一键生成结构化短剧分镜。',
  },
  {
    title: '角色一致性',
    desc: '为项目内每个角色单独绑定参考图，多场景里保持同一形象。',
  },
  {
    title: '纯本地数据',
    desc: '项目、分镜、参考图都存浏览器 IndexedDB，可一键导出 JSON 备份。',
  },
  {
    title: 'OpenAI 兼容',
    desc: '自填 base URL 与 API Key，支持 OpenAI / Claude / 国产大模型聚合服务商。',
  },
]

function App() {
  return (
    <main className="app-shell">
      <header className="app-hero">
        <span className="app-tag">v0.0.1 · Skeleton</span>
        <h1>
          dramai <span className="app-hero-sub">· 浏览器内的 AI 短剧工作台</span>
        </h1>
        <p>
          这是 <a href="https://github.com/hyyyyyyz/dramai">hyyyyyyz/dramai</a>{' '}
          的初始化骨架页。开发已经从这里启航，下一步会接入设置页、项目数据库与文本到分镜的工作流。
        </p>
      </header>

      <section className="app-grid">
        {features.map((f) => (
          <article key={f.title} className="app-card">
            <h2>{f.title}</h2>
            <p>{f.desc}</p>
          </article>
        ))}
      </section>

      <footer className="app-footer">
        Apache-2.0 · 浏览器原生跑 · 部署目标：
        <code>https://hyyyyyyz.github.io/dramai/</code>
      </footer>
    </main>
  )
}

export default App
