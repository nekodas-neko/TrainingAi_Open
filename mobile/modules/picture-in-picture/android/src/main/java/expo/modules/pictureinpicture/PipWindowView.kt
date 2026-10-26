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
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.AbsoluteSizeSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.LinearInterpolator
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

// The workout's picture-in-picture window (#3266, option A, "the phase card"), drawn natively so it
// keeps updating while the activity is paused. It changes with the workout: a portrait card while
// lifting (the load, which set, heart rate), a square with a ring counting the rest down, and a
// held card while paused. Colours and sizes are the approved mockup's: a black window, 30-38 dp
// numbers, nothing under 9 dp. Text is sized in dp, not sp: the window is a fixed layout with no
// room for a larger font scale. Preview bundles no Geist Mono, so the clocks are the system mono
// face with tabular figures.
//
// The clocks are Chronometers on the elapsed-realtime base, so the platform counts them with no JS
// and no tick of ours. Each second the running clock's tick asks `frameAt` for a fresh frame, which
// moves the ring and turns a rest over at its target. Each clock goes through PipClockGate: it is
// started once, its base is set only when it moves, and a render reached from inside a render is
// skipped (#3315).
class PipWindowView(context: Context, private val frameAt: (Long) -> PipFrame) : FrameLayout(context) {
  private val density = resources.displayMetrics.density
  private fun dp(value: Float) = (value * density).toInt()

  // The rest's length, read by the rest clock's own tick to count down. Null counts up.
  private var restTargetSec: Long? = null

  private val gate = PipClockGate()
  private val setClockView = clock(15f, Color.WHITE)
  private val restClockView = clock(38f, Color.WHITE)
  private val pausedClockView = clock(34f, AMBER)
  private val setClock = clockOf(setClockView)
  private val restClock = clockOf(restClockView)
  private val pausedClock = clockOf(pausedClockView)

