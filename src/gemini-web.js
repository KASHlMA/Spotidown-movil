// Gemini en el celular: lo mismo que gemini.js de escritorio (texto del DJ y voz de Nat en
// vivo, verificada y en caché), con WebSocket del navegador y archivos del celular.
// Si se cambia algo de la lógica, cambiarlo también en gemini.js.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { postJson, toBase64, fromBase64, concat, sha1 } from './store.js'

const API        = 'https://generativelanguage.googleapis.com/v1beta/models/'
const LIVE_URL   = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const TEXT_MODEL = 'gemini-flash-lite-latest'
// Si se acaba el límite diario del principal, el texto sigue con éste (la voz no cambia)
const TEXT_MODELS = [TEXT_MODEL, 'gemini-3.1-flash-lite']
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-latest'
const VOICE      = 'Laomedeia'
const liveSystem = script => 'Eres DJ Nat, una locutora de radio mexicana de 25 años: muy expresiva, cálida, juguetona, ' +
  'carismática y siempre de buenas. Estás al aire. Cuando el productor diga "¡Al aire!", dices tu guion COMPLETO, de la ' +
  'primera a la última palabra, con toda tu personalidad. Sólo dices las palabras del guion: nada de acotaciones, ' +
  'descripciones ni texto entre paréntesis, no agregues ni quites nada, no comentes, y NUNCA menciones canciones, ' +
  'artistas ni datos que no estén en el guion. Tu guion es:\n' + script
const ON_AIR = '¡Al aire!'
const VOICE_VERSION = 'v5-al-aire'   // igual que en escritorio: mismos nombres de archivo
const KEY = 'sd.geminiKey'
const VOICE_DIR = 'dj-voice'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (event, detail, text) => console.warn('[dj-voice]', event, detail, String(text).slice(0, 120))

