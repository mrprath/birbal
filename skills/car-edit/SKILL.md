---
name: car-edit
description: Render stylized 2D car edit videos from user-provided footage
version: 1.0.0
triggers:
  - "edit a car video"
  - "car edit"
  - "make a car edit"
  - "render car video"
security:
  - DR-9: No shell interpolation — spawn/array args for FFmpeg
  - S6: Never expose credentials in output
  - DR-7: Repo isolation — all paths within skills/car-edit/
---

# car-edit

Render stylized 2D car edit videos from footage on demand.

## WHY

Car edits are a popular video format — slow-mo rolls, cinematic color grading, aggressive cuts synced to beats. The tedious parts (effect stacking, color correction, speed ramping, export settings) are automatable. This skill handles the pipeline so the user focuses on creative direction. Jev makes the creative decisions structured and repeatable.

## Behavior

1. **Get footage.** Ask the user for a video file path. It must resolve within the repo. If no footage, offer to generate a synthetic sample (`--generate-sample`).
2. **Get style.** Ask for the edit style in natural language. If clear (cinematic, aggressive, clean, moody), use the matching preset. If vague, call Jev Choice to classify.
3. **Analyze footage.** Run OpenCV frame sampling to extract brightness, motion level, and dominant colors.
4. **Select effects.** Load preset from `effects.py`. Call Jev Noul to validate the effects match the footage + mood. If confidence < 0.6, adjust.
5. **Render.** Run `render.py` with array args (DR-9). MoviePy applies effects, composites layers, exports via FFmpeg.
6. **Quality gate.** Jev Score rates the output on [poor, passable, good, excellent]. Report the verdict.
7. **Deliver.** Present the output path, effects applied, and Jev quality score.

### Running render.py

```
python skills/car-edit/render.py \
  --input <footage-path> \
  --style <cinematic|aggressive|clean|moody> \
  --output skills/car-edit/output/<name>.mp4
```

Generate a sample instead of requiring footage:
```
python skills/car-edit/render.py --generate-sample --output skills/car-edit/sample/synthetic.mp4
```

All subprocess calls use array-form args. Never shell=True. Never interpolate user input into command strings.

## Jev Integration

Three decision points, all via POST to `https://api.typesafe.ai/v1/systemone` with `JEV_API_KEY` from `.env`:

1. **Style Classification (Choice)** — when the user's style request is ambiguous. Criteria: cinematic, aggressive, clean, moody.
2. **Effect Validation (Noul)** — after selecting effects: "Do these effects match the intended mood given this footage?" Gate at 0.6.
3. **Quality Gate (Score)** — after rendering: rate output on [poor, passable, good, excellent].

## Security Constraints

- FFmpeg and Blender paths come from `.env` (`FFMPEG_PATH`, `BLENDER_PATH`), never hardcoded (DR-2)
- All subprocess calls use `subprocess.run([...], shell=False)` with list args (DR-9, S15)
- All file paths validated to resolve within repo root (DR-7, S8)
- API key read from env, never printed or logged (S6)
- Output videos are gitignored

## What This Skill Does NOT Do

- Upload videos anywhere
- Access footage outside the repo without explicit user approval
- Generate music or audio (uses source audio or silence)
- Auto-commit or auto-push video outputs
- Run Blender 3D renders (future scope — currently 2D edits only)
