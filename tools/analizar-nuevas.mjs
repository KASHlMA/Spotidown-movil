// Analiza las canciones del celular que todavía no tienen análisis de audio (géneros, ánimo y
// "parecido"): las copia del celular por adb, las analiza aquí con el mismo modelo de Spotidown de
// escritorio y guarda el resultado en audio-extra.json, que build.mjs mete en la app.
//
// Uso (con el celular conectado):  npm run nuevas   → luego  npm run apk  e instalar
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { songKey } from '../src/song-key.mjs'

const HERE = path.resolve(import.meta.dirname, '..')
const DESKTOP = path.resolve(process.env.SPOTIDOWN_DESKTOP || path.join(HERE, '..'))
const require = createRequire(path.join(DESKTOP, 'package.json'))
const { analyze, loadModels } = require(path.join(DESKTOP, 'audio-analysis.js'))
const { lyricsMood } = require(path.join(DESKTOP, 'lyrics-mood.js'))
const { parseFile } = await import(pathToFileURL(require.resolve('music-metadata')).href)

const EXTRA = path.join(HERE, 'audio-extra.json')
const DESK = path.join(process.env.APPDATA || '', 'music-player', 'audio-features.json')
const DESK_META = path.join(process.env.APPDATA || '', 'music-player', 'music-cache.json')

// Lo que ya está analizado: lo de la compu + lo que este script ya hizo antes
const extra = fs.existsSync(EXTRA) ? JSON.parse(fs.readFileSync(EXTRA, 'utf8')) : {}
const known = new Set(Object.keys(extra))
try {
  const audio = JSON.parse(fs.readFileSync(DESK, 'utf8')).songs
  const meta = JSON.parse(fs.readFileSync(DESK_META, 'utf8')).songs
  for (const [p, d] of Object.entries(audio)) if (meta[p] && !d.error) known.add(songKey(meta[p].title, meta[p].artist))
} catch {}

// Las canciones del celular (la lista que guarda la app)
const phone = JSON.parse(execFileSync('adb', ['exec-out', 'run-as', 'com.kashima.spotidown', 'cat', 'files/music-cache.json'], { maxBuffer: 64 << 20 }).toString()).songs
const todo = Object.entries(phone).filter(([, c]) => !known.has(songKey(c.title, c.artist)))
console.log(`En el celular: ${Object.keys(phone).length} · sin análisis: ${todo.length}`)
if (!todo.length) process.exit(0)

// Igual que audio-worker.js de escritorio
const top = (values, classes, n, min) => [...values].map((v, i) => [classes[i], +v.toFixed(3)])
  .filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).slice(0, n)
function packEmbedding(emb) {
  const norm = Math.hypot(...emb) || 1
  let max = 0
  for (const x of emb) max = Math.max(max, Math.abs(x / norm))
  const q = Int8Array.from(emb, x => Math.round((x / norm) / (max || 1) * 127))
  return Buffer.from(q.buffer).toString('base64')
}
async function readLyricsMood(file) {
  try {
    const meta = await parseFile(file, { skipCovers: true })
    let text = ''
    const l = meta.common.lyrics?.[0]
    if (l) text = typeof l === 'string' ? l : (l.text || '')
    return lyricsMood(text)
  } catch { return null }
}

const s = await loadModels()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotidown-'))
let done = 0
for (const [p, c] of todo) {
  const local = path.join(tmp, 'cancion' + path.extname(p))
  try {
    execFileSync('adb', ['pull', p, local], { stdio: 'ignore' })
    const r = await analyze(local)
    extra[songKey(c.title, c.artist)] = {
      styles: top(r.genres, s.genreClasses, 10, 0.03),
      moods: top(r.moods, s.moodClasses, 8, 0.03),
      emb: packEmbedding(r.emb),
      lyr: await readLyricsMood(local),
    }
    fs.writeFileSync(EXTRA, JSON.stringify(extra))   // se guarda cada una (si se corta, no se pierde)
    console.log(`${++done}/${todo.length}  ${c.title} - ${c.artist}`)
  } catch (e) {
    console.log(`(no se pudo) ${c.title}: ${e.message.slice(0, 80)}`)
  } finally { fs.rmSync(local, { force: true }) }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`Listo: ${done} analizadas. Ahora: npm run apk`)
