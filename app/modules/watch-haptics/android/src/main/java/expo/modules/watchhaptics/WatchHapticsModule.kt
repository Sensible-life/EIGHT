package expo.modules.watchhaptics

import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class WatchHapticsModule : Module() {
  private var node: String? = null
  private var clockOffset = 0.0
  private var sequence = 0L
  private val session = UUID.randomUUID().toString()
  private val context get() = requireNotNull(appContext.reactContext)
  private fun request(path: String, payload: JSONObject): JSONObject {
    val target = requireNotNull(node) { "워치 앱을 열고 다시 연결해 주세요." }
    val response = Tasks.await(Wearable.getMessageClient(context).sendRequest(target, "/layerlab/$path", payload.toString().toByteArray(Charsets.UTF_8)), 5, TimeUnit.SECONDS)
    val result = JSONObject(String(response, Charsets.UTF_8))
    check(result.optBoolean("ok")) { result.optString("error", "워치 응답 오류") }
    return result
  }
  override fun definition() = ModuleDefinition {
    Name("WatchHaptics")
    Function("now") { SystemClock.elapsedRealtime().toDouble() }
    AsyncFunction("connect") {
      node = null
      val capability = Tasks.await(Wearable.getCapabilityClient(context).getCapability("layer_lab_haptics", CapabilityClient.FILTER_REACHABLE), 5, TimeUnit.SECONDS)
      val target = capability.nodes.filter { it.isNearby }.sortedBy { it.id }.firstOrNull()
        ?: error("가까운 워치를 찾지 못했어요. Bluetooth 연결과 워치 앱 설치를 확인해 주세요.")
      node = target.id
      var bestRtt = Double.MAX_VALUE
      try {
        repeat(3) {
          val start = SystemClock.elapsedRealtime().toDouble()
          val result = request("clock", JSONObject())
          val end = SystemClock.elapsedRealtime().toDouble()
          if (end - start < bestRtt) {
            bestRtt = end - start
            clockOffset = result.getDouble("watchTimeMs") - (start + end) / 2
          }
        }
        mapOf("name" to target.displayName, "roundTripMs" to bestRtt)
      } catch (e: Exception) { node = null; throw IllegalStateException("워치에서 Layer Lab 앱을 열고 연결해 주세요.", e) }
    }
    AsyncFunction("prepare") { pattern: String ->
      require(pattern.toByteArray(Charsets.UTF_8).size <= 80000)
      request("pattern", JSONObject(pattern).put("session", session))
      Unit
    }
    AsyncFunction("sync") { state: String ->
      val payload = JSONObject(state)
      payload.put("session", session).put("sequence", ++sequence)
      payload.put("watchAnchorMs", payload.getDouble("sampledAtMs") + clockOffset + payload.optDouble("startDelayMs", 0.0))
      request("transport", payload)
      Unit
    }
    AsyncFunction("stop") {
      if (node != null) request("stop", JSONObject().put("session", session).put("sequence", ++sequence))
      Unit
    }
    AsyncFunction("test") { request("test", JSONObject()); Unit }
  }
}
