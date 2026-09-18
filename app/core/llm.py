"""Thin wrapper around the Anthropic SDK.

Every feature in the app goes through one of three calls:
  - complete(): free-text answer
  - extract():  structured answer validated against a Pydantic model
  - stream():   token stream for chat-style UI

One model everywhere; `effort` is the cost/quality dial per call.
"""
import json
from typing import Iterator, Type, TypeVar

import anthropic
from pydantic import BaseModel

from app.core import config  # noqa: F401  (loads .env before the client is built)

MODEL = "claude-opus-5"

T = TypeVar("T", bound=BaseModel)

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def complete(
    user: str,
    system: str | None = None,
    effort: str = "medium",
    max_tokens: int = 16000,
) -> str:
    response = client().messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system or anthropic.NOT_GIVEN,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort},
    )
    return "".join(b.text for b in response.content if b.type == "text")


def extract(
    schema: Type[T],
    user: str,
    system: str | None = None,
    effort: str = "medium",
    max_tokens: int = 16000,
) -> T:
    """Structured output validated against `schema`.

    Uses the API's constrained-output mode when the schema is small enough; for large
    schemas (the API rejects them with 'compiled grammar is too large') it falls back to
    putting the JSON schema in the prompt and validating the reply locally.
    """
    try:
        response = client().messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            system=system or anthropic.NOT_GIVEN,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": effort},
        )
    except anthropic.BadRequestError as e:
        if "grammar is too large" not in str(e):
            raise
        return _extract_via_prompt(schema, user, system, effort, max_tokens)
    if response.parsed_output is None:
        raise RuntimeError(f"Model returned no parseable {schema.__name__} (stop_reason={response.stop_reason})")
    return response.parsed_output


def _extract_via_prompt(schema: Type[T], user: str, system: str | None, effort: str, max_tokens: int) -> T:
    schema_json = json.dumps(schema.model_json_schema(), indent=None)
    instructions = (
        "Respond with a single JSON object and nothing else - no prose, no markdown fences. "
        f"It must validate against this JSON schema:\n{schema_json}"
    )
    full_system = f"{system}\n\n{instructions}" if system else instructions
    text = complete(user, system=full_system, effort=effort, max_tokens=max_tokens).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return schema.model_validate_json(text)


def stream(
    messages: list[dict],
    system: str | None = None,
    effort: str = "medium",
    max_tokens: int = 64000,
) -> Iterator[str]:
    """Yields text chunks. `messages` is the full history in API format."""
    with client().messages.stream(
        model=MODEL,
        max_tokens=max_tokens,
        system=system or anthropic.NOT_GIVEN,
        messages=messages,
        output_config={"effort": effort},
    ) as s:
        yield from s.text_stream


def check_connection() -> str:
    """Cheapest possible round-trip; returns the model's reply or raises."""
    return complete("Reply with the single word OK.", effort="low", max_tokens=16)
