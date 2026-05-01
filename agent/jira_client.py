import os
import requests
from requests.auth import HTTPBasicAuth

from models.ticket import TicketDTO, PersonRef


def _auth() -> HTTPBasicAuth:
    return HTTPBasicAuth(os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])


def _base() -> str:
    return os.environ["JIRA_BASE_URL"].rstrip("/")


def parse_webhook_payload(payload: dict) -> TicketDTO:
    issue = payload.get("issue", payload)
    fields = issue.get("fields", {})

    assignee = fields.get("assignee") or {}
    reporter = fields.get("reporter") or {}

    return TicketDTO(
        ticket_id=issue.get("id", ""),
        ticket_key=issue.get("key", ""),
        ticket_summary=fields.get("summary", ""),
        ticket_description=_extract_text(fields.get("description")),
        ticket_priority=fields.get("priority", {}).get("name", "Medium") if fields.get("priority") else "Medium",
        ticket_labels=fields.get("labels", []),
        ticket_components=[c.get("name", "") for c in fields.get("components", [])],
        ticket_assignee=PersonRef(
            name=assignee.get("displayName", "Unassigned"),
            email=assignee.get("emailAddress"),
            jira_account_id=assignee.get("accountId"),
        ),
        ticket_reporter=PersonRef(
            name=reporter.get("displayName", ""),
            email=reporter.get("emailAddress"),
        ),
        ticket_created=fields.get("created", ""),
        ticket_type=fields.get("issuetype", {}).get("name", "Task") if fields.get("issuetype") else "Task",
    )


def _extract_text(description) -> str:
    if description is None:
        return ""
    if isinstance(description, str):
        return description
    parts = []
    for block in description.get("content", []):
        for inline in block.get("content", []):
            if inline.get("type") == "text":
                parts.append(inline.get("text", ""))
    return " ".join(parts)


def write_comment(ticket_key: str, briefing: dict, trace_url: str) -> None:
    confidence_pct = round(briefing.get("overall_confidence", 0) * 100)
    owner = briefing.get("primary_owner", {})
    body = {
        "body": {
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 3},
                    "content": [{"type": "text", "text": f"SAGE Analysis  confidence {confidence_pct}%"}],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "marks": [{"type": "strong"}], "text": "Context: "},
                        {"type": "text", "text": briefing.get("context_summary", "")},
                    ],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "marks": [{"type": "strong"}], "text": "Owner: "},
                        {"type": "text", "text": f"{owner.get('name', '')} ({owner.get('team', '')})"},
                    ],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "marks": [{"type": "strong"}], "text": "Risk: "},
                        {"type": "text", "text": briefing.get("risk_summary", "none")},
                    ],
                },
                {
                    "type": "blockquote",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {"type": "text", "marks": [{"type": "strong"}], "text": "Suggested question: "},
                                {"type": "hardBreak"},
                                {"type": "text", "text": briefing.get("ask_senior_message", "")},
                            ],
                        }
                    ],
                },
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "marks": [{"type": "link", "attrs": {"href": trace_url}}],
                            "text": "View full briefing in SAGE",
                        }
                    ],
                },
            ],
        }
    }
    resp = requests.post(
        f"{_base()}/rest/api/3/issue/{ticket_key}/comment",
        json=body,
        auth=_auth(),
        timeout=10,
    )
    resp.raise_for_status()
