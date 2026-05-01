"""
Embed all repos listed in GITHUB_REPOS env var.
Usage: python scripts/embed_repos.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from db.embeddings import embed_repository


def main():
    owner = os.environ["GITHUB_OWNER"]
    repos_raw = os.environ.get("GITHUB_REPOS", "")
    repos = [r.strip() for r in repos_raw.split(",") if r.strip()]

    if not repos:
        print("No repos in GITHUB_REPOS env var")
        return

    for repo in repos:
        print(f"Embedding {owner}/{repo}...")
        try:
            embed_repository(owner, repo)
        except Exception as e:
            print(f"  Failed: {e}")

    print("Done.")


if __name__ == "__main__":
    main()
