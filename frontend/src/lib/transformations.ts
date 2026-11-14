export function formatJson(input: string, indentation: 0 | 2 | 4 = 2): string {
  if (!input.trim()) throw new Error('Masukkan JSON yang ingin dirapikan.')
  if (input.length > 1_000_000) throw new Error('JSON terlalu besar. Batas input 1 juta karakter.')
  if (![0, 2, 4].includes(indentation)) throw new Error('Indentasi JSON tidak valid.')

  // Parsing validates syntax only. Serializing the parsed value would round large
  // identifiers and decimal literals, reorder numeric keys, and discard duplicate
  // keys. Formatting the validated tokens preserves the user's actual document.
  JSON.parse(input)
  const tokens =
    input.match(
      /"(?:\\.|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
    ) ?? []
  let depth = 0
  for (const token of tokens) {
    if (token === '{' || token === '[') {
      depth += 1
      if (depth > 100) throw new Error('JSON terlalu dalam. Maksimal 100 tingkat.')
    } else if (token === '}' || token === ']') {
      depth -= 1
    }
  }
  if (indentation === 0) return tokens.join('')

  const parts: string[] = []
  const indent = ' '.repeat(indentation)
  let length = 0
  const append = (part: string) => {
    length += part.length
    if (length > 4_000_000)
      throw new Error('Hasil JSON terlalu besar. Kurangi isi atau gunakan Minify.')
    parts.push(part)
  }
  const newline = () => append('\n' + indent.repeat(depth))
  depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '{' || token === '[') {
      append(token)
      depth += 1
      if (tokens[index + 1] !== (token === '{' ? '}' : ']')) newline()
    } else if (token === '}' || token === ']') {
      depth -= 1
      if (tokens[index - 1] !== (token === '}' ? '{' : '[')) newline()
      append(token)
    } else if (token === ',') {
      append(token)
      newline()
    } else if (token === ':') {
      append(': ')
    } else {
      append(token)
    }
  }
  return parts.join('')
}

export const textTransformations = {
  uppercase: (input: string) => input.toLocaleUpperCase('id'),
  lowercase: (input: string) => input.toLocaleLowerCase('id'),
  title: (input: string) =>
    input
      .toLocaleLowerCase('id')
      .replace(
        /(^|\s)(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toLocaleUpperCase('id'),
      ),
  sentence: (input: string) =>
    input
      .toLocaleLowerCase('id')
      .replace(
        /(^|[.!?]\s+)(\p{L})/gu,
        (_, before: string, letter: string) => before + letter.toLocaleUpperCase('id'),
      ),
  slug: (input: string) =>
    input
      .toLocaleLowerCase('id')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, ''),
  spaces: (input: string) => input.trim().replace(/[ \t]+/g, ' '),
}

export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}

export function decodeBase64(input: string): string {
  const cleaned = input.replace(/\s/g, '')
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleaned) || !cleaned)
    throw new Error('Base64 tidak valid.')
  const bytes = Uint8Array.from(atob(cleaned), (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export const passwordGroups = [
  { key: 'uppercase', label: 'Huruf besar', preview: 'A–Z', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  { key: 'lowercase', label: 'Huruf kecil', preview: 'a–z', chars: 'abcdefghijklmnopqrstuvwxyz' },
  { key: 'numbers', label: 'Angka', preview: '0–9', chars: '0123456789' },
  { key: 'symbols', label: 'Simbol', preview: '#%&', chars: '!@#$%&*+-=?_~' },
] as const

export type PasswordGroups = Record<(typeof passwordGroups)[number]['key'], boolean>

// Rejection sampling avoids bias from modulo reduction of a 32-bit random value.
export function secureRandomIndex(size: number): number {
  if (!Number.isInteger(size) || size < 1 || size > 0x100000000)
    throw new Error('Ukuran alfabet tidak valid.')
  const limit = Math.floor(0x100000000 / size) * size
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)
  return value % size
}

export function generatePassword(length: number, groups: PasswordGroups): string {
  if (!Number.isInteger(length) || length < 12 || length > 64)
    throw new Error('Panjang password harus 12–64 karakter.')
  const selected = passwordGroups.filter((group) => groups[group.key])
  if (!selected.length) throw new Error('Pilih minimal satu jenis karakter.')
  const alphabet = selected.map((group) => group.chars).join('')
  // Sample complete candidates uniformly, rejecting those missing a selected group.
  let result: string
  do {
    result = Array.from({ length }, () => alphabet[secureRandomIndex(alphabet.length)]).join('')
  } while (
    !selected.every((group) =>
      Array.from(result).some((character) => group.chars.includes(character)),
    )
  )
  return result
}
