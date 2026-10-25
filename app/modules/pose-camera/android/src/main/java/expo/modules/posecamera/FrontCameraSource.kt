package expo.modules.posecamera

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * The phone's front camera through CameraX: ~640x480 RGBA, rotated upright, never mirrored, plus an
 * on-screen preview at the same 4:3 ratio so the skeleton lines up with it.
 * Frames are handed on and never stored (principle 3).
 */
class FrontCameraSource(private val context: Context) : FrameSource {
    private val executor = Executors.newSingleThreadExecutor { Thread(it, "camera") }
    @Volatile private var running = false
    private var provider: ProcessCameraProvider? = null
    private var useCases: List<UseCase> = emptyList()
    private var seq = 0L

    override fun start(owner: LifecycleOwner, preview: Preview.SurfaceProvider?, onFrame: (Frame) -> Unit, onError: (String) -> Unit) {
        running = true
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (!running) return@addListener // stopped before the provider was ready
            val selector = ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(
                    ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                )
                .build()
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(selector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setOutputImageRotationEnabled(true)
                .build()
            analysis.setAnalyzer(executor) { image ->
                val tMs = SystemClock.elapsedRealtime()
                val frame = try {
                    val sensorMs = image.imageInfo.timestamp / 1e6
                    Frame(image.toBitmap(), tMs, sensorMs, ++seq)
                } catch (e: Exception) { // skip this frame; never let it escape the camera thread
                    Log.w(TAG, "frame conversion failed", e)
                    null
                } finally {
                    image.close() // always, or KEEP_ONLY_LATEST stalls
                }
                if (frame != null) onFrame(frame)
            }
            val cases = listOfNotNull(
                preview?.let { surface -> Preview.Builder().setResolutionSelector(selector).build().also { it.setSurfaceProvider(surface) } },
                analysis,
            )
            try {
                val p = future.get()
                p.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, *cases.toTypedArray())
                provider = p
                useCases = cases
            } catch (e: Exception) {
                Log.e(TAG, "front camera failed to start", e)
                onError("카메라를 시작하지 못했어요.")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Main thread only (CameraX unbind). */
    override fun stop() {
        running = false
        useCases.filterIsInstance<ImageAnalysis>().forEach { it.clearAnalyzer() }
        if (useCases.isNotEmpty()) provider?.unbind(*useCases.toTypedArray()) // only ours, never unbindAll()
        provider = null
        useCases = emptyList()
        executor.shutdown()
    }

    companion object {
        private const val TAG = "FrontCamera"
    }
}