"""
car-edit render pipeline v3 — production grade
Cinematic car edits from still images + optional beat-synced audio.

Techniques sourced from professional car edit breakdowns:
- Feature-anchored Ken Burns (zoom to wheels, headlights, badges, body lines)
- Eased motion curves (no linear movement — smooth acceleration/deceleration)
- Shot sequencing: hook → establish → detail build → hero reveal
- Vignette, lens warmth, teal-orange grading
- Beat-synced cuts with speed ramps
- 1-3 second clips per image

Usage:
  python render.py --images sample/zr1x_*.jpg --style cinematic --car-name "CORVETTE ZR1X" --output output/edit.mp4
  python render.py --images sample/*.jpg --audio track.mp3 --style aggressive --output output/edit.mp4
"""

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SKILL_DIR = Path(__file__).resolve().parent
OUTPUT_FPS = 60
OUTPUT_WIDTH = 1920
OUTPUT_HEIGHT = 1080


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def validate_path(p, label="path"):
    resolved = Path(p).resolve()
    if not str(resolved).startswith(str(REPO_ROOT)):
        print(f"ERROR: {label} resolves outside repo root: {resolved}", file=sys.stderr)
        sys.exit(1)
    return resolved


def get_ffmpeg_path():
    path = os.environ.get("FFMPEG_PATH", "")
    if path and Path(path).exists():
        return str(Path(path))
    return "ffmpeg"


def load_env():
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())


def ease_in_out(t):
    """Smooth ease-in-out curve. t: 0.0-1.0 → 0.0-1.0"""
    return t * t * (3.0 - 2.0 * t)


def ease_out(t):
    """Smooth ease-out. Fast start, gentle stop."""
    return 1.0 - (1.0 - t) ** 3


def ease_in(t):
    """Smooth ease-in. Gentle start, fast end."""
    return t ** 3


# ---------------------------------------------------------------------------
# Beat detection
# ---------------------------------------------------------------------------

def detect_beats(audio_path, duration=None):
    """Detect beat timestamps. Returns (cut_times, tempo)."""
    import librosa
    print(f"  Detecting beats in: {Path(audio_path).name}")
    y, sr = librosa.load(str(audio_path), sr=22050, duration=duration)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    tempo_val = float(tempo) if not hasattr(tempo, '__len__') else float(tempo[0])
    print(f"  Tempo: {tempo_val:.0f} BPM | {len(beat_times)} beats")
    return beat_times, tempo_val


# ---------------------------------------------------------------------------
# Image analysis — find features to anchor on
# ---------------------------------------------------------------------------