export function createGemini() {
  const key = () => localStorage.getItem(KEY) || ''

  // Audios guardados: se listan una vez al abrir la app
  const known = new Map()   // nombre → mtime
  let voiceDirUri = ''
  const ready = (async () => {
    try { await Filesystem.mkdir({ path: VOICE_DIR, directory: Directory.Data, recursive: true }) } catch {}
    try { voiceDirUri = (await Filesystem.getUri({ path: VOICE_DIR, directory: Directory.Data })).uri } catch {}
    try {
      const r = await Filesystem.readdir({ path: VOICE_DIR, directory: Directory.Data })
      for (const f of r.files) known.set(f.name, f.mtime || 0)
    } catch {}
  })()
  const nameFor = async text => (await sha1(VOICE + VOICE_VERSION + text)) + '.wav'
  // La ruta del archivo (la sirve MainActivity en /_music_/<ruta>)
  const pathFor = name => voiceDirUri.replace(/^file:\/\//, '') + '/' + name
  async function saveWav(name, pcm) {
    await Filesystem.writeFile({ path: `${VOICE_DIR}/${name}`, directory: Directory.Data, data: toBase64(pcmToWav(pcm, 24000)) })
    known.set(name, Date.now())
  }

  async function request(model, body, k = key()) {
    let r
    try { r = await postJson(API + model + ':generateContent', body, { 'x-goog-api-key': k }) }
    catch { throw new Error('network') }
    const j = r.data || {}
    if (j.error) {
      if (j.error.code === 429) throw new Error('quota')
      if (j.error.code === 400 || j.error.code === 401 || j.error.code === 403) throw new Error('invalid-key')
      throw new Error('network')
    }
    return j
  }

  // Sesión de la API en vivo para decir `script`; speak() se resuelve con el PCM del turno
  function openLive(script) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key())}`)
      ws.binaryType = 'arraybuffer'
      let ready = false, closed = false, turn = null, said = ''
      const errOf = (code, reason) => code === 1008 ? 'invalid-key' : /quota|exhaust/i.test(String(reason)) ? 'quota' : 'network'
      const setupTimer = setTimeout(() => ws.close(), 15000)
      ws.onopen = () => ws.send(JSON.stringify({ setup: {
        model: 'models/' + LIVE_MODEL,
        generationConfig: { temperature: 0.3, responseModalities: ['AUDIO'], thinkingConfig: { thinkingBudget: 0 },
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
        systemInstruction: { parts: [{ text: liveSystem(script) }] },
        outputAudioTranscription: {},
      } }))
      ws.onmessage = ev => {
        let m
        try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)) } catch { return }
        if (m.setupComplete) { ready = true; clearTimeout(setupTimer); resolve(session); return }
        if (m.serverContent?.outputTranscription?.text) {
          said += m.serverContent.outputTranscription.text
          // El audio llega 0.7–1.6 s después del texto: si en 5 s no llega, Google no lo mandó
          if (turn && !turn.pcm.length && !turn.noAudio) {
            turn.noAudio = setTimeout(() => { if (turn && !turn.pcm.length) { turn.silent = true; ws.close() } }, 5000)
          }
        }
        if (!turn) return
        for (const p of m.serverContent?.modelTurn?.parts || []) {
          if (!p.inlineData) continue
          const buf = fromBase64(p.inlineData.data)
          turn.pcm.push(buf)
          turn.onChunk?.(buf)
        }
        if (m.serverContent?.turnComplete) {
          const t = turn
          turn = null
          clearTimeout(t.timer); clearTimeout(t.noAudio)
          t.resolve(concat(t.pcm))
        }
      }
      ws.onclose = ev => {
        closed = true
        const err = Object.assign(new Error(errOf(ev.code, ev.reason)), { detail: `cierre ${ev.code} ${String(ev.reason).slice(0, 100)}` })
        if (!ready) { clearTimeout(setupTimer); reject(err) }
        if (turn) {
          const t = turn
          turn = null
          clearTimeout(t.timer); clearTimeout(t.noAudio)
          if (t.silent) err.detail = `sin audio; dijo: ${said}`
          t.reject(Object.assign(err, { partial: t.pcm.length > 0 }))
        }
      }
      const session = {
        speak(text, onChunk) {
          return new Promise((res, rej) => {
            if (closed) return rej(new Error('network'))
            turn = { pcm: [], onChunk, resolve: res, reject: rej, timer: setTimeout(() => ws.close(), 30000) }
            ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }))
          })
        },
        said: () => said,
        close: () => { closed = true; try { ws.close() } catch {} },
      }
    })
  }

  async function openLiveRetry(text) {
    for (let attempt = 1; ; attempt++) {
      try { return await openLive(text) }
      catch (e) {
        log('falló', `abrir sesión (intento ${attempt}): ${e.message} ${e.detail || ''}`, text)
        if (e.message === 'invalid-key' || attempt === 3) throw e
        await sleep(e.message === 'quota' ? 12000 : 1000)
      }
    }
  }

  function faithful(text, said) {
    if (!said.trim()) return true
    if (/[([]/.test(said)) return false
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ')
      .split(/\s+/).filter(w => w.length > 2)
    const want = norm(text), got = norm(said)
    const wantSet = new Set(want), gotSet = new Set(got)
    const extra = got.filter(w => !wantSet.has(w)).length
    const missing = want.filter(w => !gotSet.has(w)).length
    return extra <= Math.max(2, got.length * 0.2) && missing <= Math.max(1, want.length * 0.25)
  }

  function missingTail(text, said) {
    const norm = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '')
    const got = said.split(/\s+/).map(norm).filter(Boolean)
    const words = text.split(/\s+/).filter(Boolean)
    let pos = 0, last = -1
    words.forEach((w, i) => {
      const n = norm(w)
      if (n.length <= 2) return
      const at = got.indexOf(n, pos)
      if (at >= 0) { pos = at + 1; last = i }
    })
    if (last < 2) return null
    const tail = words.slice(last + 1)
    return tail.filter(w => norm(w).length > 2).length >= 3 ? tail.join(' ') : null
  }

  const gap = () => new Uint8Array(Math.round(24000 * 0.15) * 2)

  // Frase completa verificada (para lo que se prepara con calma)
  async function liveSay(text) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      let session = null
      try {
        session = await openLiveRetry(text)
        let buf = await session.speak(ON_AIR)
        if (!buf.length) throw Object.assign(new Error('network'), { detail: `sin audio; dijo: ${session.said()}` })
        await sleep(1200)
        let said = session.said()
        session.close()
        const tail = missingTail(text, said)
        if (tail) {
          const s2 = await openLiveRetry(tail)
          try {
            const more = await s2.speak(ON_AIR)
            await sleep(1200)
            if (more.length && faithful(tail, s2.said())) { buf = concat([buf, gap(), more]); said += ' ' + s2.said() }
          } finally { s2.close() }
        }
        if (faithful(text, said)) return buf
        log('distinta', `intento ${attempt}, dijo: ${said}`, text)
      } catch (e) {
        log('falló', `intento ${attempt}: ${e.message} ${e.detail || ''}`, text)
        if (e.message === 'invalid-key') throw e
      } finally { session?.close() }
      if (attempt < 3) await sleep(attempt * 4000)
    }
    throw new Error('unfaithful')
  }

  async function say(text) {
    await ready
    const name = await nameFor(text)
    if (known.has(name)) return pathFor(name)
    const pcm = await liveSay(text)
    await saveWav(name, pcm)
    return pathFor(name)
  }

  // En vivo para cuando alguien espera: el audio va saliendo por onChunk
  async function sayNow(text, onChunk) {
    await ready
    const name = await nameFor(text)
    if (known.has(name)) return { file: pathFor(name) }
    const session = await openLive(text)
    let emitted = false
    const held = []
    let open = false, stage = false
    const release = () => { open = emitted = true; for (const x of held.splice(0)) onChunk(x) }
    const gate = b => {
      if (open) { onChunk(b); return }
      held.push(b)
      const said = session.said().trim()
      if (/^[([]/.test(said)) { stage = true; session.close(); return }
      const heldSec = held.reduce((n, x) => n + x.length, 0) / 48000
      if (said.split(/\s+/).length >= 2 || heldSec > 1.2) release()
    }
    try {
      let buf
      try { buf = await session.speak(ON_AIR, gate) }
      catch (e) {
        if (stage) throw Object.assign(new Error('network'), { detail: `acotación: ${session.said()}` })
        throw e
      }
      if (!buf.length) throw Object.assign(new Error('network'), { detail: `sin audio; dijo: ${session.said()}` })
      if (!open) release()
      await sleep(1200)
      let said = session.said()
      session.close()
      const tail = missingTail(text, said)
      if (tail) {
        const g = gap()
        onChunk(g)
        const s2 = await openLive(tail)
        try {
          const more = await s2.speak(ON_AIR, onChunk)
          await sleep(1200)
          buf = concat([buf, g, more])
          said += ' ' + s2.said()
        } finally { s2.close() }
      }
      if (faithful(text, said)) await saveWav(name, buf)
      else log('distinta', `en vivo, dijo: ${said}`, text)
      return {}
    } catch (e) {
      log('falló', `en vivo: ${e.message} ${e.detail || ''}`, text)
      throw Object.assign(e, { partial: emitted })
    } finally { session.close() }
  }

  // Tope diario igual que en escritorio
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  // { day, n: { modelo: usadas }, out: { modelo: true si Google dijo que se acabó } }
  const readCount = () => {
    let c
    try { c = JSON.parse(localStorage.getItem('sd.geminiCount') || '{}') } catch { c = {} }
    if (c.day !== today()) c = { day: today() }
    if (typeof c.n !== 'object') c.n = typeof c.n === 'number' ? { [TEXT_MODEL]: c.n } : {}
    c.out = c.out || {}
    return c
  }
  const writeCount = c => localStorage.setItem('sd.geminiCount', JSON.stringify(c))
  const spend = m => { const c = readCount(); c.n[m] = (c.n[m] || 0) + 1; writeCount(c) }
  const exhausted = m => { const c = readCount(); c.out[m] = true; writeCount(c) }
  const used = () => Object.values(readCount().n).reduce((a, b) => a + b, 0)

  // Cada modelo tiene su propio límite de 500 al día: cuando el principal llega al tope (o
  // Google dice que ya se acabó), sigue el de respaldo. La voz es otro modelo: no cambia.
  const pick = urgent => TEXT_MODELS.find(m => !readCount().out[m] && (readCount().n[m] || 0) < (urgent ? 480 : 380))

  function think(system, prompt, schema, urgent = false) {
    if (!pick(urgent)) return Promise.reject(new Error('budget'))
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: schema ? { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.9 } : { temperature: 1 },
    }
    const hedgeAfter = urgent ? 1500 : Infinity, giveUp = urgent ? 6000 : 45000
    return new Promise((resolve, reject) => {
      let done = false, running = 0, hedged = false
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(hedgeTimer); clearTimeout(giveUpTimer); fn(v) }
      const launch = () => {
        const model = pick(urgent)
        if (!model) return finish(reject, new Error('budget'))
        running++
        spend(model)
        request(model, body).then(j => {
          const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim()
          if (!text) throw new Error('network')
          finish(resolve, schema ? JSON.parse(text) : text)
        }).catch(e => {
          running--
          if (done) return
          if (e.message === 'quota') { exhausted(model); if (pick(urgent)) return launch() }
          if (e.message === 'quota' || e.message === 'invalid-key') return finish(reject, e)
          if (!hedged && urgent) { hedged = true; launch() }
          else if (!hedged) finish(reject, e)
          else if (!running) finish(reject, e)
        })
      }
      const hedgeTimer = isFinite(hedgeAfter) ? setTimeout(() => { if (!hedged) { hedged = true; launch() } }, hedgeAfter) : null
      const giveUpTimer = setTimeout(() => finish(reject, new Error('timeout')), giveUp)
      launch()
    })
  }

  return {
    hasKey: () => !!key(),
    async setKey(k) {
      k = String(k || '').trim()
      if (k) {
        try { await request(TEXT_MODEL, { contents: [{ parts: [{ text: 'Responde sólo: ok' }] }] }, k) }
        catch (e) { return { ok: false, error: e.message === 'invalid-key' ? 'La API key de Gemini no es válida.' : 'No se pudo conectar con Gemini. Revisa tu internet.' } }
        localStorage.setItem(KEY, k)
      } else localStorage.removeItem(KEY)
      return { ok: true }
    },
    say, sayNow, think, used,
    cached: async text => { await ready; return known.has(await nameFor(text)) },
    async cleanup(keep, maxDays = 7) {
      await ready
      const keepNames = new Set(await Promise.all(keep.map(nameFor)))
      const limit = Date.now() - maxDays * 864e5
      let removed = 0
      for (const [name, mtime] of known) {
        if (keepNames.has(name) || mtime >= limit) continue
        try { await Filesystem.deleteFile({ path: `${VOICE_DIR}/${name}`, directory: Directory.Data }); known.delete(name); removed++ } catch {}
      }
      return removed
    },
  }
}

function pcmToWav(pcm, rate) {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

// Clima (Open-Meteo, gratis y sin key), igual que en escritorio
export async function weatherFor(city, getJson) {
  city = String(city || '').trim()
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem('sd.weather') || '{}') } catch {}
  try {
    if (saved.at && Date.now() - saved.at < 30 * 60 * 1000 && saved.query === city) return saved.data
    let loc = saved.query === city ? saved.loc : null
    if (!loc && city) {
      const [name, region = ''] = city.split(',').map(x => x.trim())
      const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=10&language=es&name=${encodeURIComponent(name)}`)
      const fold = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const list = g.results || []
      const r = (region && list.find(x => fold(`${x.admin1} ${x.country}`).includes(fold(region)))) || list[0]
      if (r) loc = { lat: r.latitude, lon: r.longitude, name: r.name }
    }
    if (!loc) {
      const ip = await getJson('https://ipwho.is/')
      if (ip.success && ip.latitude) loc = { lat: ip.latitude, lon: ip.longitude, name: ip.city }
    }
    if (!loc) return null
    const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code&timezone=auto')
    const c = w.current
    if (!c) return null
    const rain = (c.weather_code >= 51 && c.weather_code <= 67) || (c.weather_code >= 80 && c.weather_code <= 82) || c.weather_code >= 95
    const feels = c.apparent_temperature ?? c.temperature_2m
    const data = { city: loc.name, temp: Math.round(c.temperature_2m), kind: rain ? 'lluvia' : feels >= 30 ? 'calor' : feels <= 14 ? 'frio' : null }
    localStorage.setItem('sd.weather', JSON.stringify({ at: Date.now(), query: city, loc, data }))
    return data
  } catch { return null }
}
