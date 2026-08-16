package com.trainingai.app.oura

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OuraAuthTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun encryptsNonceToKnownVector() {
        val key = OuraAuth.parseKeyHex("000102030405060708090a0b0c0d0e0f")!!
        val nonce = ByteArray(15) { it.toByte() }
        val out = OuraAuth.encryptNonce(key, nonce)
        assertEquals(16, out.size)
        assertEquals("b61e6af8da7260d2214369b951bf8963", hex(out))
    }

    @Test fun differentKeyDifferentCiphertext() {
        val key = OuraAuth.parseKeyHex("ffeeddccbbaa99887766554433221100")!!
        val nonce = ByteArray(15) { it.toByte() }
        assertEquals("4a5972df95370770e136fd68179510d1", hex(OuraAuth.encryptNonce(key, nonce)))
    }

    @Test fun parseKeyHexRejectsBadInput() {
        assertNull(OuraAuth.parseKeyHex("zz"))
        assertNull(OuraAuth.parseKeyHex("00010203"))                       // too short
        assertNull(OuraAuth.parseKeyHex("000102030405060708090a0b0c0d0e0f00")) // too long
        assertEquals(16, OuraAuth.parseKeyHex("  000102030405060708090A0B0C0D0E0F ")!!.size) // trims + case-insensitive
    }
}
