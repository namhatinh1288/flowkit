# fk-plan-video — Continuity-Aware I2V Camera + Dialogue Planning

Use this skill **after scene images are completed and before video generation**. Its job is to plan each 8-second I2V clip so camera movement, dialogue timing, acting, and the final composition cut naturally into the next scene.

This skill **does not generate video**. It only plans and persists `video_prompt` values for later use by `/fk-gen-videos`.

Usage:

```text
/fk-plan-video <project_id> <video_id> [scene selection]
```

Examples:

```text
/fk-plan-video <PID> <VID>
/fk-plan-video <PID> <VID> scenes 3-5
/fk-plan-video <PID> <VID> scenes 3,4,5
```

---

## Core idea

Do not treat each scene as an isolated clip.

For scene **N**, plan the video using:

- the current scene beat and still image
- current dialogue/action
- ROOT vs CONTINUATION relationship
- the previous scene when continuity matters
- **the next scene and next scene image/composition** when one exists

The goal is not pixel-perfect morphing into the next image. The goal is to make the **cut feel intentional**.

```text
CURRENT SCENE
+ current image/composition
+ dialogue/action beat
+ chain context
+ NEXT SCENE
+ next image/composition
        ↓
CAMERA + PERFORMANCE PLAN
        ↓
8-second video_prompt
        ↓
I2V later via /fk-gen-videos
```

---

## Non-negotiable rules

1. **Do not generate video in this skill.**
2. **Do not regenerate scene images or references.**
3. **Do not modify ROOT/CONTINUATION relationships.**
4. **Do not set or clear `*_end_scene_media_id`.** This skill plans normal start-image-only I2V.
5. Preserve existing approved story facts, characters, wardrobe, props, locations, and scene images.
6. If dialogue already exists, preserve its meaning and speaker ownership. Do not silently rewrite approved dialogue.
7. If no dialogue exists, only add concise dialogue when the beat clearly benefits from speech. Do not force dialogue into purely visual beats.
8. The current scene image is the visual starting authority. Do not describe an opening pose/composition that contradicts it.
9. The next scene is a **cut target**, not an end-frame constraint.
10. Camera serves the drama. Do not add movement merely to make the shot feel "cinematic."

---

## Phase 0 — Pre-flight

Read the project/video/scenes:

```bash
curl -s http://127.0.0.1:8100/api/projects/<PID>
curl -s "http://127.0.0.1:8100/api/scenes?video_id=<VID>"
```

Detect orientation from project/video metadata. Never hardcode it.

For the selected scenes, require:

- completed scene image status
- valid UUID image `media_id`
- current `prompt`
- `chain_type`
- `parent_scene_id` where applicable

If a selected scene image is not ready, stop before planning that scene.

Sort scenes by `display_order`.

---

## Phase 1 — Build visual continuity context

For every selected scene, inspect:

### Current scene

- beat/action
- visible characters/props/location
- shot size if inferable
- camera angle if inferable
- subject placement: left / center / right
- eyeline / facing direction if inferable
- dominant visual focus
- lighting / mood
- whether dialogue is expected

### Previous scene

Use when:

- current scene is CONTINUATION
- same location/action continues
- screen direction, eyeline, or spatial geography matters

### Next scene — mandatory look-ahead when one exists

Inspect the next scene for:

- next primary subject
- next shot size / angle if inferable
- next visual focus
- next subject placement
- next location/state change
- whether the next cut should feel continuous, contrasting, or intentionally abrupt

### Actual image vs prompt fallback

Prefer the actual generated scene image when the agent environment can inspect it.

If actual image vision is unavailable, infer only from the persisted still-image prompt + scene metadata and explicitly mark the visual read as `PROMPT_INFERRED` rather than pretending the image was inspected.

Never invent image details that are not visible or supported by the scene prompt.

---

## Phase 2 — Choose cut strategy

Choose one strategy per scene transition.

### A. CONTINUITY CUT

Use for same location / continuous action / same conversation.

Goals:

- preserve screen direction when appropriate
- preserve eyeline logic
- avoid unexplained subject-side reversals
- progress shot size intentionally
- let the current clip end in a composition that cuts naturally into the next scene

Good progressions:

```text
wide → medium
medium → close-up
over-the-shoulder → reverse over-the-shoulder
reaction medium → insert/detail
```

Do not mechanically alternate shots. Choose based on the dramatic beat.

### B. CONTRAST CUT

Use when the next scene intentionally changes emphasis while remaining in the same story flow.

Examples:

- calm wide → shocked close-up
- bright room → dark reveal
- character face → evidence insert

The end of the current clip should prepare attention for the contrast without trying to imitate the next frame.

### C. HARD RESET CUT

Use for:

- major location change
- time jump
- new primary perspective
- deliberately abrupt story break

Do not waste the final seconds steering toward unrelated geometry. Finish the current beat cleanly.

---

## Phase 3 — ROOT vs CONTINUATION camera rules

### ROOT scene

ROOT has more camera freedom.

Prefer one of:

- establishing → controlled push-in
- medium introduction → subtle dolly
- clean static composition when dialogue/performance is the focus
- deliberate reveal movement tied to story information

A ROOT scene should establish the current geography or dramatic focus before becoming more expressive.

### CONTINUATION scene

CONTINUATION must feel related to the prior beat, but **must not simply repeat the prior framing**.

Before choosing the camera, ask:

1. What information did the previous shot already establish?
2. What new information/emotion does this shot need to emphasize?
3. Where is the important subject in the current image?
4. What is the next scene trying to show?
5. What camera move can connect those beats without crossing the visual axis unnecessarily?

For a CONTINUATION scene:

