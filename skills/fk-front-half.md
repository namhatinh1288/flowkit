# fk-front-half — Story → References → Scene Images Only

Use this skill when the user wants Flow Kit's **front half only**: develop the story, extract reusable visual entities, generate reference images, and generate storyboard/scene images. **Do not generate video, TTS, music, thumbnails, concat, or YouTube output.**

Usage: `/fk-front-half [topic or story idea]`

## Non-negotiable stop rule

This workflow ends after scene-image review. Never invoke or recommend `/fk-gen-videos`, `/fk-gen-chain-videos`, `/fk-concat`, narration, music, thumbnail, or upload steps unless the user explicitly starts a separate video workflow later.

The local `video` row created below is only a **scene container** required by the current Flow Kit data model. It does not authorize video generation.

## Phase 0 — Pre-flight and minimal inputs

Check the local agent and Flow browser bridge:

```bash
curl -s http://127.0.0.1:8100/health
curl -s http://127.0.0.1:8100/api/flow/status
```

Require `extension_connected: true`. A signed-in `https://flow.google.com/` tab must stay open. If `flow_project_id` is missing, ask the user to create one Flow project in the Flow UI and provide/pin its UUID before any image generation.

Ask only for missing essentials:

1. **Topic / story seed** — a rough idea is enough. If the user gives a complete story, preserve its intent.
2. **Material / visual style** — run `GET /api/materials`; use one built-in or a custom material. Required.
3. **Target scene count** — exact count if provided; otherwise propose a practical count from the story.
4. **Orientation** — `VERTICAL` or `HORIZONTAL`.

Project name can be inferred from the story unless the user supplies one.

Do **not** ask the user to manually invent characters, locations, props, or scene prompts. The purpose of this skill is to derive them from the story and let the user review them.

---

## Phase 1 — Draft the story

From the user's seed, produce a coherent story suitable for visual scene breakdown.

Keep the story focused on visible actions and locations. Preserve named facts supplied by the user. Do not add unnecessary characters or locations merely to create variety.

Output for review:

```text
PROJECT: <name>
MATERIAL: <material>
ORIENTATION: <VERTICAL|HORIZONTAL>
TARGET SCENES: <N>

STORY:
<concise complete story>
```

### CHECKPOINT A — STORY APPROVAL

Stop and ask for `APPROVE`, edits, or a replacement story. Do not create project records yet.

If approved, continue.

---

## Phase 2 — Extract reusable visual entities

Identify every visual element that must remain consistent across multiple scenes.

Entity types:

- `character` — recurring person/character
- `location` — recurring place/environment
- `visual_asset` — important recurring prop/object
- `creature`, `generic_troop`, `faction` only when genuinely needed by the story

### Entity-description rule

`description` describes **appearance only**. It must not describe scene action.

For characters, define one clean base/default look in **one outfit only**. Do not mix several wardrobe states into the reference description. Include only durable identity cues such as approximate age, face/hair, build, palette, base outfit, and distinctive feature.

For locations, describe stable architecture/layout/materials and a neutral reusable lighting condition. Do not bake a one-off dramatic event into the location reference.

For props, describe shape, scale, material, color, markings, and other stable visual features.

Output a review table:

| Entity | Type | Appearance-only description | Used in scenes |
|---|---|---|---|

Avoid duplicate entities with slightly different names. Reuse a single canonical entity name whenever the same visual element returns.

### CHECKPOINT B — ENTITY APPROVAL

Stop and ask for `APPROVE`, additions, removals, renames, or description edits.

Do not generate references yet.

---

## Phase 3 — Build the scene board

Create exactly the approved target number of scenes unless the user changes it.

Each scene must contain:

- display order
- short beat/title
- `prompt` for the still image
- `character_names` containing **all** reference entities visible in that scene (despite the legacy field name, locations and visual assets also belong here)
- `chain_type`: `ROOT` or `CONTINUATION`
- `parent_scene_id` relationship to be assigned after persistence when applicable

### Still-image prompt rule

All image-generation prompts must be in English. Write the desired **visible result**:

- action / pose
- environment
- emotional read when visually observable
- shot size / camera position / angle
- lighting / mood

Do not repeat detailed character appearance. Reference images carry identity.

Do **not** create `video_prompt`, `transition_prompt`, narration, dialogue timing, audio, SFX, or motion choreography in this workflow.

### ROOT vs CONTINUATION for storyboard images

Use `ROOT` when:

- location changes substantially
- primary character/perspective changes
- there is a time jump
- a fresh composition is safer than editing the previous image

Use `CONTINUATION` only for direct visual continuity where editing the parent image is desirable. Never chain scenes whose primary subjects are unrelated.

For a CONTINUATION prompt, explicitly request a new camera angle/composition and the desired resulting moment so EDIT_IMAGE does not merely preserve the parent frame.

