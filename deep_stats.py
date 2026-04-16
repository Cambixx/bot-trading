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

print("=== Logs Analysis ===")
if logs:
    times = []
    runs = 0
    modules = Counter()
    rejects = Counter()
    for l in logs:
        try:
            if 'timestamp' in l: times.append(l['timestamp'])
            msg = l.get('message', '')
            if 'THROUGHPUT' in msg:
                print("throughput log:", msg)
            if 'stages' in l:
                print("stages:", l['stages'])
        except Exception:
            pass
    if times:
        times.sort()
        print(f"Time Window: {times[0]} to {times[-1]}")

print("\n=== Autopsies Detailed ===")
for a in autopsies:
    outcome = a.get('outcome')
    mfe = a.get('mfePct', 0)
    mae = a.get('maePct', 0)
    sym = a.get('symbol', 'UNK')
    score = a.get('score', 0)
    print(f"{sym} | {outcome} | MFE: {mfe:.2f}% | MAE: {mae:.2f}% | Score: {score}")
    qb = a.get('qualityBreakdown', {})
    if qb:
        print("  Quality:", qb)
    else:
        # Check if entryMetrics exists
        em = a.get('entryMetrics', {})
        if em:
            print("  EntryMetrics:", em)

print("\n=== Shadow Archive Detailed ===")
for s in shadow_archive:
    outcome = s.get('outcome')
    sym = s.get('symbol', 'UNK')
    rej = s.get('rejectReasonCode', 'UNK')
    score = s.get('score', 0)
    print(f"{sym} | {outcome} | Reject: {rej} | Score: {score}")

