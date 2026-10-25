package expo.modules.pictureinpicture

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.animation.LinearInterpolator
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

// The current app's PiP window (components/workout/pip-view.tsx and the summary placeholder in
// workout-screen.tsx), drawn natively so it keeps updating while the activity is paused. Sizes and
// colours are the current app's: a black window, a 144 dp ring of radius 56 and stroke 9, a 32 dp
// bold mono clock, and 9 dp uppercase captions. Text is sized in dp, not sp: the current app's CSS
// pixels ignore the system font scale, and the fixed ring has no room for a larger clock.
// Preview bundles no Geist Mono, so the clock is the system mono face with tabular figures.
//
// The clocks are Chronometers on the elapsed-realtime base, so the platform counts them with no JS
// and no tick of ours. Each second the big clock's own tick asks `frameAt` for a fresh frame, which
// moves the ring and turns a rest over at its target (#3266).
class PipWindowView(context: Context, private val frameAt: (Long) -> PipFrame) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private fun dp(value: Float) = (value * density).toInt()

  private val ring = RingView(context)
  // tracking-widest (0.1 em) on the name; tracking-wide (0.025 em) inside the ring.
  private val name = caption(9f, FAINT, WIDEST)
  private val time = clock(32f, Color.WHITE).apply {
    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    // The second has ticked: redraw what depends on it.
    setOnChronometerTickListener {
      format(it)
      render()
    }
  }
  private val target = clock(9f, TARGET).apply {
    isAllCaps = true
    letterSpacing = WIDE
    maxLines = 1
  }
  private val gate = PipClockGate()
  private val timeClock = clockOf(time)
  private val targetClock = clockOf(target)
  private val label = caption(9f, FAINT, WIDE)
  private val load = text(14f, LOAD, bold = true).apply { fontFeatureSettings = "tnum" }
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
  // text-lg font-bold leading-snug, unclamped as on the web.
  private val doneName = text(18f, Color.WHITE, bold = true).apply { setLineSpacing(0f, 1.375f) }
  private val hint = caption(10f, HINT, WIDEST).apply { text = "Tap Next to continue" }
  private val placeholder = column(dp(8f)).apply {
    addView(caption(12f, DONE_TITLE, WIDEST).apply { text = "Done"; typeface = semibold() }, wrap())
    addView(doneName, wrap().apply { leftMargin = dp(24f); rightMargin = dp(24f) })
    addView(hint, wrap())
  }
  private var pulse: ValueAnimator? = null

  init {
    setBackgroundColor(Color.BLACK)
    isClickable = true
    addView(timer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(placeholder, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  /** Draws the workout as it is now. A render reached from a clock's tick inside one is skipped. */
  fun render() = gate.render { redraw() }

  private fun redraw() {
    val frame = frameAt(System.currentTimeMillis())
    if (frame !is PipFrame.Timer) {
      val shown = frame as PipFrame.Placeholder
      timer.visibility = GONE
      placeholder.visibility = VISIBLE
      doneName.text = shown.name
      doneName.visibility = if (shown.name.isEmpty()) GONE else VISIBLE
      hint.visibility = if (shown.hint) VISIBLE else GONE
      count(time, null)
      count(target, null)
      setPulse(false)
      return
    }
    placeholder.visibility = GONE
    timer.visibility = VISIBLE
    name.text = frame.name
    name.visibility = if (frame.name.isEmpty()) GONE else VISIBLE
    count(time, frame.countsFrom)
    time.setTextColor(if (frame.overTime) OVER else Color.WHITE)
    // Before the target the caption is the target itself; past it, the overrun counting up. The
    // caption is shown before its clock is counted: the gate starts a clock once, and a Chronometer
    // started while hidden doesn't run.
    target.visibility = if (frame.target == null) GONE else VISIBLE
    count(target, frame.overFrom)
    if (frame.overFrom == null) target.text = frame.target ?: ""
    target.setTextColor(if (frame.overTime) OVER else TARGET)
    label.text = frame.label
    // No load is known: the line stays empty rather than showing a made-up one.
    load.text = frame.load ?: ""
    load.visibility = if (!frame.rest && frame.load != null) VISIBLE else GONE
    ring.fraction = frame.fraction
    ring.color = when {
      !frame.rest -> frame.setColor?.let(Color::parseColor) ?: REST
      frame.overTime -> OVER
      else -> REST
    }
    ring.invalidate()
    setPulse(!frame.rest)
  }

  /** Counts `view` up from `fromMs`, or stops it; PipClockGate keeps either from re-entering. */
  private fun count(view: Chronometer, fromMs: Long?) {
    val clock = if (view === time) timeClock else targetClock
    if (fromMs == null) {
      gate.count(clock, null)
      // Nothing to count from stands at 0:00; the caption's own text is set by render.
      view.text = if (view === target) "" else "0:00"
      return
    }
    val base = PipPresenter.elapsedBase(fromMs, System.currentTimeMillis(), SystemClock.elapsedRealtime())
    // setBase writes the platform's "00:48" after its tick; put the window's own format back.
    if (gate.count(clock, base)) format(view)
  }

  private fun clockOf(view: Chronometer) = object : PipClock {
    override fun start() = view.start()
    override fun stop() = view.stop()
    override fun setBase(base: Long) {
      view.base = base
    }
  }

  private fun format(view: Chronometer) {
    val seconds = (SystemClock.elapsedRealtime() - view.base) / 1000
    view.text = (if (view === target) "+" else "") + PipPresenter.formatTime(seconds)
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
      interpolator = LinearInterpolator()
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

  private fun text(size: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    setTextColor(color)
    gravity = Gravity.CENTER
    includeFontPadding = false
    if (bold) setTypeface(typeface, Typeface.BOLD)
  }

  // A Chronometer formats as "00:48"; the window reads "0:48", as the current app's formatTime.
  private fun clock(size: Float, color: Int) = Chronometer(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    setTextColor(color)
    gravity = Gravity.CENTER
    includeFontPadding = false
    text = "0:00"
    setOnChronometerTickListener { format(it) }
  }

  private fun caption(size: Float, color: Int, tracking: Float) = text(size, color).apply {
    isAllCaps = true
    letterSpacing = tracking
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

  // font-semibold is weight 600, which Android can name only from API 28.
  private fun semibold(): Typeface =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(Typeface.DEFAULT, 600, false)
    else Typeface.create("sans-serif-medium", Typeface.NORMAL)

  companion object {
    private const val SIZE = 144f
    private const val WIDEST = 0.1f
    private const val WIDE = 0.025f
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
