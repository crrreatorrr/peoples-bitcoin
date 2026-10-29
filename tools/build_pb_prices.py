# Writes src/data/shop_prices.tickets.json from Gameplay's pb_shop_prices.csv.
# The CSV is the source of truth. This does not recompute prices from items.json.
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tools' / 'pb_shop_prices.csv'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'src' / 'data' / 'shop_prices.tickets.json'

rows = []
with CSV.open(newline='') as f:
    for raw in csv.DictReader(f):
        rows.append({
            'shop_id': raw['shop_id'],
            'item_id': raw['item_id'],
            'pack_size': int(raw['pack_size']),
            'price': int(raw['ticket_price']),
            'sell_price': int(raw['sell_price']),
        })

keys = [(r['shop_id'], r['item_id']) for r in rows]
assert len(keys) == len(set(keys)), 'duplicate (shop_id, item_id)'
for r in rows:
    assert r['price'] > 0 and 0 <= r['sell_price'] < r['price'], r

OUT.write_text(json.dumps(rows, indent=2) + '\n')
print(f'wrote {len(rows)} rows to {OUT}')
