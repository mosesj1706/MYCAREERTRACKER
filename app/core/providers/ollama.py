"""Ollama on localhost - fully private, free. Needs a pulled model: `ollama pull <OLLAMA_MODEL>`."""
import os
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel

from app.core.providers import ProviderResult

T = TypeVar("T", bound=BaseModel)


def model_name() -> str:
    return os.getenv("OLLAMA_MODEL", "llama3.1:8b")


def base_url() -> str:
    return os.getenv("OLLAMA_HOST", "http://localhost:11434")


def extract(schema: Type[T], user: str, system: str | None) -> ProviderResult:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
    r = httpx.post(f"{base_url()}/api/chat", timeout=300,
                   json={"model": model_name(), "messages": messages, "stream": False,
                         "format": schema.model_json_schema(), "options": {"temperature": 0.2}})
    r.raise_for_status()
    d = r.json()
    return ProviderResult(d["message"]["content"], "ollama", model_name(),
                          input_tokens=d.get("prompt_eval_count", 0), output_tokens=d.get("eval_count", 0))
