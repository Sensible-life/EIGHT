# Creative display prototype

The creative display is a browser view backed by the existing Python server. It is separate from the floor projection: both can subscribe to the same room at the same time. The existing 8×8 floor projection remains available at `/projection/<room>`.

## Try it without devices

```bash
cd server
./run.sh
```

Open `http://localhost:8000/display/demo` on the server computer. The control bar (move the mouse to show it) says **DEMO · SCRIPTED DANCER**: instead of a camera, a scripted dancer (`app/src/tracking/figures.ts`) goes through the same tracking code as the webcam, so everything after the figure is the real reading. Open the debug view (`D`) to see the dancer as a wireframe, which is exactly what goes in. The dancer stands still for the calibration, dances with the arms only, and when the character appears with its "…" bubble it holds an O over its head; it then tries what the character suggested ("You tried it!") and goes back to the arms, so the guide asks about the next thing it leaves out. A demo asks sooner than a real session (8 s warm-up, 4 s lacking, 20 s between questions). You can still answer with **Y** / **N** or the control bar. Try **Labels · L** as well. Each demo page dances in a room of its own; the debug view's Room link shows it on another screen.

**Moves** (`/display/moves`, also in the control bar): what each word means. Every card loops a scripted figure (the moving part brighter, the path of one joint behind it) and shows what the real labeler reads from it, with a check mark when it is the word the card is about.

## Connect the phone

1. Start or restart `server/./run.sh` so the new endpoint is loaded. Connect the phone and display computer to the same trusted network, and put the printed server address into the phone app's settings.
2. Start a practice session, open **Camera**, set up tracking, and start music playback. Open **Connect projection display**, then select **Start projection**.
3. Open the displayed **Creative display** URL (`/display/<room>`) on the computer or display device. The other URL is the original floor projection. Both URLs are specific to that running session; reopen them when a new room is created.
4. Calibrate the floor area if using a projector. The space view otherwise represents camera coordinates, not calibrated floor positions.

An updated phone app JS bundle is needed to send body aggregates. Older phone bundles still send the floor heatmap, but the 8 remains neutral and the guide does not offer body-based ideas. The phone camera must remain visible, recording, tracking active, and arms and legs visible. The body values summarize the recent 30-second window: relative arm activity against relative leg activity, normalized against one another (shown in the debug view as "Arms / legs"). They are estimates, not scores, quality assessments, or measurements of strength. A missing/occluded body part is not counted as unused. Tracking loss, music pause, stopping the recording and a stale connection suppress proposals. No camera images or pose coordinates are transmitted.

## The display with the computer's webcam

The display reads the dancer itself with the same tracking code as the phone (`app/src/tracking/`, bundled into `server/app/static/tracking.js` by `npm run build:display` in `app/`). Three modes, chosen by the address:

| Address | Who reads the dancer | Notes |
|---|---|---|
| `/display` | this computer's webcam | a new room on every load; no phone needed |
| `/display?room=<phone room>` | this computer's webcam, inside a phone session | the phone gives the music clock and recording, and can start and stop a webcam recording (the page shows "● REC"; the server converts the take to mp4 for the phone to save); the debug view lists phone sessions to join |
| `/display/<room>` | the phone's camera | as before; video stays on the phone |

