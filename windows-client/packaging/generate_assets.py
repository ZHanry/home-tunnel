#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw, ImageFont


BRAND_BLUE = "#0F52BA"
BRAND_NAVY = "#0B2447"
BRAND_CYAN = "#72E3CF"
WHITE = "#FFFFFF"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def cubic_points(p0, p1, p2, p3, count: int = 24):
    points = []
    for index in range(count + 1):
        t = index / count
        u = 1 - t
        points.append(
            (
                u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1],
            )
        )
    return points


def rounded_line(draw: ImageDraw.ImageDraw, points, fill: str, width: int) -> None:
    points = [(round(x), round(y)) for x, y in points]
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width // 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_portal_mark(draw: ImageDraw.ImageDraw, scale: float, offset=(0, 0)) -> None:
    ox, oy = offset

    def p(x: float, y: float) -> tuple[float, float]:
        return ox + x * scale, oy + y * scale

    portal_width = max(2, round(15 * scale))
    flow_width = max(2, round(11 * scale))

    left = [p(100, 64)]
    left += [p(x, y) for x, y in cubic_points((100, 64), (74, 64), (58, 76), (58, 98))[1:]]
    left += [p(58, 158)]
    left += [p(x, y) for x, y in cubic_points((58, 158), (58, 180), (74, 192), (100, 192))[1:]]
    right = [p(156, 64)]
    right += [p(x, y) for x, y in cubic_points((156, 64), (182, 64), (198, 76), (198, 98))[1:]]
    right += [p(198, 158)]
    right += [p(x, y) for x, y in cubic_points((198, 158), (198, 180), (182, 192), (156, 192))[1:]]

    rounded_line(draw, left, WHITE, portal_width)
    rounded_line(draw, right, WHITE, portal_width)

    # Two independent lanes make the directionality readable even at 16 px.
    rounded_line(draw, [p(86, 108), p(169, 108)], BRAND_CYAN, flow_width)
    rounded_line(draw, [p(156, 96), p(169, 108), p(156, 120)], BRAND_CYAN, flow_width)
    rounded_line(draw, [p(170, 148), p(87, 148)], BRAND_CYAN, flow_width)
    rounded_line(draw, [p(100, 136), p(87, 148), p(100, 160)], BRAND_CYAN, flow_width)


def square(size: int) -> Image.Image:
    render_size = max(1024, size * 4)
    image = Image.new("RGBA", (render_size, render_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = render_size / 256
    inset = round(8 * scale)
    draw.rounded_rectangle(
        (inset, inset, render_size - inset, render_size - inset),
        radius=round(56 * scale),
        fill=BRAND_BLUE,
    )
    draw_portal_mark(draw, scale)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def wide_tile() -> Image.Image:
    image = Image.new("RGBA", (620, 300), BRAND_NAVY)
    image.alpha_composite(square(220).resize((220, 220), Image.Resampling.LANCZOS), (38, 40))
    draw = ImageDraw.Draw(image)
    draw.text((292, 87), "Home Tunnel", font=font(52, bold=True), fill=WHITE)
    draw.text((294, 157), "安全服务发布客户端", font=font(26), fill="#D6E5FC")
    return image.resize((310, 150), Image.Resampling.LANCZOS)


def installer_wizard() -> Image.Image:
    scale = 4
    image = Image.new("RGB", (164 * scale, 314 * scale), BRAND_NAVY)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 9 * scale, 314 * scale), fill=BRAND_BLUE)

    mark = square(96 * scale).convert("RGBA")
    image.paste(mark, (34 * scale, 38 * scale), mark)

    # A restrained route line reinforces the product idea without decorative noise.
    line_x = 82 * scale
    draw.line((line_x, 151 * scale, line_x, 218 * scale), fill="#38618D", width=2 * scale)
    for y in (151, 184, 218):
        radius = 4 * scale
        draw.ellipse(
            (line_x - radius, y * scale - radius, line_x + radius, y * scale + radius),
            fill=BRAND_CYAN if y != 184 else WHITE,
        )

    draw.text((28 * scale, 244 * scale), "Home Tunnel", font=font(19 * scale, bold=True), fill=WHITE)
    draw.text((28 * scale, 276 * scale), "安全服务发布客户端", font=font(10 * scale), fill="#B8D2FA")
    return image.resize((164, 314), Image.Resampling.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    workspace = root.parent
    output = Path(__file__).resolve().parent / "Assets"
    output.mkdir(parents=True, exist_ok=True)

    for name, size in {
        "StoreLogo.png": 50,
        "Square44x44Logo.png": 44,
        "Square150x150Logo.png": 150,
        "Square310x310Logo.png": 310,
    }.items():
        square(size).save(output / name, optimize=True)

    wide_tile().save(output / "Wide310x150Logo.png", optimize=True)
    installer_wizard().save(output / "InstallerWizard.bmp")
    square(55).convert("RGB").save(output / "InstallerSmall.bmp")

    square(256).save(
        root / "assets" / "HomeTunnel.ico",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    copyfile(root / "assets" / "HomeTunnel.svg", workspace / "control-center" / "public" / "HomeTunnel.svg")


if __name__ == "__main__":
    main()
