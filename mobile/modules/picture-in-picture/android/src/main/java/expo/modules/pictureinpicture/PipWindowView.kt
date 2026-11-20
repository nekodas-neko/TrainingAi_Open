package expo.modules.pictureinpicture

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

// The workout's picture-in-picture window (#3734, option A): one 3:4 card in every state, drawn
// natively so it keeps updating while the activity is paused. A band in the state's colour holds a
// clock that always counts; below it the same four facts sit in the same place on every card: the
// exercise, where it is in the session, the load, and the set segments, with heart rate in the
// footer. What each state shows is PipPresenter.present (PipState.kt), tested on the JVM.
//
// Sizes are the build spec's, in dp, not sp: the window is a fixed layout with no room for a larger
// font scale. Nothing is under 9 dp. Preview bundles no Geist Mono, so the clock and the load are
// the system mono face with tabular figures.
//
// The clock is a Chronometer on the elapsed-realtime base, so the platform counts it with no JS and
// no tick of ours. Each second its tick asks `frameAt` for a fresh frame, which drains the bar and
// turns a rest over at its target. It goes through PipClockGate: started once, its base set only
// when it moves, and a render reached from inside a render is skipped (#3315).
class PipWindowView(context: Context, private val frameAt: (Long) -> PipFrame) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private fun dp(value: Float) = (value * density).toInt()

  // The rest's length, read by the clock's own tick to count down. Null counts up.
  private var targetSec: Long? = null

  private val gate = PipClockGate()
  private val clockView = Chronometer(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 32f)
    setTextColor(TEXT)
    gravity = Gravity.START
    includeFontPadding = false
    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    text = "0:00"
    // A Chronometer formats as "00:48"; the card reads "0:48". Each tick formats it and renders the
    // card, which the gate skips when the tick came from inside a render.
    setOnChronometerTickListener {
      format(it)
      render()
    }
  }
  private val clock = object : PipClock {
    override fun start() = clockView.start()
    override fun stop() = clockView.stop()
    override fun setBase(base: Long) {
      clockView.base = base
    }
  }

  // ---- The band.
  private val stateWord = text(9f, MUTED, bold = true).apply {
    isAllCaps = true
    letterSpacing = 0.08f
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }
  private val setLine = text(9f, MUTED).apply { maxLines = 1 }
  private val clockLabel = text(10f, MUTED).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
  private val bar = BarView(context)
  private val bandFill = GradientDrawable()
  private val bandLine = View(context)
  private val band = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(10f), dp(8f), dp(10f), dp(8f))
    background = bandFill
    addView(
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(stateWord, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(setLine, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(4f) })
      },
      LinearLayout.LayoutParams(MATCH, WRAP),
    )
    addView(clockView, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(3f) })
    addView(clockLabel, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(2f) })
    addView(bar, LinearLayout.LayoutParams(MATCH, dp(3f)).apply { topMargin = dp(6f) })
  }

  // ---- The body: the same four facts in the same place on every card.
  private val name = text(13f, TEXT).apply {
    typeface = semibold()
    maxLines = 2
    ellipsize = TextUtils.TruncateAt.END
    setLineSpacing(0f, 1.1f)
  }
  private val where = text(10f, MUTED).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
  private val load = text(18f, TEXT, bold = true, mono = true).apply { maxLines = 1 }
  private val loadLabel = text(10f, MUTED).apply { maxLines = 1 }
  private val segments = SegmentsView(context)
  private val heartDot = DotView(context)
  private val heart = text(11f, MUTED).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
  private val footer = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    addView(heartDot, LinearLayout.LayoutParams(dp(6f), dp(6f)).apply { rightMargin = dp(5f) })
    addView(heart, LinearLayout.LayoutParams(0, WRAP, 1f))
  }
  private val body = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(10f), dp(8f), dp(10f), dp(8f))
    addView(name, LinearLayout.LayoutParams(MATCH, WRAP))
    addView(where, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(2f) })
    addView(
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.BOTTOM
        addView(load, LinearLayout.LayoutParams(WRAP, WRAP))
        addView(loadLabel, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(5f); bottomMargin = dp(2f) })
      },
      LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(6f) },
    )
    addView(segments, LinearLayout.LayoutParams(MATCH, dp(5f)).apply { topMargin = dp(6f) })
    addView(View(context), LinearLayout.LayoutParams(MATCH, 0, 1f))
    addView(footer, LinearLayout.LayoutParams(MATCH, WRAP))
  }
  private val cardPane = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    addView(band, LinearLayout.LayoutParams(MATCH, WRAP))
    addView(bandLine, LinearLayout.LayoutParams(MATCH, maxOf(1, dp(1f))))
    addView(body, LinearLayout.LayoutParams(MATCH, 0, 1f))
  }

  // ---- The warm-up, the review and no data yet: a card with the name, never a blank window.
  private val placeholderEyebrow = text(10f, DONE_TITLE, bold = true).apply { isAllCaps = true; letterSpacing = 0.08f; gravity = Gravity.CENTER }
  private val placeholderName = text(16f, TEXT, bold = true).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.2f) }
  private val hint = text(10f, HINT).apply { gravity = Gravity.CENTER; text = "Tap Next to continue" }
  private val placeholderPane = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    addView(placeholderEyebrow, centred())
    addView(placeholderName, centred().apply { topMargin = dp(6f); leftMargin = dp(16f); rightMargin = dp(16f) })
    addView(hint, centred().apply { topMargin = dp(6f) })
  }

  private val ground = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(GROUND_TOP, GROUND_BOTTOM))
  private var pulse: ValueAnimator? = null

  init {
    background = ground
    isClickable = true
    addView(cardPane, LayoutParams(MATCH, MATCH))
    addView(placeholderPane, LayoutParams(MATCH, MATCH))
  }

  /** Draws the workout as it is now. A render reached from a clock's tick inside one is skipped. */
  fun render() = gate.render { redraw() }

  private fun redraw() {
    val frame = frameAt(System.currentTimeMillis())
    // The pane is shown before its clock is counted: the gate starts a clock once, and a
    // Chronometer started while it is not shown doesn't run (#3315).
    cardPane.visibility = if (frame is PipFrame.Card) VISIBLE else GONE
    placeholderPane.visibility = if (frame is PipFrame.Placeholder) VISIBLE else GONE
    when (frame) {
      is PipFrame.Card -> drawCard(frame)
      is PipFrame.Placeholder -> drawPlaceholder(frame)
    }
  }

  private fun drawCard(frame: PipFrame.Card) {
    val color = parse(frame.color) ?: Color.parseColor(PipPresenter.DEFAULT_ACCENT)
    // The ground is near-black with a breath of the state's colour; the edge a 1 px line of it.
    ground.setColors(intArrayOf(mix(GROUND_TOP, color, 0.06f), GROUND_BOTTOM))
    ground.setStroke(maxOf(1, dp(1f)), withAlpha(color, 0.22f))
    bandFill.setColor(withAlpha(color, 0.16f))
    bandLine.setBackgroundColor(withAlpha(color, 0.35f))
    stateWord.text = frame.stateWord
    stateWord.setTextColor(color)
    setLine.text = frame.setLine
    setLine.visibility = if (frame.setLine.isEmpty()) GONE else VISIBLE
    clockLabel.text = frame.clockLabel
    bar.visibility = if (frame.bar == null) GONE else VISIBLE
    bar.fraction = frame.bar ?: 0f
    bar.color = color
    bar.invalidate()

    name.text = frame.name
    where.text = frame.where
    where.visibility = if (frame.where.isEmpty()) GONE else VISIBLE
    // No load is known: the line stays empty rather than showing a made-up one.
    load.text = frame.load ?: ""
    load.visibility = if (frame.load == null) GONE else VISIBLE
    loadLabel.text = frame.loadLabel ?: ""
    loadLabel.visibility = if (frame.loadLabel == null || frame.load == null) GONE else VISIBLE
    segments.set(frame.sets, frame.setsDone, frame.current, frame.setColors, color)
    bindHeart(frame.hr)

    targetSec = frame.targetSec
    count(frame.countsFrom)
    setPulse(frame.pulse)
  }

  private fun drawPlaceholder(frame: PipFrame.Placeholder) {
    val next = frame.nextUp
    ground.setColors(intArrayOf(GROUND_TOP, GROUND_BOTTOM))
    ground.setStroke(maxOf(1, dp(1f)), EDGE)
    placeholderEyebrow.text = if (next != null) "Next up" else "Done"
    placeholderEyebrow.setTextColor(if (next != null) Color.parseColor(PipPresenter.DEFAULT_ACCENT) else DONE_TITLE)
    val shown = next ?: frame.name
    placeholderName.text = shown
    placeholderName.visibility = if (shown.isEmpty()) GONE else VISIBLE
    hint.visibility = if (frame.hint) VISIBLE else GONE
    targetSec = null
    count(null)
    setPulse(false)
  }

  // A zone-coloured dot, the heart rate and the zone word; "Strap: no reading" once the reading is
  // too old; nothing with no strap.
  private fun bindHeart(hr: PipHeartView?) {
    if (hr == null) {
      footer.visibility = GONE
      return
    }
    footer.visibility = VISIBLE
    val zone = hr.zoneColor?.let { parse(it) }
    if (hr.bpm == null) {
      heart.text = "Strap: no reading"
      heartDot.visibility = GONE
      return
    }
    heartDot.visibility = VISIBLE
    heartDot.color = zone ?: MUTED
    heartDot.invalidate()
    heart.text = listOfNotNull("${hr.bpm} bpm", hr.zoneName).joinToString(" · ")
  }

  /** Counts the clock from `fromMs`, or stops it; PipClockGate keeps either from re-entering. */
  private fun count(fromMs: Long?) {
    if (fromMs == null) {
      gate.count(clock, null)
      clockView.text = PipPresenter.restClockText(0, targetSec)
      return
    }
    val base = PipPresenter.elapsedBase(fromMs, System.currentTimeMillis(), SystemClock.elapsedRealtime())
    gate.count(clock, base)
    // setBase writes the platform's "00:48" after its tick, and a new state may count to a new
    // target from the same start: put the card's own format back either way.
    format(clockView)
  }

  private fun format(view: Chronometer) {
    val seconds = maxOf(0L, (SystemClock.elapsedRealtime() - view.base) / 1000)
    view.text = PipPresenter.restClockText(seconds, targetSec)
  }

  override fun onDetachedFromWindow() {
    setPulse(false)
    super.onDetachedFromWindow()
  }

  // The running set's segment pulses 1 → 0.35 → 1 over 1.6 s, as the dot did before.
  private fun setPulse(on: Boolean) {
    if (on == (pulse != null)) return
    pulse?.cancel()
    pulse = null
    segments.pulseAlpha = 1f
    segments.invalidate()
    if (!on) return
    pulse = ValueAnimator.ofFloat(1f, 0.35f, 1f).apply {
      duration = 1_600
      interpolator = LinearInterpolator()
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener {
        segments.pulseAlpha = it.animatedValue as Float
        segments.invalidate()
      }
      start()
    }
  }

  private fun centred() = LinearLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL }

  private fun text(size: Float, color: Int, bold: Boolean = false, mono: Boolean = false) = TextView(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    setTextColor(color)
    includeFontPadding = false
    if (mono) {
      typeface = Typeface.create(Typeface.MONOSPACE, if (bold) Typeface.BOLD else Typeface.NORMAL)
      fontFeatureSettings = "tnum"
    } else if (bold) {
      setTypeface(typeface, Typeface.BOLD)
    }
  }

  /** The rest bar: what is left of the rest, drawn from the left over a dim track. */
  private inner class BarView(context: Context) : View(context) {
    var fraction = 0f
    var color = Color.WHITE
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()

    override fun onDraw(canvas: Canvas) {
      val radius = height / 2f
      paint.color = TRACK
      rect.set(0f, 0f, width.toFloat(), height.toFloat())
      canvas.drawRoundRect(rect, radius, radius, paint)
      val shown = fraction.coerceIn(0f, 1f)
      if (shown <= 0f) return
      paint.color = color
      rect.set(0f, 0f, width * shown, height.toFloat())
      canvas.drawRoundRect(rect, radius, radius, paint)
    }
  }

  /**
   * One 5 dp bar per set: done sets in their set colours, the current or next one in the state's
   * colour (pulsing while it runs), the rest dim.
   */
  private inner class SegmentsView(context: Context) : View(context) {
    var pulseAlpha = 1f
    private var sets = 0
    private var done = 0
    private var current: Int? = null
    private var colors: List<String> = emptyList()
    private var stateColor = Color.WHITE
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()

    fun set(sets: Int, done: Int, current: Int?, colors: List<String>, stateColor: Int) {
      this.sets = sets
      this.done = done
      this.current = current
      this.colors = colors
      this.stateColor = stateColor
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val count = minOf(sets, MAX_SEGMENTS)
      if (count <= 0) return
      val gap = 3f * density
      val each = (width - gap * (count - 1)) / count
      val radius = height / 2f
      for (index in 0 until count) {
        paint.color = when {
          index == current -> stateColor
          index < done -> parse(colors.getOrNull(index)) ?: stateColor
          else -> SEGMENT_OFF
        }
        if (index == current) paint.alpha = (pulseAlpha * 255).toInt()
        val left = index * (each + gap)
        rect.set(left, 0f, left + each, height.toFloat())
        canvas.drawRoundRect(rect, radius, radius, paint)
      }
    }
  }

  /** The heart rate's zone-coloured dot. */
  private inner class DotView(context: Context) : View(context) {
    var color = MUTED
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
      paint.color = color
      canvas.drawCircle(width / 2f, height / 2f, minOf(width, height) / 2f, paint)
    }
  }

  // font-semibold is weight 600, which Android can name only from API 28.
  private fun semibold(): Typeface =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(Typeface.DEFAULT, 600, false)
    else Typeface.create("sans-serif-medium", Typeface.NORMAL)

  companion object {
    private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    private const val MAX_SEGMENTS = 12
    // The build spec's ground, text and muted text.
    private val GROUND_TOP = Color.parseColor("#121C20")
    private val GROUND_BOTTOM = Color.parseColor("#0B1215")
    private val TEXT = Color.parseColor("#EEF4F6")
    private val MUTED = Color.parseColor("#94A4AB")
    private val EDGE = Color.parseColor("#1FFFFFFF")
    private val TRACK = Color.parseColor("#1AFFFFFF")
    private val SEGMENT_OFF = Color.parseColor("#26FFFFFF")
    private val DONE_TITLE = Color.parseColor("#80FFFFFF")
    private val HINT = Color.parseColor("#66FFFFFF")

    private fun parse(value: String?): Int? = value?.let { runCatching { Color.parseColor(it) }.getOrNull() }

    private fun withAlpha(color: Int, alpha: Float): Int =
      Color.argb((alpha * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    private fun mix(base: Int, tint: Int, amount: Float): Int = Color.rgb(
      (Color.red(base) + (Color.red(tint) - Color.red(base)) * amount).toInt(),
      (Color.green(base) + (Color.green(tint) - Color.green(base)) * amount).toInt(),
      (Color.blue(base) + (Color.blue(tint) - Color.blue(base)) * amount).toInt(),
    )
  }
}
