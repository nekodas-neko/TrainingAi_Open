package expo.modules.restbeep

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

// The rest-end beep for when no notification will sound (#3084). It is the current app's tone
// (components/workout/beep.ts): an 880 Hz sine whose gain ramps exponentially from 0.4 to 0.001
// over 400 ms. Synthesised here rather than played through an audio library, which would bring a
// whole media player into the APK for one short tone.
//
// USAGE_MEDIA and no audio-focus request, as the WebView's Web Audio beep has: music keeps playing,
// and media volume, not the ringer switch, decides whether it is heard.
class RestBeepModule : Module() {
  private val rate = 44100
  private val seconds = 0.4
  private val frequency = 880.0
  private val startGain = 0.4
  private val endGain = 0.001
  private var track: AudioTrack? = null

  override fun definition() = ModuleDefinition {
    Name("RestBeep")

    // Never throws: a missing beep must never break the timer that asked for it.
    Function("play") {
      try {
        val beep = track ?: build().also { track = it }
        if (beep.playState == AudioTrack.PLAYSTATE_PLAYING) beep.stop()
        beep.reloadStaticData()
        beep.play()
      } catch (e: Exception) {
        track?.release()
        track = null
      }
    }

    OnDestroy {
      track?.release()
      track = null
    }
  }

  private fun build(): AudioTrack {
    val samples = (rate * seconds).toInt()
    val pcm = ShortArray(samples) { i ->
      val t = i.toDouble() / rate
      val gain = startGain * (endGain / startGain).pow(t / seconds)
      (sin(2 * PI * frequency * t) * gain * Short.MAX_VALUE).toInt().toShort()
    }
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(rate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(samples * 2)
      .setTransferMode(AudioTrack.MODE_STATIC)
      .build()
    track.write(pcm, 0, samples)
    return track
  }
}
