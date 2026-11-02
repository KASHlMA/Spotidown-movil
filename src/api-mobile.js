// window.api del celular: lo mismo que en escritorio hacen preload.js + main.js, pero con lo que
// da Android (Capacitor). La interfaz (renderer.js) es la misma; sólo cambia esta capa.
//
// Fase 1: música del celular, carátulas y letras, caché, reproducción con pantalla apagada y
// controles en la notificación. Lo demás (Last.fm, DJ Nat, clima, Canvas) responde como "sin
// configurar" hasta portarlo, así la app funciona completa sin esas partes.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { MediaSession } from '@jofr/capacitor-media-session'

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

// ── Avisos al renderer ───────────────────────────────────────────────────────
const listeners = { library: [], audioResult: [], audioProgress: [], djChunk: [] }
// Al regresar a la app se revisa si hay música nueva (en escritorio lo avisa el watcher)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') for (const cb of listeners.library) cb()
})

const notYet = () => Promise.resolve({ error: 'Todavía no está en la versión de celular' })

// En el celular los paneles tapan toda la pantalla: al abrir la app se empieza en Inicio
try { localStorage.setItem('sd.rightMode', 'null') } catch {}

// ── Pantalla de celular: barra de abajo y mini reproductor ───────────────────
// (los scripts van al final del body, así que el HTML ya existe)
const $ = id => document.getElementById(id)
const icon = d => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`
function setupMobileUi() {
  const nav = document.createElement('nav')
  nav.className = 'm-nav'
  nav.innerHTML = [
    ['home', 'Inicio', 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'],
    ['search', 'Buscar', 'M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z'],
    ['lib', 'Tu biblioteca', 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z'],
    ['dj', 'DJ Nat', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'],
  ].map(([k, label, d]) => `<button data-k="${k}">${icon(d)}<span>${label}</span></button>`).join('')
  document.body.appendChild(nav)

  const closePanels = () => {
    document.body.classList.remove('show-lib')
    if (!$('right-panel').hidden) $('rp-close').click()
  }
  nav.addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k
    if (!k) return
    if (k === 'home') { closePanels(); $('btn-home').click() }
    if (k === 'search') { closePanels(); $('search').focus() }
    if (k === 'lib') { const on = !document.body.classList.contains('show-lib'); closePanels(); document.body.classList.toggle('show-lib', on) }
    if (k === 'dj') { document.body.classList.remove('show-lib'); $('btn-dj').click() }
    markNav()
  })
  // Elegir algo de la biblioteca la cierra
  $('lib-list').addEventListener('click', () => setTimeout(() => document.body.classList.remove('show-lib'), 0))

  // Tocar el mini reproductor abre "Reproduciendo" a pantalla completa
  document.querySelector('.bar-left').addEventListener('click', e => {
    if (e.target.closest('.like-btn, a, .link')) return
    if ($('right-panel').hidden || !document.body.classList.contains('rp-np')) $('btn-np').click()
  })

  // Qué panel está abierto (para el acomodo de los controles y la barra de abajo)
  const sync = () => {
    const rp = $('right-panel')
    document.body.classList.toggle('rp-np', !rp.hidden && !$('rp-np').hidden)
    markNav()
  }
  const markNav = () => {
    const dj = !$('right-panel').hidden && !$('rp-dj').hidden
    const lib = document.body.classList.contains('show-lib')
    for (const b of nav.children) {
      const k = b.dataset.k
      b.classList.toggle('on', k === 'dj' ? dj : k === 'lib' ? lib && !dj : k === 'home' ? !lib && !dj : false)
    }
  }
  new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  sync()
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupMobileUi)
else setupMobileUi()

window.api = {
  // Música
  getMusicDir: async () => '/storage/emulated/0/Music',
  fileUrl: p => Capacitor.convertFileSrc(p),
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
