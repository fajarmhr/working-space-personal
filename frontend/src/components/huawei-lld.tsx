import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  FileArrowUp,
  FileXls,
  LockSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { api } from '../lib/api'
import {
  downloadHuaweiScript,
  downloadHuaweiBlob,
  huaweiStages,
  parsePhysicalBaseline,
  renameHuaweiInterface,
  validateHuaweiInterfaces,
  validateHuaweiFile,
  type HuaweiExtension,
  type HuaweiInspection,
  type HuaweiPackage,
  type HuaweiOptions,
  type HuaweiStage,
} from '../lib/huawei-lld'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

const summaryLabels = {
  vrfs: 'VRF',
  subinterfaces: 'Subinterface',
  bfd_sessions: 'BFD session',
  static_routes: 'Static route',
  bgp_peers: 'BGP peer',
  loopbacks: 'Loopback',
} as const

export default function HuaweiLld({ onActivity }: { onActivity: (action: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [inspection, setInspection] = useState<HuaweiInspection | null>(null)
  const [node, setNode] = useState('')
  const [password, setPassword] = useState('')
  const [maxHop, setMaxHop] = useState('10')
  const [maxBalance, setMaxBalance] = useState('2')
  const [extension, setExtension] = useState<HuaweiExtension>('ini')
  const [baseline, setBaseline] = useState(false)
  const [cleanup, setCleanup] = useState('')
  const [bgpBefore, setBgpBefore] = useState('unknown')
  const [bfdBefore, setBfdBefore] = useState('unknown')
  const [physicalBefore, setPhysicalBefore] = useState('')
  const [interfaceNames, setInterfaceNames] = useState<Record<string, string>>({})
  const [interfacesConfirmed, setInterfacesConfirmed] = useState(false)
  const [working, setWorking] = useState<'inspect' | 'generate' | 'download' | null>(null)
  const [result, setResult] = useState<HuaweiPackage | null>(null)
  const [selectedFile, setSelectedFile] = useState(0)
  const [stage, setStage] = useState<HuaweiStage | 'all'>('all')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const revision = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      revision.current += 1
      clearTimeout(copyTimer.current)
    },
    [],
  )

  function invalidate() {
    setResult(null)
    setCopied(false)
    setError('')
  }

  function clearBaseline() {
    setBaseline(false)
    setCleanup('')
    setBgpBefore('unknown')
    setBfdBefore('unknown')
    setPhysicalBefore('')
  }

  function chooseNode(name: string) {
    setNode(name)
    setPassword('')
    clearBaseline()
    setInterfacesConfirmed(false)
    setInterfaceNames(
      Object.fromEntries((inspection?.interfaces?.[name] || []).map((item) => [item, item])),
    )
    invalidate()
  }

  async function choose(candidate?: File) {
    if (!candidate || working) return
    const problem = validateHuaweiFile(candidate)
    if (problem) {
      setError(problem)
      return
    }
    const request = ++revision.current
    invalidate()
    setFile(candidate)
    setInspection(null)
    setNode('')
    clearBaseline()
    setPassword('')
    setInterfacesConfirmed(false)
    setInterfaceNames({})
    setWorking('inspect')
    try {
      const data = await api.huaweiInspect(candidate)
      if (request !== revision.current) return
      setInspection(data)
      setNode(data.nodes[0] || '')
      setInterfaceNames(
        Object.fromEntries((data.interfaces?.[data.nodes[0]] || []).map((name) => [name, name])),
      )
      if (!data.nodes.length) setError('Tidak ada NE yang dapat diproses dari kedua sheet LLD.')
    } catch (caught) {
      if (request === revision.current)
        setError(caught instanceof Error ? caught.message : 'LLD belum dapat dibaca.')
    } finally {
      if (request === revision.current) setWorking(null)
    }
  }

  async function generate() {
    if (!file || !inspection || !node || working) return
    const hop = Number(maxHop)
    const balance = Number(maxBalance)
    if (!password.trim()) {
      setError('Isi password BGP yang akan dimasukkan ke script.')
      return
    }
    if (
      !Number.isInteger(hop) ||
      hop < 1 ||
      hop > 255 ||
      !Number.isInteger(balance) ||
      balance < 1 ||
      balance > 64
    ) {
      setError('eBGP max hop harus 1–255 dan maximum load balance harus 1–64.')
      return
    }
    if (!baseline) {
      setError('Konfirmasi persiapan perubahan sebelum membuat script.')
      return
    }
    const interfaceError = validateHuaweiInterfaces(interfaceNames)
    if (interfaceError || !interfacesConfirmed) {
      setError(interfaceError || 'Periksa dan konfirmasi nama interface pada perangkat target.')
      return
    }
    const request = ++revision.current
    invalidate()
    setWorking('generate')
    try {
      const data = await api.huaweiGenerate(file, makeOptions())
      if (request !== revision.current) return
      setResult(data)
      setSelectedFile(0)
      setStage('all')
      onActivity('Membuat paket script Huawei dari LLD')
    } catch (caught) {
      if (request === revision.current)
        setError(caught instanceof Error ? caught.message : 'Script belum dapat dibuat.')
    } finally {
      if (request === revision.current) setWorking(null)
    }
  }

  function makeOptions(): HuaweiOptions {
    return {
      node,
      extension,
      bgp_password: password,
      ebgp_max_hop: Number(maxHop),
      max_load_balance: Number(maxBalance),
      baseline_confirmed: baseline,
      interface_names: interfaceNames,
      ...(cleanup.trim() ? { bgp_cleanup_commands: cleanup.trim() } : {}),
      ...(bgpBefore !== 'unknown' ? { bgp_enabled_before: bgpBefore === 'true' } : {}),
      ...(bfdBefore !== 'unknown' ? { bfd_enabled_before: bfdBefore === 'true' } : {}),
      ...(physicalBefore.trim()
        ? { physical_admin_before: parsePhysicalBaseline(physicalBefore) }
        : {}),
    }
  }

  async function downloadPackage() {
    if (!file || !result || working) return
    const request = ++revision.current
    setError('')
    setWorking('download')
    try {
      const blob = await api.huaweiDownload(file, makeOptions())
      if (request !== revision.current) return
      downloadHuaweiBlob(blob, `${result.node}-huawei-package.zip`)
    } catch (caught) {
      if (request === revision.current)
        setError(caught instanceof Error ? caught.message : 'Paket belum dapat diunduh.')
    } finally {
      if (request === revision.current) setWorking(null)
    }
  }

  const current = result?.files[selectedFile]
  const preview = current
    ? stage === 'all'
      ? current.content
      : current.sections?.[stage] || current.content
    : ''
  async function copy() {
    if (!preview) return
    try {
      await navigator.clipboard.writeText(preview)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Teks belum dapat disalin. Pilih isi preview atau unduh script.')
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap gap-x-7 gap-y-3 border-b border-border pb-5 text-xs">
        {['Baca LLD', 'Atur parameter', 'Review & unduh'].map((label, index) => (
          <span
            key={label}
            className={cn(
              'flex items-center gap-2',
              index === 0 || inspection ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full font-mono text-[10px]',
                index === 0 || inspection ? 'bg-accent-soft text-primary' : 'bg-muted',
              )}
            >
              {(index === 0 && inspection) || (index === 1 && result) ? (
                <Check size={12} />
              ) : (
                `0${index + 1}`
              )}
            </span>
            {label}
          </span>
        ))}
      </div>

      <div className="grid min-w-0 items-start gap-7 lg:grid-cols-[0.85fr_1.15fr]">
        <section
          className="min-w-0 rounded-[28px] border border-border bg-surface p-6 sm:p-7"
          aria-labelledby="huawei-source-title"
        >
          <div className="mb-6 flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-primary">
            <FileXls size={22} />
          </div>
          <p className="eyebrow mb-3">Sumber konfigurasi</p>
          <h2 id="huawei-source-title" className="text-lg font-medium tracking-tight">
            Satu LLD, dua script berurutan.
          </h2>
          <p className="mt-3 text-xs leading-7 text-muted-foreground">
            Baca sheet 5G Core Service IP Design dan Routing untuk membuat Static Routing + BFD,
            lalu BGP over Static Routing + BFD.
          </p>
          <input
            ref={input}
            type="file"
            accept=".xlsx"
            aria-label="Buka LLD Excel"
            className="sr-only"
            disabled={!!working}
            onChange={(event) => {
              void choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void choose(event.dataTransfer.files[0])
            }}
            className="mt-6 rounded-2xl border border-dashed border-border bg-background p-5"
          >
            {file ? (
              <p className="mb-2 break-all text-xs font-medium">{file.name}</p>
            ) : (
              <p className="mb-2 text-xs font-medium">Tarik LLD ke sini atau pilih berkas.</p>
            )}
            <p className="text-[11px] leading-6 text-muted-foreground">
              .xlsx, maksimal 10 MB. Semua pemrosesan di komputer ini.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={() => input.current?.click()}
              disabled={!!working}
            >
              <FileArrowUp size={17} />
              {working === 'inspect' ? 'Membaca LLD…' : file ? 'Ganti LLD' : 'Pilih LLD'}
            </Button>
            {file && !inspection && !working && (
              <Button variant="ghost" className="mt-4 ml-2" onClick={() => void choose(file)}>
                Baca ulang
              </Button>
            )}
          </div>
          {working === 'inspect' && (
            <div role="status" aria-label="Memeriksa dua sheet LLD" className="mt-5 space-y-3">
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-4 w-3/5" />
            </div>
          )}
          {inspection && (
            <div className="mt-5 space-y-2 text-[11px] leading-6 text-muted-foreground">
              <p className="flex items-center gap-2 text-primary">
                <CheckCircle size={16} />
                {inspection.nodes.length} NE ditemukan
              </p>
              {inspection.sheets.map((sheet) => (
                <p key={sheet} className="break-words">
                  {sheet}
                </p>
              ))}
            </div>
          )}
          {!!inspection?.warnings.length && (
            <ul className="mt-4 list-disc space-y-2 pl-4 text-[11px] leading-6 text-muted-foreground">
              {inspection.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-w-0 py-2" aria-labelledby="huawei-parameters-title">
          <p className="eyebrow mb-3">Parameter perubahan</p>
          <h2 id="huawei-parameters-title" className="text-sm font-medium">
            Lengkapi nilai yang tidak tersedia di LLD.
          </h2>
          <fieldset
            disabled={!inspection || !!working}
            className="mt-5 space-y-5 disabled:opacity-55"
          >
            <div className="grid gap-2">
              <label htmlFor="huawei-node" className="field-label">
                Network element
              </label>
              <select
                id="huawei-node"
                className="field"
                value={node}
                onChange={(event) => chooseNode(event.target.value)}
              >
                {!inspection?.nodes.length && <option value="">Pilih LLD terlebih dahulu</option>}
                {inspection?.nodes.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-6 text-muted-foreground">
                AS number, alamat IP, VRF, VLAN, dan BFD mengikuti data LLD.
              </p>
            </div>
            {Object.keys(interfaceNames).length > 0 && (
              <details open className="rounded-2xl border border-border px-4 py-3">
                <summary className="cursor-pointer text-xs font-medium">
                  Nama interface perangkat target
                </summary>
                <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
                  Masukkan nama fisik, trunk, subinterface, dan loopback sesuai perangkat. Mengubah
                  nama trunk ikut memperbarui nama subinterface yang masih mengikuti trunk tersebut.
                </p>
                <div className="mt-4 max-h-80 space-y-4 overflow-y-auto pr-2">
                  {Object.entries(interfaceNames).map(([original, name], index) => (
                    <div key={original} className="grid gap-2">
                      <label
                        htmlFor={`huawei-interface-${index}`}
                        className="field-label break-all font-mono text-[10px]"
                      >
                        {original}
                      </label>
                      <input
                        id={`huawei-interface-${index}`}
                        className="field min-w-0 font-mono text-xs"
                        value={name}
                        onChange={(event) => {
                          setInterfaceNames((current) =>
                            renameHuaweiInterface(current, original, event.target.value),
                          )
                          setInterfacesConfirmed(false)
                          invalidate()
                        }}
                      />
                    </div>
                  ))}
                </div>
                <label className="mt-4 flex cursor-pointer items-start gap-3 text-[11px] leading-6 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-1.5 size-4 shrink-0 accent-primary"
                    checked={interfacesConfirmed}
                    onChange={(event) => {
                      setInterfacesConfirmed(event.target.checked)
                      invalidate()
                    }}
                  />
                  <span>Nama interface sudah sesuai dengan perangkat target.</span>
                </label>
              </details>
            )}
            <div className="grid gap-2">
              <label htmlFor="huawei-password" className="field-label">
                Password BGP
              </label>
              <input
                id="huawei-password"
                className="field font-mono"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  invalidate()
                }}
                placeholder="Masukkan nilai untuk PSWDCIPHERTEXT"
              />
              <p className="text-[11px] leading-6 text-muted-foreground">
                Nilai dimasukkan ke PSWDCIPHERTEXT sesuai template. Password tidak disimpan sebagai
                preferensi.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="huawei-hop" className="field-label">
                  eBGP max hop
                </label>
                <input
                  id="huawei-hop"
                  className="field font-mono"
                  type="number"
                  min={1}
                  max={255}
                  value={maxHop}
                  onChange={(event) => {
                    setMaxHop(event.target.value)
                    invalidate()
                  }}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="huawei-balance" className="field-label">
                  Maximum load balance
                </label>
                <input
                  id="huawei-balance"
                  className="field font-mono"
                  type="number"
                  min={1}
                  max={64}
                  value={maxBalance}
                  onChange={(event) => {
                    setMaxBalance(event.target.value)
                    invalidate()
                  }}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label htmlFor="huawei-extension" className="field-label">
                Format unduhan
              </label>
              <select
                id="huawei-extension"
                className="field"
                value={extension}
                onChange={(event) => setExtension(event.target.value as HuaweiExtension)}
              >
                <option value="ini">.ini</option>
                <option value="txt">.txt</option>
              </select>
              <p className="text-[11px] leading-6 text-muted-foreground">
                Keduanya berisi script MML yang sama sesuai template.
              </p>
            </div>
            <details className="rounded-2xl border border-border px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium">
                Baseline &amp; kelengkapan rollback
              </summary>
              <div className="mt-4 space-y-4">
                <p className="text-[11px] leading-6 text-muted-foreground">
                  Opsional saat menyusun draft. Nilai yang belum diketahui tetap dicatat sebagai
                  langkah manual pada hasil.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <label htmlFor="huawei-bgp-before" className="field-label text-xs">
                      Status awal BGP global
                    </label>
                    <select
                      id="huawei-bgp-before"
                      className="field text-xs"
                      value={bgpBefore}
                      onChange={(event) => {
                        setBgpBefore(event.target.value)
                        invalidate()
                      }}
                    >
                      <option value="unknown">Belum diketahui</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="huawei-bfd-before" className="field-label text-xs">
                      Status awal BFD global
                    </label>
                    <select
                      id="huawei-bfd-before"
                      className="field text-xs"
                      value={bfdBefore}
                      onChange={(event) => {
                        setBfdBefore(event.target.value)
                        invalidate()
                      }}
                    >
                      <option value="unknown">Belum diketahui</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="huawei-physical-before" className="field-label text-xs">
                    Status awal interface fisik
                  </label>
                  <textarea
                    id="huawei-physical-before"
                    className="field min-h-24 font-mono text-[11px]"
                    value={physicalBefore}
                    onChange={(event) => {
                      setPhysicalBefore(event.target.value)
                      invalidate()
                    }}
                    placeholder={'200GE1/0/1=up\n200GE1/0/2=down'}
                  />
                  <p className="text-[11px] leading-6 text-muted-foreground">
                    Satu interface per baris, gunakan nama asal pada label daftar interface. Output
                    akan mengikuti nama target yang kamu isi.
                  </p>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="huawei-bgp-cleanup" className="field-label text-xs">
                    Perintah cleanup BGP tervalidasi
                  </label>
                  <textarea
                    id="huawei-bgp-cleanup"
                    className="field min-h-28 font-mono text-[11px]"
                    value={cleanup}
                    onChange={(event) => {
                      setCleanup(event.target.value)
                      invalidate()
                    }}
                    placeholder="Masukkan perintah cleanup yang sudah divalidasi pada release UPF target"
                  />
                  <p className="text-[11px] leading-6 text-muted-foreground">
                    Untuk pemulihan objek BGP yang sintaks penghapusannya belum tersedia di
                    template. Periksa urutan dependensinya.
                  </p>
                </div>
              </div>
            </details>
            <label className="flex cursor-pointer items-start gap-3 text-[11px] leading-6 text-muted-foreground">
              <input
                type="checkbox"
                checked={baseline}
                onChange={(event) => {
                  setBaseline(event.target.checked)
                  invalidate()
                }}
                className="mt-1.5 size-4 shrink-0 accent-primary"
              />
              <span>
                Saya menyiapkan resource baru, telah memeriksa sintaks MML pada target, dan telah
                menyimpan baseline serta status interface untuk pemulihan.
              </span>
            </label>
          </fieldset>
          <Button
            className="mt-6"
            onClick={() => void generate()}
            disabled={
              !inspection ||
              !node ||
              !password.trim() ||
              !baseline ||
              !interfacesConfirmed ||
              !!working
            }
          >
            {working === 'generate' ? 'Menyusun script…' : 'Buat paket script'}
            <ArrowRight size={17} />
          </Button>
        </section>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger/5 p-4 text-xs leading-6 text-danger"
        >
          <WarningCircle size={18} className="mt-1 shrink-0" />
          {error}
        </p>
      )}
      {working === 'generate' && (
        <div
          role="status"
          aria-label="Menyusun dua script Huawei"
          className="space-y-4 rounded-[28px] border border-border p-6"
        >
          <div className="skeleton h-5 w-2/5" />
          <div className="skeleton h-48 w-full" />
        </div>
      )}

      {result && current && (
        <section
          aria-label="Hasil script Huawei"
          className="min-w-0 rounded-[28px] border border-border bg-surface p-5 sm:p-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Paket perubahan</p>
              <h2 className="text-lg font-medium tracking-tight">{result.node}</h2>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Template {result.template_version}
              </p>
            </div>
            <div className="text-[11px] leading-6 text-muted-foreground">
              <p>Execution: Static + BFD, lalu BGP.</p>
              <p>Rollback: BGP, lalu Static + BFD.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={!!working}
                onClick={() => void downloadPackage()}
              >
                <DownloadSimple size={15} />
                {working === 'download' ? 'Menyiapkan ZIP…' : 'Unduh paket ZIP'}
              </Button>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-3 xl:grid-cols-6">
            {Object.entries(summaryLabels).map(([key, label]) => (
              <div key={key}>
                <dt className="text-[10px] text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-mono text-lg">
                  {result.summary[key as keyof typeof summaryLabels]}
                </dd>
              </div>
            ))}
          </dl>
          <p role="status" className="mt-5 flex items-center gap-2 text-xs text-primary">
            {result.requires_review || result.manual_steps.length > 0 ? (
              <WarningCircle size={17} />
            ) : (
              <CheckCircle size={17} />
            )}
            {result.requires_review || result.manual_steps.length > 0
              ? 'Paket dibuat. Kelengkapan rollback masih perlu ditinjau.'
              : 'Paket dibuat dengan baseline yang diberikan.'}
          </p>
          {(result.warnings.length > 0 || result.manual_steps.length > 0) && (
            <div className="mt-5 rounded-2xl bg-muted/60 p-4 text-[11px] leading-6">
              <p className="mb-2 flex items-center gap-2 font-medium">
                <WarningCircle size={16} />
                Periksa sebelum digunakan
              </p>
              <ul className="list-disc space-y-2 pl-4 text-muted-foreground">
                {[...result.warnings, ...result.manual_steps].map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2" aria-label="Pilih script">
            {result.files.map((script, index) => (
              <Button
                key={script.name}
                variant={selectedFile === index ? 'default' : 'secondary'}
                onClick={() => {
                  setSelectedFile(index)
                  setCopied(false)
                }}
                aria-pressed={selectedFile === index}
              >
                {index + 1}. {index === 0 ? 'Static + BFD' : 'BGP'}
              </Button>
            ))}
          </div>
          {current.sections && (
            <div className="mt-4 flex flex-wrap gap-1" aria-label="Pilih tahapan">
              {[{ id: 'all', label: 'Seluruh script' }, ...huaweiStages].map((item) => (
                <Button
                  key={item.id}
                  variant={stage === item.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    setStage(item.id as HuaweiStage | 'all')
                    setCopied(false)
                  }}
                  aria-pressed={stage === item.id}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 break-all font-mono text-[10px] text-muted-foreground">
              {current.name.replace(/\.(txt|ini)$/i, '')}.{extension}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void copy()}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Tersalin' : 'Salin'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => downloadHuaweiScript(current, extension)}
              >
                <DownloadSimple size={15} />
                Unduh script
              </Button>
            </div>
          </div>
          <textarea
            aria-label="Preview script Huawei"
            readOnly
            value={preview}
            spellCheck={false}
            className="code-editor mt-3 h-[460px] min-w-0 whitespace-pre text-[11px] leading-6"
            wrap="off"
          />
          <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
            Jalankan satu tahapan pada satu waktu. Bagian rollback dijalankan hanya saat pemulihan
            diperlukan.
          </p>
        </section>
      )}
      <p className="flex items-start gap-2 border-t border-border pt-5 text-[11px] leading-6 text-muted-foreground">
        <LockSimple size={16} className="mt-1 shrink-0 text-primary" />
        LLD diproses di server lokal. Script memuat konfigurasi dan password BGP; simpan hasil di
        lokasi kerja yang sesuai.
      </p>
    </div>
  )
}
