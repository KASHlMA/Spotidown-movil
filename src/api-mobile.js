// window.api del celular: lo mismo que en escritorio hacen preload.js + main.js, pero con lo que
// da Android (Capacitor). La interfaz (renderer.js) es la misma; sólo cambia esta capa.
//
// Fase 1: música del celular, carátulas y letras, caché, reproducción con pantalla apagada y
// controles en la notificación. Lo demás (Last.fm, DJ Nat, clima, Canvas) responde como "sin
// configurar" hasta portarlo, así la app funciona completa sin esas partes.
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { MediaSession } from '@jofr/capacitor-media-session'
import { App } from '@capacitor/app'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import { createLastfm } from './lastfm-web.js'
import { createGemini, weatherFor } from './gemini-web.js'
import { getJson, toBase64 } from './store.js'
import { ytVideos } from './youtube-web.js'
import { songKey } from './song-key.mjs'
import { setupMobileUiWhenReady, goBack } from './mobile-ui.js'

// android/.../MusicPlugin.java (en la compu, para ver el diseño, se puede simular con window.__musicWeb)
const Music = registerPlugin('Music', { web: () => window.__musicWeb })

// ── Archivos de la app (en escritorio: la carpeta userData) ──────────────────
async function readJson(name, fallback) {
  try {
    const r = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch { return fallback }
}
async function writeJson(name, data) {
  try {
    await Filesystem.writeFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(data) })
  } catch (e) { console.error('writeJson', name, e) }
}

// ── Música: una sola búsqueda en el celular sirve para la caché y la lista ───
let scanPromise = null
function scanOnce() {
  if (!scanPromise) {
    scanPromise = Music.scan().then(r => r.songs).catch(e => { console.error('scan', e); return [] })
    // La siguiente vez (al volver a la app) se vuelve a buscar
    scanPromise.finally(() => setTimeout(() => { scanPromise = null }, 2000))
  }
  return scanPromise
}

// Lista de la última vez guardada en localStorage (se lee al instante): al abrir la app sale ya,
// y la búsqueda de verdad (~1.7 s) va unos segundos después; si encontró algo distinto, se refresca
const SNAP = 'music-snap'
let snap = null
try { snap = JSON.parse(localStorage.getItem(SNAP)) } catch {}
const snapFiles = cache => Object.entries(cache.songs).map(([path, c]) => ({ path, mtime: c.mtime }))
const snapSig = cache => Object.entries(cache.songs).map(([p, c]) => p + '|' + c.mtime + '|' + (c.cover || '')).join(';')
function saveSnap(cache) {
  try { localStorage.setItem(SNAP, JSON.stringify(cache)) } catch (e) { console.error('snap', e) }
}
async function realCache() {
  // La caché trae título, artista… de lo que ya se leyó; lo nuevo se llena con lo que
  // Android ya sabe de cada canción (así la lista sale completa desde el primer momento)
  const [cache, found] = await Promise.all([readJson('music-cache.json', { version: 1, songs: {} }), scanOnce()])
  for (const s of found) {
    const c = cache.songs[s.path]
    if (!c || c.mtime !== s.mtime) {
      cache.songs[s.path] = { title: s.title, artist: s.artist, album: s.album, duration: s.duration, mtime: s.mtime }
    }
    // Carátula ya guardada en el celular: sale desde que abre la app
    cache.songs[s.path].cover = s.cover ? window.api.fileUrl(s.cover) : null
  }
  return cache
}
let fastCache = !!snap?.songs, fastFiles = fastCache
function checkLater() {
  if (fastCache || fastFiles) return
  setTimeout(async () => {
    const real = await realCache()
    const found = new Set((await scanOnce()).map(x => x.path))
    for (const p of Object.keys(real.songs)) if (!found.has(p)) delete real.songs[p]
    if (snapSig(real) === snapSig(snap)) return
    saveSnap(real)
    for (const cb of listeners.library) cb()
  }, 4000)
}

