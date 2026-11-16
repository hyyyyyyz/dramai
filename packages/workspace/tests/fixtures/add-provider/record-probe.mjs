// Records what the REAL server answers to the three calls the add form makes before anything is saved:
// `providers.probe` (list the models / test the connection of a draft), `models.known` and `providers.loginChannels`.
// Not a test: run it by hand when the server's answers change.
//
//   node --conditions=dramai-source --experimental-strip-types packages/workspace/tests/fixtures/add-provider/record-probe.mjs
//
// (from the repository root; Node 22+). The server runs in-process with a data directory of its own. Its upstream is a
// stand-in `fetch` that answers like a provider would (an OpenAI-style model list, a 401 for one particular fake key, a
// refused connection and a timeout for two particular hosts) and counts what it was asked: nothing leaves the machine and
// the keys are fake. Writes `recorded-probe.json` next to this file.
import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../../../../server/src/app.ts'
import { createClient } from '../../../../api/src/index.ts'

const out = fileURLToPath(new URL('./recorded-probe.json', import.meta.url))
const dataDir = await mkdtemp(join(tmpdir(), 'dramai-record-'))
const asked = []
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const server = await createServer({
  port: 0,
  dataDir,
  startWorker: false,
  validateResponses: true,
  logger: { error: () => {} },
  executor: {
    fetch: async (u, init) => {
      const url = new URL(String(u))
      const headers = new Headers(init?.headers)
      asked.push({
        method: init?.method ?? 'GET',
        host: url.hostname,
        path: url.pathname,
        body: init?.body != null,
      })
      if (url.hostname === 'down.example.com') throw new TypeError('fetch failed')
      if (url.hostname === 'slow.example.com') {
        const e = new Error('The operation was aborted due to timeout')
        e.name = 'TimeoutError'
        throw e
      }
      const auth =
        headers.get('authorization') ??
        headers.get('x-api-key') ??
        headers.get('x-goog-api-key') ??
        ''
      if (auth.includes(BAD))
        return json(401, {
          error: {
            message: `Incorrect API key provided: ${BAD}`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        })
      // Gemini-style listing lives under /v1beta/models and answers in its own shape
      if (url.pathname.endsWith('/v1beta/models'))
        return json(200, {
          models: [1, 2].map((n) => ({
            name: `models/gemini-model-${n}`,
            displayName: `Model ${n}`,
            supportedGenerationMethods: ['generateContent'],
          })),
        })
      return json(200, {
        object: 'list',
        data: [
          { id: 'text-model-1', object: 'model' },
          { id: 'text-model-2', object: 'model' },
        ],
      })
    },
  },
})
const api = createClient({ baseUrl: server.url, token: server.token || undefined })
const KEY = 'sk-record-123456789012'
const BAD = 'sk-bad-123456789012'

const draft = (kind, protocol, baseUrl, extra = {}) => ({
  kind,
  protocol,
  baseUrl,
  auth: { type: 'api_key', apiKey: KEY },
  ...extra,
})
const cases = {
  // large model: the model list, and the test of the same address
  'llm.models': { action: 'models', ...draft('llm', 'openai-chat', 'https://llm.example.com/v1') },
  'llm.test': {
    action: 'test',
    ...draft('llm', 'openai-chat', 'https://llm.example.com/v1'),
    model: 'text-model-1',
  },
  'llm.testModelMissing': {
    action: 'test',
    ...draft('llm', 'openai-chat', 'https://llm.example.com/v1'),
    model: 'not-in-the-list',
  },
  'llm.models.none': {
    action: 'models',
    ...draft('llm', 'openai-chat', 'http://127.0.0.1:1234/v1', { auth: { type: 'none' } }),
  },
  'llm.models.unauthorized': {
    action: 'models',
    ...draft('llm', 'openai-chat', 'https://llm.example.com/v1', {
      auth: { type: 'api_key', apiKey: BAD },
    }),
  },
  'llm.test.unauthorized': {
    action: 'test',
    ...draft('llm', 'openai-chat', 'https://llm.example.com/v1', {
      auth: { type: 'api_key', apiKey: BAD },
    }),
  },
  'llm.models.network': {
    action: 'models',
    ...draft('llm', 'openai-chat', 'https://down.example.com/v1'),
  },
  'llm.test.network': {
    action: 'test',
    ...draft('llm', 'openai-chat', 'https://down.example.com/v1'),
  },
  'llm.models.timeout': {
    action: 'models',
    ...draft('llm', 'openai-chat', 'https://slow.example.com/v1'),
  },
  // image
  'image.models': {
    action: 'models',
    ...draft('image', 'openai-images', 'https://img.example.com/v1'),
  },
  'image.test': {
    action: 'test',
    ...draft('image', 'openai-images', 'https://img.example.com/v1'),
    model: 'image-model-1',
  },
  // the three protocols whose model list the server is about to learn to fetch: re-record when it does
  'image.gemini.models': {
    action: 'models',
    ...draft('image', 'gemini-image', 'https://gimg.example.com'),
  },
  'image.models.noList': {
    action: 'models',
    ...draft('image', 'kling-image', 'https://kimg.example.com'),
  },
  'image.test.unverifiable': {
    action: 'test',
    ...draft('image', 'kling-image', 'https://kimg.example.com'),
  },
  // video
  'video.models.noList': {
    action: 'models',
    ...draft('video', 'kling-contents', 'https://video.example.com'),
  },
  'video.test.unverifiable': {
    action: 'test',
    ...draft('video', 'kling-contents', 'https://video.example.com'),
  },
  // voice
  'tts.models': { action: 'models', ...draft('tts', 'openai-tts', 'https://tts.example.com/v1') },
  'tts.test': {
    action: 'test',
    ...draft('tts', 'openai-tts', 'https://tts.example.com/v1'),
    model: 'voice-model-1',
  },
  'tts.models.noList': {
    action: 'models',
    ...draft('tts', 'minimax-t2a', 'https://mtts.example.com/v1'),
  },
  'tts.test.unverifiable': {
    action: 'test',
    ...draft('tts', 'minimax-t2a', 'https://mtts.example.com/v1'),
  },
  // sign-in: nothing is sent, the card takes over after adding
  'login.chatgpt.models': {
    action: 'models',
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'account_login', channel: 'openai-chatgpt' },
  },
  'login.chatgpt.test': {
    action: 'test',
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'account_login', channel: 'openai-chatgpt' },
  },
  'login.openrouter.models': {
    action: 'models',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: { type: 'account_login', channel: 'openrouter' },
  },
}
// addresses the server refuses before sending anything
const refusedAddresses = {
  insecure: 'http://169.254.169.254/v1',
  invalid: 'ftp://example.com',
  placeholder: 'https://%7BWorkspaceId%7D.example.com',
}

