package expo.modules.posecamera

import android.graphics.Bitmap
import androidx.camera.core.Preview
import androidx.lifecycle.LifecycleOwner

/**
 * One upright, un-mirrored camera frame. tMs = SystemClock.elapsedRealtime() when the app got
 * it; sensorMs = the camera's own timestamp in ms (its time base may differ, see PoseEngine).
 */
class Frame(val bitmap: Bitmap, val tMs: Long, val sensorMs: Double, val seq: Long)

/**
 * Where frames come from: the phone's front camera now, the amp hardware's camera later.
 * Only this part changes with the camera; pose and tracking stay the same.
 */
interface FrameSource {
    /** Start delivering frames; [onFrame] runs on the source's own thread. [preview] shows the camera on screen, if the source can. */
    fun start(owner: LifecycleOwner, preview: Preview.SurfaceProvider?, onFrame: (Frame) -> Unit)

    fun stop()
}