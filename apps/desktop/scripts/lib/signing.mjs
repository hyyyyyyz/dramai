// 签名 / 公证 / 随包 ffmpeg 是否启用，完全看环境变量；electron-builder.config.mjs、dist.mjs 和 after-sign.mjs 共用这份判断。
const has = (env, ...names) => names.every((n) => Boolean(env[n]?.trim()))

export function signingState(env = process.env, platform = process.platform) {
  const macSigned = has(env, 'CSC_LINK') || has(env, 'CSC_NAME')
  const macNotarize =
    macSigned &&
    (has(env, 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER') ||
      has(env, 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'))
  const winAzure = has(
    env,
    'AZURE_TRUSTED_SIGNING_ENDPOINT',
    'AZURE_TRUSTED_SIGNING_ACCOUNT',
    'AZURE_TRUSTED_SIGNING_PROFILE',
    'AZURE_TRUSTED_SIGNING_PUBLISHER',
  )
  const winCert = has(env, 'WIN_CSC_LINK') || (has(env, 'CSC_LINK') && platform === 'win32')
  return {
    macSigned,
    macNotarize,
    winAzure,
    winCert,
    summary: {
      mac: macSigned
        ? macNotarize
          ? 'signed + notarized'
          : 'signed (not notarized)'
        : 'unsigned (ad-hoc signature only)',
      win: winAzure
        ? 'signed (Azure Trusted Signing)'
        : winCert
          ? 'signed (certificate)'
          : 'unsigned',
    },
  }
}