  // ---- Working: the portrait card.
  private val workName = caption(12f, MUTED, 0f).apply { typeface = semibold(); isAllCaps = false }
  private val weight = text(30f, Color.WHITE, bold = true, mono = true)
  private val unit = text(15f, Color.WHITE, bold = true, mono = true)
  private val reps = text(22f, MUTED, bold = true, mono = true)
  private val dots = DotsView(context)
  private val workHr = text(15f, MUTED, bold = true, mono = true)
  private val workingPane = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(12f), dp(12f), dp(12f), dp(12f))
    addView(workName, LinearLayout.LayoutParams(MATCH, WRAP))
    addView(
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.BOTTOM
        addView(weight, LinearLayout.LayoutParams(WRAP, WRAP))
        addView(unit, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(3f); bottomMargin = dp(3f) })
      },
      LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(8f) },
    )
    addView(reps, LinearLayout.LayoutParams(WRAP, WRAP))
    addView(dots, LinearLayout.LayoutParams(MATCH, dp(8f)).apply { topMargin = dp(8f) })
    addView(View(context), LinearLayout.LayoutParams(MATCH, 0, 1f))
    addView(
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.BOTTOM
        addView(setClockView, LinearLayout.LayoutParams(WRAP, WRAP))
        addView(View(context), LinearLayout.LayoutParams(0, 0, 1f))
        addView(workHr, LinearLayout.LayoutParams(WRAP, WRAP))
      },
      LinearLayout.LayoutParams(MATCH, WRAP),
    )
  }

  // ---- Resting: the square with its ring.
  private val ring = RingView(context)
  private val restEyebrow = caption(10f, MUTED, 0.08f).apply { typeface = semibold() }
  private val restLoad = text(12f, Color.WHITE, bold = false).apply { typeface = semibold() }
  private val restHr = text(13f, MUTED, bold = true, mono = true)
  private val restingPane = FrameLayout(context).apply {
    addView(ring, LayoutParams(MATCH, MATCH))
    addView(
      column().apply {
        addView(restEyebrow, wrap())
        addView(restClockView, wrap().apply { topMargin = dp(2f) })
        addView(restLoad, wrap().apply { topMargin = dp(2f) })
        addView(restHr, wrap().apply { topMargin = dp(2f) })
      },
      LayoutParams(MATCH, MATCH),
    )
  }

  // ---- Paused: how long, and what is held.
  private val pausedCaption = text(11f, MUTED, bold = false).apply { maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
  private val pausedPane = column().apply {
    addView(caption(10f, AMBER, 0.08f).apply { typeface = semibold(); text = "Paused" }, wrap())
    addView(pausedClockView, wrap().apply { topMargin = dp(4f) })
    addView(pausedCaption, wrap().apply { topMargin = dp(4f); leftMargin = dp(10f); rightMargin = dp(10f) })
  }
  // The amber frame around a paused window, drawn over the content.
  private val pausedFrame = View(context).apply {
    background = GradientDrawable().apply {
      setStroke(dp(2f), Color.parseColor("#88EFAF00"))
      setColor(Color.TRANSPARENT)
    }
  }

  // ---- Between exercises and done: a card with a hint, never a blank window.
  private val placeholderEyebrow = caption(10f, DONE_TITLE, 0.08f).apply { typeface = semibold() }
  private val placeholderName = text(16f, Color.WHITE, bold = true).apply { setLineSpacing(0f, 1.2f) }
  private val hint = caption(10f, HINT, 0.1f)
  private val placeholderPane = column().apply {
    addView(placeholderEyebrow, wrap())
    addView(placeholderName, wrap().apply { topMargin = dp(6f); leftMargin = dp(16f); rightMargin = dp(16f) })
    addView(hint.apply { text = "Tap Next to continue" }, wrap().apply { topMargin = dp(6f) })
  }
  private var pulse: ValueAnimator? = null

  init {
    setBackgroundColor(Color.BLACK)
    isClickable = true
    for (pane in listOf(workingPane, restingPane, pausedPane, placeholderPane)) {
      addView(pane, LayoutParams(MATCH, MATCH))
    }
    addView(pausedFrame, LayoutParams(MATCH, MATCH))
  }

  /** Draws the workout as it is now. A render reached from a clock's tick inside one is skipped. */
  fun render() = gate.render { redraw() }

  private fun redraw() {
    val frame = frameAt(System.currentTimeMillis())
    // A pane is shown before its clock is counted: the gate starts a clock once, and a Chronometer
    // started while it is not shown doesn't run (#3315).
    show(
      workingPane to (frame is PipFrame.Working),
      restingPane to (frame is PipFrame.Resting),
      pausedPane to (frame is PipFrame.Paused),
      placeholderPane to (frame is PipFrame.Placeholder),
    )
    pausedFrame.visibility = if (frame is PipFrame.Paused) VISIBLE else GONE
    when (frame) {
      is PipFrame.Working -> drawWorking(frame)
      is PipFrame.Resting -> drawResting(frame)
      is PipFrame.Paused -> drawPaused(frame)
      is PipFrame.Placeholder -> drawPlaceholder(frame)
    }
  }

  private fun show(vararg panes: Pair<View, Boolean>) {
    for ((pane, shown) in panes) pane.visibility = if (shown) VISIBLE else GONE
  }

  private fun drawWorking(frame: PipFrame.Working) {
    workName.text = frame.name
    weight.text = frame.weight ?: ""
    weight.visibility = if (frame.weight == null) GONE else VISIBLE
    unit.text = frame.unit ?: ""
    unit.visibility = if (frame.unit == null) GONE else VISIBLE
    // No load is known: the line stays empty rather than showing a made-up one.
    reps.text = frame.reps ?: ""
    reps.visibility = if (frame.reps == null) GONE else VISIBLE
    dots.set(frame.sets, frame.setsDone, frame.setColors, frame.setColor)
    count(setClock, setClockView, frame.countsFrom)
    count(restClock, restClockView, null)
    count(pausedClock, pausedClockView, null)
    bindHeart(workHr, frame.hr, 15f)
    setPulse(true)
  }

  private fun drawResting(frame: PipFrame.Resting) {
    restTargetSec = frame.targetSec
    val tint = if (frame.over) OVER else MUTED
    restEyebrow.text = frame.eyebrow
    restEyebrow.setTextColor(tint)
    restClockView.setTextColor(if (frame.over) OVER else Color.WHITE)
    restLoad.text = frame.load ?: ""
    restLoad.visibility = if (frame.load == null) GONE else VISIBLE
    ring.fraction = frame.fraction
    ring.color = if (frame.over) OVER else BRAND
    ring.invalidate()
    count(restClock, restClockView, frame.countsFrom)
    count(setClock, setClockView, null)
    count(pausedClock, pausedClockView, null)
    bindHeart(restHr, frame.hr, 13f)
    setPulse(false)
  }

  private fun drawPaused(frame: PipFrame.Paused) {
    pausedCaption.text = frame.caption
    count(pausedClock, pausedClockView, frame.countsFrom)
    count(setClock, setClockView, null)
    count(restClock, restClockView, null)
    setPulse(false)
  }

  private fun drawPlaceholder(frame: PipFrame.Placeholder) {
    val next = frame.nextUp
    placeholderEyebrow.text = if (next != null) "Next up" else "Done"
    placeholderEyebrow.setTextColor(if (next != null) BRAND else DONE_TITLE)
    val shown = next ?: frame.name
    placeholderName.text = shown
    placeholderName.visibility = if (shown.isEmpty()) GONE else VISIBLE
    hint.visibility = if (frame.hint) VISIBLE else GONE
    count(setClock, setClockView, null)
    count(restClock, restClockView, null)
    count(pausedClock, pausedClockView, null)
    setPulse(false)
  }

  // "♥ 128" in the zone's colour, with the zone's name small after it; "—" once the reading is old,
  // and nothing at all with no strap.
  private fun bindHeart(view: TextView, hr: PipHeartView?, size: Float) {
    if (hr == null) {
      view.visibility = GONE
      return
    }
    view.visibility = VISIBLE
    val line = SpannableStringBuilder("♥ ${hr.bpm ?: "—"}")
    if (hr.bpm != null && hr.zoneName != null) {
      val start = line.length
      line.append(" ").append(hr.zoneName.uppercase())
      line.setSpan(AbsoluteSizeSpan(9, true), start, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    view.text = line
    view.setTextColor(if (hr.bpm != null && hr.zoneColor != null) Color.parseColor(hr.zoneColor) else MUTED)
    view.setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
  }

  /** Counts `view` up from `fromMs`, or stops it; PipClockGate keeps either from re-entering. */
  private fun count(clock: PipClock, view: Chronometer, fromMs: Long?) {
    if (fromMs == null) {
      gate.count(clock, null)
      // Nothing to count from stands still; a timed rest shows its whole length.
      view.text = if (view === restClockView) PipPresenter.restClockText(0, restTargetSec) else "0:00"
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
    val seconds = maxOf(0L, (SystemClock.elapsedRealtime() - view.base) / 1000)
    view.text = if (view === restClockView) PipPresenter.restClockText(seconds, restTargetSec) else PipPresenter.formatTime(seconds)
  }

  override fun onDetachedFromWindow() {
    setPulse(false)
    super.onDetachedFromWindow()
  }

  // The running set's dot pulses 1 → 0.35 → 1 over 1.6 s, as the current app's <animate> did.
  private fun setPulse(on: Boolean) {
    if (on == (pulse != null)) return
    pulse?.cancel()
    pulse = null
    dots.pulseAlpha = 1f
    dots.invalidate()
    if (!on) return
    pulse = ValueAnimator.ofFloat(1f, 0.35f, 1f).apply {
      duration = 1_600
      interpolator = LinearInterpolator()
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener {
        dots.pulseAlpha = it.animatedValue as Float
        dots.invalidate()
      }
      start()
    }
  }

  private fun column() = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
  }

  private fun wrap() = LinearLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL }

  private fun text(size: Float, color: Int, bold: Boolean = false, mono: Boolean = false) = TextView(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    setTextColor(color)
    gravity = Gravity.CENTER
    includeFontPadding = false
    if (mono) {
      typeface = Typeface.create(Typeface.MONOSPACE, if (bold) Typeface.BOLD else Typeface.NORMAL)
      fontFeatureSettings = "tnum"
    } else if (bold) {
      setTypeface(typeface, Typeface.BOLD)
    }
  }

  // A Chronometer formats as "00:48"; the window reads "0:48". Each tick formats it and renders the
  // window, which the gate skips when the tick came from inside a render.
  private fun clock(size: Float, color: Int) = Chronometer(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, size)
    setTextColor(color)
    gravity = Gravity.CENTER
    includeFontPadding = false
    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
    fontFeatureSettings = "tnum"
    text = "0:00"
    setOnChronometerTickListener {
      format(it)
      render()
    }
  }

  private fun caption(size: Float, color: Int, tracking: Float) = text(size, color).apply {
    isAllCaps = true
    letterSpacing = tracking
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }

  /** The rest ring: a track, and the part of the rest left drawn over it from the top. */
  private inner class RingView(context: Context) : View(context) {
    var fraction = 0f
    var color = BRAND
    private val stroke = 10f * density
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
      // 64 dp in the 160 dp window of the mockup: 16 dp in from the shorter side.
      val radius = maxOf(minOf(cx, cy) - 16f * density, 24f * density)
      bounds.set(cx - radius, cy - radius, cx + radius, cy + radius)
      canvas.drawCircle(cx, cy, radius, track)
      if (fraction <= 0f) return
      arc.color = color
      canvas.drawArc(bounds, -90f, 360f * minOf(fraction, 1f), false, arc)
    }
  }

  /** The set dots: sets done in their colours, the running one pulsing in its own, the rest dim. */
  private inner class DotsView(context: Context) : View(context) {
    var pulseAlpha = 1f
    private var sets = 0
    private var done = 0
    private var colors: List<String> = emptyList()
    private var current: String? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    fun set(sets: Int, done: Int, colors: List<String>, current: String?) {
      this.sets = sets
      this.done = done
      this.colors = colors
      this.current = current
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val radius = 4f * density
      val gap = 4f * density
      val cy = height / 2f
      for (index in 0 until minOf(sets, MAX_DOTS)) {
        val cx = radius + index * (2 * radius + gap)
        paint.color = when {
          index < done -> parse(colors.getOrNull(index)) ?: BRAND
          index == done -> parse(current ?: colors.getOrNull(index)) ?: BRAND
          else -> DOT_OFF
        }
        if (index == done) paint.alpha = (pulseAlpha * 255).toInt()
        canvas.drawCircle(cx, cy, radius, paint)
      }
    }

    private fun parse(value: String?): Int? = value?.let { runCatching { Color.parseColor(it) }.getOrNull() }
  }

  // font-semibold is weight 600, which Android can name only from API 28.
  private fun semibold(): Typeface =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) Typeface.create(Typeface.DEFAULT, 600, false)
    else Typeface.create("sans-serif-medium", Typeface.NORMAL)

  companion object {
    private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
    private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    private const val MAX_DOTS = 12
    private val BRAND = Color.parseColor("#00C84E")
    // The dark warning and danger status tokens (`statusColors.dark` in mobile/src/shared/theme/tokens.ts),
    // the same values the in-app chips use. The window is always dark, so it never needs the light steps.
    private val AMBER = Color.parseColor("#EFAF00")
    private val OVER = Color.parseColor("#FF6467")
    private val MUTED = Color.parseColor("#B2B8B3")
    private val TRACK = Color.parseColor("#14FFFFFF")
    private val DOT_OFF = Color.parseColor("#26FFFFFF")
    private val DONE_TITLE = Color.parseColor("#80FFFFFF")
    private val HINT = Color.parseColor("#4DFFFFFF")
  }
}
