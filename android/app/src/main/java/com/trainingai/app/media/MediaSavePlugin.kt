package com.trainingai.app.media

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Save an image into the device gallery (Q-400).
 *
 * The web paths cannot do this on the canonical runtime. `navigator.canShare({ files })` is
 * narrower than share-with-text and is not reliably available in the Samsung WebView, and the
 * `<a download>` fallback is a silent no-op there — no file, no error. So the label sheet's one
 * button did nothing on the APK for a full release while working in `pnpm dev`.
 *
 * **Writing the file is not the hard part; being visible is.** A file written into app storage,
 * or even into `Pictures/`, is invisible to the Photos app until it is registered with MediaStore.
 * Writing to `Directory.Documents` with `@capacitor/filesystem` and hoping is the trap here, which
 * is why this is a bridge rather than a plugin dependency.
 *
 * On API 29+ the insert itself creates the file inside the collection, so **no storage permission is
 * needed at all** — `IS_PENDING` hides the half-written row from other apps until the stream closes.
 *
 * **Below 29 this reports unavailable rather than falling back**, and that is deliberate. The legacy
 * route needs `WRITE_EXTERNAL_STORAGE`, a runtime grant, and a permission prompt written for a tier
 * that does not exist here — the supported device is API 35. `isAvailable()` says so, and the JS
 * turns that into a stated failure. What it must never do is silently take the `<a download>`
 * branch and toast success: inside the WebView that is a no-op, and a button that lies is worse
 * than the dead one Q-400 started from.
 */
@CapacitorPlugin(name = "MediaSave")
class MediaSavePlugin : Plugin() {

    /** Subdirectory under the gallery's Pictures collection. Shown as an album by the Photos app. */
    private val albumDir = "TrainingAI"

    /**
     * `saveImage({ base64, filename, mimeType })` → `{ uri }`.
     *
     * `base64` is the raw payload with no `data:` prefix — the caller strips it, so this never has
     * to guess at a MIME type it was also handed.
     */
    @PluginMethod
    fun saveImage(call: PluginCall) {
        val base64 = call.getString("base64")
        if (base64.isNullOrEmpty()) return call.reject("base64 required")
        val filename = sanitiseFilename(call.getString("filename") ?: "image.png")
        val mimeType = call.getString("mimeType") ?: "image/png"

        val bytes = try {
            android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            return call.reject("base64 is not decodable: ${e.message}")
        }
        if (bytes.isEmpty()) return call.reject("base64 decoded to nothing")

        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                return call.reject("saving to the gallery needs Android 10 or newer")
            }
            call.resolve(JSObject().put("uri", insertViaMediaStore(bytes, filename, mimeType).toString()))
        } catch (e: Exception) {
            // Rejecting with the real reason on purpose: every branch of the JS caller ends in a
            // toast, and "could not save" with nothing behind it is what made this invisible.
            call.reject("save failed: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /** `true` when a save is possible at all, so the JS can choose its path before drawing. */
    @PluginMethod
    fun isAvailable(call: PluginCall) =
        call.resolve(JSObject().put("available", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q))

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun insertViaMediaStore(bytes: ByteArray, filename: String, mimeType: String): Uri {
        val resolver = context.contentResolver
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, filename)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType)
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$albumDir")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection, values) ?: error("MediaStore refused the insert")
        try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no output stream for $uri")
        } catch (e: Exception) {
            // A pending row with no bytes behind it would sit in the collection forever, invisible
            // to the gallery and undeletable from the UI.
            resolver.delete(uri, null, null)
            throw e
        }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        return uri
    }

    /**
     * A display name, not a path. A `/` here would place the file outside the album (or fail), and
     * MediaStore takes the name from the caller verbatim.
     */
    private fun sanitiseFilename(raw: String): String {
        val cleaned = raw.replace(Regex("""[^A-Za-z0-9._ -]"""), "").trim().take(120)
        return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "label.png" else cleaned
    }
}