`/movement` (the old webcam page) redirects to `/display`. The page asks to stand still for 3 seconds (calibration). The screen itself stays clean: the 8, and the character when it has something to say. The 8's colors move with the dancer: each limb has a corner (arms on top, legs below, the dancer's left on the left), pink when that limb did a lot of the movement in the last 30 seconds and blue when it barely moved (`body.limbs`, each limb's share; an even 25 % is the middle color). A limb not seen enough stays the middle color, never blue. Controls (suggestions on/off, labels, debug, EN/KO, demo, and yes/no while the character asks) sit in a bar that shows when the mouse moves and hides with the cursor.

**Design values** (colors, text sizes, the label and character positions) are in one block at the top of `server/app/display.html`, in px of the 1280×720 design frame as read in Figma. Change a value, save, and reload the page; the server reads the file on every request, so it needs no restart. Every value, the texts, and how to swap the 8 or the character for a new shape: [DISPLAY_DESIGN.md](DISPLAY_DESIGN.md) (Korean).

**Labels** (`L` or the Labels button, remembered per browser): each part's name on the 8, on the dancer's own side (the screen is a mirror), with what it is doing in large type so it can be read from where the dancer stands. A part named "less used" is one the guide may point out; the torso's lines add the space and the less-used heights and sides. The words:

- **Each part** (left/right arm, left/right leg, torso): a kind (`hold`, `reach`, `circle` (around the shoulder or hip, or just the forearm around the elbow / the lower leg around the knee), `swing`, `shake`; legs also `step`: a foot leaves its spot and lands again while the other foot stands; torso `hold`, `shift`, `travel`, `jump`, `drop`), plus speed, size, texture, direction and timing against the phone's music or a typed BPM. A part not seen enough is unknown, never "still", and is never pointed out as unused.
- **Space**, against the spot where the dancer stood still: zone (the dancer's own left/center/right), level, depth, weight and width used.

**Debug view** (`D` or the Debug button, remembered per browser, draggable by its header): in every mode, the room's reading (status, arms/legs, less used, movement, space, the guide's state, idea, reason and timers); with the webcam also the mirrored video with the skeleton, fps and GPU/CPU, tracker state, part shares, unknown parts, heights, what is lacking and what was tried, the input (webcam or a looping dance video), a BPM field, and the room address.

**The character with a webcam**: after a 15 s warm-up, a limb, height (low/high) or side (left/right) that stays lacking for 8 s makes it ask. It does not pop up out of nowhere: as the question nears (`agent.soon`, 0..1: the slowest of the warm-up, the cooldown and the lack against its 8 s), it shows up faintly and circles the 8 on a tilted orbit (passing behind it on the far side), clearer the closer the question is; when it asks it does not cut across but keeps circling (a little faster if it is far round, at most 3 s) until it reaches the point of the orbit nearest its spot, settles there, and the "…" bubble pops up; done talking with another question already on its way, it steps back onto the orbit from that point (cooldown 30 s, the same target 60 s; the longest-lacking target first). The dancer says yes with an **O over the head held for 3 s**, one dot of the bubble lighting per second; no O within 12 s is a no ("Maybe later."). A yes turns the bubble into the idea, such as "How about trying to use your left arm?". Keyboard `Y`/`N`, the control bar, and (in a phone session) the phone and watch answer too. After a yes, trying the target within 60 s shows "You tried it!" The phone camera's rules (2 minutes without a save, or three passes through a loop) are unchanged.

Video and landmarks stay in the page; the relay passes only known words and bounded numbers (`movement`, `parts`, `space`, `body`, plus `explored`/`answering` for the guide, in `projection.py`). Positions are 2D, so a reach towards the camera or a spin on the spot is not seen. Camera jitter is handled in two ways: speeds are measured over a tenth of a second (centered) rather than frame to frame, and the still stand that sets the home spot also measures how fast each part seems to move while still (its jitter), which is taken off later speeds. So a part that does not move reads as `hold`, not `shake`, while the other side dances; a much smaller movement than the jitter (a hand shaken by a couple of centimetres) is lost with it. The words are worked out five times a second, not every frame (the page sends four packets a second). The thresholds (`labels`, `answer`, `targets` in `app/src/tracking/config.ts`) are first values tuned on scripted figures and still need tuning on real dancers.

## Workflow

`display_agent.py` contains a separate in-memory `MovementGuide` per publishing session:

1. **Observe:** accept normalized arm/leg aggregates and the existing tracker's observable `underused` targets. Each `Observation` also carries the latest checked movement reading (`movement`, `parts`, `space`: the same words the display shows, from the webcam or the phone), so a `ProposalGenerator` can base its idea on how the dancer is moving, not only on the target.
2. **Decide:** require stable tracking, warm-up and sustained evidence plus either 120 seconds without a save or three passes through a selected loop. Only playback time received during this display session counts; a save resets the timer. Cooldowns limit interruptions. The demo uses a shorter seven-second timer. Real phone input currently publishes movement only during a recording.
3. **Ask:** show the character’s help request; only generate a suggestion if the user accepts it.
4. **Propose:** the injected `ProposalGenerator` turns the chosen target into a short creative prompt. `LocalPromptGenerator` is currently deterministic and rule-based; it is **not an LLM or trained AI model**. The generator interface is the boundary for evaluating a model provider later; a model must not bypass the local eligibility rules. A remote model must run outside the WebSocket event loop, with a deadline and validated output; the current synchronous interface is intended for fast local generation.
5. **Respond:** the display accepts or dismisses a current proposal, or pauses suggestions. A stale proposal ID is rejected. A pending proposal expires automatically. Responses and cooldowns are retained only in memory for the publisher session.

These thresholds and prompts are starting points for testing, not validated recommendations. The display, phone, and a connected watch can answer the same request. Watch controls require an updated watch build and a paired device. The display connection and phone camera tab must remain open. No personalization, LLM calls, automatic video interpretation, or user-outcome assessment are implemented yet. Loop repetition detection currently covers an explicitly selected loop, not similar or manually repeated sections. Recording analysis is provisional until the recorded video is saved; discarding it rolls back the provisional totals. Older data remains as originally saved. Recording with a loop selected is not yet supported; the workflow remembers repeated loops during playback and can ask during a subsequent recording.

## Boundaries and desktop options

The page and the Python service use WebSockets on the local network. There is no room authentication or encryption in this prototype: anyone with the room URL on the trusted LAN can view aggregates or respond to suggestions. Publishing is single-writer per room. No pose/video or decisions are persisted by the display workflow.

The browser view reads the computer's webcam at `/display` (above) and the phone's aggregates at `/display/<room>`. The pose model and MediaPipe library load from a CDN, so the display computer needs internet access. A packaged macOS app (`.app` distributed in a `.dmg`) or Windows executable can host the same Python workflow and view, but an actual desktop-camera adapter, model/runtime distribution, camera permissions, installers/signing and cross-platform device tests remain separate work. Add an adapter that emits the same aggregate observation contract; do not send raw camera frames through the display relay.
