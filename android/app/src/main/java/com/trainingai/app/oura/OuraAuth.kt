package com.trainingai.app.oura

import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/** Per-connection ring auth crypto (skill §4): the ring sends a 15-byte nonce;
 *  we return it encrypted with our 16-byte key using AES/ECB/PKCS5Padding
 *  (15 bytes pad to exactly one 16-byte block). */
object OuraAuth {
    fun encryptNonce(key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == 16) { "key must be 16 bytes" }
        require(nonce.size == 15) { "nonce must be 15 bytes" }
        val cipher = Cipher.getInstance("AES/ECB/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
        return cipher.doFinal(nonce)
    }

    /** 32 hex chars → 16 bytes (the open_oura key.hex format); null if malformed. */
    fun parseKeyHex(hex: String): ByteArray? {
        val clean = hex.trim().lowercase()
        if (!Regex("^[0-9a-f]{32}$").matches(clean)) return null
        return ByteArray(16) { clean.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}
