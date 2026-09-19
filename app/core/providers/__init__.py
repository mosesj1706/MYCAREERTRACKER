"""Cheap/free providers for the 'basic' tier - writing and simple extraction that needs no deep judgment.

Selected by MCT_BASIC_PROVIDER in .env: gemini | ollama | claude (default). Every basic call falls
back to Claude if the provider is not configured, errors, or returns JSON that fails validation.
"""
import os
from typing import Type, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class ProviderResult:
    def __init__(self, text: str, provider: str, model: str, input_tokens: int = 0, output_tokens: int = 0):
        self.text, self.provider, self.model, self.input_tokens, self.output_tokens = text, provider, model, input_tokens, output_tokens


def name() -> str:
    return os.getenv("MCT_BASIC_PROVIDER", "claude").strip().lower()


def available() -> bool:
    n = name()
    if n == "gemini":
        return bool(os.getenv("GEMINI_API_KEY"))
    if n == "ollama":
        return True
    return False


def extract(schema: Type[T], user: str, system: str | None) -> ProviderResult:
    """Ask the configured basic provider for JSON matching `schema`. Raises on any failure."""
    n = name()
    if n == "gemini":
        from app.core.providers import gemini
        return gemini.extract(schema, user, system)
    if n == "ollama":
        from app.core.providers import ollama
        return ollama.extract(schema, user, system)
    raise RuntimeError("No basic provider configured")
