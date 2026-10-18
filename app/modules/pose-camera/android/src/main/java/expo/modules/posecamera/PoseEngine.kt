package expo.modules.posecamera

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import org.json.JSONObject

/** Detector thresholds from src/tracking/config.ts `pose` (the view's detectorJson prop). */
data class PoseOptions(
    val numPoses: Int,
    val minDetection: Float,
    val minPresence: Float,
    val minTracking: Float,
) {
    companion object {
        fun fromJson(json: String): PoseOptions {
            val o = JSONObject(json)
            return PoseOptions(
                numPoses = o.optInt("num_poses", 1),
                minDetection = o.optDouble("min_detection_confidence", 0.5).toFloat(),
                minPresence = o.optDouble("min_presence_confidence", 0.5).toFloat(),
                minTracking = o.optDouble("min_tracking_confidence", 0.5).toFloat(),
            )
        }
    }
}

/** One result. Flat landmark arrays (33*3, 33*3, 33), null when nobody is in view. */
class PoseResult(
    val tMs: Long,
    val captureMs: Double,
    val captureFrom: String,
    val sourceFrames: Long,
    val aspect: Float,
    val image: FloatArray?,
    val world: FloatArray?,
    val visibility: FloatArray?,
)

/**
 * MediaPipe Pose Landmarker (LIVE_STREAM), GPU first and CPU when the GPU delegate fails.
 * At most one frame is in flight: frames arriving while busy are dropped, so latency never piles
 * up (the drop shows as source_fps > pose_fps in the perf message).
 */
class PoseEngine(
    private val context: Context,
    val model: String,
    private val options: PoseOptions,
    private val onResult: (PoseResult) -> Unit,
    private val onDelegateChanged: (String) -> Unit,
) {
    @Volatile var delegate = "gpu"
        private set

    private val control = Executors.newSingleThreadExecutor { Thread(it, "pose-control") }
    private val pending = HashMap<Long, Frame>() // MediaPipe timestamp -> frame, for latency
    private var landmarker: PoseLandmarker? = null
    private var lastTs = -1L
    private var busySince = 0L
    private var gotResult = false
    private var closed = false

    init {
        landmarker = build(Delegate.GPU)
            ?: build(Delegate.CPU)?.also { delegate = "cpu" }
            ?: throw IllegalStateException("PoseLandmarker failed to start on GPU and CPU")
    }

    /** Called on the camera thread for every frame. */
    fun detect(frame: Frame) {
        val lm: PoseLandmarker
        val ts: Long
        synchronized(this) {
            lm = landmarker ?: return
            val now = SystemClock.elapsedRealtime()
            if (busySince != 0L && now - busySince < STALL_MS) return // busy: drop this frame
            ts = if (frame.tMs <= lastTs) lastTs + 1 else frame.tMs // must strictly increase
            lastTs = ts
            busySince = now
            pending[ts] = frame
            if (pending.size > MAX_PENDING) pending.keys.sorted().take(pending.size - MAX_PENDING).forEach { pending.remove(it) }
        }
        try {
            lm.detectAsync(BitmapImageBuilder(frame.bitmap).build(), ts)
        } catch (e: RuntimeException) { // closed meanwhile, or a bad frame
            Log.w(TAG, "detectAsync failed", e)
            synchronized(this) {
                busySince = 0L
                pending.remove(ts)
            }
        }
    }

    fun close() {
        val lm = synchronized(this) {
            closed = true
            pending.clear()
            landmarker.also { landmarker = null }
        }
        // Outside the lock: close() waits for in-flight results, and their callback takes the lock.
        lm?.close()
        control.shutdown()
    }

    /** The model as a direct buffer: works whether or not the APK compresses the asset. */
    private fun modelBuffer(): ByteBuffer {
        val bytes = context.assets.open("models/pose_landmarker_$model.task").use { it.readBytes() }
        return ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
            put(bytes)
            rewind()
        }
    }

    private fun build(d: Delegate): PoseLandmarker? = try {
        val base = BaseOptions.builder()
            .setModelAssetBuffer(modelBuffer())
            .setDelegate(d)
            .build()
        val opts = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.LIVE_STREAM)
            .setNumPoses(options.numPoses)
            .setMinPoseDetectionConfidence(options.minDetection)
            .setMinPosePresenceConfidence(options.minPresence)
            .setMinTrackingConfidence(options.minTracking)
            .setOutputSegmentationMasks(false)
            .setResultListener { result: PoseLandmarkerResult, input: MPImage -> handleResult(result, input) }
            .setErrorListener { e: RuntimeException -> handleError(e) }
            .build()
        PoseLandmarker.createFromOptions(context, opts)
    } catch (e: Exception) {
        Log.w(TAG, "PoseLandmarker ($d) failed to start", e)
        null
    }

    private fun handleResult(result: PoseLandmarkerResult, input: MPImage) {
        val ts = result.timestampMs()
        val frame: Frame
        synchronized(this) {
            busySince = 0L
            gotResult = true
            frame = pending.remove(ts) ?: return
            pending.keys.filter { it < ts }.forEach { pending.remove(it) } // dropped by MediaPipe
        }
        val now = SystemClock.elapsedRealtimeNanos() / 1e6
        // The sensor timestamp counts only if it is on the elapsedRealtime base (lag 0..500 ms).
        val fromSensor = frame.tMs - frame.sensorMs in 0.0..SENSOR_LAG_MAX_MS
        val start = if (fromSensor) frame.sensorMs else frame.tMs.toDouble()
        val from = if (fromSensor) "sensor" else "analyzer"
        val aspect = input.width.toFloat() / input.height
        val people = result.landmarks()
        if (people.isEmpty()) {
            onResult(PoseResult(frame.tMs, now - start, from, frame.seq, aspect, null, null, null))
            return
        }
        val p = people[0]
        val w = result.worldLandmarks()[0]
        val image = FloatArray(N * 3)
        val world = FloatArray(N * 3)
        val vis = FloatArray(N)
        for (i in 0 until N) {
            image[3 * i] = p[i].x()
            image[3 * i + 1] = p[i].y()
            image[3 * i + 2] = p[i].z()
            world[3 * i] = w[i].x()
            world[3 * i + 1] = w[i].y()
            world[3 * i + 2] = w[i].z()
            vis[i] = p[i].visibility().orElse(0f)
        }
        onResult(PoseResult(frame.tMs, now - start, from, frame.seq, aspect, image, world, vis))
    }

    private fun handleError(e: RuntimeException) {
        Log.e(TAG, "MediaPipe error (delegate=$delegate)", e)
        val fallback = synchronized(this) {
            busySince = 0L
            delegate == "gpu" && !gotResult
        }
        if (fallback) control.execute { switchToCpu() } // never close the graph from its own callback
    }

    private fun switchToCpu() {
        val gpu = synchronized(this) {
            if (landmarker == null || delegate == "cpu") return
            landmarker.also { landmarker = null } // detect() drops frames until the CPU graph is up
        }
        gpu?.close() // outside the lock, as in close()
        val cpu = build(Delegate.CPU)
        synchronized(this) {
            if (closed) {
                cpu?.close()
                return
            }
            landmarker = cpu
            delegate = "cpu"
            busySince = 0L
        }
        onDelegateChanged("cpu")
    }

    companion object {
        private const val TAG = "PoseEngine"
        private const val N = 33
        private const val STALL_MS = 500L
        private const val MAX_PENDING = 8
        private const val SENSOR_LAG_MAX_MS = 500.0
    }
}