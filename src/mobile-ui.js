import { SpeechRecognition } from '@capacitor-community/speech-recognition'
// Pantalla de celular al estilo de la app de Spotify, encima de la interfaz de escritorio:
// barra de abajo (Inicio, Buscar, Tu biblioteca, DJ Nat), pestaña Buscar con "Explorar todo",
// mini reproductor del color de la portada y "Reproduciendo" a pantalla completa.
// Usa funciones de renderer.js (navigate, getGenreGroups…), que ya existen cuando se usan.

const $ = id => document.getElementById(id)
const icon = d => `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${d}"/></svg>`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const CHEVRON_DOWN = 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z'

function setupMobileUi() {
  const body = document.body
  body.dataset.tab = 'home'

  // ── Barra de abajo ──
  const nav = document.createElement('nav')
  nav.className = 'm-nav'
  nav.innerHTML = [
    ['home', 'Inicio', 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'],
    ['search', 'Buscar', 'M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z'],
    ['lib', 'Tu biblioteca', 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1 2.5-2.5c.57 0 1.08.19 1.5.51V5h4v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z'],
    ['dj', 'DJ Nat', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'],
  ].map(([k, label, d]) => `<button data-k="${k}">${icon(d)}<span>${label}</span></button>`).join('')
  body.appendChild(nav)

  // ── Arriba, como Spotify: logo + título de la pestaña, y en Inicio los filtros ──
  const head = document.createElement('div')
  head.className = 'm-head'
  head.innerHTML = '<span class="m-title"></span><div class="m-chips">' +
    [['all', 'Todo'], ['genre', 'Géneros'], ['artist', 'Artistas'], ['album', 'Álbumes']]
      .map(([f, label]) => `<button class="chip" data-f="${f}">${label}</button>`).join('') + '</div>'
  document.querySelector('.tb-left').after(head)
  // Los filtros abren Tu biblioteca con ese filtro
  head.querySelector('.m-chips').addEventListener('click', e => {
    const f = e.target.closest('[data-f]')?.dataset.f
    if (!f) return
    setTab('lib')
    document.querySelector(`.sb-chips [data-filter="${f}"]`)?.click()
    markNav()
  })
  const TITLES = { home: '', search: 'Buscar', lib: 'Tu biblioteca' }

  // ── Buscar: "Explorar todo" con tarjetas de géneros y moods ──
  const browse = document.createElement('section')
  browse.className = 'm-browse'
  browse.hidden = true
  browse.innerHTML = '<h2>Explorar todo</h2><div class="m-cards"></div>'
  document.querySelector('.app-layout').appendChild(browse)
  const fillBrowse = () => {
    const gg = window.getGenreGroups?.()
    if (!gg) return
    browse.querySelector('.m-cards').innerHTML = [...gg.genres, ...gg.moods].map(g => {
      const art = g.songs.find(s => s.cover)?.cover
      return `<button class="m-card" data-key="${esc(g.key)}" style="background:rgb(${g.color.join(',')})">
        <span>${esc(g.name)}</span>${art ? `<img src="${art}" alt="">` : ''}</button>`
    }).join('') || '<p class="m-empty">Tus géneros aparecen aquí cuando se clasifique tu música.</p>'
  }
  browse.addEventListener('click', e => {
    const key = e.target.closest('.m-card')?.dataset.key
    if (!key) return
    browse.hidden = true
    window.navigate({ name: 'genre', key })
  })
  // Al escribir se ven los resultados; al borrar, otra vez "Explorar todo"
  $('search').addEventListener('input', () => {
    if (body.dataset.tab === 'search') browse.hidden = !!$('search').value.trim()
  })

  const closePanels = () => {
    body.classList.remove('show-lib')
    if (!$('right-panel').hidden) $('rp-close').click()
  }
  const setTab = k => {
    if (k === 'dj') { body.classList.remove('show-lib'); if ($('right-panel').hidden || $('rp-dj').hidden) $('btn-dj').click(); return }
    closePanels()
    body.dataset.tab = k
    head.querySelector('.m-title').textContent = TITLES[k]
    browse.hidden = true
    if (k === 'home') $('btn-home').click()
    if (k === 'lib') body.classList.add('show-lib')
    if (k === 'search') {
      if ($('search').value.trim()) window.navigate({ name: 'search', q: $('search').value.trim() })
      else { fillBrowse(); browse.hidden = false }
    }
  }
  nav.addEventListener('click', e => {
    const k = e.target.closest('button')?.dataset.k
    if (k) setTab(k)
    markNav()
  })
  // Elegir algo de la biblioteca la cierra
  $('lib-list').addEventListener('click', () => setTimeout(() => body.classList.remove('show-lib'), 0))
  // El logo lleva a Inicio
  $('app-logo').addEventListener('click', () => setTab('home'))

  // Tocar el mini reproductor abre "Reproduciendo" a pantalla completa
  document.querySelector('.bar-left').addEventListener('click', e => {
    if (e.target.closest('.like-btn, a, .link')) return
    if ($('right-panel').hidden || !body.classList.contains('rp-np')) $('btn-np').click()
  })
  const showLyr = document.createElement('button')
  showLyr.className = 'm-show-lyrics'
  showLyr.textContent = 'Mostrar la letra'
  $('np-lyrics').append(showLyr)

  // En el celular los paneles se cierran con la flecha hacia abajo (como Spotify)
  $('rp-close').innerHTML = icon(CHEVRON_DOWN)

  // Color de la portada (renderer.js lo pone de fondo en la vista de letra): para el mini
  // reproductor y el fondo de "Reproduciendo"
  new MutationObserver(() => {
    body.style.setProperty('--m-tint', $('view-lyrics').style.backgroundColor || '')
  }).observe($('view-lyrics'), { attributes: true, attributeFilter: ['style'] })

  // Qué panel está abierto (para el acomodo y la barra de abajo)
  const markNav = () => {
    const dj = !$('right-panel').hidden && !$('rp-dj').hidden
    for (const b of nav.children) b.classList.toggle('on', b.dataset.k === 'dj' ? dj : !dj && b.dataset.k === body.dataset.tab)
  }
  // En "Reproduciendo" los controles van dentro de la pantalla, justo debajo del título (como
  // Spotify: título → barra de tiempo → botones → letra), y al cerrar regresan a la barra
  const center = document.querySelector('.bar-center')
  const barRight = document.querySelector('.bar-right')
  const extra = document.createElement('div')
  extra.className = 'm-np-extra'
  // Letra a pantalla completa (como Spotify): flecha, título y artista arriba; barra de tiempo
  // y play abajo. Va encima de "Reproduciendo".
  const lyr = $('view-lyrics')
  const lyrHead = document.createElement('div')
  lyrHead.className = 'm-lyr-head'
  lyrHead.innerHTML = `<button class="m-lyr-close">${icon(CHEVRON_DOWN)}</button><div><b></b><span></span></div>`
  lyr.prepend(lyrHead)
  const lyrFoot = document.createElement('div')
  lyrFoot.className = 'm-lyr-foot m-host'
  lyr.append(lyrFoot)
  lyrHead.querySelector('.m-lyr-close').addEventListener('click', () => {
    if (!$('btn-back').disabled) $('btn-back').click()
    else window.navigate({ name: 'home' })
  })
  // El micrófono era el ícono de letra de escritorio: en el celular, uno de texto
  $('btn-lyrics').innerHTML = icon('M3 18h12v-2H3v2zM3 6v2h18V6H3zm0 7h18v-2H3v2z')

  // Los controles van donde se ven: letra > Reproduciendo > mini reproductor
  const moveControls = where => {
    if (where === 'lyrics') {
      if (center.parentNode !== lyrFoot) { lyrFoot.append(center); extra.remove() }
    } else if (where === 'np') {
      if (center.parentNode !== $('rp-np')) {
        $('rp-np').querySelector('.np-row').after(center)
        center.after(extra)
        extra.append($('btn-lyrics'), $('btn-queue'))
      }
    } else if (center.parentNode !== document.querySelector('.player-bar')) {
      document.querySelector('.bar-left').after(center)
      barRight.prepend($('btn-lyrics'), $('btn-queue'))
      extra.remove()
    }
  }
  $('rp-np').classList.add('m-host')
  const sync = () => {
    const inNp = !$('right-panel').hidden && !$('rp-np').hidden
    const inLyr = !lyr.hidden
    body.classList.toggle('rp-np', inNp)
    body.classList.toggle('m-lyrics', inLyr)
    // En las páginas (playlist, álbum, artista…) arriba sólo va la flecha, como Spotify
    body.classList.toggle('m-sub', !$('view-collection').hidden)
    const inQueue = !$('right-panel').hidden && !$('rp-queue').hidden
    body.classList.toggle('m-queue', inQueue)
    if (inQueue) $('rp-title').textContent = 'Fila de reproducción'
    // Sin nada sonando no hay mini reproductor (el corazón sólo aparece con una canción)
    body.classList.toggle('m-nosong', $('bar-like').hidden && !inNp)
    if (inLyr) {
      lyrHead.querySelector('b').textContent = $('np-title').textContent
      lyrHead.querySelector('span').textContent = $('np-artist').textContent
    }
    moveControls(inLyr ? 'lyrics' : inNp ? 'np' : 'bar')
    markNav()
  }
  new MutationObserver(sync).observe(body, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  sync()
}

// ── Páginas de playlist / álbum / artista / género, menú de canción y "atrás" ──
// (como Spotify: flecha para regresar, "⋮" en cada canción y el menú como hoja desde abajo)
function setupPages() {
  const body = document.body
  // Flecha de regresar arriba a la izquierda de cada página
  const back = document.createElement('button')
  back.className = 'm-page-back'
  back.innerHTML = icon('M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z')
  back.addEventListener('click', () => goBack())
  $('view-collection').prepend(back)

  // "⋮" de cada canción (es la orilla derecha de la fila): abre su menú
  // Un toque pone la canción (en escritorio un clic selecciona y doble clic la pone: en el
  // celular se sentía como si hubiera que tocar dos veces)
  $('song-list').addEventListener('click', e => {
    const li = e.target.closest('.tr')
    if (!li || e.target.closest('.link, a')) return
    e.preventDefault()
    e.stopPropagation()
    if (e.clientX >= li.getBoundingClientRect().right - 52)
      li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }))
    else li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  }, true)

  // "Buscar" del teclado sólo cierra el teclado (en escritorio Enter ponía la primera canción)
  window.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.id !== 'search') return
    e.preventDefault()
    e.stopImmediatePropagation()
    e.target.blur()
  }, true)

  // Menú de canción: arriba la canción (carátula, título, artista) y un fondo oscuro detrás
  const menu = $('ctx-menu')
  new MutationObserver(() => {
    const open = !menu.hidden
    body.classList.toggle('m-sheet', open)
    if (!open || !menu._song || menu.querySelector('.m-sheet-head')) return
    const s = menu._song
    const head = document.createElement('div')
    head.className = 'm-sheet-head'
    head.innerHTML = `<div class="m-sheet-cover">${s.cover ? `<img src="${s.cover}" alt="">` : ''}</div>
      <div><b>${esc(s.title || '')}</b><span>${esc(s.artist || '')}</span></div>`
    menu.prepend(head)
  }).observe(menu, { attributes: true, attributeFilter: ['hidden'] })
}

