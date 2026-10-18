package expo.modules.posecamera

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Camera preview + pose events for the session's camera tab; runs only while `active`.
 * JS gets landmarks and timing; video frames never leave this view (principle 3).
 */
class PoseCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true // lay out the native PreviewView child

    private val onPose by EventDispatcher()
    private val onEngine by EventDispatcher()
    private val onError by EventDispatcher()
    private val main = Handler(Looper.getMainLooper())
    private val previewView = PreviewView(context).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE // TextureView: JS overlays draw on top
        scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    private var wantActive = false
    private var attached = false
    private var source: FrameSource? = null
    private var engine: PoseEngine? = null
    var model = "lite"
    var detectorJson = "{}"

    init {
        addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    fun setActive(active: Boolean) {
        wantActive = active
    }

    /** After every prop update: start or stop to match `active` and the window state. */
    fun applyProps() = reconcile()

    /** View destroyed: never run again. */
    fun release() {
        wantActive = false
        reconcile()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        attached = true
        reconcile()
    }

    override fun onDetachedFromWindow() {
        attached = false
        reconcile()
        super.onDetachedFromWindow()
    }

    /** The one place that decides: run while active and attached. Main thread only; start/stop are idempotent. */
    private fun reconcile() {
        if (wantActive && attached) start() else stop()
    }

    private fun stop() {
        source?.stop()
        source = null
        engine?.close()
        engine = null
    }

    private fun start() {
        if (source != null) return
        val owner = appContext.currentActivity as? LifecycleOwner ?: return emitError("카메라 화면을 열 수 없어요.")
        val e = try {
            PoseEngine(context, model, PoseOptions.fromJson(detectorJson), ::emitPose, ::emitEngine, ::emitError)
        } catch (ex: Exception) {
            Log.e(TAG, "pose engine failed to start", ex)
            return emitError("자세 인식을 시작하지 못했어요.")
        }
        engine = e
        emitEngine(e.delegate)
        source = FrontCameraSource(context).also {
            it.start(owner, previewView.surfaceProvider, { frame -> e.detect(frame) }, ::emitError)
        }
    }

    /** Called on MediaPipe's thread. Expo map events cannot carry null: nobody in view = empty lists. */
    private fun emitPose(r: PoseResult) {
        val now = SystemClock.elapsedRealtime()
        val image = r.image
        val vis = r.visibility
        val lm = if (image != null && vis != null) List(N * 3) { k -> if (k % 3 == 2) vis[k / 3].toDouble() else image[k].toDouble() } else emptyList()
        val payload = mapOf<String, Any>(
            "tMs" to r.tMs.toDouble(),
            "seq" to r.sourceFrames.toDouble(),
            "ageMs" to (now - r.tMs).toDouble(),
            "emitWallMs" to System.currentTimeMillis().toDouble(),
            "latencyMs" to r.captureMs,
            "captureFrom" to r.captureFrom,
            "aspect" to r.aspect.toDouble(),
            "image" to lm,
            "world" to (r.world?.map { it.toDouble() } ?: emptyList()),
        )
        main.post { onPose(payload) }
    }

    private fun emitEngine(delegate: String) {
        main.post { onEngine(mapOf("model" to model, "delegate" to delegate)) }
    }

    private fun emitError(message: String) {
        main.post { onError(mapOf("message" to message)) }
    }

    companion object {
        private const val TAG = "PoseCameraView"
        private const val N = 33
    }
}