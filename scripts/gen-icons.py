# -*- coding: utf-8 -*-
"""
產生 PWA 主畫面 icon（icon-192.png / icon-512.png）。

字體用站內標題同一套 Baloo 2，顏色取自 style.css 的品牌色，
所以 icon 跟網站看起來是同一個東西。

用法：python scripts/gen-icons.py
"""
import os
import urllib.request
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICON_DIR = os.path.join(ROOT, "public", "icons")
# 備選配色只是拿來挑選用，放在 public 外面，不會被部署成公開檔案
PREVIEW_DIR = os.path.join(ROOT, ".icon-previews")
FONT_CACHE = os.path.join(ROOT, ".fontcache")
FONT_PATH = os.path.join(FONT_CACHE, "Baloo2-ExtraBold.ttf")
FONT_URL = "https://fonts.gstatic.com/s/baloo2/v23/wXK0E3kTposypRydzVT08TS3JnAmtdiayqpv.ttf"

WORD = "erinsama"
ACCENT = (222, 93, 131)      # --accent  #DE5D83
CREAM = (251, 246, 245)      # --bg      #FBF6F5

VARIANTS = {
    # 檔名前綴 -> (背景色, 文字色)
    "pink": (ACCENT, (255, 255, 255)),
    "cream": (CREAM, ACCENT),
}


def ensure_font():
    if os.path.exists(FONT_PATH):
        return
    os.makedirs(FONT_CACHE, exist_ok=True)
    print("下載 Baloo 2 字體…")
    req = urllib.request.Request(FONT_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r, open(FONT_PATH, "wb") as f:
        f.write(r.read())


def fit_font(draw, text, target_width):
    """二分逼近出剛好塞滿 target_width 的字級"""
    lo, hi = 8, 400
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        font = ImageFont.truetype(FONT_PATH, mid)
        width = draw.textbbox((0, 0), text, font=font)[2] - draw.textbbox((0, 0), text, font=font)[0]
        if width <= target_width:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ImageFont.truetype(FONT_PATH, best)


def render(size, bg, fg):
    img = Image.new("RGB", (size, size), bg)
    draw = ImageDraw.Draw(img)

    # 文字寬度控制在 72%，四周留白讓 iOS/Android 的圓角遮罩不會切到字
    font = fit_font(draw, WORD, int(size * 0.72))
    box = draw.textbbox((0, 0), WORD, font=font)
    text_w = box[2] - box[0]
    text_h = box[3] - box[1]

    # 底線與文字當成一組來置中，不然視覺重心會偏上
    gap = size * 0.055
    bar_h = max(2, int(size * 0.026))
    group_h = text_h + gap + bar_h
    top = (size - group_h) / 2

    draw.text(((size - text_w) / 2 - box[0], top - box[1]), WORD, font=font, fill=fg)

    bar_y = top + text_h + gap
    draw.rounded_rectangle(
        [(size - text_w) / 2, bar_y, (size + text_w) / 2, bar_y + bar_h],
        radius=bar_h / 2,
        fill=fg,
    )
    return img


def main():
    ensure_font()
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for name, (bg, fg) in VARIANTS.items():
        for size in (192, 512):
            img = render(size, bg, fg)
            out = (os.path.join(ICON_DIR, f"icon-{size}.png") if name == "pink"
                   else os.path.join(PREVIEW_DIR, f"{name}-{size}.png"))
            img.save(out)
            print("產生", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
