"""Provider-agnostic chat completion with tool calling.

Tools are declared once in a neutral shape and translated per transport:
  - Anthropic -> official `anthropic` SDK (`input_schema`, `tool_use`/`tool_result` blocks)
  - OpenAI-compatible (OpenAI, Groq, xAI, NVIDIA) -> `openai` SDK (`function`, `tool_calls`)

Never route Claude through the OpenAI-compatible shim - the shapes differ enough
that tool calling and system prompts silently degrade.
"""

import re
from typing import Callable, Optional

from sqlalchemy.orm import Session

from backend.app.config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
from backend.app.models import ProviderKey
from backend.app.services import providers
from backend.app.services.crypto_service import decrypt

MAX_TOOL_ROUNDS = 4

# Reasoning models (Qwen3, DeepSeek-R1, and friends) wrap their chain of thought
# in <think> tags inside the normal content field. Left in, it is shown in the
# chat and read aloud by TTS.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.S | re.I)
_UNCLOSED_THINK = re.compile(r"<think>.*\Z", re.S | re.I)


def strip_reasoning(text: str) -> str:
    """Remove chain-of-thought markup, including a block cut off by max_tokens."""
    cleaned = _THINK_BLOCK.sub("", text or "")
    cleaned = _UNCLOSED_THINK.sub("", cleaned)
    return cleaned.strip()


class LLMError(RuntimeError):
    """Raised when no provider is configured or the provider call fails."""


class VisionUnsupportedError(LLMError):
    """The active model cannot accept an image."""


class Resolved:
    """The provider/model/key triple a request will actually use."""

    def __init__(self, provider: providers.Provider, api_key: str, model: str):
        self.provider = provider
        self.api_key = api_key
        self.model = model


def resolve(db: Session) -> Resolved:
    """Pick the active provider: DB row first, then .env fallback."""
    row = (
        db.query(ProviderKey)
        .filter(ProviderKey.is_active == 1)
        .order_by(ProviderKey.updated_at.desc())
        .first()
    )
    if row is not None:
        provider = providers.get(row.provider)
        key = decrypt(row.api_key)
        if provider is not None and key:
            return Resolved(provider, key, row.model or provider.default_model)

    # Fallback: the pre-Settings .env configuration.
    if LLM_API_KEY:
        legacy = providers.Provider(
            id="env",
            label="Configured via .env",
            transport="openai",
            default_model=LLM_MODEL,
            base_url=LLM_BASE_URL,
        )
        return Resolved(legacy, LLM_API_KEY, LLM_MODEL)

    raise LLMError(
        "No AI provider configured. Open Settings and add an API key for OpenAI, "
        "Claude, Groq, Grok, or Nemotron."
    )


# --- neutral tool schema -----------------------------------------------------

def _to_anthropic_tools(tools: list[dict]) -> list[dict]:
    return [
        {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
        for t in tools
    ]


def _to_openai_tools(tools: list[dict]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            },
        }
        for t in tools
    ]


# --- transports --------------------------------------------------------------

def _complete_anthropic(
    r: Resolved,
    system: str,
    history: list[dict],
    tools: list[dict],
    dispatch: Callable[[str, dict], str],
    image: Optional[tuple[str, str]] = None,
) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=r.api_key)
    messages = [{"role": m["role"], "content": m["content"]} for m in history]

    if image is not None:
        # The image rides on the final user turn, placed before the text so the
        # model reads the picture then the question.
        last = messages[-1]
        last["content"] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image[1],
                    "data": image[0],
                },
            },
            {"type": "text", "text": last["content"]},
        ]
    kwargs = {"model": r.model, "max_tokens": 4096, "system": system}
    if tools:
        kwargs["tools"] = _to_anthropic_tools(tools)

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.messages.create(messages=messages, **kwargs)

        if response.stop_reason == "refusal":
            return "I can't help with that one — let's try something else."

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            return strip_reasoning(
                "".join(b.text for b in response.content if b.type == "text")
            )

        messages.append({"role": "assistant", "content": response.content})
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": dispatch(tu.name, dict(tu.input)),
                    }
                    for tu in tool_uses
                ],
            }
        )

    return "I got stuck working on that. Could you rephrase it?"


def _complete_openai(
    r: Resolved,
    system: str,
    history: list[dict],
    tools: list[dict],
    dispatch: Callable[[str, dict], str],
    image: Optional[tuple[str, str]] = None,
) -> str:
    import json

    from openai import OpenAI

    client = OpenAI(api_key=r.api_key, base_url=r.provider.base_url)
    messages: list[dict] = [{"role": "system", "content": system}, *history]

    if image is not None:
        last = messages[-1]
        last["content"] = [
            {"type": "text", "text": last["content"]},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{image[1]};base64,{image[0]}"},
            },
        ]
    kwargs: dict = {"model": r.model}
    if tools:
        kwargs["tools"] = _to_openai_tools(tools)
        kwargs["tool_choice"] = "auto"

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(messages=messages, **kwargs)
        msg = response.choices[0].message

        if not msg.tool_calls:
            return strip_reasoning(msg.content or "")

        messages.append(msg)
        for call in msg.tool_calls:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.function.name,
                    "content": dispatch(call.function.name, args),
                }
            )

    return "I got stuck working on that. Could you rephrase it?"


def complete(
    db: Session,
    system: str,
    history: list[dict],
    tools: Optional[list[dict]] = None,
    dispatch: Optional[Callable[[str, dict], str]] = None,
    image: Optional[tuple[str, str]] = None,
) -> str:
    """Run one completion (looping through tool calls) on the active provider.

    `image` is a (base64_data, media_type) pair attached to the final user turn,
    so the assistant can answer questions about what the camera sees.
    """
    r = resolve(db)
    if image is not None and not providers.supports_vision(r.provider.id, r.model):
        raise VisionUnsupportedError(
            f"{r.provider.label} model '{r.model}' can't see images. "
            f"Switch to a vision model in Settings"
            + (f" (e.g. {r.provider.vision_models[0]})" if r.provider.vision_models else "")
            + "."
        )
    tools = tools or []
    dispatch = dispatch or (lambda name, args: f"Unknown tool: {name}")
    fn = _complete_anthropic if r.provider.transport == "anthropic" else _complete_openai
    return fn(r, system, history, tools, dispatch, image)


def check_key(provider_id: str, api_key: str, model: str) -> tuple[bool, str]:
    """Send a 1-token probe so Settings can verify a key before saving it."""
    provider = providers.get(provider_id)
    if provider is None:
        return False, f"Unknown provider '{provider_id}'"
    probe = Resolved(provider, api_key, model or provider.default_model)
    try:
        if provider.transport == "anthropic":
            import anthropic

            anthropic.Anthropic(api_key=api_key).messages.create(
                model=probe.model,
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
        else:
            from openai import OpenAI

            OpenAI(api_key=api_key, base_url=provider.base_url).chat.completions.create(
                model=probe.model,
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
        return True, f"{provider.label} responded — key works."
    except Exception as e:  # provider SDKs raise distinct types; surface the message
        return False, str(e)[:300]
