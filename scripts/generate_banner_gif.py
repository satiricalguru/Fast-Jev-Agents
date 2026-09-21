import os
import sys
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def draw_text_tracked(draw, pos, text, font, fill, tracking=0):
    x, y = pos
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        bbox = font.getbbox(ch)
        w = bbox[2] - bbox[0] if bbox else 8
        x += w + tracking

def ease_in_out_cubic(t):
    if t < 0.5:
        return 4 * t * t * t
    else:
        p = 2 * t - 2
        return 0.5 * p * p * p + 1

def build_vector_cursor(scale=4):
    w, h = 32, 32
    img = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    poly = [
        (1.5 * scale, 0.5 * scale),    # Tip
        (29.0 * scale, 17.0 * scale),  # Right wing
        (18.5 * scale, 17.5 * scale),  # Notch
        (13.5 * scale, 28.5 * scale),  # Stem right
        (9.0 * scale, 29.5 * scale),   # Bottom tip
        (7.0 * scale, 19.5 * scale),   # Left inner
    ]
    draw.polygon(poly, fill=(234, 115, 69, 255), outline=(50, 75, 45, 255), width=int(1.8 * scale))
    return img.resize((w, h), Image.Resampling.LANCZOS)

def main():
    src_path = "/Users/jatinpandey/.gemini/antigravity-ide/brain/c767c153-3ac8-4a74-aced-33ed58635e31/.user_uploaded/media_1790018833175.png"
    if not os.path.exists(src_path):
        print(f"Error: {src_path} not found")
        sys.exit(1)

    orig = Image.open(src_path).convert("RGBA")
    width, height = orig.size

    # Color palette
    bg_color = (245, 245, 237, 255)
    text_dark = (37, 42, 35, 255)
    text_muted = (125, 130, 120, 255)
    orange_accent = (234, 115, 69, 255)
    green_border = np.array([75, 121, 72, 255], dtype=np.uint8)
    card_fill = np.array([237, 244, 223, 255], dtype=np.uint8)
    white_bg = np.array([255, 255, 255, 255], dtype=np.uint8)
    card_glow = np.array([195, 242, 185], dtype=float)

    # Fonts
    font_title = ImageFont.truetype("/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf", 74)
    font_mono = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13)

    # 1. Base image setup & Mathematical Card Cleanup
    base_arr = np.array(orig)

    # Clean cursor region using exact card geometry
    for x in range(780, 826):
        by = 220.0 + (x - 746.0) * (-5.0 / 88.0)
        for y in range(188, 228):
            if y < by - 1.0:
                base_arr[y, x] = card_fill
            elif abs(y - by) <= 1.0:
                base_arr[y, x] = green_border
            else:
                base_arr[y, x] = white_bg

    # Reinforce clean border line
    for x in range(746, 835):
        by = 220.0 + (x - 746.0) * (-5.0 / 88.0)
        iy = int(round(by))
        base_arr[iy, x] = green_border
        base_arr[iy + 1, x] = green_border

    base = Image.fromarray(base_arr)
    draw_base = ImageDraw.Draw(base)

    # Clean left text
    draw_base.rectangle([(40, 25), (515, 315)], fill=bg_color)
    # Clean speed lines
    draw_base.rectangle([(516, 120), (594, 188)], fill=bg_color)

    # Draw static header and footer labels
    draw_text_tracked(draw_base, (48, 36), "CODING AGENTS × TYPESAFE", font_mono, text_dark, tracking=1.8)
    draw_text_tracked(draw_base, (48, 284), "VERBATIM. FAST. ZERO LOSS.", font_mono, text_muted, tracking=2.0)

    # Text mask for "FAST-JEV AGENTS"
    text_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    text_draw.text((47, 95), "FAST-JEV", font=font_title, fill=text_dark)
    text_draw.text((47, 172), "AGENTS", font=font_title, fill=text_dark)
    text_mask = np.array(text_layer)[:, :, 3] > 0

    # Build vector cursor
    cursor_sprite = build_vector_cursor(scale=4)
    c_w, c_h = cursor_sprite.size

    # Card interior mask for glow animation
    card_mask = np.zeros((height, width), dtype=bool)
    for x in range(742, 833):
        by = 220.0 + (x - 746.0) * (-5.0 / 88.0)
        ty = 160.0 + (x - 746.0) * (-5.0 / 88.0)
        for y in range(int(round(ty)) + 2, int(round(by)) - 1):
            if x < 758 and y < 174:
                continue
            card_mask[y, x] = True

    # Animation settings: 50 frames @ 25fps = 2.0 second smooth loop
    total_frames = 50
    fps = 25
    os.makedirs("assets/frames", exist_ok=True)

    target_pos = (788, 193)
    start_pos = (742, 218)

    clean_base_arr = np.array(base)

    for i in range(total_frames):
        t = i / float(total_frames)
        frame_arr = clean_base_arr.copy()

        # A. Middle Card Compaction Glow (Frames 20 to 38)
        glow_val = 0.0
        if 20 <= i <= 38:
            if i <= 24:
                glow_val = (i - 20) / 4.0
            else:
                glow_val = 1.0 - (i - 24) / 14.0

        if glow_val > 0.01:
            for ch in range(3):
                frame_arr[card_mask, ch] = (
                    clean_base_arr[card_mask, ch] * (1.0 - glow_val) +
                    card_glow[ch] * glow_val
                ).astype(np.uint8)

        # B. FAST-JEV AGENTS Shimmer Sweep
        if 8 <= i <= 30:
            sweep_progress = (i - 8) / 22.0
            sweep_x = 20 + sweep_progress * 420
            band_width = 50
            x_grid = np.arange(width)[None, :]
            y_grid = np.arange(height)[:, None]
            proj = x_grid - 0.4 * y_grid
            sweep_proj = sweep_x - 0.4 * 150
            dist = np.abs(proj - sweep_proj)
            shimmer_mask = (dist < band_width) & text_mask
            shimmer_factor = np.clip(1.0 - (dist / band_width), 0, 1) ** 1.5
            target_highlight = np.array([145, 165, 135], dtype=float)
            text_arr = np.array(text_layer)
            for ch in range(3):
                text_channel = text_arr[:, :, ch].astype(float)
                text_channel[shimmer_mask] = (
                    text_channel[shimmer_mask] * (1 - shimmer_factor[shimmer_mask] * 0.7) +
                    target_highlight[ch] * (shimmer_factor[shimmer_mask] * 0.7)
                )
                frame_arr[text_mask, ch] = text_channel[text_mask].astype(np.uint8)
        else:
            text_arr = np.array(text_layer)
            for ch in range(3):
                frame_arr[text_mask, ch] = text_arr[text_mask, ch]

        frame = Image.fromarray(frame_arr, mode="RGBA")
        draw = ImageDraw.Draw(frame)

        # C. Kinetic Speed Lines
        phase = t * 2 * math.pi
        right_anchor = 590

        len1 = 38 + 14 * math.sin(phase)
        draw.rounded_rectangle([(right_anchor - len1, 130), (right_anchor, 135)], radius=2, fill=orange_accent)

        len2 = 54 + 18 * math.sin(phase + 1.2)
        draw.rounded_rectangle([(right_anchor - len2, 151), (right_anchor, 156)], radius=2, fill=orange_accent)

        len3 = 36 + 13 * math.sin(phase + 2.4)
        draw.rounded_rectangle([(right_anchor - len3, 173), (right_anchor, 178)], radius=2, fill=orange_accent)

        # Kinetic speed particles
        for offset, py in [(0, 142), (0.35, 164), (0.7, 137)]:
            part_t = (t * 2.0 + offset) % 1.0
            px = 518 + part_t * 66
            p_len = 5 + 4 * math.sin(part_t * math.pi)
            if px + p_len < right_anchor:
                draw.rounded_rectangle([(px, py), (px + p_len, py + 3)], radius=1, fill=orange_accent)

        # D. Cursor Movement & Tactile Click
        if i < 18:
            move_t = ease_in_out_cubic(i / 18.0)
            cur_x = start_pos[0] + (target_pos[0] - start_pos[0]) * move_t
            cur_y = start_pos[1] + (target_pos[1] - start_pos[1]) * move_t
            cur_scale = 1.0
        elif 18 <= i < 20:
            cur_x = target_pos[0]
            cur_y = target_pos[1]
            cur_scale = 1.0
        elif 20 <= i <= 24:
            press_t = math.sin((i - 20) / 4.0 * math.pi)
            cur_x = target_pos[0] + 1 * press_t
            cur_y = target_pos[1] + 1 * press_t
            cur_scale = 1.0 - 0.12 * press_t
        elif 25 <= i < 36:
            cur_x = target_pos[0]
            cur_y = target_pos[1]
            cur_scale = 1.0
        else:
            ret_t = ease_in_out_cubic((i - 36) / 14.0)
            cur_x = target_pos[0] + (start_pos[0] - target_pos[0]) * ret_t
            cur_y = target_pos[1] + (start_pos[1] - target_pos[1]) * ret_t
            cur_scale = 1.0

        # Tactile Click Ripples
        if 20 <= i <= 40:
            ripple_age = i - 20
            if ripple_age <= 18:
                r1 = 2 + ripple_age * 1.6
                alpha1 = int(220 * (1.0 - ripple_age / 18.0))
                r_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                r_draw = ImageDraw.Draw(r_img)
                r_draw.ellipse([(target_pos[0] - r1, target_pos[1] - r1),
                                (target_pos[0] + r1, target_pos[1] + r1)],
                               outline=(orange_accent[0], orange_accent[1], orange_accent[2], alpha1), width=2)
                frame = Image.alpha_composite(frame, r_img)
                draw = ImageDraw.Draw(frame)

            if 3 <= ripple_age <= 20:
                age2 = ripple_age - 3
                r2 = 2 + age2 * 1.3
                alpha2 = int(170 * (1.0 - age2 / 17.0))
                r_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                r_draw = ImageDraw.Draw(r_img)
                r_draw.ellipse([(target_pos[0] - r2, target_pos[1] - r2),
                                (target_pos[0] + r2, target_pos[1] + r2)],
                               outline=(orange_accent[0], orange_accent[1], orange_accent[2], alpha2), width=1)
                frame = Image.alpha_composite(frame, r_img)
                draw = ImageDraw.Draw(frame)

        # Render Crisp Vector Cursor
        if cur_scale != 1.0:
            w_scaled = max(1, int(c_w * cur_scale))
            h_scaled = max(1, int(c_h * cur_scale))
            c_render = cursor_sprite.resize((w_scaled, h_scaled), Image.Resampling.LANCZOS)
        else:
            c_render = cursor_sprite

        paste_pos = (int(cur_x - 1), int(cur_y))
        frame.paste(c_render, paste_pos, c_render)

        frame_path = f"assets/frames/frame_{i:03d}.png"
        frame.save(frame_path)

    print(f"Generated {total_frames} frames.")

    gif_path = "assets/fast-jev-banner.gif"
    cmd = (
        f"/opt/homebrew/bin/ffmpeg -y -framerate {fps} -i assets/frames/frame_%03d.png "
        f"-filter_complex 'palettegen=stats_mode=full[p];[0:v][p]paletteuse=dither=bayer:bayer_scale=3' "
        f"{gif_path}"
    )
    print("Compiling final GIF...")
    os.system(cmd)

    if os.path.exists(gif_path):
        size_kb = os.path.getsize(gif_path) / 1024
        print(f"Successfully generated {gif_path} ({size_kb:.1f} KB)")

if __name__ == "__main__":
    main()
