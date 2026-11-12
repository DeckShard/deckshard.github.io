#!/usr/bin/env python3
"""
Riquadro del testo sulle immagini delle carte, per il testo italiano sulle carte ingrandite (ui.js, lensText).

Per ogni stampa con testo trova dove stanno le righe del testo stampato (frazioni dell'altezza della carta):
  - cornice normale (Common…Secret): [inizio, fine, "colore in alto", "colore in basso"] — il riquadro scuro
    del testo e i suoi colori, così il testo italiano ci va sopra con lo stesso fondo;
  - arte piena (Nova Rare, Iconic): [inizio, fine] — il testo sta sull'illustrazione: l'app ci mette un velo scuro.
Se non trova nulla di sicuro la stampa resta senza voce e l'app mostra la traduzione in una didascalia.

Usi:
  python cardbox.py            rigenera cardbox.js (tutte le stampe; serve data/img/ completa)
  da collect.py: update(cards) scrive public/cardbox.json con le sole stampe che cardbox.js non ha ancora
  (le carte nuove), che l'app unisce a cardbox.js.

Solo Pillow, niente numpy: gira anche nel workflow notturno così com'è.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
IMG_DIR = ROOT / "data" / "img"
SPECIAL = {"Nova Rare", "Iconic Legend", "Iconic Other", "Iconic Secret"}


def _rows(im, x0, x1, ya, yb):
    """righe di pixel (r, g, b) della fascia [x0, x1) per y in [ya, yb)"""
    w = x1 - x0
    raw = im.crop((x0, ya, x1, yb)).tobytes()
    out = []
    for k in range(yb - ya):
        b = raw[k * w * 3:(k + 1) * w * 3]
        out.append((b[0::3], b[1::3], b[2::3]))
    return out


def _median(xs):
    s = sorted(xs); n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _groups(flags, start, H, gap=2):
    gs, cur = [], None
    for k, f in enumerate(flags):
        y = start + k
        if f:
            if cur is None: cur = [y, y]
            else: cur[1] = y
        elif cur and y - cur[1] > gap:
            gs.append(cur); cur = None
    if cur: gs.append(cur)
    return gs


def detect_standard(im):
    W, H = im.size
    x0, x1 = int(.07 * W), int(.62 * W)
    ya, yb = int(.38 * H), int(.94 * H)
    R = _rows(im, x0, x1, ya, yb)
    lum = [[(r + g + b) / 3 for r, g, b in zip(*row)] for row in R]
    n = x1 - x0
    med = [_median(l) for l in lum]
    bright = [sum(1 for v in l if v > 175) / n for l in lum]
    L = lambda y: y - ya
    y0, y1 = int(.50 * H), int(.86 * H)
    ymin = min(range(y0, y1), key=lambda y: med[L(y)])
    top = ymin
    while top > y0 and med[L(top - 1)] < 22: top -= 1
    s = max(ya, top - int(.09 * H)); e = int(.935 * H)
    gs = _groups([bright[L(y)] > .006 for y in range(s, e)], s, H)
    hh = lambda g: (g[1] - g[0]) / H

    def chipRow(y):
        """quota della riga coperta dal fondo di una parola chiave a riquadro (BLOCKER magenta, GO SOLO giallo…)"""
        r_, g_, b_ = R[L(y)]; c = 0
        for r, gg, b in zip(r_, g_, b_):
            mx, mn = max(r, gg, b), min(r, gg, b)
            if mx - mn > 110 and ((r > 170 and gg < 90) or (r > 190 and gg > 170 and b < 90)): c += 1
        return c / n
    chip = lambda g: max(chipRow(y) for y in range(g[0], g[1] + 1)) > .04

    # sotto il bordo alto del riquadro (i tag ci stanno a cavallo); in testa si scartano briciole, tag e titoli
    cand = [g for g in gs if g[0] >= top + .008 * H and g[0] < .905 * H and hh(g) >= .008]
    while cand and (hh(cand[0]) < .0165 or hh(cand[0]) >= .032) and not (hh(cand[0]) < .032 and chip(cand[0])): cand.pop(0)
    body = [g for g in cand if hh(g) >= .012]
    if not body:
        rows = [y for y in range(top + int(.022 * H), int(.925 * H)) if bright[L(y)] > .006]
        if not rows: return None
        t0, t1 = rows[0], rows[-1]
    else:
        t0, t1 = body[0][0], body[-1][1]
    # una parola chiave da sola su una riga (BLOCKER) ha il testo scuro sul riquadro colorato: non risulta tra le righe
    # chiare, la si cerca tra la riga dei tag (a cavallo del bordo alto) e la prima riga trovata
    tags = [g for g in gs if abs(g[0] - top) < .025 * H and g[1] < t0]
    y = max(top + int(.012 * H), (tags[-1][1] + 3) if tags else 0, t0 - int(.065 * H)); run = 0   # al massimo una riga sopra
    while y < t0 - 2:
        run = run + 1 if med[L(y)] < 45 and chipRow(y) > .04 else 0   # dentro il riquadro scuro, non sull'illustrazione
        if run >= int(.01 * H): t0 = y - run + 1; break
        y += 1

    def bg(y):
        px = []
        for yy in range(max(ya, y - 2), min(yb, y + 3)):
            px.extend(zip(*R[L(yy)]))
        ls = sorted((r + g + b) / 3 for r, g, b in px)
        cut = ls[int(.6 * (len(ls) - 1))]
        dark = [p for p in px if (p[0] + p[1] + p[2]) / 3 < cut] or px
        return "".join(f"{int(_median([p[k] for p in dark])):02x}" for k in range(3))
    return [round(t0 / H, 3), round(t1 / H, 3), bg(t0), bg(min(int(.92 * H), t1 + 4))]


def detect_fullart(im):
    W, H = im.size
    x0, x1 = int(.07 * W), int(.70 * W)
    ya, yb = int(.55 * H), int(.945 * H)
    R = _rows(im, x0, x1, ya, yb)
    flags = []
    for r_, g_, b_ in R:
        st = []
        for r, g, b in zip(r_, g_, b_):
            l = (r + g + b) / 3
            if max(r, g, b) > 200 and l > 140: st.append(1)
            elif l < 80: st.append(-1)
        tr = sum(1 for a, b in zip(st, st[1:]) if a != b)   # passaggi chiaro/scuro: il testo ne ha tanti, l'arte pochi
        flags.append(tr / W > .012)
    gs = [(g[0] / H, g[1] / H) for g in _groups(flags, ya, H) if (g[1] - g[0]) / H >= .006]
    # l'ultima riga di testo finisce poco sopra .885 (sotto: numerazione e copyright); si risale finché il passo
    # tra le righe resta regolare e ci si ferma alla riga dei tag (più bassa) o a un salto
    body = [g for g in gs if g[1] <= .888 and .016 <= g[1] - g[0] <= .03]
    if not body or body[-1][1] < .855: return None
    out = [body[-1]]
    for g in reversed(body[:-1]):
        if .03 <= out[0][0] - g[0] <= .05: out.insert(0, g)
        else: break
    return [round(out[0][0], 3), round(out[-1][1], 3)]


def detect(path, rarity):
    from PIL import Image
    im = Image.open(path).convert("RGB")
    return detect_fullart(im) if rarity in SPECIAL else detect_standard(im)


def known_js():
    p = ROOT / "cardbox.js"
    return set(re.findall(r'"([0-9a-f-]{36})"', p.read_text(encoding="utf-8"))) if p.exists() else set()


def update(cards, public):
    """da collect.py: calcola le stampe con testo che cardbox.js non ha (e che cardbox.json non ha già provato)"""
    have = known_js(); out_p = Path(public) / "cardbox.json"
    old = json.loads(out_p.read_text(encoding="utf-8")) if out_p.exists() else {}
    out, tried = {}, 0
    for c in cards:
        if not c.get("text"): continue
        for p in c["prints"]:
            pid = p["id"]
            if pid in have: continue
            if pid in old: out[pid] = old[pid]; continue
            f = IMG_DIR / f"{pid}.webp"
            if not f.exists(): continue
            try: out[pid] = detect(f, p.get("rarity")); tried += 1
            except Exception as e: print(f"    riquadro testo non letto per {c.get('dn')}: {e}", flush=True)
    out_p.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return tried, sum(1 for v in out.values() if v)


HEAD = """/* Riquadro del testo sulle immagini delle carte, per scrivere sopra il testo in italiano (lente, solo con Impostazioni →
   Lingua → «Testo delle carte: Italiano»). Per ogni stampa: inizio e fine delle righe di testo (frazioni dell'altezza
   della carta); per la cornice normale anche i colori di fondo del riquadro in alto e in basso, per le stampe ad arte
   piena (Nova Rare, Iconic) solo le due frazioni (l'app ci mette un velo scuro). Generato da cardbox.py; le carte
   uscite dopo stanno in public/cardbox.json, che il workflow notturno aggiorna. Le stampe senza voce mostrano il
   testo italiano sotto la carta ingrandita. */
export const CARD_BOX = """


def fmt(v):
    return "[" + ",".join(("%.3f" % x).lstrip("0") if isinstance(x, float) else json.dumps(x) for x in v) + "]"


if __name__ == "__main__":
    D = json.loads((ROOT / "public" / "cards.json").read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    res = {}
    for c in D["cards"]:
        if not c.get("text"): continue
        for p in c["prints"]:
            if only and p["id"] not in only: continue
            f = IMG_DIR / f"{p['id']}.webp"
            if not f.exists(): continue
            try: b = detect(f, p.get("rarity"))
            except Exception as e: b = None; print("errore", p["id"], e)
            if b: res[p["id"]] = b
    if only:
        print(json.dumps(res, indent=1)); sys.exit(0)
    (ROOT / "cardbox.js").write_text(HEAD + "{" + ",\n".join(f'"{k}":{fmt(v)}' for k, v in res.items()) + "};\n", encoding="utf-8")
    print(len(res), "stampe con riquadro")