def analyze_image_features(img):
    """
    Analyze an image to find interesting anchor regions:
    bright spots (headlights), high-detail areas (wheels, badges), edges (body lines).
    Returns list of (cx, cy, interest_score) normalized 0-1.
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Divide into a 4x3 grid, score each cell
    regions = []
    grid_cols, grid_rows = 4, 3
    cell_w, cell_h = w // grid_cols, h // grid_rows

    for gy in range(grid_rows):
        for gx in range(grid_cols):
            x1, y1 = gx * cell_w, gy * cell_h
            x2, y2 = x1 + cell_w, y1 + cell_h
            cell = gray[y1:y2, x1:x2]

            # Edge density (detail richness — wheels, badges, grilles)
            edges = cv2.Canny(cell, 50, 150)
            edge_score = np.mean(edges) / 255.0

            # Brightness variance (interesting lighting — headlights, reflections)
            bright_score = np.std(cell.astype(float)) / 128.0

            # Combined interest
            interest = edge_score * 0.6 + bright_score * 0.4

            cx = (x1 + x2) / 2 / w  # normalized center
            cy = (y1 + y2) / 2 / h
            regions.append((cx, cy, interest))

    # Sort by interest, return top regions
    regions.sort(key=lambda r: r[2], reverse=True)
    return regions


def plan_shot_motion(img, shot_type="detail"):
    """
    Plan a Ken Burns motion path that anchors on an interesting feature.
    Returns (start_cx, start_cy, start_scale, end_cx, end_cy, end_scale).
    All values normalized 0-1 for center, scale is zoom factor.
    """
    regions = analyze_image_features(img)
    # Most interesting region
    best = regions[0]
    second = regions[1] if len(regions) > 1 else best

    if shot_type == "hook_detail":
        # Start zoomed in on best feature, hold there with slight drift
        return (best[0], best[1], 2.0, best[0] + 0.02, best[1] + 0.01, 2.2)

    elif shot_type == "establish_wide":
        # Start wide, slow zoom in toward center
        return (0.5, 0.5, 1.0, 0.5, 0.48, 1.15)

    elif shot_type == "detail_zoom_in":
        # Start medium, zoom into best feature
        return (0.5, 0.5, 1.1, best[0], best[1], 1.8)

    elif shot_type == "detail_pan":
        # Pan from one interesting region to another
        return (best[0], best[1], 1.5, second[0], second[1], 1.5)

    elif shot_type == "slow_reveal":
        # Start on detail, zoom out to reveal full car
        return (best[0], best[1], 1.8, 0.5, 0.5, 1.0)

    elif shot_type == "hero_wide":
        # Full car, very slow subtle push in
        return (0.5, 0.5, 1.0, 0.5, 0.49, 1.08)

    elif shot_type == "drift_across":
        # Slow lateral drift across the car
        return (0.35, 0.5, 1.2, 0.65, 0.5, 1.2)

    else:  # gentle
        return (0.48, 0.5, 1.05, 0.52, 0.5, 1.1)


# ---------------------------------------------------------------------------
# Feature-anchored Ken Burns with easing
# ---------------------------------------------------------------------------

def ken_burns_frame(img, frame_idx, total_frames, motion_plan):
    """
    Render a single frame with smooth eased Ken Burns motion.
    motion_plan: (start_cx, start_cy, start_scale, end_cx, end_cy, end_scale)
    """
    h, w = img.shape[:2]
    t = frame_idx / max(total_frames - 1, 1)
    t_eased = ease_in_out(t)  # smooth acceleration/deceleration

    scx, scy, ss, ecx, ecy, es = motion_plan
    cx = scx + (ecx - scx) * t_eased
    cy = scy + (ecy - scy) * t_eased
    scale = ss + (es - ss) * t_eased

    # Calculate crop from source image
    crop_w = int(w / scale)
    crop_h = int(h / scale)

    # Center point in pixel space
    px = int(cx * w)
    py = int(cy * h)

    x1 = max(0, min(px - crop_w // 2, w - crop_w))
    y1 = max(0, min(py - crop_h // 2, h - crop_h))
    x2 = x1 + crop_w
    y2 = y1 + crop_h

    crop = img[y1:y2, x1:x2]
    resized = cv2.resize(crop, (OUTPUT_WIDTH, OUTPUT_HEIGHT), interpolation=cv2.INTER_LANCZOS4)
    return resized


# ---------------------------------------------------------------------------
# Color grading
# ---------------------------------------------------------------------------

def apply_vignette(frame, strength=0.4):
    """Darken edges to draw eye to center."""
    h, w = frame.shape[:2]
    Y, X = np.ogrid[:h, :w]
    cx, cy = w / 2, h / 2
    r = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    r_max = np.sqrt(cx ** 2 + cy ** 2)
    vignette = 1.0 - strength * (r / r_max) ** 2
    vignette = np.clip(vignette, 0, 1).astype(np.float32)
    return (frame.astype(np.float32) * vignette[:, :, np.newaxis]).astype(np.uint8)


def apply_color_grade(frame, grade="cinematic"):
    """Production color grading."""
    f = frame.astype(np.float32)

    if grade == "cinematic":
        # Teal shadows + warm highlights (Hollywood car commercial look)
        b, g, r = cv2.split(f)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        shadow_mask = np.clip(1.0 - lum / 180.0, 0, 1) ** 1.3
        highlight_mask = np.clip(lum / 200.0, 0, 1) ** 1.5
        # Teal in shadows
        b = b + 18 * shadow_mask
        g = g + 6 * shadow_mask
        # Warmth in highlights
        r = r + 12 * highlight_mask
        g = g + 4 * highlight_mask
        b = b - 5 * highlight_mask
        f = cv2.merge([np.clip(b, 0, 255), np.clip(g, 0, 255), np.clip(r, 0, 255)])
        # Contrast S-curve approximation
        f = np.clip((f - 128) * 1.12 + 130, 0, 255)

    elif grade == "aggressive":
        # High contrast, saturated, crushed blacks
        f = np.clip((f - 128) * 1.35 + 128, 0, 255)
        f = np.clip(f - 8, 0, 255)  # crush blacks
        hsv = cv2.cvtColor(f.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.25, 0, 255)
        f = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

    elif grade == "moody":
        # Desaturated, cool, dark
        hsv = cv2.cvtColor(f.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = hsv[:, :, 1] * 0.55
        hsv[:, :, 2] = hsv[:, :, 2] * 0.85
        f = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
        b, g, r = cv2.split(f)
        b = np.clip(b + 10, 0, 255)
        f = cv2.merge([b, g, r])
        f = np.clip((f - 128) * 1.15 + 126, 0, 255)

    elif grade == "clean":
        f = np.clip((f - 128) * 1.06 + 129, 0, 255)

    frame = apply_vignette(f.astype(np.uint8), strength=0.35)
    return frame


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------

def transition_crossfade(fa, fb, t):
    t_smooth = ease_in_out(t)
    return cv2.addWeighted(fa, 1.0 - t_smooth, fb, t_smooth, 0)


def transition_flash(fa, fb, t):
    """Quick white flash — punchy beat-sync cut."""
    if t < 0.35:
        p = ease_in(t / 0.35)
        white = np.full_like(fa, 255)
        return cv2.addWeighted(fa, 1.0 - p, white, p, 0)
    elif t < 0.5:
        return np.full_like(fa, 255, dtype=np.uint8)
    else:
        p = ease_out((t - 0.5) / 0.5)
        white = np.full_like(fb, 255)
        return cv2.addWeighted(white, 1.0 - p, fb, p, 0)


def transition_zoom_through(fa, fb, t):
    """Zoom into current frame, then emerge from zoom on next — smooth match cut feel."""
    h, w = fa.shape[:2]
    if t < 0.5:
        p = ease_in(t * 2)
        scale = 1.0 + p * 0.6
        crop_w, crop_h = int(w / scale), int(h / scale)
        x1, y1 = (w - crop_w) // 2, (h - crop_h) // 2
        crop = fa[y1:y1+crop_h, x1:x1+crop_w]
        result = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
        # Brightness ramp up
        result = np.clip(result.astype(np.float32) * (1.0 + p * 0.4), 0, 255).astype(np.uint8)
        return result
    else:
        p = ease_out((t - 0.5) * 2)
        scale = 1.6 - p * 0.6
        crop_w, crop_h = int(w / scale), int(h / scale)
        x1, y1 = (w - crop_w) // 2, (h - crop_h) // 2
        crop = fb[y1:y1+crop_h, x1:x1+crop_w]
        result = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
        brightness = 1.4 - p * 0.4
        result = np.clip(result.astype(np.float32) * brightness, 0, 255).astype(np.uint8)
        return result


def transition_whip_pan(fa, fb, t):
    """Horizontal whip pan with motion blur."""
    h, w = fa.shape[:2]
    if t < 0.5:
        p = ease_in(t * 2)
        ksize = max(1, int(p * 100)) | 1
        kernel = np.zeros((1, ksize), np.float32)
        kernel[0, :] = 1.0 / ksize
        blurred = cv2.filter2D(fa, -1, kernel)
        shift = int(p * w * 0.4)
        M = np.float32([[1, 0, -shift], [0, 1, 0]])
        return cv2.warpAffine(blurred, M, (w, h), borderMode=cv2.BORDER_REFLECT)
    else:
        p = ease_out((t - 0.5) * 2)
        ksize = max(1, int((1 - p) * 100)) | 1
        kernel = np.zeros((1, ksize), np.float32)
        kernel[0, :] = 1.0 / ksize
        blurred = cv2.filter2D(fb, -1, kernel)
        shift = int((1 - p) * w * 0.4)
        M = np.float32([[1, 0, shift], [0, 1, 0]])
        return cv2.warpAffine(blurred, M, (w, h), borderMode=cv2.BORDER_REFLECT)


TRANSITIONS = {
    "crossfade": transition_crossfade,
    "flash": transition_flash,
    "zoom_through": transition_zoom_through,
    "whip_pan": transition_whip_pan,
}


# ---------------------------------------------------------------------------
# Text overlays
# ---------------------------------------------------------------------------

def draw_text(frame, text, x, y, font_scale=1.2, color=(255, 255, 255),
              thickness=2, opacity=1.0):
    """Draw text with shadow at exact position."""
    if opacity <= 0:
        return frame
    font = cv2.FONT_HERSHEY_SIMPLEX
    overlay = frame.copy()
    # Shadow
    cv2.putText(overlay, text, (x + 2, y + 2), font, font_scale, (0, 0, 0),
                thickness + 2, cv2.LINE_AA)
    # Main
    cv2.putText(overlay, text, (x, y), font, font_scale, color,
                thickness, cv2.LINE_AA)
    return cv2.addWeighted(overlay, opacity, frame, 1.0 - opacity, 0)


def apply_letterbox(frame, ratio=2.35):
    h, w = frame.shape[:2]
    target_h = int(w / ratio)
    if target_h >= h:
        return frame
    bar_h = (h - target_h) // 2
    frame[:bar_h, :] = 0
    frame[h - bar_h:, :] = 0
    return frame


# ---------------------------------------------------------------------------
# Jev API
# ---------------------------------------------------------------------------

def call_jev(state, questions):
    api_key = os.environ.get("JEV_API_KEY", "")
    if not api_key:
        return None
    payload = json.dumps({"state": state, "model": "jev-latest", "questions": questions}).encode()
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode()).get("answers", {})
        except urllib.error.HTTPError as e:
            if e.code in (401, 422):
                return None
            if e.code in (429, 529):
                time.sleep(2 ** attempt)
                continue
        except Exception:
            return None
    return None


def jev_plan_sequence(num_images, style, tempo=None):
    """Ask Jev to plan shot sequencing and transition style."""
    answers = call_jev(
        state={"num_images": num_images, "style": style, "tempo_bpm": tempo},
        questions={
            "transition_style": {
                "type": "choice",
                "instructions": "What transition style best fits this car edit?",
                "criteria": {
                    "crossfade": "Smooth dissolves — elegant, cinematic, slow-paced",
                    "flash": "White flash cuts synced to beats — aggressive, punchy",
                    "zoom_through": "Zoom into detail then emerge on next shot — dramatic reveals",
                    "whip_pan": "Fast horizontal whip pan — energetic, dynamic",
                    "mixed": "Alternate between zoom_through and flash for variety",
                },
            },
            "clip_duration": {
                "type": "score",
                "instructions": "How long should each image be shown given this style and tempo?",
                "criteria": ["0.5s_very_fast", "1s_fast", "1.8s_moderate", "2.5s_slow", "3.5s_lingering"],
            },
        },
    )
    if answers:
        trans = answers.get("transition_style", {}).get("choice", "crossfade")
        dur_score = answers.get("clip_duration", {}).get("score", 2)
        dur_map = [0.5, 1.0, 1.8, 2.5, 3.5]
        clip_dur = dur_map[min(int(round(dur_score)), len(dur_map) - 1)]
        print(f"  Jev plan — transition: {trans} | clip duration: {clip_dur}s")
        return trans, clip_dur
    return "crossfade", 2.0


# ---------------------------------------------------------------------------
# Shot sequence planner
# ---------------------------------------------------------------------------

# Shot types follow the professional car edit structure:
# hook → establish → detail build → detail build → hero reveal
SEQUENCE_TEMPLATES = {
    "cinematic": [
        "hook_detail",      # close-up on best feature — grabs attention
        "establish_wide",   # pull back, show the whole car
        "detail_zoom_in",   # zoom into a detail (wheels, badge)
        "detail_pan",       # pan across body lines
        "drift_across",     # slow lateral drift
        "slow_reveal",      # detail → wide reveal
        "hero_wide",        # final hero shot, subtle push
    ],
    "aggressive": [
        "hook_detail",
        "detail_zoom_in",
        "detail_pan",
        "establish_wide",
        "detail_zoom_in",
        "drift_across",
        "hero_wide",
    ],
    "moody": [
        "establish_wide",
        "hook_detail",
        "detail_pan",
        "slow_reveal",
        "drift_across",
        "detail_zoom_in",
        "hero_wide",
    ],
    "clean": [
        "establish_wide",
        "detail_zoom_in",
        "detail_pan",
        "drift_across",
        "slow_reveal",
        "establish_wide",
        "hero_wide",
    ],
}


# ---------------------------------------------------------------------------
# Main render
# ---------------------------------------------------------------------------

def render_edit(image_paths, audio_path=None, style="cinematic", output_path=None,
                duration=None, car_name=None, car_specs=None):

    print(f"\n{'='*60}")
    print(f"  car-edit v3 — PRODUCTION RENDER")
    print(f"{'='*60}")
    print(f"  Images: {len(image_paths)}")
    print(f"  Audio: {Path(audio_path).name if audio_path else 'none'}")
    print(f"  Style: {style}")

    # Load images
    print(f"\n[1/6] Loading images...")
    images = []
    for p in image_paths:
        img = cv2.imread(str(p))
        if img is not None:
            images.append(img)
            h, w = img.shape[:2]
            print(f"  {Path(p).name} ({w}x{h})")
    if not images:
        print("ERROR: No valid images", file=sys.stderr)
        sys.exit(1)

    # Beat detection or Jev-planned timing
    print(f"\n[2/6] Planning sequence...")
    tempo = None
    if audio_path:
        beat_times, tempo = detect_beats(audio_path, duration=duration)
    trans_style, clip_dur = jev_plan_sequence(len(images), style, tempo)

    # Build shot sequence
    template = SEQUENCE_TEMPLATES.get(style, SEQUENCE_TEMPLATES["cinematic"])
    total_duration = duration or clip_dur * len(images)

    # If audio, use beats as cut points
    if audio_path and beat_times:
        # Filter beats within duration
        beats = [t for t in beat_times if t < total_duration]
        # Group beats: every N beats is one image switch
        beats_per_image = max(1, len(beats) // len(images))
        cut_times = [0.0]
        for i in range(beats_per_image, len(beats), beats_per_image):
            if len(cut_times) < len(images):
                cut_times.append(beats[i])
        # Ensure we have enough cuts
        while len(cut_times) < len(images):
            last = cut_times[-1]
            cut_times.append(last + clip_dur)
    else:
        cut_times = [i * clip_dur for i in range(len(images))]
        total_duration = len(images) * clip_dur

    print(f"  Duration: {total_duration:.1f}s | Clips: {len(images)} | Transition: {trans_style}")

    # Plan motion for each image based on its features
    print(f"\n[3/6] Analyzing features & planning motion...")
    motions = []
    for i, img in enumerate(images):
        shot_type = template[i % len(template)]
        motion = plan_shot_motion(img, shot_type)
        motions.append(motion)
        print(f"  Image {i+1}: {shot_type}")

    # Build transition schedule
    if trans_style == "mixed":
        trans_cycle = ["zoom_through", "flash", "crossfade", "zoom_through", "whip_pan"]
    else:
        trans_cycle = [trans_style]

    # Render
    print(f"\n[4/6] Rendering frames...")
    total_frames = int(total_duration * OUTPUT_FPS)
    ffmpeg = get_ffmpeg_path()

    if not output_path:
        ts = time.strftime("%Y%m%d_%H%M%S")
        output_path = str(SKILL_DIR / "output" / f"{ts}_{style}.mp4")
    output_path = validate_path(output_path, "output")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    temp_video = str(output_path.parent / f"_temp_{output_path.name}") if audio_path else str(output_path)

    proc = subprocess.Popen(
        [ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
         "-s", f"{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}", "-pix_fmt", "bgr24",
         "-r", str(OUTPUT_FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "medium", "-crf", "17",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", temp_video],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    transition_secs = 0.25  # 250ms transitions
    transition_frames = int(transition_secs * OUTPUT_FPS)
    last_pct = -1

    for fi in range(total_frames):
        current_time = fi / OUTPUT_FPS

        # Which image are we on?
        img_idx = 0
        for i, ct in enumerate(cut_times):
            if current_time >= ct:
                img_idx = i
        img_idx = min(img_idx, len(images) - 1)

        # Segment timing
        seg_start = cut_times[img_idx]
        seg_end = cut_times[img_idx + 1] if img_idx + 1 < len(cut_times) else total_duration
        seg_duration = max(0.01, seg_end - seg_start)
        seg_frames = max(1, int(seg_duration * OUTPUT_FPS))
        seg_frame = int((current_time - seg_start) * OUTPUT_FPS)
        seg_frame = max(0, min(seg_frame, seg_frames - 1))

        # Ken Burns frame with feature-anchored eased motion
        frame = ken_burns_frame(images[img_idx], seg_frame, seg_frames, motions[img_idx])

        # Transition zone — blend with previous image
        time_in_seg = current_time - seg_start
        if time_in_seg < transition_secs and img_idx > 0:
            prev_idx = img_idx - 1
            prev_start = cut_times[prev_idx]
            prev_end = seg_start
            prev_dur = max(0.01, prev_end - prev_start)
            prev_frames = max(1, int(prev_dur * OUTPUT_FPS))
            prev_frame = ken_burns_frame(images[prev_idx], prev_frames - 1, prev_frames, motions[prev_idx])

            progress = time_in_seg / transition_secs
            t_name = trans_cycle[img_idx % len(trans_cycle)]
            t_func = TRANSITIONS.get(t_name, transition_crossfade)
            frame = t_func(prev_frame, frame, progress)

        # Color grade
        frame = apply_color_grade(frame, style)

        # Letterbox
        if style in ("cinematic", "moody"):
            frame = apply_letterbox(frame, 2.35)

        # Text overlays — car name intro (first 3.5s)
        if car_name and current_time < 3.5:
            if current_time < 0.5:
                opacity = ease_out(current_time / 0.5) * 0.9
            elif current_time > 3.0:
                opacity = ease_in((3.5 - current_time) / 0.5) * 0.9
            else:
                opacity = 0.9
            frame = draw_text(frame, car_name, 60, OUTPUT_HEIGHT - 100,
                              font_scale=2.0, thickness=3, opacity=opacity)

        # Specs text (1.0s - 3.5s)
        if car_specs and 1.0 < current_time < 3.5:
            if current_time < 1.3:
                opacity = ease_out((current_time - 1.0) / 0.3) * 0.75
            elif current_time > 3.0:
                opacity = ease_in((3.5 - current_time) / 0.5) * 0.75
            else:
                opacity = 0.75
            frame = draw_text(frame, car_specs, 62, OUTPUT_HEIGHT - 60,
                              font_scale=0.7, thickness=1,
                              color=(200, 200, 200), opacity=opacity)

        # End card — car name centered (last 2s)
        if car_name and current_time > total_duration - 2.0:
            t_end = total_duration - current_time
            if t_end > 1.5:
                opacity = ease_out((2.0 - t_end) / 0.5) * 0.9
            elif t_end < 0.5:
                opacity = ease_in(t_end / 0.5) * 0.9
            else:
                opacity = 0.9
            text_w = cv2.getTextSize(car_name, cv2.FONT_HERSHEY_SIMPLEX, 2.0, 3)[0][0]
            frame = draw_text(frame, car_name, (OUTPUT_WIDTH - text_w) // 2,
                              OUTPUT_HEIGHT // 2 + 15,
                              font_scale=2.0, thickness=3, opacity=opacity)

        # Global fade in (first 0.6s) and fade out (last 0.6s)
        if current_time < 0.6:
            alpha = ease_out(current_time / 0.6)
            frame = (frame.astype(np.float32) * alpha).astype(np.uint8)
        elif current_time > total_duration - 0.6:
            alpha = ease_out((total_duration - current_time) / 0.6)
            frame = (frame.astype(np.float32) * max(0, alpha)).astype(np.uint8)

        proc.stdin.write(frame.tobytes())

        pct = int(fi / total_frames * 100)
        if pct % 10 == 0 and pct != last_pct:
            print(f"  {pct}%")
            last_pct = pct

    proc.stdin.close()
    proc.wait()
    print(f"  100%")

    # Mux audio
    if audio_path:
        print(f"\n[5/6] Muxing audio...")
        mux_cmd = [
            ffmpeg, "-y", "-i", temp_video,
            "-i", str(validate_path(audio_path, "audio")),
            "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
            "-shortest", "-movflags", "+faststart", str(output_path),
        ]
        subprocess.run(mux_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            os.remove(temp_video)
        except OSError:
            pass
    else:
        print(f"\n[5/6] No audio, skipping mux...")

    # Summary
    print(f"\n[6/6] Done.")
    size_mb = output_path.stat().st_size / (1024 * 1024) if output_path.exists() else 0
    print(f"\n{'='*60}")
    print(f"  Output: {output_path}")
    print(f"  Size: {size_mb:.1f} MB | Duration: {total_duration:.1f}s")
    print(f"  Resolution: {OUTPUT_WIDTH}x{OUTPUT_HEIGHT} @ {OUTPUT_FPS}fps")
    print(f"  Style: {style} | Transitions: {trans_style}")
    if tempo:
        print(f"  Beat-synced: {tempo:.0f} BPM")
    print(f"{'='*60}\n")
    return str(output_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="car-edit v3 — production render")
    parser.add_argument("--images", nargs="+", required=True, help="Image files (supports globs)")
    parser.add_argument("--audio", help="Audio track for beat-synced cuts")
    parser.add_argument("--style", choices=["cinematic", "aggressive", "clean", "moody"], default="cinematic")
    parser.add_argument("--output", help="Output path")
    parser.add_argument("--duration", type=float, help="Max duration in seconds")
    parser.add_argument("--car-name", help="Car name overlay")
    parser.add_argument("--car-specs", help="Specs line overlay")
    args = parser.parse_args()

    load_env()

    # Expand globs
    image_paths = []
    for pattern in args.images:
        expanded = sorted(glob.glob(pattern))
        image_paths.extend(expanded if expanded else [pattern])
    image_paths = [str(validate_path(p, "image")) for p in image_paths]

    render_edit(
        image_paths=image_paths,
        audio_path=args.audio,
        style=args.style,
        output_path=args.output,
        duration=args.duration,
        car_name=args.car_name,
        car_specs=args.car_specs,
    )


if __name__ == "__main__":
    main()
