package com.kashima.spotidown;

import android.Manifest;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/**
 * Lo que en escritorio hace main.js con el disco: buscar la música del celular (MediaStore)
 * y leer de cada archivo la carátula y la letra incrustadas.
 */
@CapacitorPlugin(
    name = "Music",
    permissions = {
        @Permission(alias = "audio", strings = { "android.permission.READ_MEDIA_AUDIO" }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MusicPlugin extends Plugin {

    // Carátulas guardadas como JPG (files/covers): sacarlas del archivo de música tarda ~70 ms cada
    // una y antes se hacía cada vez que abrías la app. La primera vez se sacan todas en segundo plano.
    private File coversDir() {
        File d = new File(getContext().getFilesDir(), "covers");
        if (!d.exists()) d.mkdirs();
        return d;
    }
    private File coverFile(String path, long mtime) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-1").digest((path + "|" + mtime).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02x", b));
            return new File(coversDir(), sb + ".jpg");
        } catch (Exception e) { return new File(coversDir(), Integer.toHexString((path + mtime).hashCode()) + ".jpg"); }
    }
    // Saca la carátula y la guarda; regresa la ruta del JPG o null si la canción no trae
    private String makeCover(String path, long mtime, MediaMetadataRetriever mmr) {
        File f = coverFile(path, mtime);
        if (f.exists()) return f.getAbsolutePath();
        byte[] pic = mmr.getEmbeddedPicture();
        if (pic == null) return null;
        Bitmap bmp = BitmapFactory.decodeByteArray(pic, 0, pic.length);
        if (bmp == null) return null;
        if (bmp.getWidth() > 400) bmp = Bitmap.createScaledBitmap(bmp, 400, Math.round(400f * bmp.getHeight() / bmp.getWidth()), true);
        try (FileOutputStream out = new FileOutputStream(f)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
            return f.getAbsolutePath();
        } catch (Exception e) { return null; }
    }
    // Carátula grande (hasta 1200 px) para Reproduciendo y las portadas grandes: la de 400 px se veía
    // borrosa ahí. Se hace la primera vez que se ve. Con "url", se baja de internet (una en HD cuando la
    // que trae el archivo es chica). Regresa { cover, w, h } o null si no hay.
    private File hdFile(String path, long mtime) {
        File d = new File(getContext().getFilesDir(), "covers-hd");
        if (!d.exists()) d.mkdirs();
        return new File(d, coverFile(path, mtime).getName());
    }
    private static JSObject saveHd(Bitmap bmp, File f) throws Exception {
        if (bmp.getWidth() > 1200) bmp = Bitmap.createScaledBitmap(bmp, 1200, Math.round(1200f * bmp.getHeight() / bmp.getWidth()), true);
        try (FileOutputStream out = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.JPEG, 90, out); }
        JSObject r = new JSObject();
        r.put("cover", f.getAbsolutePath());
        r.put("w", bmp.getWidth());
        r.put("h", bmp.getHeight());
        return r;
    }

    @PluginMethod
    public void hdCover(PluginCall call) {
        String path = call.getString("path");
        String url = call.getString("url");
        long mtime = new File(path).lastModified() / 1000 * 1000;
        new Thread(() -> {
            File f = hdFile(path, mtime);
            try {
                if (url != null) {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(15000);
                    Bitmap bmp = BitmapFactory.decodeStream(c.getInputStream());
                    if (bmp == null) { call.resolve(new JSObject()); return; }
                    JSObject r = saveHd(bmp, f);
                    r.put("online", true);
                    call.resolve(r);
                    return;
                }
                if (f.exists()) {
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(f.getAbsolutePath(), o);
                    JSObject r = new JSObject();
                    r.put("cover", f.getAbsolutePath());
                    r.put("w", o.outWidth);
                    r.put("h", o.outHeight);
                    call.resolve(r);
                    return;
                }
                MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                try {
                    mmr.setDataSource(path);
                    byte[] pic = mmr.getEmbeddedPicture();
                    Bitmap bmp = pic == null ? null : BitmapFactory.decodeByteArray(pic, 0, pic.length);
                    call.resolve(bmp == null ? new JSObject() : saveHd(bmp, f));
                } finally { try { mmr.release(); } catch (Exception ignored) {} }
            } catch (Exception e) {
                call.resolve(new JSObject());
            }
        }).start();
    }

    private static volatile boolean pregenRunning = false;
    private void pregenCovers(JSArray songs) {
        if (pregenRunning) return;
        pregenRunning = true;
        Thread t = new Thread(() -> {
            try {
                for (int i = 0; i < songs.length(); i++) {
                    JSObject o = JSObject.fromJSONObject(songs.getJSONObject(i));
                    String path = o.getString("path");
                    long mtime = o.getLong("mtime");
                    if (coverFile(path, mtime).exists()) continue;
                    MediaMetadataRetriever mmr = new MediaMetadataRetriever();
                    try { mmr.setDataSource(path); makeCover(path, mtime, mmr); }
                    catch (Exception ignored) {}
                    finally { try { mmr.release(); } catch (Exception ignored) {} }
                }
            } catch (Exception ignored) {
            } finally { pregenRunning = false; }
        });
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    private String permAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio" : "storage";
    }

    /** Todas las canciones del celular: { songs: [{ path, mtime, title, artist, album, duration }] } */
    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(permAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(permAlias(), call, "scanAfterPermission");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void scanAfterPermission(PluginCall call) {
        if (getPermissionState(permAlias()) == PermissionState.GRANTED) doScan(call);
        else call.reject("Sin permiso para leer tu música");
    }

    private void doScan(PluginCall call) {
        new Thread(() -> {
            JSArray songs = new JSArray();
            String[] cols = {
                MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.DATE_MODIFIED,
            };
            try (Cursor c = getContext().getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols,
                    MediaStore.Audio.Media.IS_MUSIC + " != 0", null, MediaStore.Audio.Media.DATA)) {
                while (c != null && c.moveToNext()) {
                    String path = c.getString(0);
                    if (path == null || !new File(path).exists()) continue;
                    // Grabaciones de llamadas (Android las marca como música): no van en la biblioteca
                    if (path.matches("(?i).*/(PhoneRecord|CallRecord|Call ?Recordings?|Recordings/Call)/.*")) continue;
                    JSObject o = new JSObject();
                    o.put("path", path);
                    o.put("mtime", c.getLong(5) * 1000);
                    o.put("title", c.getString(1));
                    String artist = c.getString(2);
                    o.put("artist", artist == null || artist.equals("<unknown>") ? "" : artist);
                    o.put("album", c.getString(3));
                    o.put("duration", c.getLong(4) / 1000.0);
                    File cf = coverFile(path, c.getLong(5) * 1000);
                    o.put("cover", cf.exists() ? cf.getAbsolutePath() : null);
                    songs.put(o);
                }
            } catch (Exception e) {
                call.reject("No se pudo leer la música: " + e.getMessage());
                return;
            }
            JSObject r = new JSObject();
            r.put("songs", songs);
            call.resolve(r);
            pregenCovers(songs);
        }).start();
    }

    /** Metadata de una canción: título, artista, álbum, duración, carátula (data URL) y letra */
    @PluginMethod
    public void readMeta(PluginCall call) {
        String path = call.getString("path");
        long mtime = new File(path).lastModified() / 1000 * 1000;
        new Thread(() -> {
            JSObject r = new JSObject();
            String name = new File(path).getName().replaceAll("\\.[^.]+$", "").replaceAll("^\\d+\\s*[-–.]\\s*", "");
            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
            try {
                mmr.setDataSource(path);
                String title = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                String artist = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                String album = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                String dur = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                r.put("title", title != null && !title.isEmpty() ? title : name);
                r.put("artist", artist != null ? artist : "");
                r.put("album", album != null ? album : "");
                r.put("duration", dur != null ? Long.parseLong(dur) / 1000.0 : 0);
                r.put("cover", makeCover(path, mtime, mmr));
            } catch (Exception e) {
                r.put("title", name);
                r.put("artist", "");
                r.put("album", "");
                r.put("duration", 0);
                r.put("cover", null);
            } finally {
                try { mmr.release(); } catch (Exception ignored) {}
            }
            r.put("lyrics", readLyrics(path));
            call.resolve(r);
        }).start();
    }

    // Carátula reducida a 400 px en JPEG (una incrustada puede pesar varios MB)
    private static String coverDataUrl(byte[] pic) {
        if (pic == null) return null;
        Bitmap bmp = BitmapFactory.decodeByteArray(pic, 0, pic.length);
        if (bmp == null) return null;
        if (bmp.getWidth() > 400) bmp = Bitmap.createScaledBitmap(bmp, 400, Math.round(400f * bmp.getHeight() / bmp.getWidth()), true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    // Letra incrustada (frame USLT de ID3v2.3/2.4), igual que en escritorio
    private static String readLyrics(String path) {
        try (RandomAccessFile f = new RandomAccessFile(path, "r")) {
            byte[] h = new byte[10];
            if (f.read(h) != 10 || h[0] != 'I' || h[1] != 'D' || h[2] != '3') return "";
            int ver = h[3];
            if (ver < 3) return "";
            int size = synchsafe(h, 6);
            byte[] tag = new byte[size];
            f.readFully(tag);
            int i = 0;
            if ((h[5] & 0x40) != 0) i += ver == 4 ? synchsafe(tag, 0) : 4 + int32(tag, 0);   // encabezado extendido
            while (i + 10 <= tag.length) {
                if (tag[i] == 0) break;
                String id = new String(tag, i, 4, StandardCharsets.ISO_8859_1);
                int len = ver == 4 ? synchsafe(tag, i + 4) : int32(tag, i + 4);
                int start = i + 10;
                if (len <= 0 || start + len > tag.length) break;
                if (id.equals("USLT")) return uslt(tag, start, len);
                i = start + len;
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static String uslt(byte[] b, int start, int len) {
        int enc = b[start];
        int p = start + 4, end = start + len;   // codificación + idioma (3)
        boolean wide = enc == 1 || enc == 2;
        // Descripción terminada en 0 (o 00 00 en UTF-16)
        if (wide) { while (p + 1 < end && !(b[p] == 0 && b[p + 1] == 0)) p += 2; p += 2; }
        else { while (p < end && b[p] != 0) p++; p++; }
        if (p >= end) return "";
        java.nio.charset.Charset cs = enc == 0 ? StandardCharsets.ISO_8859_1
            : enc == 1 ? StandardCharsets.UTF_16 : enc == 2 ? StandardCharsets.UTF_16BE : StandardCharsets.UTF_8;
        return new String(b, p, end - p, cs).replace("\u0000", "").trim();
    }

    private static int synchsafe(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static int int32(byte[] b, int o) {
        return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff);
    }
}
