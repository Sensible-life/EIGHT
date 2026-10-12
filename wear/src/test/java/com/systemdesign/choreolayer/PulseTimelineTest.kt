package com.systemdesign.choreolayer

import org.junit.Assert.*
import org.junit.Test

class PulseTimelineTest {
    private val timeline = PulseTimeline(4000.0, listOf(Pulse(500.0, 100), Pulse(1500.0, 200), Pulse(2500.0, 150)))
    @Test fun seekingSkipsEarlierPulses() {
        assertEquals(300.0, timeline.next(1200.0, null, 0.0)!!.delayMs, 0.001)
        assertNull(timeline.next(3000.0, null, 0.0))
    }
    @Test fun calibrationMovesHapticsWithoutChangingAudio() {
        assertEquals(200.0, timeline.next(1200.0, null, -100.0)!!.delayMs, 0.001)
        assertEquals(400.0, timeline.next(1200.0, null, 100.0)!!.delayMs, 0.001)
    }
    @Test fun repeatsOnlyEventsInsideSelectedLoop() {
        assertEquals(800.0, timeline.next(1700.0, Loop(1000.0, 2000.0), 0.0)!!.delayMs, 0.001)
        assertEquals(300.0, timeline.next(2200.0, Loop(1000.0, 2000.0), 0.0)!!.delayMs, 0.001)
    }
    @Test fun silenceHasNoInventedBeats() { assertNull(PulseTimeline(4000.0, emptyList()).next(0.0, null, 0.0)) }
    @Test(expected = IllegalArgumentException::class) fun invalidLoopRejected() { timeline.next(0.0, Loop(2000.0, 1000.0), 0.0) }
    @Test(expected = IllegalArgumentException::class) fun invalidPatternRejected() { PulseTimeline(4000.0, listOf(Pulse(Double.NaN, 20))) }
}
