"""EMORA AI — text-to-speech via Microsoft Edge neural voices (edge-tts).

`edge-tts` streams MP3 from Microsoft's free edge endpoint — no API key.
Speaks any short reply aloud so EMORA can "talk" like a JARVIS assistant.
"""

import io
import re

import edge_tts

# Neerja Expressive: Indian English with natural, emotive delivery. +15% made
# every voice sound rushed, so speed stays at normal and is tuned in Settings.
VOICE = "en-IN-NeerjaExpressiveNeural"
HINDI_VOICE = "hi-IN-SwaraNeural"
RATE = "+0%"

def is_hindi(text: str) -> bool:
    """Check if the text contains any Devanagari (Hindi) characters."""
    return bool(re.search(r'[ऀ-ॿ]', text))

async def synthesize(text: str, voice: str = VOICE, rate: str = RATE) -> bytes:
    """Return MP3 bytes for `text`."""
    text = clean_for_speech(text or "") or "I have nothing to say."

    # Devanagari through a plain English voice plays back silent, so swap in a
    # Hindi voice. Hindi, Marathi and Multilingual voices can read it themselves.
    if is_hindi(text) and voice.startswith("en-") and "Multilingual" not in voice:
        voice = HINDI_VOICE

    tts = edge_tts.Communicate(text, voice=voice, rate=rate)
    buf = io.BytesIO()
    async for chunk in tts.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()

def clean_for_speech(text: str) -> str:
    """Drop what a voice would otherwise read out literally.

    HTML tags, markdown marks, list bullets and emoji come out as "asterisk",
    "hash" or dead air. Line breaks become sentence breaks so a list still
    gets its pauses.
    """
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # [label](url) -> label
    text = re.sub(r"^\s*(#{1,6}|[-*•]|\d+[.)])\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`~]+", "", text)
    text = re.sub(r"[\U0001F000-\U0001FAFF]", "", text)  # emoji
    text = re.sub(r"[\u2600-\u27BF\u2B00-\u2BFF\uFE00-\uFE0F\u200D]", "", text)  # symbols/variation
    text = re.sub(r"(?<![.!?,:;])[ \t]*\n+", ". ", text.strip())
    return re.sub(r"\s+", " ", text).strip()
