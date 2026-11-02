// window.api del celular: lo mismo que en escritorio hacen preload.js + main.js, pero con lo que
// da Android (Capacitor). La interfaz (renderer.js) es la misma; sólo cambia esta capa.
//
// Fase 1: música del celular, carátulas y letras, caché, reproducción con pantalla apagada y
// controles en la notificación. Lo demás (Last.fm, DJ Nat, clima, Canvas) responde como "sin
// configurar" hasta portarlo, así la app funciona completa sin esas partes.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { MediaSession } from '@jofr/capacitor-media-session'
import { setupMobileUiWhenReady } from './mobile-ui.js'

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

// ── Botones de la notificación / pantalla de bloqueo ─────────────────────────
// renderer.js usa navigator.mediaSession como en escritorio; aquí se manda al plugin nativo
// (que además mantiene la app viva mientras suena)
const handlers = {}
const mediaSessionShim = {
  set metadata(m) {
    if (!m) return
    MediaSession.setMetadata({ title: m.title, artist: m.artist, album: m.album, artwork: [...(m.artwork || [])] }).catch(() => {})
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

// En el celular los paneles tapan toda la pantalla: al abrir la app se empieza en Inicio
try { localStorage.setItem('sd.rightMode', 'null') } catch {}

// ── Pantalla de celular (barra de abajo, Buscar, mini reproductor): mobile-ui.js ──
setupMobileUiWhenReady()

window.api = {
  // Música
  getMusicDir: async () => '/storage/emulated/0/Music',
  // MainActivity.java sirve /_music_/<ruta> (bien hecho para adelantar la canción)
  fileUrl: p => Capacitor.isNativePlatform() ? location.origin + '/_music_' + p.split('/').map(encodeURIComponent).join('/') : Capacitor.convertFileSrc(p),
  loadCache: async () => {
    // La caché trae título, artista… de lo que ya se leyó; lo nuevo se llena con lo que
    // Android ya sabe de cada canción (así la lista sale completa desde el primer momento)
    const cache = await readJson('music-cache.json', { version: 1, songs: {} })
    for (const s of await scanOnce()) {
      const c = cache.songs[s.path]
      if (!c || c.mtime !== s.mtime) {
        cache.songs[s.path] = { title: s.title, artist: s.artist, album: s.album, duration: s.duration, mtime: s.mtime }
      }
    }
    return cache
  },
  saveCache: cache => writeJson('music-cache.json', cache),
  scanMusic: async () => (await scanOnce()).map(s => ({ path: s.path, mtime: s.mtime })),
  readMeta: path => Music.readMeta({ path }),
  onLibraryChanged: cb => listeners.library.push(cb),

  // Ventana: en el celular no hay
  winClose: () => {}, winMinimize: () => {}, winMaximize: () => {},
  openExternal: url => window.open(url, '_blank'),

  // Fase 2: Last.fm
  lastfmStatus: async () => ({ hasKey: false }),
  lastfmSetKey: notYet,
  lastfmCached: async () => ({ tracks: {}, artists: {} }),
  lastfmTags: async () => null,
  lastfmSimilar: async () => null,

  // Fase 3: análisis de audio
  audioCached: async () => ({}),
  audioAnalyze: async () => 0,
  onAudioResult: cb => listeners.audioResult.push(cb),
  onAudioProgress: cb => listeners.audioProgress.push(cb),

  // Fase 2: DJ Nat (Gemini) y clima
  geminiStatus: async () => ({ hasKey: false }),
  geminiSetKey: notYet,
  djSay: notYet,
  djSayNow: notYet,
  djCached: async () => false,
  djClean: async () => 0,
  djThink: notYet,
  djChatLog: () => {},
  onDjChunk: cb => listeners.djChunk.push(cb),
  weather: async () => null,

  // Fase 3: Canvas
  ytVideos: async () => [],
}
