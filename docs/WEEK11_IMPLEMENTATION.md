# Week 11 scenario: implementation and gaps

This document describes the current implementation, not a claim that the complete scenario is finished. Earlier session data is retained in its original form; it may include analysis from outside recordings.

## Implemented in this pass

- Home links to the latest project and counts distinct projects with a finished MP4.
- A mission practice can be opened or resumed with a mission identifier and title. The linked project is marked in Workspace and mission sessions and videos appear in Mission history. The existing weekly progress metric is still ended sessions of at least 30 seconds, not validation of a particular mission.
- Playback offers 0.5×–1.5× speeds and persists the selected speed. Pitch changes with speed. Watch pulse timing is rescaled; actual watch timing still needs device testing. Recording speed is stored and applied when previewing and rendering a timeline.
- Recording can start before or after music. A recording can be reviewed, saved or discarded. The music start offset is recorded for timeline preview and MP4 rendering. Playback seeking, repetition and pause are disabled while recording to avoid introducing a discontinuity in the clip timeline.
- Newly captured body measurements are provisional until saving the recording; discard restores previous totals, and routine checkpoints exclude provisional measurements. Tracking still performs camera calibration before recording. Existing analytics previously saved under older behavior are not automatically migrated or deleted.
- Saved MP4s can be renamed or deleted.
- With the camera screen and projection connection open, the display, phone and watch can respond to the same help request. The watch vibrates for a new help request and can start or stop recording while the phone camera screen is open. This requires the updated watch app, a paired watch and device verification.

## Still missing or limited

- The desktop display receives the phone camera's aggregates. A computer webcam adapter, desktop packaging and permissions are not implemented.
- The suggestion engine is a local rules-based prototype, not an autonomous or learned model. It does not yet use music mood, recorded video interpretation, long-term preference learning or a model provider. Its timing thresholds are unvalidated.
- The display publishes movement only during a phone recording. A recording is currently limited to 60 seconds and cannot begin with a loop selected. Repetition and time without saving are counted while music plays with the display connection open; after a repeated loop is turned off, a help request can appear during the next recording when body tracking is available. Similar-section repetition and manual-seek repetition detection are not implemented.
- Individual missions remain practice prompts; mission-specific completion, saved-move checks, monthly community comparisons, relay capture/comparison, and matching opposite heatmaps are not implemented. Mission practice currently uses the selected ordinary project; it does not yet create a separate mission project.
- Watch recording and suggestion responses require physical-device testing. The APK produced by a local debug build uses the debug key; it is not a replacement for an EAS-signed APK.
- Motion analysis currently estimates observed body movement, selected body-part proportions, space and movement features. Saved measurements are aggregated at session level, so deleting an individual source clip does not currently remove its contribution. It cannot reliably infer musical attention, musical alignment, intent, quality, or mood. Layer listening time is an audible-mix estimate; explicit timeline focus labels are user-entered.
- Camera analysis filters and end-to-end desktop camera support remain to be implemented. Clips recorded before playback retain a leading segment that the timeline skips using metadata; device-level A/V timing accuracy has not been measured.
