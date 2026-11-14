import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Resolve only the stable npm dist-tag, never prereleases or a floating runtime dependency.
const manifestUrl = new URL('../frontend/package.json', import.meta.url)
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
const packages = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]
const resolved = await Promise.all(
  packages.map(async (name) => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
    if (!response.ok) throw new Error(`Cannot resolve ${name}: ${response.status}`)
    const info = await response.json()
    if (!/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error(`Non-stable version: ${name}`)
    return [name, info.version]
  }),
)
for (const [name, version] of resolved) {
  const section = name in manifest.dependencies ? manifest.dependencies : manifest.devDependencies
  section[name] = version
}
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  JSON.stringify(
    { manifest: fileURLToPath(manifestUrl), versions: Object.fromEntries(resolved) },
    null,
    2,
  ),
)
