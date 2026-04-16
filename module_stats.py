import json

autopsies = json.load(open('autopsies.json'))
for a in autopsies:
    outcome = a.get('outcome')
    mod = a.get('module', 'UNKNOWN_MOD')
    mfe = a.get('mfePct', 0)
    mae = a.get('maePct', 0)
    print(f"{a['symbol']} | {mod} | {outcome} | MFE: {mfe:.2f}% | MAE: {mae:.2f}%")
