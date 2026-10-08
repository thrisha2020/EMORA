"""EMORA AI — safe assistant actions.

Parses natural-language requests into small, whitelisted OS operations and
executes them. Deliberately no free-form shell execution: every action maps
to a fixed, validated handler so a chat message can never run arbitrary
commands.

Supported actions:
    create_folder / create_file  on Desktop or home
    open_folder                  Desktop / Home / Documents
    open_app                     launch a known application by name
    open_url                     open a validated http(s) link
    system_info                  time, date, battery, disk / memory
"""

import datetime
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Action:
    kind: str          # e.g. "create_folder", "open_url", "system_info"
    name: str          # validated target name
    location: str = ""  # "desktop" | "home" | "documents" | ""
    note: str = ""     # extra info (e.g. file content) — reserved


_VALID_NAME = re.compile(r"^[\w .\-()]{1,80}$")
_URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
IS_MAC = sys.platform == "darwin"


_QUOTES = "'\u201c\u201d\""


_MARKER_RE = re.compile(
    r"(?:with|as|name)\s+(?:it\s+)?(?:the\s+)?name\s+"
    r"|named\s+"
    r"|called\s+"
    r"|call\s+(?:it\s+|it\s+)?"
    r"|name\s+(?:it\s+)?",
    re.IGNORECASE,
)

_TRAILING_LOCATION = re.compile(
    r"\s+(?:on|in|to|at)\s+(?:(?:the\s+)?(?:desktop|folder|directory|home|documents|directory))\s*$",
    re.IGNORECASE,
)


def _extract_name(text: str) -> str | None:
    """Grab the target name after with/named/called/name markers.

    Validates strictly (no separators, no '..') and strips trailing location
    phrases so "named q3 reports on desktop" yields "q3 reports".
    """
    m = _MARKER_RE.search(text)
    if not m:
        return None
    rest = text[m.end():].strip().strip(_QUOTES).strip()
    rest = _TRAILING_LOCATION.sub("", rest).strip()
    rest = rest.rstrip(".,!?;").strip()
    if not rest:
        return None
    if not _VALID_NAME.match(rest):
        return None
    return rest


def _target_dir(location: str) -> Path:
    home = Path.home()
    if location == "desktop":
        return home / "Desktop"
    if location == "documents":
        return home / "Documents"
    return home


