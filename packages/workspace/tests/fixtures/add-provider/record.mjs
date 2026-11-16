// Records what the REAL server answers when the "Add provider" form creates a provider, so the tests of that form do
// not feed it hand-made responses. Not a test: run it by hand when the server's answers change.
//
//   node --conditions=dramai-source --experimental-strip-types packages/workspace/tests/fixtures/add-provider/record.mjs
//
// (from the repository root; Node 22+). It starts the server from this checkout in-process with a data directory of
// its own and an upstream that throws on any call, so nothing leaves the machine; keys are fake. For every kind it
// sends the body the form sends, and records the request, the stored provider, and the login entries of the preset
// list (the form reads the sign-in channels' fixed addresses from there). It writes `recorded.json` next to this file.
import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../../../../server/src/app.ts'
import { createClient } from '../../../../api/src/index.ts'

const out = fileURLToPath(new URL('./recorded.json', import.meta.url))
const dataDir = await mkdtemp(join(tmpdir(), 'dramai-record-'))
const upstream = []
const server = await createServer({
  port: 0,
  dataDir,
  startWorker: false,
  validateResponses: true,
  logger: { error: () => {} },
  executor: {
    fetch: async (u) => {
      upstream.push(String(u))
      throw new Error('record: no upstream requests allowed')
    },
  },
})
const api = createClient({ baseUrl: server.url, token: server.token || undefined })
const KEY = 'sk-record-123456789012'

// one request per kind, as the form builds it (API key), plus the two sign-in channels and "no authentication"
const requests = {
  llm: {
    label: 'My text service',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://llm.example.com/v1',
    model: 'text-model-1',
    auth: { type: 'api_key' },
    apiKey: KEY,
  },
  image: {
    label: 'My image service',
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://img.example.com/v1',
    model: 'image-model-1',
    auth: { type: 'api_key' },
    apiKey: KEY,
  },
  video: {
    label: 'My video service',
    kind: 'video',
    protocol: 'kling-contents',
    baseUrl: 'https://video.example.com',
    model: 'video-model-1',
    auth: { type: 'api_key' },
    apiKey: KEY,
  },
  tts: {
    label: 'My voice service',
    kind: 'tts',
    protocol: 'openai-tts',
    baseUrl: 'https://tts.example.com/v1',
    model: 'voice-model-1',
    auth: { type: 'api_key' },
    apiKey: KEY,
  },
  local: {
    label: 'My local model',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    auth: { type: 'none' },
  },
}
try {
  const providers = {}
  for (const [name, body] of Object.entries(requests))
    providers[name] = { request: body, stored: await api.call('providers.create', { body }) }

  const presets = await api.call('presets.list', {})
  const loginEntries = presets.items.filter((p) => p.auth.type === 'account_login')
  const logins = {}
  for (const p of loginEntries) {
    const body = {
      label: `Sign in ${p.auth.channel}`,
      kind: p.kind,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      model: p.suggestedModel,
      auth: { type: 'account_login', channel: p.auth.channel },
    }
    logins[p.auth.channel] = { request: body, stored: await api.call('providers.create', { body }) }
  }

  // what the server says to an address it refuses (the form shows it under the address box)
  const refused = {}
  for (const [name, baseUrl] of Object.entries({
    insecure: 'http://169.254.169.254/v1',
    invalid: 'ftp://example.com',
  })) {
    try {
      await api.call('providers.create', { body: { ...requests.llm, baseUrl } })
      refused[name] = 'accepted'
    } catch (e) {
      refused[name] = { code: e.code, status: e.status }
    }
  }

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
          note: 'Recorded from the real server by record.mjs; keys are fake; no upstream request was made.',
          commit,
          upstreamRequests: upstream.length,
        },
        providers,
        loginPresets: loginEntries,
        logins,
        refused,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    'recorded',
    Object.keys(providers),
    Object.keys(logins),
    refused,
    'upstream calls:',
    upstream.length,
  )
} finally {
  await server.close()
  await rm(dataDir, { recursive: true, force: true })
}
