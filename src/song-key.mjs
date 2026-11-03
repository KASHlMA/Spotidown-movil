// La misma canción en la compu y en el celular (los archivos se llaman distinto: "Artista -
// Canción" vs "Canción - Artista"): título + primer artista, sin acentos ni signos
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const songKey = (title, artist) => fold(title) + '|' + fold(String(artist || '').split(/,|&| feat\.?| ft\.?| x /i)[0])
