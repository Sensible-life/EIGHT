package com.systemdesign.choreolayer

import kotlin.math.max

data class Pulse(val timeMs: Double, val amplitude: Int)
data class Loop(val startMs: Double, val endMs: Double)
data class NextPulse(val delayMs: Double, val amplitude: Int)

/** Pure media-time planner. It never relies on the phone and watch sharing a clock. */
class PulseTimeline(val durationMs: Double, val pulses: List<Pulse>) {
    init {
        require(durationMs.isFinite() && durationMs > 0)
        require(pulses.size <= 10000 && pulses.all { it.timeMs.isFinite() && it.timeMs >= 0 && it.timeMs < durationMs && it.amplitude in 1..255 })
        require(pulses.zipWithNext().all { (a, b) -> a.timeMs <= b.timeMs })
    }
    fun next(positionMs: Double, loop: Loop?, offsetMs: Double): NextPulse? {
        if (!positionMs.isFinite() || !offsetMs.isFinite()) return null
        if (loop != null) require(loop.startMs >= 0 && loop.endMs <= durationMs && loop.endMs > loop.startMs)
        val position = if (loop != null && positionMs >= loop.endMs) loop.startMs + positiveMod(positionMs - loop.startMs, loop.endMs - loop.startMs) else max(0.0, positionMs)
        var best: NextPulse? = null
        for (pulse in pulses) {
            if (loop != null && (pulse.timeMs < loop.startMs || pulse.timeMs >= loop.endMs)) continue
            var target = pulse.timeMs + offsetMs.coerceIn(-300.0, 300.0)
            if (loop != null) target = loop.startMs + positiveMod(target - loop.startMs, loop.endMs - loop.startMs)
            var delay = target - position
            if (delay < 0 && loop != null) delay += loop.endMs - loop.startMs
            if (delay < 0 || (loop == null && target >= durationMs)) continue
            if (best == null || delay < best.delayMs) best = NextPulse(delay, pulse.amplitude)
        }
        return best
    }
    private fun positiveMod(value: Double, divisor: Double) = ((value % divisor) + divisor) % divisor
}
