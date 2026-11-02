# Spotidown móvil (Android)

La app de Android de [Spotidown](https://github.com/KASHlMA/Spotidown), hecha con Capacitor.
Usa la **misma interfaz** que la versión de escritorio (`index.html`, `renderer.js`, `styles.css`):
este repo sólo trae lo propio del celular.

- `src/api-mobile.js` — hace en Android lo que en escritorio hacen `preload.js` + `main.js`
- `src/mobile.css` — acomodo para pantalla de celular (mini reproductor, barra de abajo)
- `android/app/src/main/java/.../MusicPlugin.java` — busca la música del celular y lee carátulas y letras

## Compilar

Necesita el repo de escritorio en la carpeta de arriba (o su ruta en `SPOTIDOWN_DESKTOP`):

```
Spotidown/          ← repo de escritorio
  mobile/           ← este repo
```

```
npm install
npm run apk         # APK en android/app/build/outputs/apk/debug/app-debug.apk
```

JDK 17 (Capacitor 6).