// ── Reproduciendo y Fila de reproducción como Spotify ──
function setupNowPlaying() {
  const sd = window.sd
  // "⋮" arriba a la derecha: el menú de la canción que suena
  const more = document.createElement('button')
  more.className = 'm-np-more'
  more.innerHTML = icon('M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z')
  more.addEventListener('click', () => { if (sd.currentSong) sd.openSongMenu(sd.currentSong, 0, 0) })
  document.querySelector('.rp-header').append(more)

  // La línea de la letra que va sonando, encima del título (si la letra trae tiempos)
  const lyrNow = document.createElement('div')
  lyrNow.className = 'm-lyr-now'
  $('rp-np').querySelector('.np-row').before(lyrNow)
  $('audio').addEventListener('timeupdate', () => {
    const t = sd.lyricNow
    if (lyrNow.textContent !== t) lyrNow.textContent = t
  })

  // Fila: la que suena con su botón de play, "≡" para reacomodar arrastrando, y abajo
  // "Modo aleatorio" y "Temporizador"
  const q = $('rp-queue')
  const bar = document.createElement('div')
  bar.className = 'm-q-bar'
  bar.innerHTML = `<button data-q="shuffle">${icon('M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z')}<span>Modo aleatorio</span></button>
    <button data-q="sleep">${icon('M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61zM12 20a7 7 0 1 1 0-14 7 7 0 0 1 0 14z')}<span>Temporizador</span></button>`
  q.append(bar)
  bar.addEventListener('click', e => {
    const k = e.target.closest('[data-q]')?.dataset.q
    if (k === 'shuffle') sd.toggleShuffle()
    if (k === 'sleep') sd.openSleepMenu()
    markBar()
  })
  // Sólo cambia lo que cambió: la barra está dentro de la fila, que se vigila para decorar
  // las canciones (si se reescribía siempre, se volvía un ciclo sin fin y la app se congelaba)
  const markBar = () => {
    bar.querySelector('[data-q=shuffle]').classList.toggle('on', sd.shuffle)
    const t = sd.sleepTimer
    bar.querySelector('[data-q=sleep]').classList.toggle('on', !!t)
    const label = bar.querySelector('[data-q=sleep] span'), text = t ? 'Se apaga ' + t : 'Temporizador'
    if (label.textContent !== text) label.textContent = text
  }
  window.addEventListener('sd-notify', markBar)
  const playBtn = icon('M8 5v14l11-7z')
  const handle = icon('M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z')
  const decorate = () => {
    const now = $('queue-now').querySelector('.mini-row')
    if (now && !now.querySelector('.m-q-play')) {
      const b = document.createElement('button')
      b.className = 'm-q-play'
      b.innerHTML = playBtn
      b.addEventListener('click', e => { e.stopPropagation(); $('btn-play').click() })
      now.append(b)
    }
    $('queue-list').querySelectorAll('.mini-row').forEach((li, i) => {
      if (li.querySelector('.m-q-handle')) return
      const h = document.createElement('span')
      h.className = 'm-q-handle'
      h.innerHTML = handle
      h.dataset.pos = i
      li.append(h)
    })
    markBar()
  }
  new MutationObserver(decorate).observe(q, { childList: true, subtree: true })
  setInterval(() => { if (document.body.classList.contains('m-queue')) markBar() }, 30000)   // minutos que faltan

  // Reacomodar: arrastrar el "≡" de una canción a otra posición
  let drag = null
  $('queue-list').addEventListener('pointerdown', e => {
    const h = e.target.closest('.m-q-handle')
    if (!h) return
    e.preventDefault()
    const li = h.closest('.mini-row')
    const rows = [...$('queue-list').children]
    drag = { li, from: rows.indexOf(li), y0: e.clientY, rowH: li.getBoundingClientRect().height, n: rows.length }
    li.classList.add('m-dragging')
    h.setPointerCapture(e.pointerId)
  })
  $('queue-list').addEventListener('pointermove', e => {
    if (!drag) return
    drag.dy = e.clientY - drag.y0
    drag.li.style.transform = `translateY(${drag.dy}px)`
  })
  const drop = () => {
    if (!drag) return
    const to = Math.max(0, Math.min(drag.n - 1, drag.from + Math.round((drag.dy || 0) / drag.rowH)))
    drag.li.style.transform = ''
    drag.li.classList.remove('m-dragging')
    const { from } = drag
    drag = null
    sd.moveUpcoming(from, to)
  }
  $('queue-list').addEventListener('pointerup', drop)
  $('queue-list').addEventListener('pointercancel', drop)

  // Avisos cortos abajo ("Se agregó a la fila…")
  const toast = document.createElement('div')
  toast.className = 'm-toast'
  document.body.append(toast)
  let tt = 0
  window.addEventListener('sd-notify', e => {
    toast.textContent = e.detail
    toast.classList.add('on')
    clearTimeout(tt)
    tt = setTimeout(() => toast.classList.remove('on'), 2500)
  })
}

