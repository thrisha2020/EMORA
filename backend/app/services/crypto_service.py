"""Symmetric encryption for provider API keys stored at rest.

The Fernet key is derived from SECRET_KEY so no extra secret has to be managed.
Changing SECRET_KEY therefore invalidates stored keys - they must be re-entered.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from backend.app.config import SECRET_KEY

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        digest = hashlib.sha256(SECRET_KEY.encode("utf-8")).digest()
        _fernet = Fernet(base64.urlsafe_b64encode(digest))
    return _fernet


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str | None:
    """Return the plaintext, or None if the token can't be read (rotated SECRET_KEY)."""
    try:
        return _get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def mask(plaintext: str) -> str:
    """Render a key for display: sk-ant-…9f2a. Never returns the full secret."""
    if len(plaintext) <= 8:
        return "…" + plaintext[-2:]
    return f"{plaintext[:6]}…{plaintext[-4:]}"
