// The installers each system must produce, named dramai-<version>-<os>-<arch>.<ext>.
//   macOS    .dmg + .zip      Windows  .exe (NSIS) + .zip      Linux  .AppImage + .tar.gz
// Pure functions, tested for every system and architecture. The release collector (tooling/release) relies on these names.

const OS_LABEL = { darwin: 'mac', win32: 'win', linux: 'linux' }
const EXTENSIONS = {
  darwin: ['dmg', 'zip'],
  win32: ['exe', 'zip'],
  linux: ['AppImage', 'tar.gz'],
}

export function artifactName({ version, platform, arch, ext }) {
  return `dramai-${version}-${OS_LABEL[platform]}-${arch}.${ext}`
}

export function expectedArtifacts({ version, platform, arch }) {
  const exts = EXTENSIONS[platform]
  if (!exts) throw new Error(`unsupported platform: ${platform}`)
  return exts.map((ext) => artifactName({ version, platform, arch, ext }))
}

/**
 * @param {{ version: string, platform: string, arch: string, files: string[] }} input files = names found in the release folder
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyArtifacts({ version, platform, arch, files }) {
  const problems = []
  const expected = expectedArtifacts({ version, platform, arch })
  const prefix = `dramai-${version}-${OS_LABEL[platform]}-`
  for (const name of expected) {
    if (files.includes(name)) continue
    const ext = EXTENSIONS[platform].find((e) => name.endsWith(`.${e}`))
    const misnamed = files.find(
      (f) => f.startsWith('dramai-') && f.endsWith(`.${ext}`) && f !== name,
    )
    problems.push(
      misnamed
        ? `${name} is missing; found ${misnamed}, whose name does not follow dramai-<version>-<os>-<arch>.<ext>`
        : `${name} is missing`,
    )
  }
  void prefix
  return { ok: problems.length === 0, problems }
}
