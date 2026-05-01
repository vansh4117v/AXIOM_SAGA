from db.connection import get_connection


def search_closed_tickets(keywords: list[str]) -> list[dict]:
    if not keywords:
        return []

    like_clauses = " OR ".join(
        "LOWER(ticket_dto->>'ticket_summary') LIKE %s" for _ in keywords
    )
    params = [f"%{kw.lower()}%" for kw in keywords]

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT ticket_key,
                       ticket_dto->>'ticket_summary' AS summary,
                       status
                FROM tickets
                WHERE ({like_clauses})
                  AND status = 'complete'
                LIMIT 10
                """,
                params,
            )
            rows = cur.fetchall()

    return [
        {"key": row[0], "summary": row[1], "status": row[2], "resolution": "resolved"}
        for row in rows
    ]


def get_team_registry() -> list[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT team_name, member_name, role, github_handle,
                       domains, owned_paths, escalation_priority
                FROM team_registry
                ORDER BY escalation_priority ASC
                """
            )
            rows = cur.fetchall()

    return [
        {
            "team_name": row[0],
            "member_name": row[1],
            "role": row[2],
            "github_handle": row[3],
            "domains": row[4] or [],
            "owned_paths": row[5] or [],
            "escalation_priority": row[6],
        }
        for row in rows
    ]
