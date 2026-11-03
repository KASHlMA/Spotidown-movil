// Arma www/ para Capacitor: la misma interfaz de escritorio (index.html, renderer.js,
// styles.css) + la capa del celular (api-mobile.js hace lo que en escritorio hace main.js)
// + mobile.css (acomodo para pantalla de celular).
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

// La interfaz vive en el repo de escritorio (Spotidown): por defecto en la carpeta de arriba
const ROOT = path.resolve(process.env.SPOTIDOWN_DESKTOP || path.join(import.meta.dirname, '..'))
if (!fs.existsSync(path.join(ROOT, 'renderer.js'))) throw new Error('No encuentro Spotidown (escritorio) en ' + ROOT + ': clónalo ahí o pon SPOTIDOWN_DESKTOP')
const WWW = path.resolve(import.meta.dirname, 'www')
fs.rmSync(WWW, { recursive: true, force: true })
fs.mkdirSync(WWW, { recursive: true })

for (const f of ['renderer.js', 'styles.css']) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f))
fs.copyFileSync(path.join(import.meta.dirname, 'src', 'mobile.css'), path.join(WWW, 'mobile.css'))

// Pantalla de carga: sigue el logo de Android encima de la página hasta que el inicio ya está
// listo (si no, por un momento se ve la página a medio armar: textos y botones sin acomodar)
// El logo como el de Android (cuadro rojo redondeado), dibujado en la página misma (como imagen
// de fondo tardaba un momento en salir)
const LOGO = `<svg viewBox="0 0 24 24" width="160" height="160"><rect width="24" height="24" rx="6" fill="#e8333c"/>
<g transform="translate(1.2 1.6) scale(.9)"><g fill="none" stroke="#fff" stroke-linecap="round" transform="rotate(-9 12 12)">
<path d="M4.6 8.4C9 6.9 14.6 7.1 19.2 9.5" stroke-width="2.4"/><path d="M5.8 11.9C9.5 10.8 14 11 17.7 12.9" stroke-width="2"/>
<path d="M7 15.2C9.9 14.5 13.2 14.7 16.2 16" stroke-width="1.65"/></g>
<path d="M11 16.9v3.6M13.7 16.9 11.1 18.7l2.7 1.8" fill="none" stroke="#fff" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`
const SPLASH = `  <style>
    html.mobile { background: #202020; }
    #m-splash { position: fixed; inset: 0; z-index: 9999; background: #202020; display: flex; align-items: center; justify-content: center; transition: opacity .25s; }
    #m-splash svg { transform: translateY(-11px); }
    html.m-ready #m-splash { opacity: 0; pointer-events: none; }
  </style>`

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const need = (s, what) => { if (!html.includes(s)) throw new Error('index.html cambió: falta ' + what) }
need('</head>', '</head>')
need('<script src="renderer.js"></script>', 'el script de renderer.js')
html = html
  .replace('</head>', '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n  <link rel="stylesheet" href="mobile.css">\n</head>')
  .replace('<script src="renderer.js"></script>', '<script src="api-mobile.js"></script>\n  <script src="renderer.js"></script>')
  .replace('<html', '<html class="mobile"')
  .replace('</head>', SPLASH + '\n</head>')
  .replace(/<body([^>]*)>/, '<body$1>\n  <div id="m-splash">' + LOGO + '</div>')
fs.writeFileSync(path.join(WWW, 'index.html'), html)

// Análisis de audio (géneros, ánimo y "parecido" de cada canción): en el celular tardaría horas y
// se comería la batería, y la compu ya lo hizo; se lleva lo que analizó Spotidown de escritorio,
// por título y artista (casi toda la música es la misma)
const { songKey } = await import('./src/song-key.mjs')
const DESK = path.join(process.env.APPDATA || path.join(process.env.HOME || '', '.config'), 'music-player')
const features = {}
try {
  const audio = JSON.parse(fs.readFileSync(path.join(DESK, 'audio-features.json'), 'utf8')).songs
  const meta = JSON.parse(fs.readFileSync(path.join(DESK, 'music-cache.json'), 'utf8')).songs
  for (const [p, d] of Object.entries(audio)) {
    const m = meta[p]
    if (!m || d.error) continue
    features[songKey(m.title, m.artist)] = { styles: d.styles, moods: d.moods, emb: d.emb, lyr: d.lyr }
  }
} catch (e) { console.warn('Sin análisis de audio de la compu:', e.message) }
// Las que sólo están en el celular (tools/analizar-nuevas.mjs)
try { Object.assign(features, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'audio-extra.json'), 'utf8'))) } catch {}
fs.writeFileSync(path.join(WWW, 'audio-features.json'), JSON.stringify(features))
console.log('análisis de audio:', Object.keys(features).length, 'canciones')

await build({
  entryPoints: [path.join(import.meta.dirname, 'src', 'api-mobile.js')],
  bundle: true, format: 'iife', target: 'chrome100', outfile: path.join(WWW, 'api-mobile.js'),
})
console.log('www listo')
