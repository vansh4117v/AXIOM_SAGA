import json
from typing import Any


def parse_llm_json(raw: str) -> Any:
    """Parse the first JSON value from an LLM response."""
    text = (raw or "").strip()

    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
        text = text.strip()

    decoder = json.JSONDecoder()
    last_error = None
    for idx, char in enumerate(text):
        if char not in "{[":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[idx:])
            return parsed
        except json.JSONDecodeError as exc:
            last_error = exc

    if last_error:
        raise last_error
    raise json.JSONDecodeError("No JSON object found", text, 0)


def parse_llm_json_object(raw: str) -> dict:
    parsed = parse_llm_json(raw)
    if not isinstance(parsed, dict):
        raise TypeError(f"Expected JSON object, got {type(parsed).__name__}")
    return parsed