// ── Botones de la notificación / pantalla de bloqueo ─────────────────────────
// renderer.js usa navigator.mediaSession como en escritorio; aquí se manda al plugin nativo
// (que además mantiene la app viva mientras suena)
const handlers = {}
let metaSeq = 0
const mediaSessionShim = {
  set metadata(m) {
    if (!m) return
    const seq = ++metaSeq   // si cambias de canción rápido, gana la última
    // La carátula se manda como imagen (data:) y no como liga: el plugin descarga las ligas por
    // su cuenta, y https://localhost/... sólo existe dentro de la app (fallaba y cerraba la app)
    Promise.all([...(m.artwork || [])].map(async a => {
      if (!a?.src || a.src.startsWith('data:')) return a
      try {
        const blob = await (await fetch(a.src)).blob()
        const src = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob) })
        return { ...a, src }
      } catch { return null }
    })).then(art => seq === metaSeq && MediaSession.setMetadata({ title: m.title, artist: m.artist, album: m.album, artwork: art.filter(Boolean) }))
      .catch(() => {})
  },
  get metadata() { return null },
  set playbackState(s) { MediaSession.setPlaybackState({ playbackState: s }).catch(() => {}) },
  get playbackState() { return 'none' },
  setActionHandler(action, fn) {
    handlers[action] = fn
    MediaSession.setActionHandler({ action }, fn ? d => fn(d) : null).catch(() => {})
  },
  setPositionState(p) { MediaSession.setPositionState(p || {}).catch(() => {}) },
}
if (Capacitor.isNativePlatform()) {
  Object.defineProperty(navigator, 'mediaSession', { value: mediaSessionShim, configurable: true })
}
// El WebView de Android no trae MediaMetadata: renderer.js tronaba al darle play (antes de
// cargar la canción) y no sonaba nada
if (!window.MediaMetadata) {
  window.MediaMetadata = class MediaMetadata {
    constructor({ title = '', artist = '', album = '', artwork = [] } = {}) {
      Object.assign(this, { title, artist, album, artwork })
    }
  }
}

// ── Avisos al renderer ───────────────────────────────────────────────────────
const listeners = { library: [], audioResult: [], audioProgress: [], djChunk: [] }
// Al regresar a la app se revisa si hay música nueva (en escritorio lo avisa el watcher)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') for (const cb of listeners.library) cb()
})

const notYet = () => Promise.resolve({ error: 'Todavía no está en la versión de celular' })
// Como en main.js: los errores viajan como { error } para que el renderer decida el respaldo
const wrap = fn => (...a) => Promise.resolve().then(() => fn(...a)).then(v => ({ ok: v }), e => ({ error: e.message }))

const lastfm = createLastfm()
const gemini = createGemini()

// Voz de respaldo: la de Android (el WebView no trae speechSynthesis y Dalia necesita algo que
// el celular no puede abrir). renderer.js usa speechSynthesis cuando no hay archivo de voz.
if (Capacitor.isNativePlatform()) {
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.lang = 'es-MX' } }
  window.speechSynthesis = {
    getVoices: () => [],
    cancel: () => { TextToSpeech.stop().catch(() => {}) },
    speak: u => {
      TextToSpeech.speak({ text: u.text, lang: 'es-MX', rate: u.rate || 1, pitch: 1.05, category: 'playback' })
        .then(() => u.onend?.(), () => u.onerror?.())
    },
  }
}

// En el celular los paneles tapan toda la pantalla: al abrir la app se empieza en Inicio
try { localStorage.setItem('sd.rightMode', 'null') } catch {}

// ── Pantalla de celular (barra de abajo, Buscar, mini reproductor): mobile-ui.js ──
setupMobileUiWhenReady()
// Botón "atrás" de Android: cierra lo de encima o regresa; en Inicio la app se va a segundo
// plano sin cerrarse (la música sigue), como Spotify
if (Capacitor.isNativePlatform()) App.addListener('backButton', () => { if (!goBack()) App.minimizeApp() })

