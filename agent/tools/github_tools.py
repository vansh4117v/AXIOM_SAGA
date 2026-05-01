import os
import base64
import requests

_GITHUB_API = "https://api.github.com"


def _headers() -> dict:
    return {"Authorization": f"token {os.environ['GITHUB_TOKEN']}"}


def _owner_repo() -> tuple[str, str]:
    owner = os.environ["GITHUB_OWNER"]
    repo = os.environ["GITHUB_REPOS"].split(",")[0].strip()
    return owner, repo


def get_file_content(file_path: str) -> dict | None:
    owner, repo = _owner_repo()
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{file_path}"
    resp = requests.get(url, headers=_headers(), timeout=10)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data.get("type") != "file":
        return None
    content = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
    return {"path": file_path, "content": content[:2000]}


def get_recent_prs_for_file(file_path: str, limit: int = 5) -> list[dict]:
    owner, repo = _owner_repo()
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/pulls"
    resp = requests.get(
        url,
        headers=_headers(),
        params={"state": "closed", "per_page": 10},
        timeout=10,
    )
    if resp.status_code != 200:
        return []

    matching = []
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
                }
            )
        if len(matching) >= limit:
            break

    return matching


def validate_file_paths(files: list[dict]) -> list[dict]:
    owner, repo = _owner_repo()
    valid = []
    for f in files:
        if f.get("similarity_score", 0) > 0.8:
            valid.append(f)
            continue
        url = f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{f['path']}"
        resp = requests.get(url, headers=_headers(), timeout=10)
        if resp.status_code == 200:
            valid.append(f)
    return valid
