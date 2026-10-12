package com.systemdesign.choreolayer

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToLong

class MainActivity : Activity(), MessageClient.RpcService {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
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
            if (playing && SystemClock.elapsedRealtime() - lastContact > 3500) stop("연결 끊김 · 진동 중지")
            handler.postDelayed(this, 500)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24); setBackgroundColor(Color.rgb(17, 19, 16))
        }
        layout.addView(TextView(this).apply { text = "LAYER / LAB"; textSize = 14f; setTextColor(Color.rgb(217, 242, 139)); gravity = Gravity.CENTER })
        status = TextView(this).apply { text = "폰에서 곡을 열고\n워치 연결을 눌러 주세요"; textSize = 13f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, 18, 0, 12) }
        layout.addView(status)
        layout.addView(Button(this).apply { text = "진동 테스트"; setOnClickListener { vibrate(180) } })
        layout.addView(Button(this).apply { text = "연결 종료"; setOnClickListener { accepting = false; stop("종료됨 · 앱을 다시 열어 주세요") } })
        layout.addView(TextView(this).apply { text = "이 화면을 열어 둔 상태에서 사용하세요"; textSize = 10f; setTextColor(Color.GRAY); gravity = Gravity.CENTER })
        setContentView(ScrollView(this).apply { addView(layout) })
    }
    override fun onResume() {
        super.onResume(); accepting = true
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Wearable.getMessageClient(this).addRpcService(this, "/layerlab/").addOnFailureListener { stop("연결 서비스 오류 · 앱을 다시 열어 주세요") }
        handler.post(watchdog)
    }
    override fun onPause() {
        accepting = false; stop("폰에서 다시 연결해 주세요")
        handler.removeCallbacks(watchdog)
        Wearable.getMessageClient(this).removeRpcService(this)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }
    override fun onRequest(nodeId: String, path: String, data: ByteArray): Task<ByteArray> {
        val result = try {
            check(accepting) { "워치 앱을 다시 열어 주세요." }
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
                    stop("패턴 준비됨 · ${candidate.pulses.size}회")
                    if (session != newSession) sequence = -1
                    session = newSession; timeline = candidate
                    JSONObject()
                }
                "/layerlab/transport", "/layerlab/stop" -> {
                    require(input.getString("session") == session)
                    val seq = input.getLong("sequence")
                    if (seq > sequence) {
                        sequence = seq
                        if (path.endsWith("stop")) stop("진동 꺼짐") else {
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
                            if (playing) { status.text = "비트를 손목으로\n진동 재생 중"; scheduleNext() } else stop("일시정지 · 연결됨")
                        }
                    }
                    JSONObject()
                }
                "/layerlab/test" -> { vibrate(180); JSONObject() }
                else -> error("지원하지 않는 요청")
            }.put("ok", true)
        } catch (error: Exception) { JSONObject().put("ok", false).put("error", error.message ?: "워치 오류") }
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
        if (!vibrator.hasVibrator()) { status.text = "진동을 지원하지 않는 기기"; return }
        val now = SystemClock.elapsedRealtime()
        if (now - lastPulse < 140) return
        lastPulse = now
        vibrator.vibrate(VibrationEffect.createOneShot(35, if (vibrator.hasAmplitudeControl()) amplitude.coerceIn(1, 255) else VibrationEffect.DEFAULT_AMPLITUDE))
    }
    private fun stop(message: String) {
        playing = false; handler.removeCallbacks(pulseRunner); vibrator.cancel(); status.text = message
    }
}
