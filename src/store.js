// Archivos de la app en el celular (en escritorio: la carpeta userData). JSON con caché en
// memoria y guardado con calma, y archivos binarios (los audios de DJ Nat).
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { CapacitorHttp } from '@capacitor/core'

export async function readJson(name, fallback) {
  try {
    const r = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch { return fallback }
}

export async function writeJson(name, data) {
  try {
    await Filesystem.writeFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(data), recursive: true })
  } catch (e) { console.error('writeJson', name, e) }
}

// Bytes ↔ base64 (en pedazos: con un arreglo grande, String.fromCharCode(...) truena)
export function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromBase64(b64) {
  const s = atob(b64), out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export async function sha1(text) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Peticiones HTTP por el lado nativo (sin problemas de CORS en el WebView)
export async function getJson(url, headers = {}) {
  const r = await CapacitorHttp.get({ url, headers, connectTimeout: 15000, readTimeout: 15000 })
  return typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data
}
export async function postJson(url, body, headers = {}) {
  const r = await CapacitorHttp.post({ url, headers: { 'content-type': 'application/json', ...headers }, data: body,
                                       connectTimeout: 15000, readTimeout: 60000 })
  return { status: r.status, data: typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data }
}
