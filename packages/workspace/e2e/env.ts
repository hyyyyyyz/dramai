export const PORT = Number(process.env.E2E_PORT ?? 4801)
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4802)
export const MOCK = `http://127.0.0.1:${MOCK_PORT}`
