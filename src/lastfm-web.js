// Last.fm en el celular: lo mismo que lastfm.js de escritorio (etiquetas de género/mood y
// canciones parecidas, con caché), guardando en el celular en lugar de archivos.
import { readJson, writeJson, getJson } from './store.js'

const API       = 'https://ws.audioscrobbler.com/2.0/'
const GAP_MS    = 250          // Last.fm permite ~5 peticiones por segundo
const DAY       = 24 * 3600 * 1000
const TAGS_TTL  = 90 * DAY
const SIM_TTL   = 30 * DAY
const MIN_COUNT = 3            // tags con menos peso suelen ser ruido
const TEMP_ERRORS = new Set([8, 11, 16, 29])   // fallos temporales del servidor: no se cachean
const KEY = 'sd.lastfmKey'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const asList = x => Array.isArray(x) ? x : x ? [x] : []
function cleanTags(list) {
  return asList(list)
    .map(t => [String(t.name || '').toLowerCase().trim(), +t.count || 0])
    .filter(([n, c]) => n && c >= MIN_COUNT)
    .slice(0, 20)
}

export function createLastfm() {
  let cache = { version: 1, tracks: {}, artists: {}, similar: {} }
  const ready = readJson('lastfm-cache.json', {}).then(c => { cache = Object.assign(cache, c) })
  const key = () => localStorage.getItem(KEY) || ''

  let saveTimer = null
  const scheduleSave = () => { if (!saveTimer) saveTimer = setTimeout(flush, 3000) }
  function flush() { clearTimeout(saveTimer); saveTimer = null; writeJson('lastfm-cache.json', cache) }

  // Todas las peticiones pasan por una cola para respetar el límite de Last.fm
  let chain = Promise.resolve()
  function call(params, k = key()) {
    const run = chain.then(async () => {
      const url = API + '?' + new URLSearchParams({ ...params, api_key: k, format: 'json', autocorrect: '1' })
      for (let attempt = 0; ; attempt++) {
        let data
        try { data = await getJson(url) }
        catch {
          if (attempt < 2) { await sleep(2000); continue }
          throw new Error('network')
        }
        if (data.error === 10 || data.error === 26) throw new Error('invalid-key')
        if (TEMP_ERRORS.has(data.error)) {
          if (attempt < 3) { await sleep(5000); continue }
          throw new Error('network')
        }
        return data.error ? null : data
      }
    })
    chain = run.catch(() => {}).then(() => sleep(GAP_MS))
    return run
  }
  const fresh = (e, ttl) => e && Date.now() - e.at < ttl

  return {
    hasKey: () => !!key(),
    async setKey(k) {
      k = String(k || '').trim()
      if (k) {
        try { await call({ method: 'artist.gettoptags', artist: 'Queen' }, k) }
        catch (e) {
          return { ok: false, error: e.message === 'invalid-key' ? 'La API key no es válida.' : 'No se pudo conectar con Last.fm. Revisa tu internet.' }
        }
        localStorage.setItem(KEY, k)
      } else localStorage.removeItem(KEY)
      return { ok: true }
    },
    async cached() {
      await ready
      const pick = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.tags]))
      return { tracks: pick(cache.tracks), artists: pick(cache.artists) }
    },
    async tags(q) {
      await ready
      if (!key()) return null
      let t = cache.tracks[q.key]
      if (!fresh(t, TAGS_TTL)) {
        const d = await call({ method: 'track.gettoptags', artist: q.artist, track: q.title })
        t = cache.tracks[q.key] = { tags: cleanTags(d?.toptags?.tag), at: Date.now() }
        scheduleSave()
      }
      let a = cache.artists[q.akey]
      if (!fresh(a, TAGS_TTL)) {
        const d = await call({ method: 'artist.gettoptags', artist: q.artist })
        a = cache.artists[q.akey] = { tags: cleanTags(d?.toptags?.tag), at: Date.now() }
        scheduleSave()
      }
      return { track: t.tags, artist: a.tags }
    },
    async similar(q) {
      await ready
      if (!key()) return null
      const s = cache.similar[q.key]
      if (fresh(s, SIM_TTL)) return s.data
      const [tr, ar] = await Promise.all([
        call({ method: 'track.getsimilar', artist: q.artist, track: q.title, limit: '150' }),
        call({ method: 'artist.getsimilar', artist: q.artist, limit: '50' }),
      ])
      const data = {
        tracks:  asList(tr?.similartracks?.track).map(x => [x.artist?.name || '', x.name || '', +x.match || 0]),
        artists: asList(ar?.similarartists?.artist).map(x => [x.name || '', +x.match || 0]),
      }
      cache.similar[q.key] = { data, at: Date.now() }
      scheduleSave()
      return data
    },
    flush,
  }
}