// ── Tarjeta de la letra que avanza con la canción y "Acerca del artista" ──
let libPage = null   // página abierta desde Tu biblioteca: "atrás" regresa a la biblioteca
function setupExtras() {
  const sd = window.sd
  $('lib-list').addEventListener('click', () => setTimeout(() => { libPage = $('col-title').textContent }, 300))

  // Letra: la tarjeta trae la letra completa y va bajando sola. Con tiempos marca la línea
  // que suena; sin tiempos avanza parejo con la canción (aproximado)
  const box = $('np-lyrics-text')
  let built = '', lines = []
  const build = () => {
    const src = [...$('lyrics-inner').querySelectorAll('.lyric-line')].map(e => e.textContent)
    const sig = sd.currentSong?.path + '|' + src.length
    // La app vuelve a escribir la muestra de 4 líneas en cada canción (aunque se repita)
    if (!src.length || (sig === built && box.children.length === src.length)) return
    built = sig
    box.innerHTML = src.map(t => `<div>${esc(t)}</div>`).join('')
    lines = [...box.children]
    box.scrollTop = 0
  }
  new MutationObserver(build).observe($('lyrics-inner'), { childList: true })
  let last = -2
  $('audio').addEventListener('timeupdate', () => {
    if (!lines.length || !document.body.classList.contains('rp-np')) return
    const a = $('audio')
    const synced = sd.lyricLines.length > 0
    const idx = synced ? sd.lyricIdx : -1
    if (synced && idx !== last) {
      last = idx
      lines.forEach((l, i) => l.classList.toggle('cur', i === idx))
      if (idx >= 0) box.scrollTo({ top: lines[idx].offsetTop - box.offsetTop - 8, behavior: 'smooth' })
    } else if (!synced && a.duration) {
      box.scrollTop = (box.scrollHeight - box.clientHeight) * (a.currentTime / a.duration)
    }
  })

  // "Acerca del artista": foto, nombre, fans y cuántas canciones suyas tienes
  const card = document.createElement('div')
  card.className = 'm-artist-card'
  card.hidden = true
  $('np-lyrics').after(card)
  let shownFor = ''
  const fillArtist = async () => {
    const s = sd.currentSong
    const name = (s?.artist || '').split(/\s*,\s*/)[0]
    if (!name || name === shownFor) return
    shownFor = name
    const info = await window.api.artistInfo?.(name)
    if (shownFor !== name) return
    const mine = sd.allSongs.filter(x => (x.artist || '').toLowerCase().includes(name.toLowerCase())).length || 0
    card.hidden = false
    card.innerHTML = `<div class="m-artist-pic">${info?.picture ? `<img src="${info.picture}" alt="">` : ''}<span>Acerca del artista</span></div>
      <div class="m-artist-body"><b>${esc(name)}</b>
      <span>${info?.fans ? info.fans.toLocaleString('es-MX') + ' fans en Deezer · ' : ''}${mine} ${mine === 1 ? 'canción' : 'canciones'} en tu biblioteca</span>
      <button class="m-artist-go">Ver artista</button></div>`
    card.querySelector('.m-artist-go').onclick = () => {
      $('rp-close').click()
      window.navigate({ name: 'artist', key: name.toLowerCase() })
    }
  }
  $('audio').addEventListener('play', fillArtist)
  new MutationObserver(fillArtist).observe($('np-title'), { childList: true, characterData: true, subtree: true })

  // Página de artista: su foto en lugar de la carátula de una canción
  new MutationObserver(async () => {
    const cover = $('col-cover')
    if (!cover.classList.contains('round') || cover.dataset.artist === $('col-title').textContent) return
    const name = cover.dataset.artist = $('col-title').textContent
    const info = await window.api.artistInfo?.(name)
    if (info?.picture && cover.dataset.artist === name) cover.innerHTML = `<img src="${info.picture}" alt="">`
  }).observe($('col-title'), { childList: true, characterData: true, subtree: true })
}

