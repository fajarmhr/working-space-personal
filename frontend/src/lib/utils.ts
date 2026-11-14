import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export async function copyText(value: string) {
  if (!navigator.clipboard)
    throw new Error('Clipboard tidak tersedia. Pilih dan salin teks secara manual.')
  await navigator.clipboard.writeText(value)
}

export function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(
    'id-ID',
    options ?? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  ).format(new Date(value))
}
