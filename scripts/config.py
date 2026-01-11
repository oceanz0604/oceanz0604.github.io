"""
OceanZ Gaming Cafe - Shared Python Configuration

Central configuration for all upload scripts.
"""

import os

# ==================== PATHS ====================

# Firebird Database
SOURCE_FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB.dat"
WORKING_FDB_PATH = r"C:\Program Files (x86)\Pan Group\PanCafe Pro Server\Data\USDB_copy.FDB"

# Firebase Credentials
FIREBASE_CRED_PATH = r"C:\Firebase\fbcreds.json"

# IP Logs
IPLOG_BASE_PATH = r"C:\Users\decrypter\Downloads\iplogs\iplogs"

# ==================== FIREBASE ====================

FIREBASE_DB_URL = "https://fdb-dataset-default-rtdb.asia-southeast1.firebasedatabase.app"

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
    
    # Sync metadata
    SYNC_META = "sync-meta"                     # /sync-meta/{script_name}
    
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
    "PS", "XBOX ONE X"
]

# Terminal name mappings for normalization
TERMINAL_ALIASES = {
    "PLAYSTATION": "PS",
    "XBOX": "XBOX ONE X",
    "PS5": "PS",
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

# Fields to keep from MEMBERS
MEMBER_FIELDS = [
    "ID", "USERNAME", "PASSWORD", "BALANCE", "FIRSTNAME", "LASTNAME",
    "EMAIL", "PHONE", "GROUPID", "MEMBERSTATE", "JOININGDATE", 
    "LASTCONNECTION", "ISLOGIN", "TIMEMINS", "TOTALUSEDMIN", "TOTALPAID"
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
        "PLAYSTATION" -> "PS"
        "ct-room-1" -> "CT-ROOM-1"
    """
    if not name:
        return None
    
    name = str(name).upper().strip()
    
    # Check aliases
    if name in TERMINAL_ALIASES:
        return TERMINAL_ALIASES[name]
    
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
        "PS" -> "PS"
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

