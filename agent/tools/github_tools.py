import os
import base64
import requests

_GITHUB_API = "https://api.github.com"


def _headers() -> dict:
    return {"Authorization": f"token {os.environ['GITHUB_TOKEN']}"}


def _owner() -> str:
    return os.environ["GITHUB_OWNER"]


def _all_repos() -> list[str]:
    return [r.strip() for r in os.environ["GITHUB_REPOS"].split(",") if r.strip()]


def get_file_content(file_path: str, repo: str | None = None) -> dict | None:
    """Fetch file from a specific repo, or search all repos if none specified."""
    owner = _owner()
    repos = [repo] if repo else _all_repos()

    for r in repos:
        url = f"{_GITHUB_API}/repos/{owner}/{r}/contents/{file_path}"
        resp = requests.get(url, headers=_headers(), timeout=10)
        if resp.status_code != 200:
            continue
        data = resp.json()
        if data.get("type") != "file":
            continue
        content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
        return {"path": file_path, "content": content[:2000], "repo": r}

    return None


def get_recent_prs_for_file(file_path: str, limit: int = 5) -> list[dict]:
    """Search PRs across all repos for a given file path."""
    owner = _owner()
    matching = []

    for repo in _all_repos():
        url = f"{_GITHUB_API}/repos/{owner}/{repo}/pulls"
        resp = requests.get(
            url,
            headers=_headers(),
            params={"state": "closed", "per_page": 10},
            timeout=10,
        )
        if resp.status_code != 200:
            continue

        for pr in resp.json():
            files_url = f"{_GITHUB_API}/repos/{owner}/{repo}/pulls/{pr['number']}/files"
            files_resp = requests.get(files_url, headers=_headers(), timeout=10)
            if files_resp.status_code != 200:
                continue
            touched_paths = [f["filename"] for f in files_resp.json()]
            if file_path in touched_paths:
                matching.append(
                    {
                        "pr_number": pr["number"],
                        "title": pr["title"],
                        "author": pr["user"]["login"],
                        "merged_at": pr.get("merged_at"),
                        "files_changed": len(touched_paths),
                        "pr_url": pr["html_url"],
                        "repo": repo,
                    }
                )
            if len(matching) >= limit:
                return matching

    return matching


def validate_file_paths(files: list[dict]) -> list[dict]:
    """Validate file paths across all repos."""
    owner = _owner()
    valid = []
    for f in files:
        if f.get("similarity_score", 0) > 0.8:
            valid.append(f)
            continue
        # Check file exists in any repo
        found = False
        for repo in _all_repos():
            url = f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{f['path']}"
            resp = requests.get(url, headers=_headers(), timeout=10)
            if resp.status_code == 200:
                f["repo"] = repo
                found = True
                break
        if found:
            valid.append(f)
    return valid