window.api = {
  // Música
  getMusicDir: async () => '/storage/emulated/0/Music',
  // MainActivity.java sirve /_music_/<ruta> (bien hecho para adelantar la canción)
  fileUrl: p => Capacitor.isNativePlatform() ? location.origin + '/_music_' + p.split('/').map(encodeURIComponent).join('/') : Capacitor.convertFileSrc(p),
  loadCache: async () => {
    if (fastCache) { fastCache = false; checkLater(); return structuredClone(snap) }
    const cache = await realCache()
    saveSnap(cache)
    return cache
  },
  saveCache: cache => { saveSnap(cache); return writeJson('music-cache.json', cache) },
  scanMusic: async () => {
    if (fastFiles) { fastFiles = false; checkLater(); return snapFiles(snap) }
    return (await scanOnce()).map(s => ({ path: s.path, mtime: s.mtime }))
  },
  readMeta: async path => {
    const m = await Music.readMeta({ path })
    if (m.cover) m.cover = window.api.fileUrl(m.cover)
    return m
  },
  onLibraryChanged: cb => listeners.library.push(cb),

  // Ventana: en el celular no hay
  winClose: () => {}, winMinimize: () => {}, winMaximize: () => {},
  openExternal: url => window.open(url, '_blank'),

  // Last.fm (géneros, moods y radio)
  lastfmStatus: async () => ({ hasKey: lastfm.hasKey() }),
  lastfmSetKey: key => lastfm.setKey(key),
  lastfmCached: () => lastfm.cached(),
  lastfmTags: q => lastfm.tags(q),
  lastfmSimilar: q => lastfm.similar(q),

  // Análisis de audio: el que hizo la compu (build.mjs lo mete en la app), por título y artista
  audioCached: async () => {
    const [db, cache] = await Promise.all([
      fetch('audio-features.json').then(r => r.json()).catch(() => ({})),
      readJson('music-cache.json', { songs: {} }),
    ])
    const out = {}
    for (const [p, c] of Object.entries(cache.songs)) {
      const d = db[songKey(c.title, c.artist)]
      if (d) out[p] = d
    }
    return out
  },
  audioAnalyze: async () => 0,   // (lo nuevo se analiza en la compu)
  onAudioResult: cb => listeners.audioResult.push(cb),
  onAudioProgress: cb => listeners.audioProgress.push(cb),

  // DJ Nat (Gemini) y clima
  geminiStatus: async () => ({ hasKey: gemini.hasKey() }),
  geminiSetKey: key => gemini.setKey(key),
  // engine 'dalia': en el celular no hay; el renderer usa entonces la voz de Android
  djSay: wrap((text, engine) => engine === 'gemini' ? gemini.say(text) : Promise.reject(new Error('sin dalia'))),
  djSayNow: async (text, id) => {
    try {
      return { ok: await gemini.sayNow(text, buf => { const b = toBase64(buf); for (const cb of listeners.djChunk) cb(id, b) }, id) }
    } catch (e) { return { error: e.message, partial: !!e.partial } }
  },
  djCancel: id => gemini.cancelNow(id),
  djCached: text => gemini.cached(text),
  djClean: keep => gemini.cleanup(keep),
  djThink: wrap((system, prompt, schema, urgent) => gemini.think(system, prompt, schema, urgent)),
  // Lo que le escribes a Nat (para después hacer frases con tu estilo): las últimas 500
  djChatLog: (who, text) => {
    try {
      const log = JSON.parse(localStorage.getItem('sd.djChat') || '[]')
      log.push([new Date().toLocaleString('es-MX'), who, String(text).replace(/\s+/g, ' ')])
      localStorage.setItem('sd.djChat', JSON.stringify(log.slice(-500)))
    } catch {}
  },
  onDjChunk: cb => listeners.djChunk.push(cb),
  weather: city => weatherFor(city, getJson),

  // Foto y fans del artista (Deezer, sin key): para "Acerca del artista" y la página de artista.
  // Se guarda por artista: cada uno se busca una sola vez (30 días)
  artistInfo: async name => {
    const key = 'sd.artistInfo'
    let cache = {}
    try { cache = JSON.parse(localStorage.getItem(key) || '{}') } catch {}
    const k = String(name || '').toLowerCase().trim()
    if (!k) return null
    const c = cache[k]
    if (c && Date.now() - c.at < 30 * 864e5) return c.info
    try {
      const r = await CapacitorHttp.get({ url: 'https://api.deezer.com/search/artist?limit=1&q=' + encodeURIComponent(name) })
      const a = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data)?.data?.[0]
      const same = x => x.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
      const info = a && same(a.name) === same(k) ? { name: a.name, picture: a.picture_xl, fans: a.nb_fan } : null
      cache[k] = { info, at: Date.now() }
      localStorage.setItem(key, JSON.stringify(cache))
      return info
    } catch { return null }   // sin internet
  },

  // Fase 3: Canvas
  ytVideos: (artist, title, live) => ytVideos(artist, title, live),
}