- keep spatial logic from the previous scene when useful
- change shot size or angle with purpose
- avoid arbitrary 180° reversals
- avoid repeating the exact same dolly/pan pattern
- use reaction shots, OTS, inserts, rack focus, or restrained push-ins when they fit
- reserve the final 1–2 seconds for a useful **handoff composition** when the next scene is related

---

## Phase 4 — Dialogue-first timing

Camera movement must not consume the whole 8-second clip when dialogue matters.

Default 8-second timing for dialogue scenes:

```text
0.0–0.8s   visual anchor / settle
0.8–6.6s   dialogue + acting + restrained camera movement
6.6–8.0s   reaction / reveal / exit composition toward next cut
```

For lighter dialogue:

```text
0.0–1.2s   establish
1.2–6.2s   dialogue/action
6.2–8.0s   visual handoff
```

For visual-only beats, use the full duration as needed.

### Dialogue rules

- Keep speech natural for ~8 seconds.
- Do not cram long exposition into one clip.
- One character may own multiple consecutive lines if dramatically appropriate.
- Do not force A-B-A alternation.
- Allow reaction silence.
- Use delivery verbs only when useful: says, whispers, asks, replies, gasps, mutters, shouts.
- No subtitles unless explicitly requested.

If dialogue already exists elsewhere in project data, preserve exact wording unless the user explicitly authorizes rewriting.

---

## Phase 5 — Camera vocabulary

Follow `/fk-camera-guide` conventions.

Prefer clear, filmable camera instructions:

- static / locked-off
- slow dolly-in / dolly-out
- pan left / right
- tilt up / down
- tracking shot
- gimbal glide
- subtle arc
- over-the-shoulder
- rack focus
- insert / detail shot
- wide / medium / close-up

Rules:

- camera movement should be its own clear sentence or timed instruction
- normally one dominant movement per shot
- avoid combining incompatible or excessive moves
- avoid meaningless words such as "dynamic cinematic camera" without specifying what the camera actually does
- preserve vertical-friendly composition in VERTICAL projects

---

## Phase 6 — Create a planning record before writing prompts

For each selected scene, first output a compact plan:

```json
{
  "scene": 4,
  "chain": "CONTINUATION",
  "visual_read": "IMAGE_INSPECTED",
  "opening_shot": "side medium shot near display platform",
  "dramatic_focus": "lights fail and guests realize something is wrong",
  "dialogue_window": "0.8-6.4s",
  "camera_move": "slow push toward display case",
  "screen_direction": "preserve prior ballroom axis",
  "next_scene_target": "empty case + Headmistress reaction",
  "exit_composition": "finish tighter on display case",
  "cut_strategy": "CONTINUITY_CUT"
}
```

For the last scene, use:

```text
next_scene_target: NONE
```

and finish the dramatic beat cleanly.

---

## Phase 7 — Write the 8-second `video_prompt`

Write natural English suitable for Veo-style I2V.

Recommended structure:

```text
0-<t>s: opening action from the existing still image + initial camera behavior.
<t>-<t>s: primary acting/dialogue beat + restrained camera movement.
<t>-8s: reaction/reveal/handoff composition that prepares the next cut.
Audio: ...
SFX: ...
Music: ...
Negative: subtitles, watermark, text overlay.
```

Do not repeat detailed character appearance already established by the image/ref system.

Do not instruct the model to "end exactly on the next frame" or morph into the next scene. This skill is for normal I2V with editorial cutting.

### Look-ahead wording

The prompt may steer attention toward the next scene, for example:

```text
During the final second, the camera settles closer to the display case, holding the empty velvet stand as the visual focus.
```

Good.

Do not write:

```text
Transform into Scene 5 / match the next image exactly / morph into the next frame.
```

Bad for this workflow.

---

## CHECKPOINT — PLAN REVIEW

Before persisting anything, show:

| Scene | Chain | Opening | Camera | Dialogue window | Exit composition | Cut strategy |
|---|---|---|---|---|---|---|

Then show each proposed `video_prompt`.

Stop and ask for approval.

Do **not** PATCH scene rows before approval.

---

## Phase 8 — Persist approved prompts only

After approval, PATCH only the approved selected scenes.

Example:

```bash
curl -X PATCH http://127.0.0.1:8100/api/scenes/<SID> \
  -H "Content-Type: application/json" \
  -d '{"video_prompt":"<APPROVED_VIDEO_PROMPT>"}'
```

Do not modify:

- `prompt`
- image media IDs
- image URLs
- ROOT/CONTINUATION relationship
- `parent_scene_id`
- entity bindings
- end-frame media IDs
- video status/media fields

Verify the patched scenes with:

```bash
curl -s "http://127.0.0.1:8100/api/scenes?video_id=<VID>"
```

Print:

```text
VIDEO PLAN COMPLETE
Scenes planned: <selected>/<total>
video_prompt persisted: YES
videos generated: NO

Next action only when explicitly approved by user:
/fk-gen-videos <PID> <VID>
```

---

## Planning quality checks

Before approval, fail or revise the plan when any of these occur:

- camera contradicts the starting still image
- CONTINUATION repeats the previous shot without dramatic reason
- current scene ignores an obvious next-scene cut opportunity
- unexplained left/right reversal creates likely spatial confusion
- too many camera moves in one 8-second clip
- dialogue occupies nearly all 8 seconds with no room for acting/reaction
- camera move exists only for spectacle and distracts from dialogue
- prompt accidentally asks for end-frame morphing
- new character/location/prop appears that is not supported by the scene
- text/subtitle generation is requested accidentally

---

## Recommended workflow

```text
/fk-front-half
    ↓
approved scene images
    ↓
/fk-plan-video
    ↓
approved video prompts
    ↓
/fk-gen-videos
    ↓
/fk-concat
```

For projects with strong dialogue, treat `/fk-plan-video` as the directing pass between storyboard and video generation.
