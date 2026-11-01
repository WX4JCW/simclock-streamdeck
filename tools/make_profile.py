# Builds the ready-made "MSFS SimClock" profile for the Stream Deck + XL, packed into the plugin:
#   com.acms.simclock.sdPlugin/profiles/SimClock-PlusXL.streamDeckProfile
# Only this plugin's own actions: the six dials hold LOCAL, ZULU, SIM, STD, TO STD and the Departure
# Timeline, and the keys are left blank (owner, 2026-10-31: "No other buttons or stuff just whats
# relevant so we can package those profiles").
#
# Format, copied from the ChasePlane plugin's profile, which imported cleanly: a zip holding
# <PROFILE>.sdProfile/manifest.json (Device model with an empty UUID = any device of that model, Name,
# Pages, Version "3.0") and <PROFILE>.sdProfile/Profiles/<PAGE>/manifest.json (Controllers: Keypad and
# Encoder, actions keyed "column,row"). Fixed IDs, so a newer file replaces the profile instead of adding
# a copy. Usage: python tools/make_profile.py   (from the repository root)
import json
import os
import zipfile

MANIFEST = "com.acms.simclock.sdPlugin/manifest.json"
OUT = "com.acms.simclock.sdPlugin/profiles/SimClock-PlusXL.streamDeckProfile"
PROFILE_ID = "4D1C8E20-7A3B-4F6D-9C21-5B0E8A3D1F02"
PAGE_ID = "8B3F2A41-1C5D-4E7A-A9F0-6D2C4B8E1A02"
PLUS_XL_MODEL = "20GBX9901"  # the owner's + XL reports this model

plugin = json.load(open(MANIFEST, encoding="utf-8"))
PLUGIN = {"Name": plugin["Name"], "UUID": plugin["UUID"], "Version": plugin["Version"]}


def action(n, name, kind, settings):
    # ActionIDs are fixed per position, like the IDs above.
    return {
        "ActionID": f"8B3F2A41-0000-4000-8000-{n:012d}",
        "LinkedTitle": True,
        "Name": name,
        "Plugin": PLUGIN,
        "Resources": None,
        "Settings": settings,
        "State": 0,
        "States": [{}],
        "UUID": f"{PLUGIN['UUID']}.{kind}",
    }


# Countdown alerts at 10, 5 and 0 minutes; the panel shows these as defaults but only saves them when
# touched, so they are written here for the alerts to work out of the box.
ALERTS = {"warn1Min": "10", "warn2Min": "5", "warn3Min": "0"}
DIALS = [
    ("SimClock", "clock", {"source": "pc"}),
    ("SimClock", "clock", {"source": "zulu"}),
    ("SimClock", "clock", {"source": "sim"}),
    ("SimClock", "clock", {"source": "std"}),
    ("SimClock", "clock", {"source": "tostd", **ALERTS}),
    ("Departure Timeline", "timeline", {}),
]
dials = {f"{col},0": action(100 + col, name, kind, s) for col, (name, kind, s) in enumerate(DIALS)}

root = {
    "Device": {"Model": PLUS_XL_MODEL, "UUID": ""},
    "Name": "MSFS SimClock",
    "Pages": {"Current": PAGE_ID.lower(), "Default": PAGE_ID.lower(), "Pages": [PAGE_ID.lower()]},
    "Version": "3.0",
}
page = {"Controllers": [{"Actions": {}, "Type": "Keypad"}, {"Actions": dials, "Type": "Encoder"}], "Icon": "", "Name": ""}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
base = f"{PROFILE_ID}.sdProfile/"
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(base, "")
    z.writestr(base + "manifest.json", json.dumps(root))
    z.writestr(base + "Profiles/", "")
    z.writestr(f"{base}Profiles/{PAGE_ID}/", "")
    z.writestr(f"{base}Profiles/{PAGE_ID}/manifest.json", json.dumps(page))
print(f"written {OUT}: {len(dials)} dials, plugin {PLUGIN['Version']}")
