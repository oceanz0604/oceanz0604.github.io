"""
OceanZ Gaming Cafe - Shared Python Configuration

Central configuration for all upload scripts.
"""

import os
import re

# ==================== PATHS ====================

# Firebird Database
SOURCE_FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB.dat"
WORKING_FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB_copy.FDB"

# Firebase Credentials
FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"

# IP Logs
IPLOG_BASE_PATH = r"C:\Users\decrypter\Downloads\iplogs\iplogs"

# PC activity scraper (WMI from counter → each seat)
# Credentials optional — leave blank to use the Windows account running sync_service.
# Or set env: OCEANZ_WMI_USER / OCEANZ_WMI_PASSWORD
ACTIVITY_ENABLED = True
ACTIVITY_INTERVAL_SECONDS = 45

# ==================== FIREBASE ====================

FIREBASE_DB_URL = "https://oceanz-fdb-4401f-default-rtdb.asia-southeast1.firebasedatabase.app"
FDB_FIREBASE_DB_URL = FIREBASE_DB_URL  # Alias for sync service

# Firebase Data Paths (must match JS config.js)
class FB_PATHS:
    """Firebase Realtime Database paths - keep in sync with shared/config.js"""
    
    # Core data
    MEMBERS = "members"                         # /members/{USERNAME}
    HISTORY = "history"                         # /history/{USERNAME}/{ID}
    SESSIONS = "sessions"                       # /sessions/{SESSION_ID}
    SESSIONS_BY_MEMBER = "sessions-by-member"   # /sessions-by-member/{MEMBER_ID}/{SESSION_ID}
    TERMINAL_STATUS = "terminal-status"         # /terminal-status/{TERMINAL_NAME}
    
    # Optimized query paths
    HISTORY_BY_DATE = "history-by-date"         # /history-by-date/{YYYY-MM-DD}/{ID}
    DAILY_SUMMARY = "daily-summary"             # /daily-summary/{YYYY-MM-DD}
    MONTHLY_SUMMARY = "monthly-summary"         # /monthly-summary/{YYYY-MM}
    
    # Leaderboards (pre-computed)
    LEADERBOARDS = "leaderboards"               # /leaderboards/all-time, /monthly/{YYYY-MM}
    
    # Guest sessions (from messages.msg)
    GUEST_SESSIONS = "guest-sessions"           # /guest-sessions/{YYYY-MM-DD}/{terminal_time}
    
    # Sync metadata
    SYNC_META = "sync-meta"                     # /sync-meta/{script_name}
    
    # Sync control (for Firebase-based sync triggering)
    SYNC_CONTROL = "sync-control"               # /sync-control/
    SYNC_REQUEST = "sync-control/request"       # Write timestamp to trigger sync
    SYNC_STATUS = "sync-control/status"         # idle, syncing, completed, error
    SYNC_PROGRESS = "sync-control/progress"     # Array of progress messages
    SYNC_LAST = "sync-control/last_sync"        # Last sync info
    SYNC_HEARTBEAT = "sync-control/service_heartbeat"  # Service health check
    
    # Cash Register (from KASAHAR table)
    CASH_REGISTER = "cash-register"             # /cash-register/{ID}
    DAILY_REVENUE = "daily-revenue"             # /daily-revenue/{YYYY-MM-DD}
    
    # Legacy paths (for backward compatibility)
    LEGACY_MEMBERS = "fdb/MEMBERS"              # Old: /fdb/MEMBERS (array)
    LEGACY_STATUS = "status"                    # Old: /status/{terminal}

# ==================== TERMINALS ====================

# All terminal names (must match JS config.js TIMETABLE_PCS)
ALL_TERMINALS = [
    "CT-ROOM-1", "CT-ROOM-2", "CT-ROOM-3", "CT-ROOM-4", 
    "CT-ROOM-5", "CT-ROOM-6", "CT-ROOM-7",
    "T-ROOM-1", "T-ROOM-2", "T-ROOM-3", "T-ROOM-4", 
    "T-ROOM-5", "T-ROOM-6", "T-ROOM-7",
    "PS-1", "PS-2", "XBOX ONE X"
]

# Terminal name mappings for normalization
# Legacy "PS" / PLAYSTATION / PS5 → PS-1 (renamed unit)
TERMINAL_ALIASES = {
    "PS": "PS-1",
    "PLAYSTATION": "PS-1",
    "PS5": "PS-1",
    "PS1": "PS-1",
    "PS2": "PS-2",
    "XBOX": "XBOX ONE X",
    "XBOX ONE": "XBOX ONE X"
}

