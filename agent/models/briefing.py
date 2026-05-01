from pydantic import BaseModel


class RiskFlag(BaseModel):
    flag: str
    severity: str
    evidence: str
    recommendation: str


class SuggestedStep(BaseModel):
    step_number: int
    action: str
    rationale: str
    estimated_effort_hours: float


class PrimaryOwner(BaseModel):
    name: str
    role: str
    team: str
    github_handle: str
    match_reason: str


class Briefing(BaseModel):
    ticket_key: str
    run_id: str
    overall_confidence: float
    context_summary: str
    owner_summary: str
    steps_summary: str
    risk_summary: str
    ask_senior_message: str
    primary_owner: PrimaryOwner
    risk_flags: list[RiskFlag]
    suggested_steps: list[SuggestedStep]
    overall_risk_level: str
    execution_plan: list[str]
