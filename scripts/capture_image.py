"""Read PNG/JPEG capture dimensions without decoding or changing image bytes."""

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SOF = frozenset((0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF))


def image_info(data):
    """Return (format, width, height) from a structurally valid image header.

    This is a header reader, not a pixel decoder. Original-byte hashes remain
    the provenance check for the complete captured file.
    """
    if data.startswith(PNG_SIGNATURE):
        if len(data) < 24 or data[8:16] != b"\0\0\0\rIHDR":
            raise ValueError("Invalid PNG dimension header")
        width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        if not width or not height:
            raise ValueError("PNG dimensions must be positive")
        return "png", width, height
    if not data.startswith(b"\xff\xd8"):
        raise ValueError("Capture must contain actual PNG or JPEG bytes")
    offset = 2
    while offset < len(data):
        if data[offset] != 0xFF:
            raise ValueError("Invalid JPEG header marker")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise ValueError("Truncated JPEG header marker")
        marker = data[offset]
        offset += 1
        if marker in (0x00, 0xD8) or 0xD0 <= marker <= 0xD7:
            raise ValueError("Invalid JPEG header marker")
        if marker in (0xD9, 0xDA):
            raise ValueError("JPEG is missing its SOF dimension header")
        if marker == 0x01:  # TEM is the only standalone marker before a frame.
            continue
        if marker < 0xC0:
            raise ValueError("Invalid JPEG header marker")
        if offset + 2 > len(data):
            raise ValueError("Truncated JPEG segment length")
        length = int.from_bytes(data[offset:offset + 2], "big")
        end = offset + length
        if length < 2 or end > len(data):
            raise ValueError("Invalid or truncated JPEG segment")
        if marker in JPEG_SOF:
            if length < 8:
                raise ValueError("Truncated JPEG SOF dimension header")
            height = int.from_bytes(data[offset + 3:offset + 5], "big")
            width = int.from_bytes(data[offset + 5:offset + 7], "big")
            components = data[offset + 7]
            if not width or not height or not components or length != 8 + 3 * components:
                raise ValueError("Invalid JPEG SOF dimensions or components")
            return "jpeg", width, height
        offset = end
    raise ValueError("JPEG is missing its SOF dimension header")


def validate_image_suffix(image_format, suffix):
    """Keep the source extension, while rejecting names that mislabel bytes."""
    suffix = suffix.lower()
    allowed = {"png": (".png",), "jpeg": (".jpg", ".jpeg")}
    if suffix not in allowed.get(image_format, ()):
        raise ValueError("Image extension does not match its PNG/JPEG bytes")
    return suffix
