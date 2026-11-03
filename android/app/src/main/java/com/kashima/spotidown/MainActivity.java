package com.kashima.spotidown;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MusicPlugin.class);   // tu música del celular (MusicPlugin.java)
        super.onCreate(savedInstanceState);
        // Android 13+: los controles de la notificación necesitan este permiso
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        WebView web = getBridge().getWebView();
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
                return super.shouldInterceptRequest(view, request);
            }
        });
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
