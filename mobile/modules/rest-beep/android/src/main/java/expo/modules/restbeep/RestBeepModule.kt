package expo.modules.restbeep

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
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
// It is also the rest-end cue in picture-in-picture (#3110), where React Native pauses JS timers:
// JS arms it when a rest starts, and at the deadline it beeps and buzzes only if the activity is
// in picture-in-picture. On screen the JS cue does it, and in the background the notification.
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
  private val main = Handler(Looper.getMainLooper())
  private var armed: Runnable? = null
  // A deadline missed by more than this (the device slept through it) is not cued late.
  private val graceMs = 5_000L

  override fun definition() = ModuleDefinition {
    Name("RestBeep")

    // Never throws: a missing beep must never break the timer that asked for it.
    Function("play") { play() }

    Function("schedule") { atEpochMs: Double ->
      main.post { arm(atEpochMs.toLong()) }
    }

    Function("cancel") {
      main.post { disarm() }
    }

    Function("isInPictureInPicture") { inPictureInPicture() }

    OnDestroy {
      main.post {
        disarm()
        track?.release()
        track = null
      }
    }
  }

  private fun arm(atEpochMs: Long) {
    disarm()
    val fire = Runnable {
      armed = null
      val late = System.currentTimeMillis() - atEpochMs
      if (late in 0..graceMs && inPictureInPicture()) {
        play()
        buzz()
      }
    }
    armed = fire
    main.postDelayed(fire, (atEpochMs - System.currentTimeMillis()).coerceAtLeast(0))
  }

  private fun disarm() {
    armed?.let { main.removeCallbacks(it) }
    armed = null
  }

  private fun inPictureInPicture(): Boolean =
    try {
      appContext.currentActivity?.isInPictureInPictureMode == true
    } catch (e: Exception) {
      false
    }

  // The same Confirm haptic the JS cue asks expo-haptics for.
  private fun buzz() {
    try {
      val view = appContext.currentActivity?.window?.decorView ?: return
      val effect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
        else HapticFeedbackConstants.LONG_PRESS
      view.performHapticFeedback(effect)
    } catch (e: Exception) {}
  }

  private fun play() {
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
