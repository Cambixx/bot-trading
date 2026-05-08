import json
import os
from datetime import datetime
from collections import Counter

def load_json(filepath):
    if not os.path.exists(filepath): return None
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return None

def analyze_bot(bot_name, history_file, autopsies_file, shadow_archive_file, logs_file):
    print(f"\\n--- Analysis for {bot_name} ---")
    
    # Check what files are missing
    files = {
        'history.json': load_json(history_file),
        'autopsies.json': load_json(autopsies_file),
        'shadow_archive.json': load_json(shadow_archive_file),
        'logs.json': load_json(logs_file)
    }
    
    missing = [k for k, v in files.items() if v is None]
    if missing:
        print(f"Missing files: {missing}")
    
    # Analyzing Autopsies
    autopsies = files['autopsies.json']
    if autopsies:
        print(f"\\n# Live Trade Performance ({bot_name})")
        # Dates
        if len(autopsies) > 0:
            timestamps = [t.get('timestamp') or t.get('closeTime') or t.get('timestamp_ms') for t in autopsies if (t.get('timestamp') or t.get('closeTime') or t.get('timestamp_ms'))]
            timestamps = sorted([str(ts) for ts in timestamps if ts])
            if timestamps:
                print(f"Data Window: {timestamps[0]} -> {timestamps[-1]}")
        
        # Performance by module
        modules = {}
        for a in autopsies:
            mod = a.get('module', 'UNKNOWN')
            if mod not in modules:
                modules[mod] = {'WIN': 0, 'LOSS': 0, 'STALE_EXIT': 0, 'BREAK_EVEN': 0, 'mfe_wins': [], 'mae_wins': [], 'mfe_losses': [], 'mae_losses': [], 'win_r': []}
            
            outcome = a.get('outcome', 'UNKNOWN')
            if outcome in modules[mod]:
                modules[mod][outcome] += 1
            
            mfe = a.get('mfePct', 0)
            mae = a.get('maePct', 0)
            
            if outcome == 'WIN':
                modules[mod]['mfe_wins'].append(mfe)
                modules[mod]['mae_wins'].append(mae)
                sl_pct = a.get('sl_pct', None)
                if not sl_pct: 
                    entry = a.get('entry', 0)
                    sl = a.get('sl', 0)
                    if entry > 0: sl_pct = abs(entry - sl)/entry * 100
                
                tp_pct = a.get('tp_pct', None)
                if not tp_pct:
                    entry = a.get('entry', 0)
                    tp = a.get('tp', 0)
                    if entry > 0: tp_pct = abs(entry - tp)/entry * 100
                
                if sl_pct and sl_pct > 0 and tp_pct:
                    modules[mod]['win_r'].append(tp_pct/sl_pct)
                    
            elif outcome == 'LOSS':
                modules[mod]['mfe_losses'].append(mfe)
                modules[mod]['mae_losses'].append(mae)
                
        for mod, stats in modules.items():
            wins = stats['WIN']
            losses = stats['LOSS']
            n_decisive = wins + losses
            if n_decisive == 0: continue
            
            wr = wins / n_decisive
            avg_win_r = sum(stats['win_r'])/len(stats['win_r']) if stats['win_r'] else 2.0
            expectancy = (wr * avg_win_r) - ((1 - wr) * 1.0)
            
            avg_mfe_wins = sum(stats['mfe_wins'])/len(stats['mfe_wins']) if stats['mfe_wins'] else 0
            avg_mae_losses = sum(stats['mae_losses'])/len(stats['mae_losses']) if stats['mae_losses'] else 0
            avg_mfe_losses = sum(stats['mfe_losses'])/len(stats['mfe_losses']) if stats['mfe_losses'] else 0
            
            zero_mfe_losses = len([m for m in stats['mfe_losses'] if m == 0])
            z_mfe_rate = zero_mfe_losses / losses if losses > 0 else 0
            
            print(f"Module: {mod}")
            print(f"n_decisive: {n_decisive} (WIN: {wins} | LOSS: {losses} | STALE: {stats['STALE_EXIT']} | BE: {stats['BREAK_EVEN']})")
            print(f"Win Rate: {wr*100:.1f}%")
            print(f"Expectancy: {expectancy:.2f} R")
            print(f"Avg MFE (wins): {avg_mfe_wins:.2f}%")
            print(f"Avg MFE (losses): {avg_mfe_losses:.2f}%")
            print(f"Avg MAE (losses): {avg_mae_losses:.2f}%")
            print(f"Zero-MFE losses: {z_mfe_rate*100:.1f}%\\n")

    # Funnel Analysis (from persistent logs)
    logs = files['logs.json']
    if logs:
        print(f"\\n# Throughput Funnel ({bot_name})")
        funnel_counts = Counter()
        reject_counts = Counter()
        runs = 0
        for msg in logs:
            if not isinstance(msg, str): continue
            if "[THROUGHPUT]" in msg and "Stages:" in msg:
                runs += 1
                try:
                    stages_str = msg.split("Stages: ")[1]
                    stages = stages_str.split(" | ")
                    for stage in stages:
                        k, v = stage.split("=")
                        funnel_counts[k.strip()] += int(v.strip())
                except Exception:
                    pass
            if "[THROUGHPUT]" in msg and "Rejects:" in msg:
                try:
                    rejects_str = msg.split("Rejects: ")[1]
                    rejects = rejects_str.split(" | ")
                    for rej in rejects:
                        k, v = rej.split("=")
                        reject_counts[k.strip()] += int(v.strip())
                except Exception:
                    pass

        print(f"Runs Observed: {runs}")
        print("Stages:")
        for k, v in funnel_counts.items():
            print(f"{k}: {v}")
        print("\\nTop Reject Codes:")
        for k, v in reject_counts.most_common(5):
            print(f"{k}: {v}")

    # Shadow Trade Analysis
    shadow = files['shadow_archive.json']
    if shadow:
        print(f"\\n# Shadow Edge Analysis ({bot_name})")
        reasons = {}
        for s in shadow:
            code = s.get('rejectReasonCode', s.get('rejectReason', 'UNKNOWN'))
            if code not in reasons:
                reasons[code] = {'WOULD_WIN': 0, 'WOULD_LOSE': 0}
            
            out = s.get('outcome')
            if out in ['WOULD_WIN', 'WOULD_LOSE']:
                reasons[code][out] += 1
                
        for code, stats in reasons.items():
            wins = stats['WOULD_WIN']
            losses = stats['WOULD_LOSE']
            total = wins + losses
            if total >= 5:
                wr = wins / total
                exp_gain = (wr * 2.0) - ((1 - wr) * 1.0)
                print(f"Code: {code} | n: {total} | WR: {wr*100:.1f}% | Expected Gain: {exp_gain:.2f} R")

analyze_bot("Bot 1 (Fusion)", "/Users/carlosrabago/trading/history.json", "/Users/carlosrabago/trading/autopsies.json", "/Users/carlosrabago/trading/shadow_trades_archive.json", "/Users/carlosrabago/trading/persistent_logs.json")
analyze_bot("Bot 2 (Reversal Lab)", "/Users/carlosrabago/trading/knife_history.json", "/Users/carlosrabago/trading/knife_autopsies.json", "/Users/carlosrabago/trading/knife_shadow_archive.json", "/Users/carlosrabago/trading/knife_persistent_logs.json")

