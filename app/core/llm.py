"""Thin wrapper around the Anthropic SDK, plus a 'basic' tier for cheap providers.

Every feature in the app goes through one of three calls:
  - complete(): free-text answer
  - extract():  structured answer validated against a Pydantic model
  - stream():   token stream for chat-style UI

Cost controls, in order of effect:
  - MODEL comes from MCT_MODEL (default claude-sonnet-5); `effort` is the per-call dial.
  - `cached=` puts a large stable block (the profile) in the system prompt with a 1-hour cache
    breakpoint, so match -> tailor -> rescore re-read it at ~10% of the price.
  - `tier="basic"` sends writing/simple-extraction calls to the free provider in
    app/core/providers (Gemini or Ollama) and falls back to Claude on any failure.
  - Every call is logged to llm_usage with its cost (app/core/usage.py).
"""
import json
import logging
import os
from typing import Iterator, Literal, Type, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from app.core import config  # noqa: F401  (loads .env before the client is built)
from app.core import providers, usage

log = logging.getLogger("mct.llm")

MODEL = os.getenv("MCT_MODEL", "claude-sonnet-5")
Tier = Literal["judgment", "basic"]

T = TypeVar("T", bound=BaseModel)

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _system_blocks(system: str | None, cached: str | None) -> list[dict] | anthropic.NotGiven:
    """Stable prompt first, then the cached block with a breakpoint. Prefix order matters for cache hits."""
    blocks: list[dict] = []
    if system:
        blocks.append({"type": "text", "text": system})
    if cached:
        blocks.append({"type": "text", "text": cached, "cache_control": {"type": "ephemeral", "ttl": "1h"}})
    return blocks or anthropic.NOT_GIVEN


def _record(feature: str, response_usage, fallback: bool = False) -> None:
    u = response_usage
    usage.record(feature, "anthropic", MODEL,
                 input_tokens=u.input_tokens, cache_read=u.cache_read_input_tokens or 0,
                 cache_write=u.cache_creation_input_tokens or 0, output_tokens=u.output_tokens, fallback=fallback)


def complete(
    user: str,
    system: str | None = None,
    effort: str = "medium",
    max_tokens: int = 16000,
    cached: str | None = None,
    feature: str = "other",
) -> str:
    response = client().messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=_system_blocks(system, cached),
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort},
    )
    _record(feature, response.usage)
    return "".join(b.text for b in response.content if b.type == "text")


def extract(
    schema: Type[T],
    user: str,
    system: str | None = None,
    effort: str = "medium",
    max_tokens: int = 16000,
    cached: str | None = None,
    feature: str = "other",
    tier: Tier = "judgment",
) -> T:
    """Structured output validated against `schema`.

    tier="basic": try the configured free provider first; any error or invalid JSON falls back to
    Claude (logged as a fallback). tier="judgment": Claude only.

    On Claude, uses the API's constrained-output mode when the schema is small enough; for large
    schemas (the API rejects them with 'compiled grammar is too large') it falls back to putting the
    JSON schema in the prompt and validating the reply locally.
    """
    fallback = False
    if tier == "basic" and providers.available():
        try:
            r = providers.extract(schema, user, system)
            out = schema.model_validate_json(_strip_fences(r.text))
            usage.record(feature, r.provider, r.model, input_tokens=r.input_tokens, output_tokens=r.output_tokens)
            return out
        except (ValidationError, ValueError, Exception) as e:  # noqa: BLE001 - any provider failure falls back
            log.warning("basic provider failed for %s (%s: %s); falling back to Claude", feature, type(e).__name__, e)
            fallback = True

    try:
        response = client().messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            system=_system_blocks(system, cached),
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": effort},
        )
    except anthropic.BadRequestError as e:
        if "grammar is too large" not in str(e):
            raise
        return _extract_via_prompt(schema, user, system, effort, max_tokens, cached, feature, fallback)
    _record(feature, response.usage, fallback)
    if response.parsed_output is None:
        raise RuntimeError(f"Model returned no parseable {schema.__name__} (stop_reason={response.stop_reason})")
    return response.parsed_output


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return text


def _extract_via_prompt(schema: Type[T], user: str, system: str | None, effort: str, max_tokens: int,
                        cached: str | None, feature: str, fallback: bool) -> T:
    schema_json = json.dumps(schema.model_json_schema(), indent=None)
    instructions = (
        "Respond with a single JSON object and nothing else - no prose, no markdown fences. "
        f"It must validate against this JSON schema:\n{schema_json}"
    )
    full_system = f"{system}\n\n{instructions}" if system else instructions
    response = client().messages.create(
        model=MODEL, max_tokens=max_tokens, system=_system_blocks(full_system, cached),
        messages=[{"role": "user", "content": user}], output_config={"effort": effort},
    )
    _record(feature, response.usage, fallback)
    text = "".join(b.text for b in response.content if b.type == "text")
    return schema.model_validate_json(_strip_fences(text))


def stream(
    messages: list[dict],
    system: str | list[dict] | None = None,
    effort: str = "medium",
    max_tokens: int = 64000,
    feature: str = "chat",
) -> Iterator[str]:
    """Yields text chunks. `messages` is the full history in API format. `system` may be a list of
    blocks with cache_control already set (the interview does this)."""
    with client().messages.stream(
        model=MODEL,
        max_tokens=max_tokens,
        system=system or anthropic.NOT_GIVEN,
        messages=messages,
        output_config={"effort": effort},
    ) as s:
        yield from s.text_stream
        _record(feature, s.get_final_message().usage)


def check_connection() -> str:
    """Cheapest possible round-trip; returns the model's reply or raises."""
    return complete("Reply with the single word OK.", effort="low", max_tokens=16, feature="check")
