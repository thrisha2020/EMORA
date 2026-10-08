"""Registry of supported LLM providers.

Two transports are used:
  - "anthropic" -> the official `anthropic` SDK (Claude is not an OpenAI-compatible API)
  - "openai"    -> the `openai` SDK pointed at the provider's OpenAI-compatible base URL

`models` is a convenience list for the Settings dropdown; users can always type a
custom model id, because provider model names churn faster than this file.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    transport: str  # "anthropic" | "openai"
    default_model: str
    models: list[str] = field(default_factory=list)
    base_url: str | None = None
    key_prefix: str = ""
    console_url: str = ""
    # Models that can accept an image alongside text. Vision is per-model, not
    # per-provider — a provider may serve both vision and text-only models.
    vision_models: tuple[str, ...] = ()


PROVIDERS: dict[str, Provider] = {
    "openai": Provider(
        id="openai",
        label="OpenAI · ChatGPT",
        transport="openai",
        default_model="gpt-4o-mini",
        models=["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
        vision_models=("gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"),
        base_url=None,  # SDK default
        key_prefix="sk-",
        console_url="https://platform.openai.com/api-keys",
    ),
    "anthropic": Provider(
        id="anthropic",
        label="Anthropic · Claude",
        transport="anthropic",
        default_model="claude-opus-5",
        models=["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
        vision_models=("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"),
        base_url=None,
        key_prefix="sk-ant-",
        console_url="https://console.anthropic.com/settings/keys",
    ),
    "groq": Provider(
        id="groq",
        label="Groq",
        transport="openai",
        default_model="llama-3.3-70b-versatile",
        models=[
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "openai/gpt-oss-120b",
            "qwen/qwen3.6-27b",  # the vision-capable option on Groq
        ],
        vision_models=("qwen/qwen3.6-27b",),
        base_url="https://api.groq.com/openai/v1",
        key_prefix="gsk_",
        console_url="https://console.groq.com/keys",
    ),
    "xai": Provider(
        id="xai",
        label="xAI · Grok",
        transport="openai",
        default_model="grok-3",
        models=["grok-3", "grok-3-mini", "grok-2-vision-latest"],
        vision_models=("grok-3", "grok-2-vision-latest"),
        base_url="https://api.x.ai/v1",
        key_prefix="xai-",
        console_url="https://console.x.ai",
    ),
    "nvidia": Provider(
        id="nvidia",
        label="NVIDIA · Nemotron",
        transport="openai",
        default_model="nvidia/llama-3.3-nemotron-super-49b-v1",
        models=[
            "nvidia/llama-3.3-nemotron-super-49b-v1",
            "nvidia/llama-3.1-nemotron-70b-instruct",
            "nvidia/llama-3.1-nemotron-nano-8b-v1",
        ],
        base_url="https://integrate.api.nvidia.com/v1",
        key_prefix="nvapi-",
        console_url="https://build.nvidia.com",
    ),
}


def get(provider_id: str) -> Provider | None:
    return PROVIDERS.get(provider_id)


def catalog() -> list[dict]:
    """Provider metadata for the Settings UI (no secrets)."""
    return [
        {
            "id": p.id,
            "label": p.label,
            "default_model": p.default_model,
            "models": p.models,
            "key_prefix": p.key_prefix,
            "console_url": p.console_url,
            "vision_models": list(p.vision_models),
        }
        for p in PROVIDERS.values()
    ]


def supports_vision(provider_id: str, model: str) -> bool:
    """Can this provider/model pair accept an image?

    Matched on prefix so dated snapshots (`gpt-4o-2024-08-06`) still resolve.
    """
    provider = PROVIDERS.get(provider_id)
    if provider is None:
        return False
    name = (model or "").strip().lower()
    return any(name.startswith(v.lower()) for v in provider.vision_models)
