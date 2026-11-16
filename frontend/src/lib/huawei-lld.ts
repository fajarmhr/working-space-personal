export type HuaweiExtension = 'txt' | 'ini'
export type HuaweiStage = 'preparation' | 'execution' | 'verification' | 'rollback'

export const huaweiStages: { id: HuaweiStage; label: string }[] = [
  { id: 'preparation', label: 'Preparation' },
  { id: 'execution', label: 'Execution' },
  { id: 'verification', label: 'Verification' },
  { id: 'rollback', label: 'Rollback' },
]

export interface HuaweiInspection {
  nodes: string[]
  sheets: string[]
  warnings: string[]
  summary?: Record<string, unknown>
  interfaces?: Record<string, string[]>
}

export interface HuaweiOptions {
  node: string
  extension: HuaweiExtension
  bgp_password: string
  ebgp_max_hop: number
  max_load_balance: number
  baseline_confirmed: boolean
  bgp_cleanup_commands?: string
  bgp_enabled_before?: boolean
  bfd_enabled_before?: boolean
  physical_admin_before?: Record<string, 'up' | 'down'>
  interface_names: Record<string, string>
}

export interface HuaweiScript {
  name: string
  content: string
  stage: string
  sections?: Record<HuaweiStage, string>
}

export interface HuaweiPackage {
  node: string
  warnings: string[]
  summary: {
    vrfs: number
    subinterfaces: number
    bfd_sessions: number
    static_routes: number
    bgp_peers: number
    loopbacks: number
  }
  files: HuaweiScript[]
  execution_order: string[]
  rollback_order: string[]
  template_version: string
  manual_steps: string[]
  requires_review?: boolean
  readiness?: 'review_required' | 'baseline_supplied'
}

export function huaweiFilename(name: string, extension: HuaweiExtension): string {
  return `${name.replace(/\.(?:txt|ini)$/i, '')}.${extension}`
}

export function validateHuaweiFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return 'Pilih berkas LLD dengan format .xlsx.'
  if (file.size === 0) return 'Berkas LLD kosong. Pilih berkas lain.'
  if (file.size > 10 * 1024 * 1024) return 'Ukuran LLD maksimal 10 MB.'
  return null
}

export function downloadHuaweiScript(script: HuaweiScript, extension: HuaweiExtension): void {
  downloadHuaweiBlob(
    new Blob([script.content], { type: 'text/plain;charset=utf-8' }),
    huaweiFilename(script.name, extension),
  )
}

export function downloadHuaweiBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parsePhysicalBaseline(text: string): Record<string, 'up' | 'down'> {
  const result: Record<string, 'up' | 'down'> = {}
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([a-zA-Z0-9/_.-]+)\s*=\s*(up|down)$/i.exec(line)
    if (!match)
      throw new Error(
        `Baseline interface baris ${index + 1}: gunakan format nama-interface=up atau down.`,
      )
    const name = match[1]
    if (
      name === '__proto__' ||
      name === 'constructor' ||
      name === 'prototype' ||
      Object.hasOwn(result, name)
    )
      throw new Error(
        `Baseline interface baris ${index + 1}: nama interface tidak valid atau berulang.`,
      )
    result[name] = match[2].toLowerCase() as 'up' | 'down'
  }
  return result
}

export function renameHuaweiInterface(
  names: Record<string, string>,
  original: string,
  value: string,
): Record<string, string> {
  const updated = { ...names, [original]: value }
  if (/^Eth-Trunk\d+$/i.test(original)) {
    const previous = names[original]
    for (const [key, name] of Object.entries(names))
      if (key.startsWith(`${original}.`) && name.startsWith(`${previous}.`))
        updated[key] = `${value}${name.slice(previous.length)}`
  }
  return updated
}

export function validateHuaweiInterfaces(names: Record<string, string>): string | null {
  const used = new Set<string>()
  for (const [original, value] of Object.entries(names)) {
    if (!/^[A-Za-z0-9/_.-]+$/.test(value))
      return `Nama interface untuk ${original} wajib diisi tanpa spasi atau karakter perintah.`
    const key = value.toLowerCase()
    if (used.has(key)) return `Nama interface ${value} digunakan lebih dari sekali.`
    used.add(key)
  }
  return null
}