# ==================== FIELD MAPPINGS ====================

# PanCafe Turkish field names -> English names
HISTORY_FIELD_MAP = {
    "SAAT": "TIME",           # Time
    "TARIH": "DATE",          # Date  
    "MIKTAR": "CHARGE",       # Amount/Charge
    "KALAN": "BALANCE",       # Remaining Balance
}

# Fields to keep from MEMBERSHISTORY
HISTORY_FIELDS = [
    "ID", "MEMBERS_USERNAME", "DATE", "TIME", "CHARGE", "BALANCE",
    "NOTE", "TERMINALNAME", "USINGMIN", "USINGSEC", "DISCOUNTNOTE"
]

# FDB MEMBERS table field mappings (Turkish -> Our Standard Names)
# FDB Field       -> Our Standard Name (used in Firebase/Frontend)
# NAME            -> FIRSTNAME (first name)
# LASTNAME        -> LASTNAME (last name)
# BAKIYE          -> BALANCE (current balance)
# TOTALBAKIYE     -> TOTALBAKIYE (total amount ever loaded)
# ACCSTATUS       -> MEMBERSTATE (account status: 0=active, 1=disabled)
# LOGIN           -> ISLOGIN (currently logged in: 0/1)
# RECDATE         -> RECDATE (registration date)
# LLOGDATE        -> LASTLOGIN (last login date)
# TOTALACTMINUTE  -> TOTALACTMINUTE (total active minutes)
# PRICETYPE       -> PRICETYPE (pricing group)
# ACCTYPE         -> ACCTYPE (account type)
MEMBER_FIELDS = [
    "ID", "USERNAME", "PASSWORD", "BAKIYE", "NAME", "LASTNAME",
    "EMAIL", "PHONE", "GSM", "ACCSTATUS", "ACCTYPE", "PRICETYPE",
    "RECDATE", "LLOGDATE", "LOGIN", "TOTALACTMINUTE", "TOTALBAKIYE",
    "AVAILBONUS", "USEDBONUS"
]

# ==================== SETTINGS ====================

SESSION_RETENTION_DAYS = 7      # Keep sessions for 7 days
FIREBIRD_USER = "SYSDBA"
FIREBIRD_PASSWORD = "masterkey"

# ==================== UTILITIES ====================

def normalize_terminal_name(name):
    """
    Normalize terminal name for consistent matching.
    
    Examples:
        "CT-ROOM-1" -> "CT-ROOM-1"
        "PLAYSTATION" -> "PS-1"
        "PS" -> "PS-1"
        "PS2" -> "PS-2"
        "ct-room-1" -> "CT-ROOM-1"
    """
    if not name:
        return None
    
    name = str(name).upper().strip()
    
    # Check aliases
    if name in TERMINAL_ALIASES:
        return TERMINAL_ALIASES[name]

    # PS-1 / PS-2 variants
    ps_match = re.match(r"^PS[-_]?(\d+)$", name)
    if ps_match:
        return f"PS-{ps_match.group(1)}"
    
    # Check if it's a known terminal
    for terminal in ALL_TERMINALS:
        if terminal.upper() == name:
            return terminal
    
    return name


def get_short_terminal_name(name):
    """
    Get shortened terminal name for display.
    
    Examples:
        "CT-ROOM-1" -> "CT1"
        "T-ROOM-5" -> "T5"
        "XBOX ONE X" -> "XBOX"
        "PS-1" -> "PS-1"
        "PS" -> "PS-1"
    """
    if not name:
        return ""
    
    name = str(name).upper().strip()
    
    if name.startswith("CT-ROOM-"):
        return f"CT{name.replace('CT-ROOM-', '')}"
    elif name.startswith("T-ROOM-"):
        return f"T{name.replace('T-ROOM-', '')}"
    elif name == "XBOX ONE X":
        return "XBOX"
    elif name == "PS":
        return "PS-1"
    else:
        ps_match = re.match(r"^PS[-_]?(\d+)$", name)
        if ps_match:
            return f"PS-{ps_match.group(1)}"
    
    return name


def is_guest_terminal(name):
    """
    Check if a terminal name represents a guest session.
    Guest sessions don't have member accounts.
    """
    if not name:
        return False
    
    short = get_short_terminal_name(name)
    guest_prefixes = ["CT", "T", "PS", "XBOX"]
    
    return any(short.startswith(p) or short == p for p in guest_prefixes)

