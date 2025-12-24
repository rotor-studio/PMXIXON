#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request

HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000

ASTURAIRE_BASE = "https://calidaddelairews.asturias.es/RestCecoma"
ASTURAIRE_USER = "manten"
ASTURAIRE_PASS = "MANTEN"


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT_DIR, "data")
OFFICIAL_FILE = os.path.join(DATA_DIR, "official_history.json")


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def astur_headers():
    timestamp = str(int(time.time() * 1000))
    first = sha256_hex(ASTURAIRE_USER + ASTURAIRE_PASS)
    signature = sha256_hex(first + timestamp)
    return {"signature": signature, "timestamp": timestamp}


def fetch_json(url: str, headers=None, timeout=12):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_timestamp(value: str):
    if not value:
        return None
    if "T" in value:
        iso = value
    else:
        iso = value.replace(" ", "T") + "Z"
    try:
        return int(time.mktime(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))) * 1000
    except Exception:
        return None


def parse_dms(value: str):
    if not value:
        return None
    parts = [p for p in value.strip().replace("\"", "").split() if p]
    tokens = []
    for part in parts:
        cleaned = "".join(ch for ch in part if ch.isalnum())
        if cleaned:
            tokens.append(cleaned)
    if len(tokens) < 4:
        return None
    try:
        degrees = float(tokens[0])
        minutes = float(tokens[1])
        seconds = float(tokens[2])
        direction = tokens[3].upper()
    except Exception:
        return None
    decimal = degrees + minutes / 60 + seconds / 3600
    if direction in ("S", "W"):
        decimal *= -1
    return decimal


def normalize_name(value: str) -> str:
    return (value or "").strip().lower().replace("ó", "o")


def format_date_ddmmyyyy(ts_ms: int) -> str:
    t = time.localtime(ts_ms / 1000)
    return f"{t.tm_mday:02d}-{t.tm_mon:02d}-{t.tm_year}"


def calc_target_period(ts_ms: int) -> int:
    if not ts_ms:
        return 0
    local = time.localtime(ts_ms / 1000)
    offset_hours = -time.timezone // 3600
    raw = local.tm_hour + offset_hours
    if raw < 1:
        return 1
    if raw > 24:
        return 24
    return int(round(raw))


def parse_official_pollutants(items, display_ts_ms):
    if not isinstance(items, list):
        return {}
    target_period = calc_target_period(display_ts_ms)
    target_date = time.strftime("%Y-%m-%d", time.localtime(display_ts_ms / 1000))
    latest = {}
    for item in items:
        key = item.get("cana")
        if key is None:
            continue
        date_key = (item.get("fechaF") or "").split(" ")[0]
        period = item.get("periodo")
        use_target = date_key == target_date and period == target_period
        record = latest.get(key)
        if use_target or record is None:
            latest[key] = item
    def get_val(cana):
        item = latest.get(cana)
        if not item:
            return None
        try:
            return float(item.get("val"))
        except Exception:
            return None
    def get_name(name):
        for item in latest.values():
            if str(item.get("nombre", "")).strip().upper() == name:
                try:
                    return float(item.get("val"))
                except Exception:
                    return None
        return None
    return {
        "pm10": get_val(10),
        "pm25": get_val(9),
        "no2": get_val(8) or get_name("NO2"),
        "no": get_name("NO"),
        "temperature": get_val(83),
        "humidity": get_val(86),
        "pressure": get_val(87),
    }


def fetch_official():
    headers = astur_headers()
    stations = fetch_json(f"{ASTURAIRE_BASE}/getEstacion", headers=headers)
    gijon = [s for s in stations if "gijon" in normalize_name(s.get("poblacEs"))]
    results = []
    for station in gijon:
        uuid = station.get("uuid") or station.get("ides")
        if not uuid:
            continue
        display_ts = parse_timestamp(station.get("tmpFEs")) or int(time.time() * 1000)
        to_date = format_date_ddmmyyyy(display_ts)
        from_date = format_date_ddmmyyyy(display_ts - 24 * 60 * 60 * 1000)
        params = {
            "uuidEs": uuid,
            "histo": "60m",
            "validado": "T",
            "fechaiF": from_date,
            "fechafF": to_date,
        }
        qs = urllib.parse.urlencode(params)
        data = fetch_json(f"{ASTURAIRE_BASE}/getDato?{qs}", headers=headers)
        pollutants = parse_official_pollutants(data, display_ts)
        results.append({
            "id": f"official-{station.get('ides')}",
            "name": (station.get("nombreEs") or "").strip(),
            "lat": parse_dms(station.get("latEs")),
            "lon": parse_dms(station.get("lonEs")),
            "timestamp": display_ts,
            "pollutants": pollutants,
        })
    return results



def load_history(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_history(path, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=True, indent=2)


def update_history(history, sensors, key_prefix=""):
    now = int(time.time() * 1000)
    for sensor in sensors:
        sensor_id = f"{key_prefix}{sensor['id']}"
        sample = {
            "t": sensor.get("timestamp") or now,
            "pm10": sensor.get("pm10"),
            "pm25": sensor.get("pm25"),
            "no2": sensor.get("pollutants", {}).get("no2") if sensor.get("pollutants") else None,
            "no": sensor.get("pollutants", {}).get("no") if sensor.get("pollutants") else None,
            "humidity": sensor.get("pollutants", {}).get("humidity") if sensor.get("pollutants") else sensor.get("humidity"),
            "temperature": sensor.get("pollutants", {}).get("temperature") if sensor.get("pollutants") else sensor.get("temperature"),
            "pressure": sensor.get("pollutants", {}).get("pressure") if sensor.get("pollutants") else sensor.get("pressure"),
        }
        if sensor_id not in history:
            history[sensor_id] = {"data": []}
        entries = history[sensor_id]["data"]
        if entries:
            last = entries[-1]
            if abs(sample["t"] - last.get("t", 0)) <= 2 * 60 * 1000:
                entries[-1] = sample
            else:
                entries.append(sample)
        else:
            entries.append(sample)
        history[sensor_id]["data"] = [
            entry for entry in entries if now - entry.get("t", now) <= HISTORY_WINDOW_MS
        ]
    return history


def run_once():
    official = fetch_official()

    official_history = load_history(OFFICIAL_FILE)

    official_history = update_history(official_history, official)

    save_history(OFFICIAL_FILE, official_history)

    print(f"Official stations: {len(official)}")


def main():
    parser = argparse.ArgumentParser(description="PMXIXON local collector")
    parser.add_argument("--loop", type=int, default=0, help="Run every N seconds")
    args = parser.parse_args()

    if args.loop and args.loop > 0:
        while True:
            try:
                run_once()
            except Exception as exc:
                print("Collector error:", exc)
            time.sleep(args.loop)
    else:
        run_once()


if __name__ == "__main__":
    main()
