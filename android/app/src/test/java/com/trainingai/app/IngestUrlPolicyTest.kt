package com.trainingai.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RV-196 — `setIngestUrl` accepted any absolute URL, so a script in the origin could redirect the
 * ring's raw frames to a host of its choosing, persistently. These pin the allowlist.
 */
class IngestUrlPolicyTest {

    @Test fun `accepts the app's own origin`() {
        assertTrue(IngestUrlPolicy.isAllowed(IngestUrlPolicy.APP_ORIGIN))
        assertTrue(IngestUrlPolicy.isAllowed("${IngestUrlPolicy.APP_ORIGIN}/"))
        assertTrue(IngestUrlPolicy.isAllowed("  ${IngestUrlPolicy.APP_ORIGIN}  "))
    }

    @Test fun `rejects an arbitrary host, which is the whole point`() {
        assertFalse(IngestUrlPolicy.isAllowed("https://evil.example.com"))
        assertFalse(IngestUrlPolicy.isAllowed("https://evil.example.com/api/oura-ble/samples"))
    }

    @Test fun `rejects a host that merely starts with the app origin`() {
        // The old guard was `startsWith("http")`; a prefix check against the origin would be the
        // natural replacement and is also wrong.
        assertFalse(IngestUrlPolicy.isAllowed("https://trainingai-production.up.railway.app.evil.com"))
    }

    @Test fun `rejects userinfo smuggling`() {
        // Parses to host `evil.example.com` — reads as the app's origin to a human and to a
        // prefix match, and is not.
        assertFalse(IngestUrlPolicy.isAllowed("https://trainingai-production.up.railway.app@evil.example.com"))
    }

    @Test fun `rejects plaintext to the app host`() {
        assertFalse(IngestUrlPolicy.isAllowed("http://trainingai-production.up.railway.app"))
    }

    @Test fun `allows loopback, which cannot move data off the device`() {
        assertTrue(IngestUrlPolicy.isAllowed("http://localhost:3000"))
        assertTrue(IngestUrlPolicy.isAllowed("http://127.0.0.1:3000"))
        assertTrue(IngestUrlPolicy.isAllowed("http://10.0.2.2:3000"))
    }

    @Test fun `rejects non-http schemes and junk`() {
        assertFalse(IngestUrlPolicy.isAllowed("file:///data/data/com.trainingai.app"))
        assertFalse(IngestUrlPolicy.isAllowed("javascript:alert(1)"))
        assertFalse(IngestUrlPolicy.isAllowed("not a url"))
        assertFalse(IngestUrlPolicy.isAllowed("/api/oura-ble/samples"))
    }

    @Test fun `rejects nothing-at-all rather than defaulting`() {
        assertFalse(IngestUrlPolicy.isAllowed(null))
        assertFalse(IngestUrlPolicy.isAllowed(""))
        assertFalse(IngestUrlPolicy.isAllowed("   "))
    }

    @Test fun `normalize trims and drops one trailing slash`() {
        assertEquals("https://a.example.com", IngestUrlPolicy.normalize("  https://a.example.com/ "))
        assertEquals(null, IngestUrlPolicy.normalize(null))
        assertEquals(null, IngestUrlPolicy.normalize("  "))
    }
}
