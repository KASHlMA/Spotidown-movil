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

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const need = (s, what) => { if (!html.includes(s)) throw new Error('index.html cambió: falta ' + what) }
need('</head>', '</head>')
need('<script src="renderer.js"></script>', 'el script de renderer.js')
html = html
  .replace('</head>', '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n  <link rel="stylesheet" href="mobile.css">\n</head>')
  .replace('<script src="renderer.js"></script>', '<script src="api-mobile.js"></script>\n  <script src="renderer.js"></script>')
  .replace('<html', '<html class="mobile"')
fs.writeFileSync(path.join(WWW, 'index.html'), html)

await build({
  entryPoints: [path.join(import.meta.dirname, 'src', 'api-mobile.js')],
  bundle: true, format: 'iife', target: 'chrome100', outfile: path.join(WWW, 'api-mobile.js'),
})
console.log('www listo')
