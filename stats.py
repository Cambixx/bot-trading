import json
import datetime
from collections import Counter

def load_json(fp):
    try:
        with open(fp, 'r') as f:
            return json.load(f)
    except Exception:
        return []

history = load_json('history.json')
autopsies = load_json('autopsies.json')
shadow_archive = load_json('shadow_trades_archive.json')
logs = load_json('persistent_logs.json')

# Get time window from logs (assuming logs have timestamps)
if logs and isinstance(logs, list) and len(logs) > 0:
    timestamps = [log.get('timestamp') for log in logs if 'timestamp' in log]
    if timestamps:
        timestamps.sort()
        start = timestamps[0]
        end = timestamps[-1]
        print(f"Log span: {start} to {end}")
    
# Or from history / autopsies
if autopsies:
    mfe = [a.get('mfePct', 0) for a in autopsies if 'mfePct' in a]
    mae = [a.get('maePct', 0) for a in autopsies if 'maePct' in a]
    wins = len([a for a in autopsies if a.get('outcome') == 'WIN'])
    losses = len([a for a in autopsies if a.get('outcome') == 'LOSS'])
    total = len(autopsies)
    print(f"Autopsies ({total}): {wins} W / {losses} L")
    if len(mfe) > 0:
        print(f"Avg MFE: {sum(mfe) / len(mfe)}")
    if len(mae) > 0:
        print(f"Avg MAE: {sum(mae) / len(mae)}")

if shadow_archive:
    wins = len([s for s in shadow_archive if s.get('outcome') == 'WOULD_WIN'])
    losses = len([s for s in shadow_archive if s.get('outcome') == 'WOULD_LOSE'])
    total = len(shadow_archive)
    print(f"Shadows ({total}): {wins} WOULD_WIN / {losses} WOULD_LOSE")
    reasons = Counter([s.get('rejectReasonCode', 'UNKNOWN') for s in shadow_archive])
    print(f"Shadow Reject Reasons: {reasons.most_common(5)}")

# Throughput from logs
rejects = Counter()
runs = 0
for l in logs:
    if isinstance(l, dict):
        msg = l.get('message', '')
        if "THROUGHPUT" in msg and "Rejects" in msg:
            print("REJECT LOG:", msg)
        if "Execution started" in msg or "THROUGHPUT" in msg:
            if "Total runs" in msg or "Execution started" in msg:
                runs += 1

print(f"Approx Runs Observed: {runs}")

