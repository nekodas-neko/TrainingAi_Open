package com.trainingai.app

import java.net.URI

/**
 * Where the native BLE services may be told to post device frames (RV-196).
 *
 * `setIngestUrl` is exposed to the WebView on three plugins (Oura, scale, Polar). It accepted any
 * absolute URL, persisted it, and made the foreground service post raw frames there — and the
 * persistence means a redirect survives restarts. Every caller is app JavaScript, so the CSP was
 * the only boundary, and the CSP allows `'unsafe-inline'`. Any script executing in the origin
 * could therefore silently point the ring's upload at a host of its choosing.
 *
 * This is the allowlist the entry asks for. It is a pure object with no Android dependency
 * precisely so the decision can be unit-tested on the JVM, which is the only verification
 * available before an APK exists.
 *
 * **Loopback is allowed deliberately.** A loopback target cannot move data off the device, so
 * permitting it does not weaken the property this exists to protect, and the emulator and local
 * harnesses need it. `10.0.2.2` is the emulator's route to its host.
 */
object IngestUrlPolicy {
    /** The origin the APK's WebView is served from — `capacitor.config.ts` `server.url`. */
    const val APP_ORIGIN: String = "https://trainingai-production.up.railway.app"

    private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")

    /** Trim and drop a trailing slash, or null when there is nothing usable. */
    fun normalize(raw: String?): String? {
        val trimmed = raw?.trim()?.trimEnd('/').orEmpty()
        return trimmed.ifEmpty { null }
    }

    fun isAllowed(raw: String?): Boolean {
        val url = normalize(raw) ?: return false
        val uri = try { URI(url) } catch (_: Exception) { return false }

        // `https://app-origin@evil.example.com/` has host `evil.example.com`, which is why this
        // parses rather than matching a prefix — and why userinfo is refused outright rather than
        // ignored, since its only use here would be to make a hostile URL read as the app's.
        if (uri.userInfo != null) return false

        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false

        if (host in LOOPBACK_HOSTS) return scheme == "http" || scheme == "https"
        if (scheme != "https") return false
        return host == URI(APP_ORIGIN).host.lowercase()
    }
}
