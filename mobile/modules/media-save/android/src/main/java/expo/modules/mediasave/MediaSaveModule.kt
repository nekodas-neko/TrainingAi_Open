package expo.modules.mediasave

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.annotation.RequiresApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Saves an image into the gallery's Pictures/TrainingAI album (#3065). A port of the current
// app's android/.../media/MediaSavePlugin.kt: the same album, the same name sanitising, the same
// MediaStore insert. On Android 10+ the insert needs no storage permission, and IS_PENDING hides
// the half-written row until the bytes are in. Below 10 it reports unavailable rather than asking
// for WRITE_EXTERNAL_STORAGE, as the current app does.
class MediaSaveModule : Module() {
  private val albumDir = "TrainingAI"

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "The app context is not available." }

  override fun definition() = ModuleDefinition {
    Name("MediaSave")

    Function("isAvailable") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    // `base64` is the raw payload with no data: prefix. Resolves with the content URI; rejects
    // with the real reason, because the caller shows it.
    AsyncFunction("saveImage") { base64: String, filename: String, mimeType: String ->
      if (base64.isEmpty()) throw IllegalArgumentException("base64 required")
      val bytes = try {
        Base64.decode(base64, Base64.DEFAULT)
      } catch (e: IllegalArgumentException) {
        throw IllegalArgumentException("base64 is not decodable: ${e.message}")
      }
      if (bytes.isEmpty()) throw IllegalArgumentException("base64 decoded to nothing")
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        throw IllegalStateException("saving to the gallery needs Android 10 or newer")
      }
      insertViaMediaStore(bytes, sanitiseFilename(filename), mimeType.ifEmpty { "image/png" }).toString()
    }
  }

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
      // A pending row with no bytes would sit in the collection forever, invisible and undeletable.
      resolver.delete(uri, null, null)
      throw e
    }
    resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    return uri
  }

  // A display name, not a path: a `/` would place the file outside the album.
  private fun sanitiseFilename(raw: String): String {
    val cleaned = raw.replace(Regex("""[^A-Za-z0-9._ -]"""), "").trim().take(120)
    return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "label.png" else cleaned
  }
}
