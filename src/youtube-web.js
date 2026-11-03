// Video de fondo (tipo Canvas de Spotify): lo mismo que hace main.js en escritorio. Se busca en
// YouTube leyendo la página de resultados (sin key ni límite diario) y se prefiere el video
// oficial del artista (o su visualizer oficial); letras, "audio" y visualizers de fans no.
// Se guarda por canción: cada una se busca una sola vez.
import { CapacitorHttp } from '@capacitor/core'
import { readJson, writeJson } from './store.js'

const ytFold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()

async function ytSearch(q) {
  // CapacitorHttp lo pide desde Android (desde la página, YouTube no lo deja por CORS)
  const res = await CapacitorHttp.get({
    url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&hl=es',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'es-MX,es;q=0.9' },
    responseType: 'text', connectTimeout: 10000, readTimeout: 10000,
  })
  const m = String(res.data || '').match(/var ytInitialData = (\{.*?\});<\/script>/s)
  if (!m) return []
  const out = []
  const walk = o => {
    if (!o || typeof o !== 'object' || out.length >= 12) return
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer
      out.push({ id: v.videoId, title: (v.title?.runs || []).map(r => r.text).join(''), channel: v.ownerText?.runs?.[0]?.text || '' })
      return
    }
    for (const k in o) walk(o[k])
  }
  walk(JSON.parse(m[1]))
  return out
}

let ytCache = null
export async function ytVideos(artist, title, live) {
  const key = 'v2|' + ytFold(artist) + '|' + ytFold(title)
  if (!ytCache) ytCache = await readJson('yt-cache.json', {})
  const c = ytCache[key]
  if (c && Date.now() - c.at < (c.ids.length ? 60 : 7) * 864e5) return c.ids
  let list
  try { list = await ytSearch(`${artist} ${title} video oficial`) } catch { return null }   // sin internet
  const t = ytFold(title), a = ytFold(artist).split(' ')[0]
  const scored = list.map(v => {
    const vt = ytFold(v.title), ch = ytFold(v.channel)
    if (!vt.includes(t.split(' ').slice(0, 3).join(' '))) return null            // otra canción
    if (/\b(letra|lyrics?|lyric video|audio|karaoke|cover|reaccion|reaction|8d|slowed|sped up|nightcore)\b/.test(vt)) return null
    if (!live && /\b(en vivo|live|concierto)\b/.test(vt)) return null
    const official = a && (ch.includes(a) || /vevo/.test(ch))
    if (/\bvisualizer\b/.test(vt) && !official) return null
    let score = 0
    if (/\b(video oficial|official video|official music video|videoclip|video clip)\b/.test(vt)) score += 3
    if (official) score += 2
    if (a && vt.includes(a)) score += 1
    return { id: v.id, score }
  }).filter(Boolean).sort((x, y) => y.score - x.score)
  const ids = scored.filter(x => x.score >= 2).slice(0, 3).map(x => x.id)
  ytCache[key] = { ids, at: Date.now() }
  writeJson('yt-cache.json', ytCache)
  return ids
}
