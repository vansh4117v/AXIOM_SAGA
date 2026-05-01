"""Unit tests for SAGE — no DB or API keys needed."""
import json
from unittest.mock import patch, MagicMock

from models.ticket import TicketDTO, PersonRef
from jira_client import parse_webhook_payload


class TestParseWebhookPayload:
    """Verify Jira webhook JSON → TicketDTO mapping."""

    def test_full_payload(self):
        payload = {
            "issue": {
                "id": "10042",
                "key": "SAGE-1",
                "fields": {
                    "summary": "Login page 500 error",
                    "description": "Users see a 500 on /login after deploy",
                    "priority": {"name": "P0"},
                    "issuetype": {"name": "Bug"},
                    "labels": ["production", "auth"],
                    "components": [{"name": "frontend"}],
                    "assignee": {
                        "displayName": "Parshvi Jain",
                        "emailAddress": "parshvi@team.com",
                        "accountId": "abc123",
                    },
                    "reporter": {
                        "displayName": "Monitor Bot",
                        "emailAddress": "bot@team.com",
                    },
                    "created": "2026-05-01T10:00:00Z",
                },
            }
        }

        ticket = parse_webhook_payload(payload)

        assert ticket.ticket_key == "SAGE-1"
        assert ticket.ticket_summary == "Login page 500 error"
        assert ticket.ticket_priority == "P0"
        assert ticket.ticket_type == "Bug"
        assert "production" in ticket.ticket_labels
        assert ticket.ticket_assignee.name == "Parshvi Jain"
        assert ticket.ticket_reporter.name == "Monitor Bot"
        assert ticket.ticket_components == ["frontend"]

    def test_minimal_payload(self):
        """Missing fields should not crash, defaults applied."""
        payload = {
            "issue": {
                "key": "SAGE-2",
                "fields": {
                    "summary": "Add docs",
                },
            }
        }

        ticket = parse_webhook_payload(payload)

        assert ticket.ticket_key == "SAGE-2"
        assert ticket.ticket_summary == "Add docs"
        assert ticket.ticket_priority == "Medium"
        assert ticket.ticket_type == "Task"
        assert ticket.ticket_labels == []
        assert ticket.ticket_assignee.name == "Unassigned"


class TestOrchestorBranchLogic:
    """Verify the 3 execution plans without making LLM calls."""

    def test_p0_triggers_risk_first(self):
        from agents.orchestrator import should_run_risk_first

        state = {"execution_plan": ["risk_agent", "context_agent", "routing_agent"]}
        assert should_run_risk_first(state) == "risk_agent"

    def test_default_triggers_context_first(self):
        from agents.orchestrator import should_run_risk_first

        state = {"execution_plan": ["context_agent", "routing_agent", "explainer_agent", "risk_agent"]}
        assert should_run_risk_first(state) == "context_agent"

    def test_context_retry_below_threshold(self):
        from agents.orchestrator import should_retry_context

        state = {"context_confidence": 0.3, "context_retry_count": 0}
        assert should_retry_context(state) == "context_agent"

    def test_context_passes_after_threshold(self):
        from agents.orchestrator import should_retry_context

        state = {"context_confidence": 0.85, "context_retry_count": 1}
        assert should_retry_context(state) == "routing_check"

    def test_context_stops_after_max_retries(self):
        from agents.orchestrator import should_retry_context

        state = {"context_confidence": 0.3, "context_retry_count": 2}
        assert should_retry_context(state) == "routing_check"

    def test_risk_late_skipped_if_already_ran(self):
        from agents.orchestrator import should_run_risk_late

        state = {
            "execution_plan": ["risk_agent", "context_agent", "routing_agent"],
            "execution_path": "risk_first",
        }
        assert should_run_risk_late(state) == "synthesis"

    def test_risk_late_runs_on_default_path(self):
        from agents.orchestrator import should_run_risk_late

        state = {
            "execution_plan": ["context_agent", "routing_agent", "explainer_agent", "risk_agent"],
            "execution_path": "default",
        }
        assert should_run_risk_late(state) == "risk_agent_late"
