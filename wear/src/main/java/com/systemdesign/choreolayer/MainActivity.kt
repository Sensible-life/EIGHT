package com.systemdesign.choreolayer

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.content.res.ColorStateList
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import org.json.JSONArray
import kotlin.math.max
import kotlin.math.roundToLong

class MainActivity : Activity(), MessageClient.RpcService {
    private val accent = Color.rgb(196, 76, 223)
    private val ink = Color.rgb(249, 244, 251)
    private val soft = Color.rgb(55, 43, 65)
    private val surface = Color.rgb(35, 28, 43)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun rounded(color: Int, radius: Int = 14) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }
    private fun styleButton(button: Button, selected: Boolean = false) {
        button.background = rounded(if (selected) accent else soft, 18)
        button.setTextColor(if (selected) Color.WHITE else ink)
        button.isAllCaps = false; button.textSize = 11f; button.minWidth = 0; button.minimumWidth = 0
        button.minHeight = dp(44); button.minimumHeight = dp(44); button.minimumWidth = dp(44)
        button.setPadding(dp(12), 0, dp(12), 0)
    }
    private fun buttonSpacing() = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(dp(4), dp(4), dp(4), dp(4)) }
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var mixerView: LinearLayout
    private val mixerCommands = mutableListOf<JSONObject>()
    private var mixerSession = ""
    private class LayerRow(val root: LinearLayout, val label: TextView, val slider: SeekBar, var name: String) {
        var dragging = false
        var pendingPercent: Int? = null
        var pendingAt = 0L
        var muted = false
        var solo = false
        var pendingMuted: Boolean? = null
        var pendingSolo: Boolean? = null
        var mutedAt = 0L
        var soloAt = 0L
        var muteButton: Button? = null
        var soloButton: Button? = null
    }
    private val mixerRows = linkedMapOf<String, LayerRow>()
    private var masterRow: LayerRow? = null
    private var mixerUiSession = ""
    private var suggestionView: LinearLayout? = null
    private var recordButton: Button? = null
    private var shownSuggestion = ""
    private var answeredSuggestion = ""

    private fun enqueueControl(expectedSession: String, stem: String?, field: String, value: Any) {
        synchronized(mixerCommands) {
            if (mixerSession != expectedSession) return
            mixerCommands.removeAll {
                it.optString("session") == mixerSession &&
                    (if (stem == null) it.has("masterPercent") else it.optString("stem") == stem &&
                        (it.has(field) || (field == "percent" && it.has("delta"))))
            }
            if (mixerCommands.size < 100) mixerCommands.add(JSONObject().put("session", mixerSession).apply {
                if (stem != null) put("stem", stem)
                put(field, value)
            })
        }
    }
    private fun updateToggleButtons(row: LayerRow) {
        row.muteButton?.apply { styleButton(this, row.muted); text = "M"; alpha = 1f; contentDescription = "${row.name} mute ${if (row.muted) "on" else "off"}" }
        row.soloButton?.apply { styleButton(this, row.solo); text = "S"; alpha = 1f; contentDescription = "${row.name} solo ${if (row.solo) "on" else "off"}" }
    }
    private fun createMixerRow(expectedSession: String, stem: String?, name: String): LayerRow {
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; background = rounded(surface); setPadding(dp(10), dp(12), dp(10), dp(10)); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(5), 0, dp(5)) } }
        val label = TextView(this).apply { setTextColor(ink); textSize = 13f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); gravity = Gravity.CENTER }
        val slider = SeekBar(this).apply { max = if (stem == null) 100 else 150; progressTintList = ColorStateList.valueOf(accent); thumbTintList = ColorStateList.valueOf(accent); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (44 * resources.displayMetrics.density).toInt()); contentDescription = "$name volume" }
        val row = LayerRow(container, label, slider, name)
        fun sendPercent(progress: Int) {
            row.pendingPercent = progress; row.pendingAt = SystemClock.elapsedRealtime()
            row.label.text = "${row.name}  $progress%"
            enqueueControl(expectedSession, stem, if (stem == null) "masterPercent" else "percent", progress)
        }
        slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(view: SeekBar) { row.dragging = true; view.parent?.requestDisallowInterceptTouchEvent(true) }
            override fun onProgressChanged(view: SeekBar, progress: Int, fromUser: Boolean) { if (fromUser) sendPercent(progress) }
            override fun onStopTrackingTouch(view: SeekBar) { row.dragging = false; view.parent?.requestDisallowInterceptTouchEvent(false); sendPercent(view.progress) }
        })
        container.addView(label); container.addView(slider)
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        for (delta in listOf(-10, 10)) buttons.addView(Button(this).apply {
            text = if (delta < 0) "−" else "+"; styleButton(this); textSize = 17f
            contentDescription = "${if (delta < 0) "Decrease" else "Increase"} $name volume"
            setOnClickListener { val next = (row.slider.progress + delta).coerceIn(0, row.slider.max); if (next != row.slider.progress) { row.slider.progress = next; sendPercent(next) } }
        }, buttonSpacing())
        if (stem != null) {
            row.muteButton = Button(this).apply {
                styleButton(this)
                setOnClickListener { row.muted = !row.muted; row.pendingMuted = row.muted; row.mutedAt = SystemClock.elapsedRealtime(); updateToggleButtons(row); enqueueControl(expectedSession, stem, "muted", row.muted) }
            }
            row.soloButton = Button(this).apply {
                styleButton(this)
                setOnClickListener { row.solo = !row.solo; row.pendingSolo = row.solo; row.soloAt = SystemClock.elapsedRealtime(); updateToggleButtons(row); enqueueControl(expectedSession, stem, "solo", row.solo) }
            }
            buttons.addView(row.muteButton, buttonSpacing()); buttons.addView(row.soloButton, buttonSpacing())
        }
        // Keep touch targets usable on round watches; narrow screens can scroll the controls horizontally.
        val controls = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = true
            isFillViewport = true
            addView(buttons)
        }
        container.addView(controls)
        return row
    }
    private fun updateVolume(row: LayerRow, percent: Int) {
        val pending = row.pendingPercent
        if (!row.dragging && (pending == null || percent == pending || SystemClock.elapsedRealtime() - row.pendingAt > 3000)) {
            row.pendingPercent = null; row.slider.progress = percent
        }
        row.label.text = "${row.name}  ${row.slider.progress}%"
    }
    private fun renderMixer(input: JSONObject) {
        val incomingSession = input.getString("session")
        synchronized(mixerCommands) { if (incomingSession != mixerSession) return }
        val layers = input.getJSONArray("layers")
        val advanced = input.optInt("controlsVersion", 1) >= 2
        if (mixerUiSession != incomingSession) {
            mixerView.removeAllViews(); mixerRows.clear(); masterRow = null; suggestionView = null; recordButton = null; shownSuggestion = ""; answeredSuggestion = ""; mixerUiSession = incomingSession
            mixerView.addView(TextView(this).apply { text = "Mixer"; setTextColor(ink); textSize = 17f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(4)) })
        }
        val suggestion = input.optJSONObject("suggestion")
        val suggestionId = suggestion?.optString("id") ?: ""
        if (suggestionId != shownSuggestion) {
            suggestionView?.let { mixerView.removeView(it) }; suggestionView = null; shownSuggestion = suggestionId
            if (suggestionId.isNotEmpty() && suggestionId != answeredSuggestion) {
                val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
                box.addView(TextView(this).apply { text = suggestion?.optString("title")?.take(100); setTextColor(ink); gravity = Gravity.CENTER })
                val reason = suggestion?.optString("reason")?.take(400).orEmpty()
                if (suggestion?.optString("kind") == "suggestion" && reason.isNotBlank()) {
                    val explanation = TextView(this).apply {
                        text = reason; setTextColor(ink); gravity = Gravity.CENTER
                        visibility = View.GONE
                    }
                    box.addView(Button(this).apply {
                        text = "Why?"; styleButton(this, false)
                        setOnClickListener {
                            val show = explanation.visibility == View.GONE
                            explanation.visibility = if (show) View.VISIBLE else View.GONE
                            text = if (show) "Hide" else "Why?"
                        }
                    }, buttonSpacing())
                    box.addView(explanation)
                }
                val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
                for (choice in listOf("accept", "dismiss")) buttons.addView(Button(this).apply {
                    text = if (suggestion?.optString("kind") == "help") { if (choice == "accept") "Yes" else "No" } else { if (choice == "accept") "Try" else "Later" }; styleButton(this, choice == "accept")
                    setOnClickListener {
                        synchronized(mixerCommands) {
                            if (mixerSession == incomingSession && mixerCommands.size < 100) mixerCommands.add(JSONObject().put("session", incomingSession).put("suggestionId", suggestionId).put("choice", choice))
                        }
                        answeredSuggestion = suggestionId; mixerView.removeView(box); suggestionView = null
                    }
                }, buttonSpacing())
                box.addView(buttons); mixerView.addView(box, 1); suggestionView = box
            }
        }
        val available = input.optBoolean("recordAvailable", false)
        if (available) {
            val button = recordButton ?: Button(this).also { created ->
                styleButton(created)
                created.setOnClickListener {
                    synchronized(mixerCommands) {
                        if (mixerSession == incomingSession && mixerCommands.size < 100 && mixerCommands.none { it.optString("action") == "record" })
                            mixerCommands.add(JSONObject().put("session", incomingSession).put("action", "record"))
                    }
                }
                mixerView.addView(created, if (suggestionView == null) 1 else 2, buttonSpacing()); recordButton = created
            }
            button.text = if (input.optBoolean("recording", false)) "Stop recording" else "Record"
        } else recordButton?.let { mixerView.removeView(it); recordButton = null }
        if (advanced) {
            val row = masterRow ?: createMixerRow(incomingSession, null, "Master").also { masterRow = it; mixerView.addView(it.root, if (suggestionView == null) 1 else 2) }
            updateVolume(row, input.getInt("masterPercent"))
        } else masterRow?.let { mixerView.removeView(it.root); masterRow = null }
        val activeStems = (0 until layers.length()).map { layers.getJSONObject(it).getString("stem") }.toSet()
        for (stem in mixerRows.keys.toList()) if (stem !in activeStems) mixerRows.remove(stem)?.let { mixerView.removeView(it.root) }
        for (i in 0 until layers.length()) {
            val layer = layers.getJSONObject(i)
            val stem = layer.getString("stem")
            val name = layer.getString("label")
            val row = mixerRows[stem] ?: createMixerRow(incomingSession, stem, name).also { mixerRows[stem] = it; mixerView.addView(it.root) }
            row.name = name; row.slider.contentDescription = "$name volume"
            updateVolume(row, layer.getInt("percent"))
            row.muteButton?.visibility = if (advanced) android.view.View.VISIBLE else android.view.View.GONE
            row.soloButton?.visibility = if (advanced) android.view.View.VISIBLE else android.view.View.GONE
            if (advanced) {
                val now = SystemClock.elapsedRealtime()
                val muted = layer.getBoolean("muted"); val solo = layer.getBoolean("solo")
                if (row.pendingMuted == null || row.pendingMuted == muted || now - row.mutedAt > 3000) { row.pendingMuted = null; row.muted = muted }
                if (row.pendingSolo == null || row.pendingSolo == solo || now - row.soloAt > 3000) { row.pendingSolo = null; row.solo = solo }
                updateToggleButtons(row)
            }
        }
    }
    private val vibrator by lazy { getSystemService(VIBRATOR_SERVICE) as Vibrator }
    private var timeline: PulseTimeline? = null
    private var session = ""
    private var sequence = -1L
    private var playing = false
    private var anchorMs = 0.0
    private var positionMs = 0.0
    private var offsetMs = 0.0
    private var loop: Loop? = null
    private var lastContact = 0L
    private var lastPulse = -1000L
    private var accepting = false
    private val pulseRunner = Runnable { vibrate(nextAmplitude); scheduleNext() }
    private var nextAmplitude = 128
    private val watchdog = object : Runnable {
        override fun run() {
            if (playing && SystemClock.elapsedRealtime() - lastContact > 3500) stop("Disconnected · vibration stopped")
            handler.postDelayed(this, 500)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dp(22), dp(30), dp(22), dp(30)); setBackgroundColor(Color.rgb(18, 15, 22))
        }
        layout.addView(TextView(this).apply { text = "EIGHT 8"; textSize = 17f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); setTextColor(ink); gravity = Gravity.CENTER })
        status = TextView(this).apply { text = "Open a track on your phone,\nthen connect your watch"; textSize = 11f; setTextColor(Color.rgb(198, 184, 205)); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(8)) }
        layout.addView(status)
        mixerView = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
        layout.addView(mixerView)
        layout.addView(Button(this).apply { text = "Test vibration"; styleButton(this); setOnClickListener { vibrate(180) } }, buttonSpacing())
        layout.addView(Button(this).apply { text = "Disconnect"; styleButton(this); setOnClickListener { accepting = false; stop("Disconnected · reopen the app") } }, buttonSpacing())
        layout.addView(TextView(this).apply { text = "Keep this screen open during use"; textSize = 10f; setTextColor(Color.GRAY); gravity = Gravity.CENTER })
        setContentView(ScrollView(this).apply { addView(layout) })
    }
    override fun onResume() {
        super.onResume(); accepting = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Wearable.getMessageClient(this).addRpcService(this, "/layerlab/").addOnFailureListener { stop("Connection error · reopen the app") }
        handler.post(watchdog)
    }
    override fun onPause() {
        accepting = false; synchronized(mixerCommands) { mixerCommands.clear(); mixerSession = "" }; mixerUiSession = ""; mixerRows.clear(); masterRow = null; mixerView.removeAllViews(); stop("Reconnect from your phone")
        handler.removeCallbacks(watchdog)
        Wearable.getMessageClient(this).removeRpcService(this)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }
    override fun onRequest(nodeId: String, path: String, data: ByteArray): Task<ByteArray> {
        val result = try {
            check(accepting) { "Reopen the watch app." }
            require(data.size <= 81000)
            val input = JSONObject(String(data, Charsets.UTF_8))
            when (path) {
                "/layerlab/clock" -> JSONObject().put("watchTimeMs", SystemClock.elapsedRealtime())
                "/layerlab/pattern" -> {
                    require(input.getInt("version") == 1)
                    val values = input.getJSONArray("pulses")
                    val candidate = PulseTimeline(input.getDouble("durationMs"), (0 until values.length()).map {
                        val item = values.getJSONArray(it); Pulse(item.getDouble(0), item.getInt(1))
                    })
                    val newSession = input.getString("session")
                    stop("Pattern ready · ${candidate.pulses.size} beats")
                    if (session != newSession) sequence = -1
                    session = newSession; timeline = candidate
                    JSONObject()
                }
                "/layerlab/transport", "/layerlab/stop" -> {
                    require(input.getString("session") == session)
                    val seq = input.getLong("sequence")
                    if (seq > sequence) {
                        sequence = seq
                        if (path.endsWith("stop")) stop("Vibration off") else {
                            val nextAnchor = input.getDouble("watchAnchorMs")
                            val nextPosition = input.getDouble("positionMs")
                            val nextOffset = input.getDouble("offsetMs")
                            require(nextAnchor.isFinite() && nextPosition.isFinite() && nextOffset.isFinite())
                            require(nextPosition >= 0 && nextPosition <= requireNotNull(timeline).durationMs)
                            val range = input.optJSONObject("loop")?.let { Loop(it.getDouble("startMs"), it.getDouble("endMs")) }
                            if (range != null) require(range.startMs >= 0 && range.endMs <= requireNotNull(timeline).durationMs && range.endMs > range.startMs)
                            anchorMs = nextAnchor; positionMs = nextPosition; offsetMs = nextOffset; loop = range
                            playing = input.getBoolean("playing"); lastContact = SystemClock.elapsedRealtime()
                            handler.removeCallbacks(pulseRunner)
                            if (playing) { status.text = "Playing beat vibrations"; scheduleNext() } else stop("Paused · connected")
                        }
                    }
                    JSONObject()
                }
                "/layerlab/mixer" -> {
                    val nextSession = input.getString("session")
                    val layers = input.getJSONArray("layers")
                    require(nextSession.length in 1..100 && layers.length() <= 20)
                    val advanced = input.optInt("controlsVersion", 1) >= 2
                    if (advanced) require(input.getInt("masterPercent") in 0..100)
                    for (i in 0 until layers.length()) {
                        val layer = layers.getJSONObject(i)
                        require(layer.getString("stem").length in 1..100 && layer.getString("label").length <= 100 && layer.getInt("percent") in 0..150)
                        if (advanced) { layer.getBoolean("muted"); layer.getBoolean("solo") }
                    }
                    val commands: List<JSONObject>
                    synchronized(mixerCommands) {
                        if (mixerSession != nextSession) { mixerCommands.clear(); mixerSession = nextSession }
                        commands = mixerCommands.toList(); mixerCommands.clear()
                    }
                    runOnUiThread { renderMixer(input) }
                    JSONObject().put("commands", JSONArray(commands))
                }
                "/layerlab/test" -> { vibrate(180); JSONObject() }
                else -> error("Unsupported request")
            }.put("ok", true)
        } catch (error: Exception) { JSONObject().put("ok", false).put("error", error.message ?: "Watch error") }
        return Tasks.forResult(result.toString().toByteArray(Charsets.UTF_8))
    }
    private fun scheduleNext() {
        if (!playing || !accepting) return
        val now = SystemClock.elapsedRealtime()
        val earliest = max(now, lastPulse + 140)
        val futureStart = max(0.0, anchorMs - earliest)
        val mediaPosition = positionMs + max(0.0, earliest - anchorMs)
        val next = timeline?.next(mediaPosition, loop, offsetMs) ?: return
        nextAmplitude = next.amplitude
        handler.postDelayed(pulseRunner, max(1, earliest - now + futureStart.roundToLong() + next.delayMs.roundToLong()))
    }
    private fun vibrate(amplitude: Int) {
        if (!vibrator.hasVibrator()) { status.text = "Vibration is unavailable on this device"; return }
        val now = SystemClock.elapsedRealtime()
        if (now - lastPulse < 140) return
        lastPulse = now
        vibrator.vibrate(VibrationEffect.createOneShot(35, if (vibrator.hasAmplitudeControl()) amplitude.coerceIn(1, 255) else VibrationEffect.DEFAULT_AMPLITUDE))
    }
    private fun stop(message: String) {
        playing = false; handler.removeCallbacks(pulseRunner); vibrator.cancel(); status.text = message
    }
}
