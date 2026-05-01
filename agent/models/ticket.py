from pydantic import BaseModel


class PersonRef(BaseModel):
    name: str = ""
    email: str | None = None
    jira_account_id: str | None = None


class TicketDTO(BaseModel):
    ticket_id: str = ""
    ticket_key: str
    ticket_summary: str
    ticket_description: str
    ticket_priority: str
    ticket_labels: list[str] = []
    ticket_components: list[str] = []
    ticket_assignee: PersonRef = PersonRef()
    ticket_reporter: PersonRef = PersonRef()
    ticket_created: str = ""
    ticket_type: str = "Task"
