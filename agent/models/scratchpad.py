from typing import TypedDict


class AgentScratchpad(TypedDict, total=False):
    ticket_key: str
    ticket_summary: str
    ticket_description: str
    ticket_priority: str
    ticket_labels: list[str]
    ticket_components: list[str]
    ticket_type: str
    classification: dict
    execution_plan: list[str]
    plan_reasoning: str
    relevant_files: list[dict]
    related_prs: list[dict]
    related_tickets: list[dict]
    context_confidence: float
    context_retry_count: int
    primary_owner: dict
    escalation_path: list[dict]
    suggested_question: str
    plain_summary: str
    suggested_steps: list[dict]
    risk_flags: list[dict]
    open_related_bugs: list[dict]
    overall_risk_level: str
    briefing: dict
    agent_trace: list[dict]
    run_id: str
    execution_path: str
    ticket_id: str
    ticket_assignee: dict
    ticket_reporter: dict
    ticket_created: str
    routing_confidence: float
    overall_confidence: float
    processing_status: str
    jira_comment_body: str
    historical_incidents: list[dict]
    key_concepts: list[str]
    audience_level: str
