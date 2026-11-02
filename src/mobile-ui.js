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
  const sync = () => {
    body.classList.toggle('rp-np', !$('right-panel').hidden && !$('rp-np').hidden)
    markNav()
  }
  new MutationObserver(sync).observe(body, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  sync()
}

export function setupMobileUiWhenReady() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupMobileUi)
  else setupMobileUi()
}
