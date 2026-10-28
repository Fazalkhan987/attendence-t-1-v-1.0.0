"""Decode browser-uploaded images (JPEG/PNG/WebP bytes) into validated BGR frames."""
from __future__ import annotations

import cv2
import numpy as np

from faceattend.exceptions import InvalidImageError
from faceattend.image_utils import validate_frame

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_SIDE = 1920   # larger photos are downscaled; detection runs at 640x640 anyway


def decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise InvalidImageError("Empty image")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidImageError("Image is larger than 8 MB")
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise InvalidImageError("Could not read the image - use JPEG, PNG or WebP")
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        scale = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    return validate_frame(img)
