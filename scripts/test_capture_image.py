"""Offline image-header regressions; fixtures are not product captures."""
import unittest

from capture_image import image_info, validate_image_suffix


def png(width=1120, height=760):
    return b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" + width.to_bytes(4, "big") + height.to_bytes(4, "big")


def segment(marker, payload):
    return b"\xff" + bytes((marker,)) + (len(payload) + 2).to_bytes(2, "big") + payload


def jpeg(width=1109, height=754, marker=0xC0):
    frame = b"\x08" + height.to_bytes(2, "big") + width.to_bytes(2, "big") + b"\x01\x01\x11\x00"
    return b"\xff\xd8" + segment(0xE0, b"JFIF\0" + b"\xff\xc0not-a-frame") + segment(marker, frame)


class ImageHeaderTests(unittest.TestCase):
    def test_png_dimensions_are_read_without_changing_bytes(self):
        data = png()
        self.assertEqual(image_info(data), ("png", 1120, 760))
        self.assertEqual(data, png())

    def test_jpeg_sof_dimensions_skip_metadata_and_support_frame_markers(self):
        for marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            with self.subTest(marker=marker):
                data = jpeg(marker=marker)
                self.assertEqual(image_info(data), ("jpeg", 1109, 754))
                self.assertEqual(data, jpeg(marker=marker))

    def test_jpeg_fill_bytes_and_standalone_tem_are_supported(self):
        self.assertEqual(image_info(b"\xff\xd8\xff\x01\xff" + jpeg()[2:]), ("jpeg", 1109, 754))

    def test_format_extensions_remain_truthful(self):
        for image_format, suffix in (("png", ".png"), ("jpeg", ".jpg"), ("jpeg", ".jpeg"), ("jpeg", ".JPG")):
            self.assertEqual(validate_image_suffix(image_format, suffix), suffix.lower())
        for image_format, suffix in (("png", ".jpg"), ("jpeg", ".png"), ("jpeg", ".webp"), ("jpeg", "")):
            with self.subTest(image_format=image_format, suffix=suffix):
                with self.assertRaises(ValueError):
                    validate_image_suffix(image_format, suffix)

    def test_invalid_and_truncated_headers_are_rejected(self):
        bad = {
            "unsupported": b"GIF89a" + b"\0" * 32,
            "png-truncated": png()[:23],
            "png-missing-ihdr": png().replace(b"IHDR", b"IDAT"),
            "png-zero-width": png(0, 760),
            "jpeg-no-frame": b"\xff\xd8\xff\xd9",
            "jpeg-scan-before-frame": b"\xff\xd8\xff\xda\0\x02",
            "jpeg-truncated-marker": b"\xff\xd8\xff",
            "jpeg-truncated-length": b"\xff\xd8\xff\xe0\0",
            "jpeg-short-length": b"\xff\xd8\xff\xe0\0\x01",
            "jpeg-truncated-segment": b"\xff\xd8\xff\xe0\0\x10short",
            "jpeg-stuffed-header": b"\xff\xd8\xff\0",
            "jpeg-repeated-soi": b"\xff\xd8\xff\xd8",
            "jpeg-invalid-marker": b"\xff\xd8\xff\x23\0\x02",
            "jpeg-missing-marker-prefix": b"\xff\xd8bad",
            "jpeg-short-sof": b"\xff\xd8" + segment(0xC0, b"\0" * 5),
            "jpeg-zero-width": jpeg(0, 754),
            "jpeg-zero-height": jpeg(1109, 0),
            "jpeg-wrong-components": jpeg()[:-4] + b"\x02\x01\x11\x00",
        }
        for name, data in bad.items():
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    image_info(data)


if __name__ == "__main__":
    unittest.main()
