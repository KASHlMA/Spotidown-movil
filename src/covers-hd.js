// Carátulas en HD para Reproduciendo y las portadas grandes (las listas siguen con la de 400 px,
// que carga rápido). Si la que trae el archivo es chica, se busca la del álbum en Deezer y luego en
// iTunes, y sólo se usa si el álbum y el artista coinciden. No se tocan los archivos de música:
// todo se guarda dentro de la app (MusicPlugin.java, files/covers-hd).
import { CapacitorHttp } from '@capacitor/core'

const MIN_W = 900   // menos que esto se ve borrosa a pantalla completa

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim()
const firstArtist = a => String(a || '').split(/,|&| x | feat\.?| ft\.?/i)[0].trim()
const same = (a, b) => { a = fold(a); b = fold(b); return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a)) }

// Lo que ya se buscó (por álbum + artista): la liga encontrada o '' si no hubo
let tried = {}
try { tried = JSON.parse(localStorage.getItem('hd-covers') || '{}') } catch {}
const remember = (k, v) => { tried[k] = v; try { localStorage.setItem('hd-covers', JSON.stringify(tried)) } catch {} }

const getJson = async url => {
  const r = await CapacitorHttp.get({ url, connectTimeout: 10000, readTimeout: 10000 })
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
}

async function findOnline(song) {
  const artist = firstArtist(song.artist), album = song.album || ''
  if (!artist) return ''
  try {
    if (album) {
      const d = await getJson('https://api.deezer.com/search/album?q=' + encodeURIComponent(`artist:"${artist}" album:"${album}"`))
      const hit = (d.data || []).find(x => same(x.title, album) && same(x.artist?.name, artist))
      if (hit?.cover_xl) return hit.cover_xl
    }
    // Sin álbum (sencillos): por la canción
    const t = await getJson('https://api.deezer.com/search/track?q=' + encodeURIComponent(`artist:"${artist}" track:"${song.title}"`))
    const th = (t.data || []).find(x => same(x.title, song.title) && same(x.artist?.name, artist))
    if (th?.album?.cover_xl) return th.album.cover_xl
    const it = await getJson('https://itunes.apple.com/search?country=mx&limit=10&entity=' + (album ? 'album' : 'song') +
      '&term=' + encodeURIComponent(`${artist} ${album || song.title}`))
    const ih = (it.results || []).find(x => same(album ? x.collectionName : x.trackName, album || song.title) && same(x.artistName, artist))
    if (ih?.artworkUrl100) return ih.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1200x1200bb.')
  } catch {}
  return ''
}

export async function hdCover(Music, song, fileUrl) {
  if (!song?.path) return null
  const r = await Music.hdCover({ path: song.path }).catch(() => ({}))
  if (r.cover && r.w >= MIN_W) return fileUrl(r.cover)
  // Chica o sin carátula: una búsqueda por álbum (o canción suelta)
  const key = fold(firstArtist(song.artist)) + '|' + fold(song.album || song.title)
  if (tried[key] === undefined) remember(key, await findOnline(song))
  if (tried[key]) {
    const r2 = await Music.hdCover({ path: song.path, url: tried[key] }).catch(() => ({}))
    if (r2.cover) return fileUrl(r2.cover) + '?hd=' + Date.now()
  }
  return r.cover ? fileUrl(r.cover) : null
}