def _open_with_system(path: Path) -> bool:
    """Open a folder in the OS file manager. Returns success."""
    try:
        if IS_MAC:
            subprocess.Popen(["open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


def parse(message: str) -> Action | None:
    text = " ".join(str(message or "").lower().split())

    # ---- system info ----
    if any(w in text for w in ("system info", "battery", "disk space", "free space", "storage left", "how much ram", "how much storage", "what time", "current time", "today's date", "what date", "what day")):
        return Action(kind="system_info", name="system_info")

    # ---- open url ----
    if any(w in text for w in ("open", "go to", "visit", "launch site", "browse to")) and ("http" in text or "website" in text or ".com" in text or ".org" in text or ".io" in text or ".net" in text or "url" in text or "site" in text or "link" in text):
        m = _URL_RE.search(text)
        if m:
            return Action(kind="open_url", name=m.group(0), location="")
        # no explicit scheme but looks like a domain
        m = re.search(r"\b(?:[a-z0-9-]+\.)+(?:com|org|io|net|ai|edu|gov|me|co)\b(?:/[^\s]*)?", text)
        if m:
            return Action(kind="open_url", name="https://" + m.group(0), location="")
        return None

    # ---- create / open folder ----
    if "folder" in text or "directory" in text:
        if any(w in text for w in ("open", "open up", "show me", "go to")):
            kind = "open_folder"
        elif any(w in text for w in ("create", "make", "new", "put")):
            kind = "create_folder"
        else:
            return None
        location = "desktop" if "desktop" in text else ("documents" if "document" in text else "home")
        name = _extract_name(text.lower())
        if not name:
            if kind == "open_folder":
                return Action(kind="open_folder", name="", location=location)
            return None
        if not _VALID_NAME.match(name) or name in (".", "..", "desktop", "home", "documents"):
            return None
        return Action(kind=kind, name=name, location=location)

    # ---- create file ----
    if "file" in text:
        if not any(w in text for w in ("create", "make", "new", "put")):
            return None
        location = "desktop" if "desktop" in text else ("documents" if "document" in text else "home")
        name = _extract_name(text.lower())
        if not name:
            return None
        if not _VALID_NAME.match(name) or name in (".", "..", "desktop", "home", "documents"):
            return None
        return Action(kind="create_file", name=name, location=location)

    # ---- open app ----
    if any(w in text for w in ("open ", "launch ", "start ", "run ")):
        app = _extract_app(text)
        if app:
            return Action(kind="open_app", name=app, location="")

    return None


_APP_ALIASES = {
    "calculator": "Calculator",
    "safari": "Safari",
    "chrome": "Google Chrome",
    "browser": "Safari",
    "vs code": "Visual Studio Code",
    "vscode": "Visual Studio Code",
    "code editor": "Visual Studio Code",
    "terminal": "Terminal",
    "finder": "Finder",
    "files": "Finder",
    "file manager": "Finder",
    "notes": "Notes",
    "calendar": "Calendar",
    "mail": "Mail",
    "photos": "Photos",
    "music": "Music",
    "spotify": "Spotify",
    "settings": "System Settings",
    "system settings": "System Settings",
    "word": "Microsoft Word",
    "excel": "Microsoft Excel",
    "powerpoint": "Microsoft PowerPoint",
    "pycharm": "PyCharm",
    "pycharm": "PyCharm",
    "slack": "Slack",
    "notion": "Notion",
    "zoom": "zoom.us",
    "discord": "Discord",
    "whatsapp": "WhatsApp",
}


def _extract_app(text: str) -> str | None:
    """Resolve an app name from the message via aliases."""
    for alias, real in _APP_ALIASES.items():
        if alias in text:
            return real
    # unknown app — allow a simple trailing name, but never shell metachars
    m = re.search(r"(?:open|launch|start|run)\s+(?:the\s+)?([a-z][a-z0-9 .-]{1,40})$", text)
    if m and _VALID_NAME.match(m.group(1).strip()):
        return m.group(1).strip()
    return None


def execute(action: Action) -> str:
    """Run a parsed action, returning a human-readable confirmation."""
    if action.kind == "system_info":
        return _system_info()

    if action.kind == "open_url":
        # webbrowser, not _open_with_system: Path("https://x.com") collapses the
        # double slash to "https:/x.com", which the OS opener can't resolve.
        import webbrowser

        if webbrowser.open(action.name):
            return f"Opened {action.name} in your browser."
        return f"I couldn't open the link: {action.name}"

    if action.kind == "open_folder":
        if action.name:
            target = _target_dir(action.location) / action.name
        else:
            target = _target_dir(action.location)
        if not target.exists():
            return f"I couldn't find the folder {action.name or action.location}."
        if _open_with_system(target):
            return f"Opened folder {action.name or action.location} in your file manager."
        return f"I couldn't open {action.name or action.location}."

    if action.kind == "open_app":
        if not IS_MAC:
            return "App launching is only supported on macOS for now."
        try:
            subprocess.Popen(
                ["open", "-a", action.name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return f"Launching {action.name}."
        except OSError as e:
            return f"I couldn't launch {action.name}: {e}"

    target_dir = _target_dir(action.location)
    target = target_dir / action.name

    if action.kind == "create_folder":
        try:
            target.mkdir(parents=False, exist_ok=False)
        except FileExistsError:
            return f"The folder {action.name} already exists on the desktop."
        except OSError as e:
            return f"I couldn't create the folder: {e}"
        return f"Done. Created folder {action.name} at {target}"

    if action.kind == "create_file":
        try:
            # exist_ok=False: write_text() truncated an existing file, so
            # "create file named .zshrc" quietly emptied it.
            target.touch(exist_ok=False)
        except FileExistsError:
            return f"The file {action.name} already exists at {target} — I left it alone."
        except OSError as e:
            return f"I couldn't create the file: {e}"
        return f"Done. Created file {action.name} at {target}"

    return f"Action '{action.kind}' is not supported yet."


def _system_info() -> str:
    """Time, date, battery, disk — plain text summary."""
    now = datetime.datetime.now()
    parts = [f"It's {now.strftime('%I:%M %p')} on {now.strftime('%A, %B %d, %Y')}."]

    try:
        import psutil
        bat = psutil.sensors_battery()
        if bat is not None:
            pct = int(bat.percent)
            state = "charging" if bat.power_plugged else "on battery"
            parts.append(f"Battery is at {pct}% ({state}).")
    except Exception:
        pass

    try:
        usage = shutil.disk_usage(str(Path.home()))
        free_gb = usage.free / 1024**3
        parts.append(f"You have about {free_gb:.0f} GB of free disk space.")
    except OSError:
        pass

    try:
        import psutil
        vm = psutil.virtual_memory()
        parts.append(f"System memory: {int(vm.percent)}% in use.")
    except Exception:
        pass

    return " ".join(parts)


def handle(message: str) -> str | None:
    """Try to handle a chat message as an action.

    Returns a confirmation string if the message was an action (no LLM call
    needed), otherwise None so the normal chat flow takes over.
    """
    action = parse(message)
    if action is None:
        return None
    return execute(action)