import os
import psycopg2
import psycopg2.pool
from contextlib import contextmanager

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        dsn = os.environ["AZURE_POSTGRES_URL"]
        # Add connect timeout if not already in DSN
        if "connect_timeout" not in dsn:
            sep = "&" if "?" in dsn else "?"
            dsn += f"{sep}connect_timeout=10"
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=dsn,
            options="-c statement_timeout=30000",  # 30s max per query
        )
    return _pool


@contextmanager
def get_connection():
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)
