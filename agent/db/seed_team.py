import logging
from db.connection import get_connection

logger = logging.getLogger(__name__)

DEMO_TEAM = [
    {
        "team_name": "Backend",
        "member_name": "Parshvi Jain",
        "role": "Lead Engineer",
        "github_handle": "parshvi1508",
        "domains": ["payments", "auth", "infrastructure", "database"],
        "owned_paths": ["agents/", "api/", "db/", "tools/", "models/"],
        "escalation_priority": 1,
    },
    {
        "team_name": "Backend",
        "member_name": "Dev Sharma",
        "role": "Senior Engineer",
        "github_handle": "devsharma",
        "domains": ["frontend", "documentation", "testing"],
        "owned_paths": ["scripts/", "tests/", "config/"],
        "escalation_priority": 2,
    },
    {
        "team_name": "DevOps",
        "member_name": "Arjun Mehta",
        "role": "DevOps Engineer",
        "github_handle": "arjunmehta",
        "domains": ["infrastructure", "deployment", "ci-cd"],
        "owned_paths": ["Dockerfile", "docker-compose.yml", ".github/"],
        "escalation_priority": 3,
    },
]


def seed_team_if_empty() -> None:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM team_registry")
                count = cur.fetchone()[0]
                if count > 0:
                    logger.info(f"[seed] team_registry has {count} rows, skip")
                    return

                for member in DEMO_TEAM:
                    cur.execute(
                        """
                        INSERT INTO team_registry
                            (team_name, member_name, role, github_handle, domains, owned_paths, escalation_priority)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            member["team_name"],
                            member["member_name"],
                            member["role"],
                            member["github_handle"],
                            member["domains"],
                            member["owned_paths"],
                            member["escalation_priority"],
                        ),
                    )
                logger.info(f"[seed] Inserted {len(DEMO_TEAM)} team members")
    except Exception as e:
        logger.error(f"[seed] team_registry seed failed: {e}")
