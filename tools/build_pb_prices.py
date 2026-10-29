# Builds src/data/shop_prices.tickets.json from PB shop data (read-only on game files).
# Same price rules as Gameplay's _build_pb_prices.py (K, D, SELL_SHARE, SELL_MAX, PACK).
# Output path is this repo, not the balance workspace the original script wrote to.
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'src' / 'data'
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'src' / 'data' / 'shop_prices.tickets.json'

items = {i['id']: i for i in json.loads((SRC / 'items.json').read_text())}
shops = json.loads((SRC / 'shops.json').read_text())
drops = json.loads((SRC / 'droptables.json').read_text())
skills = json.loads((SRC / 'skills.json').read_text())

K = 3          # price curve: ticket_price = max(1, round(K * sqrt(usd)))
D = 25         # stream rate: 1 Ticket per 25 USD-equivalent (drops, lobbying, sells of produced items)
SELL_SHARE = 0.45
SELL_MAX = 150 # below the 200 session cap so any sell fits a fresh session
PACK = {'item_rounds': 100, 'item_coom': 100}  # ammo priced per 100-unit pack, linear at D

produced = set()
for t in drops:
    for e in t['table']:
        if 'item' in e:
            produced.add(e['item'])
    for a in t.get('always', []):
        produced.add(a['item'])
for sk in skills:
    for a in sk.get('actions', []):
        if a.get('output'):
            produced.add(a['output'])
        if a.get('rare', {}).get('item'):
            produced.add(a['rare']['item'])
    for r in sk.get('recipes', []):
        produced.add(r['output'])

best = {}
for s in shops:
    for e in s['stock']:
        best[e['item']] = min(best.get(e['item'], 1e18), e['priceUsd'])

def buy_tickets(it, usd):
    if it in PACK:
        return max(1, math.ceil(usd * PACK[it] / D))
    return max(1, round(K * math.sqrt(usd)))

sell_of = {}
for it, usd in best.items():
    value = items[it]['value']
    cheapest = buy_tickets(it, usd)
    if it in PACK:
        sell = min(math.floor(SELL_SHARE * cheapest), math.floor(value * PACK[it] / D))
    else:
        sell = math.floor(SELL_SHARE * cheapest)
        if it in produced:
            sell = min(sell, math.floor(value / D))
        sell = min(sell, SELL_MAX)
    sell_of[it] = max(0, min(sell, cheapest - 1))

rows = []
for s in shops:
    for e in s['stock']:
        it, usd = e['item'], e['priceUsd']
        rows.append({
            'shop_id': s['id'],
            'item_id': it,
            'pack_size': PACK.get(it, 1),
            'price': buy_tickets(it, usd),
            'sell_price': sell_of[it],
            '_pb_price': usd,
            '_name': items[it]['name'],
        })

rows.sort(key=lambda r: (r['_pb_price'], r['item_id'], r['shop_id']))

keys = [(r['shop_id'], r['item_id']) for r in rows]
assert len(keys) == len(set(keys)), 'duplicate (shop_id, item_id)'
assert len(rows) == sum(len(s['stock']) for s in shops)
min_buy = {}
for r in rows:
    min_buy[r['item_id']] = min(min_buy.get(r['item_id'], 1e18), r['price'])
for r in rows:
    assert 0 <= r['sell_price'] < r['price'], r
    assert r['sell_price'] < min_buy[r['item_id']] or r['price'] == min_buy[r['item_id']]
    # sell is strictly below this row's price, and one sell price per item
assert len({(r['item_id'], r['sell_price']) for r in rows}) == len(min_buy)

public = [
    {
        'shop_id': r['shop_id'],
        'item_id': r['item_id'],
        'pack_size': r['pack_size'],
        'price': r['price'],
        'sell_price': r['sell_price'],
    }
    for r in rows
]
OUT.write_text(json.dumps(public, indent=2) + '\n')
print(f'wrote {len(public)} rows to {OUT}')