try {
  const probes = {}
  const before = asked.length
  for (const [name, body] of Object.entries(cases)) {
    const sentBefore = asked.length
    probes[name] = {
      request: body,
      response: await api.call('providers.probe', { body }),
      upstreamAsked: asked.slice(sentBefore),
    }
  }
  // the model-list answer of every interface type, so a test can hold the card's list of listable types to it
  const KINDS = {
    llm: ['openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-chat'],
    image: [
      'openai-images',
      'gemini-image',
      'volcengine-images',
      'dashscope-image',
      'siliconflow-images',
      'kling-image',
    ],
    video: [
      'aliyun-video',
      'volcengine-video',
      'kling-video',
      'generic-video',
      'ark-video',
      'kling-contents',
      'dashscope-video',
    ],
    tts: ['openai-tts', 'minimax-t2a', 'dashscope-cosyvoice'],
  }
  const modelsByProtocol = {}
  for (const [kind, list] of Object.entries(KINDS))
    for (const protocol of list) {
      const body = { action: 'models', ...draft(kind, protocol, 'https://proto.example.com') }
      const r = await api.call('providers.probe', { body })
      modelsByProtocol[protocol] = { outcome: r.outcome, count: r.items?.length }
    }
  const refused = {}
  for (const [name, baseUrl] of Object.entries(refusedAddresses)) {
    const sentBefore = asked.length
    try {
      await api.call('providers.probe', {
        body: { action: 'models', ...draft('llm', 'openai-chat', baseUrl) },
      })
      refused[name] = 'accepted'
    } catch (e) {
      refused[name] = {
        status: e.status,
        code: e.code,
        details: e.details,
        upstreamAsked: asked.length - sentBefore,
      }
    }
  }
  const known = {}
  for (const kind of ['llm', 'image', 'video', 'tts'])
    known[kind] = (await api.call('models.known', { query: { kind } })).items
  known['image.openai-images'] = (
    await api.call('models.known', { query: { kind: 'image', protocol: 'openai-images' } })
  ).items
  known['tts.openai-tts'] = (
    await api.call('models.known', { query: { kind: 'tts', protocol: 'openai-tts' } })
  ).items
  known['video.kling-contents'] = (
    await api.call('models.known', { query: { kind: 'video', protocol: 'kling-contents' } })
  ).items
  const loginChannels = (await api.call('providers.loginChannels', {})).items
  const stored = (await api.call('providers.list', {})).items
  const text = JSON.stringify({
    responses: Object.values(probes).map((p) => p.response),
    refused,
    known,
    loginChannels,
  })
  const commit = execSync('git rev-parse --short HEAD', {
    cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
  })
    .toString()
    .trim()
  await writeFile(
    out,
    JSON.stringify(
      {
        meta: {
          note: 'Recorded from the real server by record-probe.mjs; the upstream is a stand-in fetch; keys are fake.',
          commit,
          providersStoredAfterAllProbes: stored.length,
          upstreamAsked: asked.length - before,
          keyAppearsInAnyResponse: text.includes(KEY) || text.includes(BAD),
        },
        probes,
        modelsByProtocol,
        refused,
        known,
        loginChannels,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'recorded',
    Object.keys(probes).length,
    'probes; stored providers:',
    stored.length,
    '; key in responses:',
    text.includes(KEY) || text.includes(BAD),
  )
} finally {
  await server.close()
  await rm(dataDir, { recursive: true, force: true })
}
