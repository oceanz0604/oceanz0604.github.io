#!/usr/bin/env python3
"""
OceanZ PC Activity Scraper

Runs on the counter / PanCafe server. For each occupied Windows PC it:
1. Resolves IP from MAC (ARP) and/or hostname variants
2. Remotely lists processes via classic DCOM WMI (NOT WinRM/CIM)
3. Maps known game/app executables → label + icon key
4. Writes result to Firebase: terminal-status/{PC}/activity

Seats need WMI/DCOM reachable on the LAN (Remote Administration firewall
group). WinRM is NOT required. Failures are soft — they never fail FDB sync
or flip sync-control status.

Usage:
    python pc_activity.py              # one-shot scrape
    python pc_activity.py --dry-run    # resolve + probe, no Firebase write
    python pc_activity.py --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import firebase_admin
from firebase_admin import credentials, db

from config import (
    ALL_TERMINALS,
    FB_PATHS,
    FIREBASE_CRED_PATH,
    FDB_FIREBASE_DB_URL,
    normalize_terminal_name,
)

# ==================== CONFIG ====================

# Seconds between polls when driven by sync_service
ACTIVITY_INTERVAL_SECONDS = int(os.environ.get("OCEANZ_ACTIVITY_INTERVAL", "45"))

# Optional explicit credentials for remote WMI (blank = current Windows user)
# Prefer env vars on the counter machine:
#   set OCEANZ_WMI_USER=.\Administrator
#   set OCEANZ_WMI_PASSWORD=secret
WMI_USER = os.environ.get("OCEANZ_WMI_USER", "").strip()
WMI_PASSWORD = os.environ.get("OCEANZ_WMI_PASSWORD", "").strip()

# Manual IP overrides: { "CT-ROOM-1": "192.168.1.21", ... }
# Loaded from scripts/pc_activity_hosts.json if present
HOSTS_FILE = Path(__file__).parent / "pc_activity_hosts.json"

# Per-PC probe timeout (seconds). Keep low so a dead WMI path cannot stall heartbeat.
PROBE_TIMEOUT_SECONDS = int(os.environ.get("OCEANZ_ACTIVITY_PROBE_TIMEOUT", "6"))
# Parallel probes — cafe LAN can handle a few concurrent WMI calls
PROBE_WORKERS = int(os.environ.get("OCEANZ_ACTIVITY_WORKERS", "4"))

# Consoles / non-Windows — skip remote probe
SKIP_TERMINALS = {"PS-1", "PS-2", "PS", "XBOX ONE X", "XBOX", "PLAYSTATION"}

# Priority: higher wins when multiple known apps are running
CATEGORY_PRIORITY = {
    "game": 100,
    "launcher": 40,
    "browser": 30,
    "social": 25,
    "media": 20,
    "work": 15,
    "other": 5,
}

# exe (lowercase, no path) → activity metadata
# icon: emoji fallback shown on Floor; iconKey optional for assets/activity/{key}.svg
PROCESS_MAP = {
    # Games
    "valorant-win64-shipping.exe": {"label": "Valorant", "category": "game", "icon": "🎯", "iconKey": "valorant"},
    "valorant.exe": {"label": "Valorant", "category": "game", "icon": "🎯", "iconKey": "valorant"},
    "cs2.exe": {"label": "CS2", "category": "game", "icon": "🔫", "iconKey": "cs2"},
    "csgo.exe": {"label": "CS:GO", "category": "game", "icon": "🔫", "iconKey": "cs2"},
    "dota2.exe": {"label": "Dota 2", "category": "game", "icon": "🛡️", "iconKey": "dota2"},
    "league of legends.exe": {"label": "LoL", "category": "game", "icon": "⚔️", "iconKey": "lol"},
    "leagueclient.exe": {"label": "LoL", "category": "launcher", "icon": "⚔️", "iconKey": "lol"},
    "leagueclientux.exe": {"label": "LoL", "category": "launcher", "icon": "⚔️", "iconKey": "lol"},
    "fortniteclient-win64-shipping.exe": {"label": "Fortnite", "category": "game", "icon": "🪂", "iconKey": "fortnite"},
    "r5apex.exe": {"label": "Apex", "category": "game", "icon": "🎖️", "iconKey": "apex"},
    "gta5.exe": {"label": "GTA V", "category": "game", "icon": "🚗", "iconKey": "gtav"},
    "gtav.exe": {"label": "GTA V", "category": "game", "icon": "🚗", "iconKey": "gtav"},
    "playgtav.exe": {"label": "GTA V", "category": "game", "icon": "🚗", "iconKey": "gtav"},
    "minecraft.exe": {"label": "Minecraft", "category": "game", "icon": "🧱", "iconKey": "minecraft"},
    "javaw.exe": {"label": "Java App", "category": "other", "icon": "☕", "iconKey": "java"},  # often Minecraft
    "rocketleague.exe": {"label": "Rocket League", "category": "game", "icon": "⚽", "iconKey": "rocketleague"},
    "overwatch.exe": {"label": "Overwatch", "category": "game", "icon": "🦸", "iconKey": "overwatch"},
    "overwatch2.exe": {"label": "Overwatch 2", "category": "game", "icon": "🦸", "iconKey": "overwatch"},
    "rainbowsix.exe": {"label": "R6 Siege", "category": "game", "icon": "🧨", "iconKey": "r6"},
    "pubg.exe": {"label": "PUBG", "category": "game", "icon": "🪖", "iconKey": "pubg"},
    "tslgame.exe": {"label": "PUBG", "category": "game", "icon": "🪖", "iconKey": "pubg"},
    "fifa.exe": {"label": "EA FC", "category": "game", "icon": "⚽", "iconKey": "eafc"},
    "fc25.exe": {"label": "EA FC 25", "category": "game", "icon": "⚽", "iconKey": "eafc"},
    "fc24.exe": {"label": "EA FC 24", "category": "game", "icon": "⚽", "iconKey": "eafc"},
    "warzone.exe": {"label": "Warzone", "category": "game", "icon": "💥", "iconKey": "warzone"},
    "cod.exe": {"label": "Call of Duty", "category": "game", "icon": "💥", "iconKey": "cod"},
    "modernwarfare.exe": {"label": "Modern Warfare", "category": "game", "icon": "💥", "iconKey": "cod"},
    "eldenring.exe": {"label": "Elden Ring", "category": "game", "icon": "🗡️", "iconKey": "eldenring"},
    "cyberpunk2077.exe": {"label": "Cyberpunk", "category": "game", "icon": "🤖", "iconKey": "cyberpunk"},
    "bg3.exe": {"label": "Baldur's Gate 3", "category": "game", "icon": "🐉", "iconKey": "bg3"},
    "bg3_dx11.exe": {"label": "Baldur's Gate 3", "category": "game", "icon": "🐉", "iconKey": "bg3"},
    "hl2.exe": {"label": "Source Game", "category": "game", "icon": "🎮", "iconKey": "source"},
    "left4dead2.exe": {"label": "L4D2", "category": "game", "icon": "🧟", "iconKey": "l4d2"},
    "terraria.exe": {"label": "Terraria", "category": "game", "icon": "⛏️", "iconKey": "terraria"},
    "rustclient.exe": {"label": "Rust", "category": "game", "icon": "🧰", "iconKey": "rust"},
    "escapefromtarkov.exe": {"label": "Tarkov", "category": "game", "icon": "🎒", "iconKey": "tarkov"},
    "destiny2.exe": {"label": "Destiny 2", "category": "game", "icon": "🌌", "iconKey": "destiny2"},
    "robloxplayerbeta.exe": {"label": "Roblox", "category": "game", "icon": "🧩", "iconKey": "roblox"},
    "osu!.exe": {"label": "osu!", "category": "game", "icon": "🎵", "iconKey": "osu"},
    "osu.exe": {"label": "osu!", "category": "game", "icon": "🎵", "iconKey": "osu"},

    # Launchers
    "steam.exe": {"label": "Steam", "category": "launcher", "icon": "🎮", "iconKey": "steam"},
    "epicgameslauncher.exe": {"label": "Epic", "category": "launcher", "icon": "🎮", "iconKey": "epic"},
    "riotclientservices.exe": {"label": "Riot Client", "category": "launcher", "icon": "🎮", "iconKey": "riot"},
    "battle.net.exe": {"label": "Battle.net", "category": "launcher", "icon": "🎮", "iconKey": "battlenet"},
    "origin.exe": {"label": "EA App", "category": "launcher", "icon": "🎮", "iconKey": "ea"},
    "eadesktop.exe": {"label": "EA App", "category": "launcher", "icon": "🎮", "iconKey": "ea"},
    "galaxyclient.exe": {"label": "GOG", "category": "launcher", "icon": "🎮", "iconKey": "gog"},
    "upc.exe": {"label": "Ubisoft", "category": "launcher", "icon": "🎮", "iconKey": "ubisoft"},

    # Browsers / media / social (window title often unknown remotely)
    "chrome.exe": {"label": "Chrome", "category": "browser", "icon": "🌐", "iconKey": "chrome"},
    "msedge.exe": {"label": "Edge", "category": "browser", "icon": "🌐", "iconKey": "edge"},
    "firefox.exe": {"label": "Firefox", "category": "browser", "icon": "🌐", "iconKey": "firefox"},
    "brave.exe": {"label": "Brave", "category": "browser", "icon": "🌐", "iconKey": "brave"},
    "discord.exe": {"label": "Discord", "category": "social", "icon": "💬", "iconKey": "discord"},
    "spotify.exe": {"label": "Spotify", "category": "media", "icon": "🎧", "iconKey": "spotify"},
    "vlc.exe": {"label": "VLC", "category": "media", "icon": "🎬", "iconKey": "vlc"},
    "obs64.exe": {"label": "OBS", "category": "media", "icon": "📹", "iconKey": "obs"},
    "obs32.exe": {"label": "OBS", "category": "media", "icon": "📹", "iconKey": "obs"},

    # Work / misc
    "code.exe": {"label": "VS Code", "category": "work", "icon": "💻", "iconKey": "vscode"},
    "notepad.exe": {"label": "Notepad", "category": "work", "icon": "📝", "iconKey": "notepad"},
    "winword.exe": {"label": "Word", "category": "work", "icon": "📄", "iconKey": "word"},
    "excel.exe": {"label": "Excel", "category": "work", "icon": "📊", "iconKey": "excel"},
}

# Noise processes we never report as “activity”
IGNORE_EXES = {
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe",
    "lsass.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe", "explorer.exe",
    "runtimebroker.exe", "searchhost.exe", "startmenuexperiencehost.exe",
    "shellexperiencehost.exe", "applicationframehost.exe", "conhost.exe",
    "taskhostw.exe", "sihost.exe", "ctfmon.exe", "securityhealthservice.exe",
    "msmpeng.exe", "nissrv.exe", "audiodg.exe", "smartscreen.exe",
    "textinputhost.exe", "lockapp.exe", "searchapp.exe", "phoneexperiencehost.exe",
    "widgetservice.exe", "widgets.exe", "crossdeviceresume.exe",
    "pancafe", "pcclient.exe", "pcservice.exe", "panclient.exe",
}


def init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CRED_PATH)
        firebase_admin.initialize_app(cred, {"databaseURL": FDB_FIREBASE_DB_URL})
    return db


def load_host_overrides():
    if not HOSTS_FILE.exists():
        return {}
    try:
        data = json.loads(HOSTS_FILE.read_text(encoding="utf-8"))
        return {str(k).upper(): str(v).strip() for k, v in (data or {}).items() if v}
    except Exception as e:
        print(f"[WARN] Could not read {HOSTS_FILE}: {e}")
        return {}


def normalize_mac(mac: str) -> str:
    if not mac:
        return ""
    hexes = re.findall(r"[0-9A-Fa-f]{2}", mac)
    return ":".join(h.upper() for h in hexes) if len(hexes) >= 6 else ""


def build_arp_table() -> dict:
    """Return { 'AA:BB:..': '192.168.x.x' } from `arp -a`."""
    table = {}
    try:
        out = subprocess.check_output(["arp", "-a"], text=True, errors="ignore", timeout=10)
    except Exception:
        return table

    for line in out.splitlines():
        #  192.168.1.10          aa-bb-cc-dd-ee-ff     dynamic
        m = re.search(
            r"(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F\-:.]{11,})\s+",
            line,
        )
        if not m:
            continue
        ip, mac = m.group(1), normalize_mac(m.group(2))
        if mac and not ip.startswith("224.") and not ip.endswith(".255"):
            table[mac] = ip
    return table


def hostname_candidates(terminal_name: str) -> list:
    n = (normalize_terminal_name(terminal_name) or terminal_name or "").upper().strip()
    cands = []
    if not n:
        return cands
    cands.append(n)
    cands.append(n.replace(" ", "-"))
    cands.append(n.replace("-", ""))
    # CT-ROOM-1 → CT1, CT-ROOM1, CTROOM1
    m = re.match(r"^(CT|T)-ROOM-(\d+)$", n)
    if m:
        cands.extend([
            f"{m.group(1)}{m.group(2)}",
            f"{m.group(1)}-ROOM{m.group(2)}",
            f"{m.group(1)}ROOM{m.group(2)}",
            f"{m.group(1)}-{m.group(2)}",
        ])
    # PS-1 → PS1
    m = re.match(r"^PS-(\d+)$", n)
    if m:
        cands.append(f"PS{m.group(1)}")
    # unique preserve order
    seen = set()
    out = []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def resolve_ip(terminal_name: str, mac: str, overrides: dict, arp: dict) -> str | None:
    key = (normalize_terminal_name(terminal_name) or terminal_name or "").upper()
    if key in overrides:
        return overrides[key]
    # short keys in overrides
    for cand in hostname_candidates(terminal_name):
        if cand in overrides:
            return overrides[cand]

    mac_n = normalize_mac(mac)
    if mac_n and mac_n in arp:
        return arp[mac_n]
    # ARP sometimes stores without leading zeros differences — already normalized

    for host in hostname_candidates(terminal_name):
        try:
            return socket.gethostbyname(host)
        except OSError:
            continue
    return None


def _ps_literal(value: str) -> str:
    """Single-quoted PowerShell string literal."""
    return "'" + str(value).replace("'", "''") + "'"


def _parse_process_names(raw: str) -> list[str]:
    names = []
    for line in (raw or "").splitlines():
        name = line.strip()
        if not name or name.startswith("__ERR__"):
            continue
        # tasklist lines: "chrome.exe                   1234 Console ..."
        if " " in name and name.lower().endswith(".exe"):
            name = name.split()[0]
        if not name.lower().endswith(".exe"):
            name = f"{name}.exe"
        names.append(name)
    return names


def fetch_remote_processes(ip: str, timeout: int | None = None) -> list[str]:
    """
    Return process exe names on a remote Windows PC.

    Uses classic DCOM WMI (Get-WmiObject) — works on typical cafe LANs
    without WinRM. Falls back to `tasklist /S`. Never uses CIM/WinRM.
    """
    if not ip:
        return []
    timeout = timeout if timeout is not None else PROBE_TIMEOUT_SECONDS

    cred_block = ""
    wmi_cred = ""
    if WMI_USER and WMI_PASSWORD:
        cred_block = (
            f"$u = {_ps_literal(WMI_USER)}; "
            f"$p = ConvertTo-SecureString {_ps_literal(WMI_PASSWORD)} -AsPlainText -Force; "
            f"$cred = New-Object System.Management.Automation.PSCredential($u, $p); "
        )
        wmi_cred = " -Credential $cred"

    # Get-WmiObject = DCOM/RPC (port 135). Get-CimInstance would use WinRM and fail.
    script = (
        cred_block
        + f"$ErrorActionPreference = 'Stop'; "
        f"try {{ "
        f"(Get-WmiObject -Class Win32_Process -ComputerName {_ps_literal(ip)}{wmi_cred} "
        f"| Select-Object -ExpandProperty Name) -join \"`n\" "
        f"}} catch {{ Write-Output ('__ERR__' + $_.Exception.Message) }}"
    )

    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-Command", script,
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return []
    except subprocess.TimeoutExpired:
        return []

    out = (completed.stdout or "").strip()
    if out and not out.startswith("__ERR__"):
        names = _parse_process_names(out)
        if names:
            return names

    # Fallback: tasklist over RPC (also no WinRM)
    tasklist_cmd = ["tasklist", "/S", ip, "/FO", "CSV", "/NH"]
    if WMI_USER and WMI_PASSWORD:
        tasklist_cmd.extend(["/U", WMI_USER, "/P", WMI_PASSWORD])
    try:
        tl = subprocess.run(
            tasklist_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if tl.returncode == 0 and tl.stdout:
            names = []
            for line in tl.stdout.splitlines():
                # CSV: "chrome.exe","1234",...
                m = re.match(r'"([^"]+\.exe)"', line.strip(), re.I)
                if m:
                    names.append(m.group(1))
            if names:
                return names
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    return []


def pick_activity(process_names: list[str]) -> dict | None:
    best = None
    best_score = -1
    seen = set()

    for raw in process_names:
        exe = raw.split("\\")[-1].strip().lower()
        if not exe or exe in seen:
            continue
        seen.add(exe)
        if exe in IGNORE_EXES or exe.startswith("pan"):
            continue

        meta = PROCESS_MAP.get(exe)
        if not meta:
            continue

        score = CATEGORY_PRIORITY.get(meta.get("category", "other"), 5)
        # Prefer real game processes over launchers/browsers
        if score > best_score:
            best_score = score
            best = {
                "exe": exe,
                "label": meta["label"],
                "category": meta.get("category", "other"),
                "icon": meta.get("icon", "💻"),
                "iconKey": meta.get("iconKey", "unknown"),
            }

    return best


def clear_activity(terminal_name: str):
    try:
        db.reference(f"{FB_PATHS.TERMINAL_STATUS}/{terminal_name}/activity").delete()
    except Exception:
        pass


def write_activity(terminal_name: str, activity: dict | None, dry_run: bool = False):
    path = f"{FB_PATHS.TERMINAL_STATUS}/{terminal_name}/activity"
    if dry_run:
        print(f"   [dry-run] {terminal_name} → {activity}")
        return
    try:
        if activity is None:
            clear_activity(terminal_name)
            return
        payload = {
            **activity,
            "updatedAt": datetime.now().isoformat(),
            "source": "wmi",
        }
        db.reference(path).set(payload)
    except Exception as e:
        print(f"   [ERROR] Firebase write {terminal_name}: {e}")


def scrape_once(verbose: bool = False, dry_run: bool = False) -> dict:
    """
    Read occupied terminals from Firebase, probe each, write activity.
    Soft-fail: unreachable PCs are skipped (no Firebase error payload).
    Returns summary stats.
    """
    init_firebase()
    overrides = load_host_overrides()
    arp = build_arp_table()
    if verbose:
        print(f"[ARP] {len(arp)} entries, {len(overrides)} host overrides")

    terminals = db.reference(FB_PATHS.TERMINAL_STATUS).get() or {}
    stats = {"probed": 0, "matched": 0, "skipped": 0, "failed": 0, "cleared": 0}

    # Clear free seats first (fast Firebase ops)
    targets = []  # (norm, ip)
    for name, info in terminals.items():
        if not isinstance(info, dict):
            continue
        norm = normalize_terminal_name(name) or name
        status = str(info.get("status") or "").lower()

        if status != "occupied":
            if info.get("activity"):
                write_activity(norm, None, dry_run=dry_run)
                stats["cleared"] += 1
            continue

        if norm in SKIP_TERMINALS or any(x in norm.upper() for x in ("PS-", "XBOX", "PLAYSTATION")):
            stats["skipped"] += 1
            continue

        mac = info.get("mac") or ""
        ip = resolve_ip(norm, mac, overrides, arp)
        if not ip:
            stats["failed"] += 1
            if verbose:
                print(f"   [skip] {norm}: no IP (mac={mac or '—'})")
            # Do NOT write error activity — keeps Floor / sync UI clean
            continue

        targets.append((norm, ip))

    def _probe_one(item):
        norm, ip = item
        procs = fetch_remote_processes(ip)
        return norm, ip, procs

    results = []
    if targets:
        workers = max(1, min(PROBE_WORKERS, len(targets)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_probe_one, t) for t in targets]
            for fut in as_completed(futures):
                try:
                    results.append(fut.result())
                except Exception as e:
                    stats["failed"] += 1
                    if verbose:
                        print(f"   [fail] probe worker: {e}")

    for norm, ip, procs in results:
        stats["probed"] += 1
        if not procs:
            stats["failed"] += 1
            if verbose:
                print(f"   [fail] {norm} @ {ip}: no processes (WMI/DCOM blocked?)")
            # Soft-fail: leave previous activity or show nothing — never write "No signal"
            continue

        activity = pick_activity(procs)
        if activity:
            activity["ip"] = ip
            write_activity(norm, activity, dry_run=dry_run)
            stats["matched"] += 1
            if verbose:
                print(f"   [ok] {norm} @ {ip}: {activity['label']} ({activity['exe']})")
        else:
            write_activity(norm, {
                "exe": "",
                "label": "In use",
                "category": "other",
                "icon": "💻",
                "iconKey": "",
                "ip": ip,
            }, dry_run=dry_run)
            if verbose:
                print(f"   [ok] {norm} @ {ip}: no known game/app ({len(procs)} procs)")

    return stats


def run_activity_sync(verbose: bool = False) -> bool:
    """
    Entry point for sync_service.
    Always returns True so activity never fails the overall sync service / UI.
    """
    try:
        print("\n[ACTIVITY] Scanning occupied PCs (DCOM WMI)…")
        stats = scrape_once(verbose=verbose, dry_run=False)
        print(
            f"[ACTIVITY] probed={stats['probed']} matched={stats['matched']} "
            f"failed={stats['failed']} cleared={stats['cleared']} skipped={stats['skipped']}"
        )
        if stats["failed"] and stats["matched"] == 0 and stats["probed"] > 0:
            print(
                "[ACTIVITY] HINT: Enable 'Windows Management Instrumentation (WMI-In)' "
                "and 'Remote Administration' firewall rules on seat PCs. "
                "WinRM is NOT required. Optional: set OCEANZ_WMI_USER / OCEANZ_WMI_PASSWORD."
            )
        try:
            status = "ok" if stats["failed"] == 0 else ("partial" if stats["matched"] else "unreachable")
            db.reference(f"{FB_PATHS.SYNC_META}/activity").update({
                "last_sync": datetime.now().isoformat(),
                "status": status,
                **{f"stats_{k}": v for k, v in stats.items()},
            })
        except Exception:
            pass
        return True  # never fail the service loop / UI
    except Exception as e:
        print(f"[ACTIVITY] ERROR (ignored for sync status): {e}")
        try:
            db.reference(f"{FB_PATHS.SYNC_META}/activity").update({
                "last_sync": datetime.now().isoformat(),
                "status": "error",
                "error": str(e)[:200],
            })
        except Exception:
            pass
        return True


def main():
    parser = argparse.ArgumentParser(description="OceanZ PC activity scraper")
    parser.add_argument("--dry-run", action="store_true", help="Probe only, do not write Firebase")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    print("=" * 56)
    print("OceanZ PC Activity Scraper")
    print("=" * 56)
    if WMI_USER:
        print(f"WMI user: {WMI_USER}")
    else:
        print("WMI user: (current Windows session)")
    if HOSTS_FILE.exists():
        print(f"Host overrides: {HOSTS_FILE}")

    stats = scrape_once(verbose=True if args.verbose or args.dry_run else True, dry_run=args.dry_run)
    print("Done:", stats)


if __name__ == "__main__":
    main()
