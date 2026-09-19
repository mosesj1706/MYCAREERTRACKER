"""Gemini via the google-genai SDK. Free tier needs only GEMINI_API_KEY (aistudio.google.com)."""
import os
from typing import Type, TypeVar

from pydantic import BaseModel

from app.core.providers import ProviderResult

T = TypeVar("T", bound=BaseModel)
_client = None


def model_name() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def client():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def extract(schema: Type[T], user: str, system: str | None) -> ProviderResult:
    from google.genai import types
    r = client().models.generate_content(
        model=model_name(),
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.2,
        ),
    )
    u = r.usage_metadata
    return ProviderResult(r.text or "", "gemini", model_name(),
                          input_tokens=(u.prompt_token_count or 0) if u else 0,
                          output_tokens=(u.candidates_token_count or 0) if u else 0)


def list_models() -> list[str]:
    return [m.name.replace("models/", "") for m in client().models.list() if "generateContent" in (m.supported_actions or [])]
