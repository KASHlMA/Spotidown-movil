package com.kashima.spotidown;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    private volatile boolean painted = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // El logo de Android se queda hasta que la página ya pintó su pantalla de carga (máx. 3 s);
        // antes se alcanzaba a ver un cuadro vacío entre los dos
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> !painted);
        splash.setOnExitAnimationListener(v -> v.remove());   // sin desvanecerse: abajo ya está el mismo logo
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> painted = true, 3000);
        registerPlugin(MusicPlugin.class);   // tu música del celular (MusicPlugin.java)
        super.onCreate(savedInstanceState);
        // Android 13+: los controles de la notificación necesitan este permiso
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        maxRefreshRate();
        WebView web = getBridge().getWebView();
        // Mismo gris que la pantalla de carga (si no, entre el logo de Android y la página se ve un cuadro negro)
        web.setBackgroundColor(Color.parseColor("#202020"));
        // Abajo (donde va el gesto de Android) negro como la app; antes se veía una franja gris
        getWindow().setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        // La música empieza a sonar sin tener que tocar dos veces
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Los archivos de música se sirven en /_music_/<ruta>, con los encabezados de "Range"
        // bien puestos (el de Capacitor no los ponía bien y no se podía adelantar).
        web.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String p = url.getPath();
                if (p != null && p.startsWith("/_music_/")) return serveMusic(p.substring("/_music_".length()), request);
                if ("www.youtube-nocookie.com".equals(url.getHost()) && p != null && p.startsWith("/embed/")) {
                    WebResourceResponse r = serveEmbed(request);
                    if (r != null) return r;
                }
                return super.shouldInterceptRequest(view, request);
            }
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                // Un momento más para que el logo de la página ya esté pintado
                view.postDelayed(() -> painted = true, 150);
            }
        });
    }

    // La pantalla a lo más rápido que dé (120 / 144 Hz): si la app no lo pide, Android la deja en 60 Hz
    // y las animaciones y el scroll se sienten lentos
    private void maxRefreshRate() {
        try {
            Display d = Build.VERSION.SDK_INT >= 30 ? getDisplay() : getWindowManager().getDefaultDisplay();
            Display.Mode cur = d.getMode(), best = cur;
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) {}
    }

    // Canvas: la página del video de YouTube se pide aquí para meterle un estilo que esconde todo
    // menos el video (el ícono de pausa, el título, el logo…), como hace main.js en escritorio.
    // Si algo falla regresa null y el WebView la carga normal.
    private static final String EMBED_STYLE = "<style>body *:not(video):not(:has(video)){display:none!important}"
        + "html,body{background:#000!important}</style>"
        // Calidad 720p: sola arrancaba en la más baja (256x136) y se veía borroso
        + "<script>setInterval(function(){var p=document.getElementById('movie_player');"
        + "if(p&&p.setPlaybackQualityRange&&p.getPlaybackQuality()!=='hd720'){try{p.setPlaybackQualityRange('hd720','hd720')}catch(e){}}},1500)</script>";
    private static WebResourceResponse serveEmbed(WebResourceRequest request) {
        if (!"GET".equals(request.getMethod())) return null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
            for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
                if (!h.getKey().equalsIgnoreCase("Accept-Encoding")) c.setRequestProperty(h.getKey(), h.getValue());
            }
            // Sin "Referer" el reproductor de YouTube no carga
            if (c.getRequestProperty("Referer") == null) c.setRequestProperty("Referer", "https://localhost/");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            }
            String html = out.toString("UTF-8");
            int head = html.indexOf("</head>");
            if (head < 0) return null;
            html = html.substring(0, head) + EMBED_STYLE + html.substring(head);
            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            return null;
        }
    }

    private static WebResourceResponse serveMusic(String path, WebResourceRequest request) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Access-Control-Allow-Origin", "*");
        File f = new File(path);
        String ext = MimeTypeMap.getFileExtensionFromUrl(Uri.fromFile(f).toString());
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext == null ? "" : ext.toLowerCase());
        if (mime == null) mime = "audio/mpeg";
        if (!f.canRead()) return new WebResourceResponse(mime, null, 404, "Not Found", headers, null);
        try {
            long len = f.length(), from = 0, to = len - 1;
            String range = request.getRequestHeaders().get("Range");
            if (range == null) range = request.getRequestHeaders().get("range");
            InputStream in = new FileInputStream(f);
            if (range != null && range.startsWith("bytes=")) {
                String[] r = range.substring(6).split("-", -1);
                if (!r[0].isEmpty()) from = Long.parseLong(r[0].trim());
                if (r.length > 1 && !r[1].trim().isEmpty()) to = Math.min(Long.parseLong(r[1].trim()), len - 1);
                // Ojo: el WebView mismo se brinca hasta "from" (lee el Range de la petición), pero no
                // corta en "to": aquí se le da el archivo desde el principio, cortado en "to". Si también
                // se brincaba aquí era doble, y cerca del final se salía del archivo (la canción se
                // trababa y no pasaba a la siguiente)
                headers.put("Content-Range", "bytes " + from + "-" + to + "/" + len);
                headers.put("Content-Length", String.valueOf(to - from + 1));
                return new WebResourceResponse(mime, null, 206, "Partial Content", headers, new Capped(in, to + 1));
            }
            headers.put("Content-Length", String.valueOf(len));
            return new WebResourceResponse(mime, null, 200, "OK", headers, in);
        } catch (Exception e) {
            return new WebResourceResponse(mime, null, 500, "Error", headers, null);
        }
    }

    /** El archivo hasta el byte "to" (cuenta también lo que el WebView se brinca) */
    private static class Capped extends InputStream {
        private final InputStream in;
        private long left;
        Capped(InputStream in, long left) { this.in = in; this.left = left; }
        @Override public int read() throws java.io.IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
        @Override public long skip(long n) throws java.io.IOException {
            long s = in.skip(Math.min(n, left));
            if (s > 0) left -= s;
            return s;
        }
        @Override public int available() throws java.io.IOException { return (int) Math.min(in.available(), left); }
        @Override public void close() throws java.io.IOException { in.close(); }
    }
}
