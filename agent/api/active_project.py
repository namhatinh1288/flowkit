"""Active project API — get/set the currently active project.

This front-half branch also exposes a TEMPORARY local-only netlog sink used to
capture Flow's batchexecute wire shape from a real UI action. It intentionally
stores no headers, cookies, CSRF tokens, or auth credentials.
"""
import json
import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException

from agent.db import crud

router = APIRouter(prefix="/api/active-project", tags=["active-project"])
logger = logging.getLogger(__name__)

_STATE_FILE = Path(__file__).parent.parent / "active_project.json"
_NETLOG_FILE = Path(__file__).parent.parent.parent / "scratch" / "flow-netlog.jsonl"


def _read_state() -> dict | None:
    if _STATE_FILE.exists():
        try:
            with open(_STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Corrupt active_project.json, clearing: %s", e)
            _clear_state()
    return None


def _write_state(data: dict):
    """Atomic write — temp file + os.replace to avoid partial reads."""
    content = json.dumps(data, indent=2) + "\n"
    fd, tmp = tempfile.mkstemp(dir=_STATE_FILE.parent, suffix=".tmp")
    try:
        os.write(fd, content.encode())
        os.close(fd)
        os.replace(tmp, _STATE_FILE)
    except BaseException:
        os.close(fd)
        os.unlink(tmp)
        raise


def _clear_state():
    if _STATE_FILE.exists():
        _STATE_FILE.unlink()


@router.get("")
async def get_active_project():
    """Return the active project. Falls back to most recently created if none set."""
    state = _read_state()

    if state and state.get("project_id"):
        project = await crud.get_project(state["project_id"])
        if project:
            # Enrich with video info
            videos = await crud.list_videos(project_id=project["id"])
            video = videos[0] if videos else None
            return {
                "project_id": project["id"],
                "project_name": project["name"],
                "video_id": video["id"] if video else None,
                "orientation": video.get("orientation") if video else None,
                "material": project.get("material"),
                "status": project.get("status"),
                "source": "explicit",
            }
        else:
            # Stale reference — clear and fall back
            _clear_state()

    # Fall back to most recent project
    projects = await crud.list_projects()
    if not projects:
        return {"project_id": None, "project_name": None, "source": "none"}

    project = projects[0]  # list is ORDER BY created_at DESC, [0] = most recent
    videos = await crud.list_videos(project_id=project["id"])
    video = videos[0] if videos else None
    return {
        "project_id": project["id"],
        "project_name": project["name"],
        "video_id": video["id"] if video else None,
        "orientation": video.get("orientation") if video else None,
        "material": project.get("material"),
        "status": project.get("status"),
        "source": "fallback_most_recent",
    }


@router.put("")
async def set_active_project(body: dict):
    """Set the active project by project_id."""
    project_id = body.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    project = await crud.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    _write_state({"project_id": project_id})
    logger.info("Active project set: %s (%s)", project["name"], project_id[:8])

    videos = await crud.list_videos(project_id=project_id)
    video = videos[0] if videos else None
    return {
        "project_id": project["id"],
        "project_name": project["name"],
        "video_id": video["id"] if video else None,
        "orientation": video.get("orientation") if video else None,
        "material": project.get("material"),
        "status": project.get("status"),
        "source": "explicit",
    }


@router.delete("")
async def clear_active_project():
    """Clear the active project (revert to fallback behavior)."""
    _clear_state()
    return {"status": "cleared", "message": "Active project cleared. Will use most recent project as fallback."}


# ─── TEMP Flow batchexecute wire recorder ───────────────────
# Evidence only. This is intentionally local, bounded, and contains no request
# headers/cookies/auth. Remove after the current Flow RPC contract is identified.

@router.post("/netlog")
async def append_flow_netlog(body: dict):
    allowed = {
        "ts": body.get("ts"),
        "path": body.get("path"),
        "rpcids": body.get("rpcids"),
        "f_req": body.get("f_req"),
        "status_code": body.get("status_code"),
        "response_text": body.get("response_text"),
        "response_truncated": bool(body.get("response_truncated", False)),
    }
    # Keep accidental payload growth bounded even if Flow changes dramatically.
    if isinstance(allowed["f_req"], str):
        allowed["f_req"] = allowed["f_req"][:500_000]
    if isinstance(allowed["response_text"], str):
        allowed["response_text"] = allowed["response_text"][:250_000]

    _NETLOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_NETLOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(allowed, ensure_ascii=False) + "\n")
    return {"ok": True, "path": str(_NETLOG_FILE), "rpcids": allowed["rpcids"]}


@router.get("/netlog")
async def read_flow_netlog(limit: int = 20):
    if not _NETLOG_FILE.exists():
        return {"path": str(_NETLOG_FILE), "count": 0, "items": []}
    lines = _NETLOG_FILE.read_text(encoding="utf-8").splitlines()
    items = []
    for line in lines[-max(1, min(limit, 100)):]:
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"path": str(_NETLOG_FILE), "count": len(lines), "items": items}


@router.delete("/netlog")
async def clear_flow_netlog():
    if _NETLOG_FILE.exists():
        _NETLOG_FILE.unlink()
    return {"ok": True, "path": str(_NETLOG_FILE)}
