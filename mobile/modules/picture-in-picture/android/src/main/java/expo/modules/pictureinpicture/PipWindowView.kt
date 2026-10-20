package expo.modules.pictureinpicture

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

// The current app's PiP window (components/workout/pip-view.tsx and the summary placeholder in
// workout-screen.tsx), drawn natively so it keeps updating while the activity is paused. Sizes and
// colours are the current app's: a black window, a 144 dp ring of radius 56 and stroke 9, a 32 sp
// bold mono clock, and 9 sp uppercase captions tracked at 0.1 em.
class PipWindowView(context: Context) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private fun dp(value: Float) = (value * density).toInt()

  private val ring = RingView(context)
  private val name = caption(9f, FAINT)
  private val time = text(32f, Color.WHITE, bold = true).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD) }
  private val target = caption(9f, TARGET)
  private val label = caption(9f, FAINT)
  private val load = text(14f, LOAD, bold = true)
  private val timer = column(dp(4f)).apply {
    addView(name, wrap().apply { leftMargin = dp(12f); rightMargin = dp(12f) })
    addView(
      FrameLayout(context).apply {
        addView(ring, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(
          column(0).apply {
            addView(time, wrap())
            addView(target, wrap().apply { topMargin = dp(2f) })
            addView(label, wrap().apply { topMargin = dp(2f) })
          },
          LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
      },
      LinearLayout.LayoutParams(dp(SIZE), dp(SIZE)),
    )
    addView(load, wrap())
  }
  private val doneName = text(18f, Color.WHITE, bold = true).apply {
    setLineSpacing(0f, 1.375f)
    maxLines = 3
  }
  private val placeholder = column(dp(8f)).apply {
    addView(caption(12f, DONE_TITLE).apply { text = "Done"; setTypeface(typeface, Typeface.BOLD) }, wrap())
    addView(doneName, wrap().apply { leftMargin = dp(24f); rightMargin = dp(24f) })
    addView(caption(10f, HINT).apply { text = "Tap Next to continue" }, wrap())
  }
  private var pulse: ValueAnimator? = null

  init {
    setBackgroundColor(Color.BLACK)
    isClickable = true
    addView(timer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(placeholder, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun render(window: PipWindow?, nowMs: Long) {
    if (window == null || window.kind == "placeholder") {
      timer.visibility = GONE
      placeholder.visibility = if (window == null) GONE else VISIBLE
      doneName.text = window?.exerciseName ?: ""
      setPulse(false)
      return
    }
    placeholder.visibility = GONE
    timer.visibility = VISIBLE
    val clock = PipState.clock(window, nowMs)
    name.text = window.exerciseName
    name.visibility = if (window.exerciseName.isEmpty()) GONE else VISIBLE
    time.text = PipState.formatTime(clock.seconds)
    time.setTextColor(if (clock.overTime) OVER else Color.WHITE)
    target.text = clock.target ?: ""
    target.visibility = if (clock.target == null) GONE else VISIBLE
    target.setTextColor(if (clock.overTime) OVER else TARGET)
    label.text = clock.label
    load.text = window.load ?: ""
    load.visibility = if (window.phase == "set" && window.load != null) VISIBLE else GONE
    ring.fraction = clock.fraction
    ring.color = when {
      window.phase != "rest" -> window.setColor?.let(Color::parseColor) ?: REST
      clock.overTime -> OVER
      else -> REST
    }
    ring.invalidate()
    setPulse(window.phase == "set")
  }

  override fun onDetachedFromWindow() {
    setPulse(false)
    super.onDetachedFromWindow()
  }

  // The set arc pulses 1 → 0.35 → 1 over 1.6 s, as the current app's <animate> on stroke-opacity.
  private fun setPulse(on: Boolean) {
    if (on == (pulse != null)) return
    pulse?.cancel()
    pulse = null
    ring.arcAlpha = 1f
    if (!on) return
    pulse = ValueAnimator.ofFloat(1f, 0.35f, 1f).apply {
      duration = 1_600
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener {
        ring.arcAlpha = it.animatedValue as Float
        ring.invalidate()
      }
      start()
    }
  }

  private fun column(gap: Int) = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    if (gap > 0) {
      dividerDrawable = android.graphics.drawable.ShapeDrawable().apply {
        intrinsicHeight = gap
        paint.color = Color.TRANSPARENT
      }
      showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE
    }
  }

  private fun wrap() = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.WRAP_CONTENT,
    LinearLayout.LayoutParams.WRAP_CONTENT,
  ).apply { gravity = Gravity.CENTER_HORIZONTAL }

  private fun text(sp: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
    setTextColor(color)
    gravity = Gravity.CENTER
    includeFontPadding = false
    if (bold) setTypeface(typeface, Typeface.BOLD)
  }

  private fun caption(sp: Float, color: Int) = text(sp, color).apply {
    isAllCaps = true
    letterSpacing = 0.1f
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  private inner class RingView(context: Context) : View(context) {
    var fraction = 0f
    var color = REST
    var arcAlpha = 1f
    private val stroke = 9f * density
    private val radius = 56f * density
    private val bounds = RectF()
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      color = TRACK
    }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      bounds.set(cx - radius, cy - radius, cx + radius, cy + radius)
      canvas.drawCircle(cx, cy, radius, track)
      if (fraction <= 0f) return
      arc.color = color
      arc.alpha = (arcAlpha * 255).toInt()
      canvas.drawArc(bounds, -90f, 360f * fraction, false, arc)
    }
  }

  companion object {
    private const val SIZE = 144f
    private val REST = Color.parseColor("#94a3b8")
    private val OVER = Color.parseColor("#f87171")
    private val TRACK = Color.parseColor("#12FFFFFF")
    private val FAINT = Color.parseColor("#59FFFFFF")
    private val TARGET = Color.parseColor("#66FFFFFF")
    private val LOAD = Color.parseColor("#CCFFFFFF")
    private val DONE_TITLE = Color.parseColor("#80FFFFFF")
    private val HINT = Color.parseColor("#4DFFFFFF")
  }
}
