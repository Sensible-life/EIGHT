package expo.modules.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PoseCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("PoseCamera")
        View(PoseCameraView::class) {
            Events("onPose", "onEngine", "onError")
            Prop("active") { view: PoseCameraView, active: Boolean -> view.setActive(active) }
            Prop("model") { view: PoseCameraView, model: String -> view.model = model }
            Prop("detectorJson") { view: PoseCameraView, json: String -> view.detectorJson = json }
            OnViewDidUpdateProps { view: PoseCameraView -> view.applyProps() }
            OnViewDestroys { view: PoseCameraView -> view.stop() }
        }
    }
}