Output a review table:

| # | Beat | Prompt | Entities | Chain |
|---|---|---|---|---|

### CHECKPOINT C — SCENE BOARD APPROVAL

Stop and ask for `APPROVE` or scene edits. No image credits should be consumed before this checkpoint is approved.

---

## Phase 4 — Persist the approved project

### 4.1 Create local project + entities

Use the approved story, material, entities, and Flow project UUID:

```bash
curl -X POST http://127.0.0.1:8100/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<PROJECT_NAME>",
    "description": "Front-half storyboard project",
    "story": "<APPROVED_STORY>",
    "material": "<MATERIAL>",
    "flow_project_id": "<FLOW_PROJECT_UUID>",
    "characters": [<APPROVED_ENTITIES>]
  }'
```

Save `project_id` as `<PID>`.

### 4.2 Create the scene container

The API currently stores scenes under a `video` record. Create one, but treat it only as a storyboard container:

```bash
curl -X POST http://127.0.0.1:8100/api/videos \
  -H "Content-Type: application/json" \
  -d '{"project_id":"<PID>","title":"<PROJECT_NAME> — Storyboard","display_order":0}'
```

Save `video_id` as `<VID>`.

### 4.3 Create approved scenes

Create ROOT scenes first where IDs are needed as parents, then CONTINUATION scenes with the correct `parent_scene_id`.

```bash
curl -X POST http://127.0.0.1:8100/api/scenes \
  -H "Content-Type: application/json" \
  -d '{
    "video_id":"<VID>",
    "display_order":0,
    "prompt":"<APPROVED_STILL_PROMPT>",
    "character_names":["<ENTITY_1>","<ENTITY_2>"],
    "chain_type":"ROOT"
  }'
```

Do not set `video_prompt` or `transition_prompt`.

Verify with:

```bash
curl -s http://127.0.0.1:8100/api/projects/<PID>/characters
curl -s "http://127.0.0.1:8100/api/scenes?video_id=<VID>"
```

---

## Phase 5 — Generate reference images

Follow the existing `/fk-gen-refs <PID>` mechanics:

1. Get all project entities.
2. Skip entities that already have a valid UUID `media_id`.
3. Submit all missing `GENERATE_CHARACTER_IMAGE` requests using `POST /api/requests/batch`.
4. Let the server throttle; do not write manual loops or throwaway scripts.
5. Poll `GET /api/requests/batch-status?project_id=<PID>&type=GENERATE_CHARACTER_IMAGE` until done.
6. Verify each entity has a UUID `media_id` and a reference image URL.

Print a review table including entity, type, status, and reference image URL.

### CHECKPOINT D — REFERENCE APPROVAL

Stop before scene-image generation.

Ask the user to approve all references or identify entities to regenerate/edit. For an entity that needs another candidate, update its `image_prompt`/description if requested and use `REGENERATE_CHARACTER_IMAGE` only for that entity. Never regenerate already approved refs unnecessarily.

Proceed only after the user approves the reference set.

---

## Phase 6 — Generate storyboard / scene images

Follow the existing `/fk-gen-images <PID> <VID>` dependency rules, but this workflow stops after images.

### Pre-check

Abort if any referenced entity lacks a valid UUID `media_id`.

Detect orientation from the project metadata; never hardcode it.

### Dependency waves

- ROOT scenes → `GENERATE_IMAGE`
- CONTINUATION scenes → `EDIT_IMAGE`, only after the parent image is completed

Submit independent requests through `POST /api/requests/batch`. Do not manually loop request calls.

The worker automatically resolves reference images from `character_names`; CONTINUATION edits also resolve the parent's image as the base.

After all waves complete, verify each scene has a completed image and UUID image `media_id`.

Print a review table including scene number, beat, chain type, image status, and image URL.

### CHECKPOINT E — SCENE IMAGE REVIEW

Ask the user to approve the storyboard or list specific scenes to regenerate.

When regenerating:

- use `REGENERATE_IMAGE` only for the requested ROOT scene when possible
- respect cascade behavior: regenerating a parent can invalidate dependent CONTINUATION children
- re-run only the affected dependency chain, not unrelated completed scenes

---

## Phase 7 — Final front-half handoff and STOP

When the scene images are approved, print:

```text
FRONT HALF COMPLETE
Project: <PID>
Storyboard container: <VID>
Entities: <approved>/<total>
Scene images: <approved>/<total>

Completed:
✓ story
✓ entities
✓ reference images
✓ scene images

STOPPED BEFORE VIDEO GENERATION
```

Do not suggest a video command as the next action. The intended deliverable is the approved image storyboard and reusable reference library.

## Resume behavior

If the user runs `/fk-front-half` again for an existing `<PID>` / `<VID>`, inspect current state first and resume from the earliest incomplete checkpoint instead of recreating completed entities or images.
