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
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import java.io.File
import java.util.UUID
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
    private var video: VideoCapture<Recorder>? = null
    private var recording: Recording? = null
    private var discardRecording = false

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
            val capture = VideoCapture.withOutput(Recorder.Builder().setQualitySelector(QualitySelector.from(Quality.SD)).build())
            val cases = listOfNotNull(
                preview?.let { surface -> Preview.Builder().setResolutionSelector(selector).build().also { it.setSurfaceProvider(surface) } },
                analysis,
                capture,
            )
            try {
                val p = future.get()
                try {
                    p.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, *cases.toTypedArray())
                    video = capture
                    useCases = cases
                } catch (unsupported: Exception) {
                    val fallback = cases.filter { it !== capture }
                    p.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, *fallback.toTypedArray())
                    video = null
                    useCases = fallback
                }
                provider = p
            } catch (e: Exception) {
                Log.e(TAG, "front camera failed to start", e)
                onError("카메라를 시작하지 못했어요.")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    override fun startRecording(onEvent: (String, String) -> Unit) {
        check(recording == null) { "이미 녹화 중이에요." }
        val recorder = video?.output ?: error("이 기기에서 카메라 분석과 녹화를 동시에 지원하지 않아요.")
        val file = File(context.cacheDir, "dance-${UUID.randomUUID()}.mp4")
        discardRecording = false
        val options = FileOutputOptions.Builder(file).setDurationLimitMillis(60_000).setFileSizeLimit(150_000_000).build()
        recording = recorder.prepareRecording(context, options).start(ContextCompat.getMainExecutor(context)) { event ->
            when (event) {
                is VideoRecordEvent.Start -> onEvent("started", "")
                is VideoRecordEvent.Finalize -> {
                    recording = null
                    val usable = !event.hasError() || event.error == VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED || event.error == VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED
                    if (!discardRecording && usable && file.exists() && file.length() > 0) onEvent("saved", android.net.Uri.fromFile(file).toString())
                    else { file.delete(); if (!discardRecording) onEvent("error", "영상을 저장하지 못했어요.") }
                }
            }
        }
    }

    override fun stopRecording() { recording?.stop() }

    /** Main thread only (CameraX unbind). */
    override fun stop() {
        running = false
        discardRecording = true
        recording?.stop()
        recording = null
        video = null
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