// ── DJ Nat como el DJ de Spotify ──
// Sin chat: el DJ se ve en Reproduciendo (orbe grande mientras habla, "DJ" + la vibra arriba) y
// el botón del DJ abre la hoja "¿Qué te gustaría escuchar?" con sugerencias y el micrófono.
const MOOD_PHRASE = { 'm-triste': 'tristes pa la noche', 'm-bailar': 'para bailar', 'm-peda': 'pa la peda',
  'm-romance': 'románticas', 'm-chill': 'tranquilas', 'm-energia': 'con energía', 'm-feliz': 'alegres' }
function setupDj() {
  const sd = window.sd, body = document.body
  // El panel del DJ (con el texto) no se usa en el celular: se va a Reproduciendo
  new MutationObserver(() => {
    if (!$('right-panel').hidden && !$('rp-dj').hidden) $('btn-np').click()
  }).observe($('rp-dj'), { attributes: true, attributeFilter: ['hidden'] })

  // Mientras habla: el orbe grande en lugar de la carátula y "A continuación / DJ Nat"
  const label = document.createElement('div')
  label.className = 'm-dj-label'
  label.innerHTML = '<b>A continuación</b><span>DJ Nat</span>'
  $('rp-np').querySelector('.np-row').prepend(label)
  const orbHome = $('dj-orb').parentNode, orbNext = $('dj-orb').nextSibling
  let talking = false
  setInterval(() => {
    const d = sd.dj, ctxDj = sd.playContext?.key === 'dj:'
    body.classList.toggle('m-djmode', d.on && (ctxDj || d.speaking || d.thinking))
    const t = d.on && (d.speaking || d.thinking)
    if (t !== talking) {
      talking = t
      body.classList.toggle('m-dj-talk', t)
      if (t) { document.querySelector('#rp-np .np-media').append($('dj-orb')); sd.startOrb() }
      else orbHome.insertBefore($('dj-orb'), orbNext)
    }
    if (body.classList.contains('rp-np') && body.classList.contains('m-djmode')) {
      const v = d.vibe || 'DJ Nat'
      if ($('rp-title').textContent !== v) $('rp-title').textContent = v
    }
  }, 250)

  // Botón del DJ (abajo a la derecha en Reproduciendo, como Spotify)
  const btn = document.createElement('button')
  btn.className = 'm-dj-btn'
  btn.innerHTML = '<span class="mini-orb"><i></i><i></i><i></i></span>'
  btn.addEventListener('click', () => openSheet())
  document.querySelector('.m-np-extra')?.append(btn)
  // (la fila de botones de abajo se crea antes; si no, se agrega cuando aparezca)
  new MutationObserver(() => {
    const x = document.querySelector('.m-np-extra')
    if (x && btn.parentNode !== x) x.append(btn)
  }).observe($('rp-np'), { childList: true })

  // Hoja "¿Qué te gustaría escuchar?"
  const sheet = document.createElement('div')
  sheet.className = 'm-dj-sheet'
  sheet.hidden = true
  sheet.innerHTML = `
    <div class="m-dj-now"><div class="m-dj-now-cover"></div><div class="m-dj-now-text"><b></b><span></span></div>
      <button class="m-dj-now-play">${icon('M8 5v14l11-7z')}</button></div>
    <h2>¿Qué te gustaría escuchar?</h2>
    <div class="m-dj-chips"></div>
    <form class="m-dj-ask"><input type="text" placeholder="Escribe una solicitud en español" spellcheck="false" autocomplete="off">
      <button type="button" class="m-dj-mic">${icon('M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z')}</button></form>`
  body.append(sheet)
  const input = sheet.querySelector('input')
  const send = text => {
    text = String(text || '').trim()
    if (!text) return
    closeSheet()
    if (!sd.dj.on) sd.djStart()
    setTimeout(() => sd.djAsk(text), sd.dj.on ? 0 : 600)
  }
  sheet.querySelector('form').addEventListener('submit', e => { e.preventDefault(); send(input.value) })
  sheet.querySelector('.m-dj-now-play').addEventListener('click', () => $('btn-play').click())
  sheet.querySelector('.m-dj-chips').addEventListener('click', e => {
    const c = e.target.closest('button')
    if (!c) return
    if (c.dataset.switch) { closeSheet(); if (sd.dj.on) sd.djSwitch(); else sd.djStart(); return }
    send(c.textContent)
  })
  // Micrófono: dictado de Android (pide permiso la primera vez)
  sheet.querySelector('.m-dj-mic').addEventListener('click', async () => {
    const SR = SpeechRecognition
    try {
      const p = await SR.checkPermissions()
      if (p.speechRecognition !== 'granted') await SR.requestPermissions()
      const r = await SR.start({ language: 'es-MX', maxResults: 1, prompt: 'Pídele algo a DJ Nat', partialResults: false, popup: true })
      const said = r?.matches?.[0]
      if (said) { input.value = said; send(said) }
    } catch (e) { console.warn('dictado', e) }
  })

  // Sugerencias armadas con tu música (géneros, moods y artistas que más tienes)
  const suggestions = () => {
    const gg = window.getGenreGroups?.()
    const out = []
    if (gg) {
      for (const g of gg.genres.slice(0, 6)) {
        const m = gg.moods.find(m => MOOD_PHRASE[m.key] && m.songs.filter(s => g.songs.includes(s)).length >= 8 && !out.some(o => o.includes(MOOD_PHRASE[m.key])))
        out.push(m ? `${g.name} ${MOOD_PHRASE[m.key]}` : `Puro ${g.name.toLowerCase()}`)
      }
    }
    const artists = window.getGroups?.().artistList?.filter(a => a.name !== 'Artista desconocido').sort((a, b) => b.songs.length - a.songs.length) || []
    for (const a of artists.slice(0, 3)) out.splice(1 + out.length % 3, 0, `Algo como ${a.name}`)
    return out.slice(0, 8)
  }
  function openSheet() {
    const s = sd.currentSong
    sheet.querySelector('.m-dj-now').hidden = !s
    if (s) {
      sheet.querySelector('.m-dj-now-cover').innerHTML = s.cover ? `<img src="${s.cover}" alt="">` : ''
      sheet.querySelector('.m-dj-now-text b').textContent = s.title || ''
      sheet.querySelector('.m-dj-now-text span').textContent = s.artist || ''
    }
    sheet.querySelector('.m-dj-chips').innerHTML =
      `<button data-switch="1" class="m-dj-chip-switch"><span class="mini-orb"><i></i><i></i><i></i></span>${sd.dj.on ? 'Cambia la vibra' : 'Iniciar DJ'}</button>` +
      suggestions().map(t => `<button>${esc(t)}</button>`).join('')
    input.value = ''
    sheet.hidden = false
  }
  function closeSheet() { sheet.hidden = true; input.blur() }
  window.__closeDjSheet = () => { if (sheet.hidden) return false; closeSheet(); return true }

  // La pestaña DJ Nat: si no está prendido lo prende; luego Reproduciendo (o la hoja)
  document.querySelector('.m-nav').addEventListener('click', e => {
    if (e.target.closest('button')?.dataset.k !== 'dj') return
    e.stopImmediatePropagation()
    if (!sd.dj.on) { sd.djStart(); return }
    if ($('right-panel').hidden || $('rp-np').hidden) $('btn-np').click()
    else openSheet()
  }, true)
}

