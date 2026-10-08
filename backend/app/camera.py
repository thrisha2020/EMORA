from typing import Optional

import cv2
import numpy as np


def capture_frame(device: int = 0) -> Optional[np.ndarray]:
    cap = cv2.VideoCapture(device)
    if not cap.isOpened():
        return None
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    return frame


def bytes_to_frame(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def frame_to_bytes(frame: np.ndarray, ext: str = ".jpg") -> bytes:
    _, buf = cv2.imencode(ext, frame)
    return buf.tobytes()