// Regresar, como el "atrás" de Android: cierra lo que esté encima o va a la pantalla anterior
export function goBack() {
  const body = document.body
  if (window.__closeDjSheet?.()) return true
  if (!$('ctx-menu').hidden) { window.closeMenu?.(); return true }
  if (!$('settings').hidden) { window.closeSettings?.(); return true }
  if (body.classList.contains('m-lyrics')) { document.querySelector('.m-lyr-close').click(); return true }
  if (!$('right-panel').hidden) { $('rp-close').click(); return true }
  if (body.classList.contains('show-lib')) { document.querySelector('.m-nav [data-k=home]').click(); return true }
  // Página abierta desde Tu biblioteca: regresa a la biblioteca
  if (libPage && !$('view-collection').hidden && $('col-title').textContent === libPage) {
    libPage = null
    document.querySelector('.m-nav [data-k=lib]').click()
    return true
  }
  if ($('view-home').hidden && !$('btn-back').disabled) { $('btn-back').click(); return true }
  if ($('view-home').hidden) { window.navigate({ name: 'home' }); return true }
  return false   // ya no hay a dónde regresar: la app se va a segundo plano (sigue sonando)
}

export function setupMobileUiWhenReady() {
  const go = () => { setupMobileUi(); setupPages(); setupNowPlaying(); setupExtras(); setupDj() }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', go); return }
  go()
}
