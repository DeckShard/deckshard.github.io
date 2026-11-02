#!/usr/bin/env python3
"""
Collector di Night City Deck — catalogo carte, immagini e prezzi del Cyberpunk TCG.

Cosa fa, in ordine:
  1. scarica il catalogo completo da api.netdeck.gg (lo stesso che alimenta il
     database ufficiale su cyberpunktcg.com): carte, stampe, testi, immagini;
  2. scarica le immagini che ancora mancano in data/img/ e ne ricava le
     miniature. Gli indirizzi ufficiali sono firmati e scadono in pochi
     minuti: senza una copia locale un'app non potrebbe mostrare nulla;
  3. scarica il listino pubblico giornaliero di Cardmarket (prezzi Trend,
     From, medie) e lo incrocia con le stampe;
  4. pubblica in public/: cards.json, prices.json, meta.json e le immagini.

Nessuna dipendenza oltre a Pillow (per le miniature).

Attribuzione: dati carte da Netdeck.gg / WeirdCo; immagini © CD PROJEKT RED;
prezzi da Cardmarket. Uso non commerciale, come richiesto dalle linee guida
per i creatori di WeirdCo.
"""

import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
IMG_DIR = DATA / "img"
OVERRIDES = ROOT / "cardmarket-pins.json"      # abbinamenti prodotto→stampa a mano, se servono
EXP_OVERRIDES = ROOT / "cardmarket-expansions.json"   # idExpansion→set a mano, se servono
PUBLIC = ROOT / "public"

UA = "NightCityDeck/0.1 (collector; non-commercial fan tool)"
NETDECK = os.environ.get("NCD_NETDECK", "https://api.netdeck.gg/api/cards/cyberpunk")
CM_BASE = os.environ.get("NCD_CM_BASE", "https://downloads.s3.cardmarket.com/productCatalog")
CM_GAME = os.environ.get("NCD_CM_GAME", "23")   # 23 = Cyberpunk TCG nel catalogo Cardmarket
THUMB_W = int(os.environ.get("NCD_THUMB_W", "244"))
IMG_DELAY = float(os.environ.get("NCD_IMG_DELAY", "0.15"))
SKIP_IMAGES = os.environ.get("NCD_SKIP_IMAGES", "") not in ("", "0", "false")

RARITY_RANK = {"Common": 0, "Uncommon": 1, "Rare": 2, "Epic": 3, "Secret": 4,
               "Nova Rare": 5, "Iconic Other": 6, "Iconic Legend": 7, "Iconic Secret": 8}
KEYWORDS = ["Blocker", "Quick", "Adrenaline", "Go Solo"]
TRIGGERS = ["Play", "Call", "Attack", "Defeated", "Spend"]


# ---------------------------------------------------------------- rete
def get(url, tries=5, binary=False):
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
                return data if binary else json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504):
                wait = 2 * (attempt + 1) ** 2
                print(f"  HTTP {e.code} su {url[:60]}…, riprovo tra {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            wait = 3 * (attempt + 1)
            print(f"  rete: {e}, riprovo tra {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"irraggiungibile dopo {tries} tentativi: {url}")


# ---------------------------------------------------------------- Netdeck
def fetch_catalogue():
    items, offset = [], 0
    while True:
        page = get(f"{NETDECK}?limit=100&offset={offset}")
        if not page or not page.get("items"):
            break
        items += page["items"]
        total = page.get("total", len(items))
        offset += page.get("limit", 100)
        print(f"  catalogo: {len(items)}/{total}", flush=True)
        if offset >= total:
            break
    return items


def parse_markers(text):
    """I testi usano {Blocker}, {Play}… come marcatori: si estraggono keyword e trigger."""
    found = set(re.findall(r"\{([^}]+)\}", text or ""))
    return ([k for k in KEYWORDS if k in found], [t for t in TRIGGERS if t in found])


def normalize_cards(items):
    """Riduce il catalogo a ciò che serve all'app, con nomi di campo corti."""
    cards, sets, printings_seen = [], {}, 0
    for c in items:
        keywords, triggers = parse_markers(c.get("rules_text"))
        prints = []
        for p in c.get("printings") or []:
            s = p.get("set") or {}
            code = s.get("code") or ""
            sets.setdefault(code, {"code": code, "name": s.get("name") or code, "n": 0})
            sets[code]["n"] += 1
            prints.append({
                "id": p["id"],
                "set": code,
                "num": str(p.get("collector_number") or ""),
                "rarity": p.get("rarity") or "",
                "lang": p.get("language") or "en",
                "artist": p.get("artist") or "",
                "lname": p.get("localized_name") or None,
                "img": bool(p.get("image_url")),
                "_img": p.get("image_url"),
            })
            printings_seen += 1
        cards.append({
            "id": c["id"],
            "name": c.get("name") or "",
            "sub": c.get("subname") or None,
            "dn": c.get("display_name") or c.get("name"),
            "slug": c.get("slug"),
            "type": c.get("card_type"),
            "color": c.get("color"),
            "cost": c.get("cost"),
            "power": c.get("power"),
            "ram": c.get("ram"),
            "text": c.get("rules_text") or "",
            "flavor": c.get("flavor_text") or None,
            "cls": c.get("classifications") or [],
            "kw": keywords,
            "trig": triggers,
            "eddiable": bool(c.get("is_eddiable")),
            "rarity": c.get("rarity") or "",
            "legal": (c.get("legalities") or {}).get("standard") or c.get("legality"),
            "sel": c.get("selected_printing_id") or c.get("printing_id"),
            "prints": prints,
        })
    return cards, sets, printings_seen


# ---------------------------------------------------------------- immagini
def ensure_images(cards):
    """Scarica solo le immagini mancanti e crea le miniature mancanti."""
    from PIL import Image
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    (IMG_DIR / "t").mkdir(exist_ok=True)
    todo = [(c, p) for c in cards for p in c["prints"]
            if p["_img"] and not (IMG_DIR / f"{p['id']}.webp").exists()]
    print(f"  immagini: {len(todo)} da scaricare", flush=True)
    done, failed, refreshes = 0, 0, 0

    def refresh_urls():
        """Gli indirizzi firmati scadono in pochi minuti: su un 403 si richiede
        il catalogo e si rimpiazzano tutti gli indirizzi con quelli freschi."""
        fresh = {}
        for item in fetch_catalogue():
            for pr in item.get("printings") or []:
                fresh[pr["id"]] = pr.get("image_url")
        for c2 in cards:
            for p2 in c2["prints"]:
                if fresh.get(p2["id"]):
                    p2["_img"] = fresh[p2["id"]]

    for c, p in todo:
        for attempt in (1, 2):
            try:
                data = get(p["_img"], binary=True)
                if data:
                    (IMG_DIR / f"{p['id']}.webp").write_bytes(data)
                    done += 1
                else:
                    failed += 1
                break
            except urllib.error.HTTPError as e:
                if e.code == 403 and attempt == 1:
                    refreshes += 1
                    print(f"    indirizzi scaduti dopo {done} immagini: li rinfresco", flush=True)
                    refresh_urls()
                    continue
                failed += 1
                print(f"    immagine non scaricata per {c['dn']} ({p['set']} {p['num']}): {e}", flush=True)
                break
            except Exception as e:
                failed += 1
                print(f"    immagine non scaricata per {c['dn']} ({p['set']} {p['num']}): {e}", flush=True)
                break
        if done % 50 == 0 and done:
            print(f"    {done}/{len(todo)}", flush=True)
        time.sleep(IMG_DELAY)
    # miniature
    made = 0
    for c in cards:
        for p in c["prints"]:
            src = IMG_DIR / f"{p['id']}.webp"
            dst = IMG_DIR / "t" / f"{p['id']}.webp"
            if src.exists() and not dst.exists():
                im = Image.open(src).convert("RGB")
                h = round(im.height * THUMB_W / im.width)
                im.resize((THUMB_W, h), Image.LANCZOS).save(dst, "WEBP", quality=80, method=6)
                made += 1
    for c in cards:
        for p in c["prints"]:
            p["img"] = (IMG_DIR / f"{p['id']}.webp").exists()
    return done, failed, made


# ---------------------------------------------------------------- Cardmarket
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def card_key(c):
    return norm(c["name"] + (" " + c["sub"] if c["sub"] else ""))


def product_key(name):
    # "V - Streetkid" -> "v streetkid"; "Chrome Fang" -> "chrome fang"
    return norm(name.replace(" - ", " "))


def fetch_cardmarket():
    guide = get(f"{CM_BASE}/priceGuide/price_guide_{CM_GAME}.json")
    products = get(f"{CM_BASE}/productList/products_singles_{CM_GAME}.json")
    if not guide or not products:
        raise RuntimeError("listino Cardmarket non disponibile")
    return guide, products


def map_expansions(products, cards):
    """
    Il listino pubblico non dice a quale set corrisponde ogni idExpansion.
    Lo si ricava dal contenuto: l'espansione che condivide piu' nomi con un set
    di Netdeck e' quel set. Le espansioni francesi hanno gli stessi nomi di
    quelle inglesi: si distinguono perche' hanno id piu' alti (aggiunte dopo).
    """
    exp_names = defaultdict(set)
    for p in products:
        exp_names[p["idExpansion"]].add(product_key(p["name"]))
    set_names = defaultdict(set)
    for c in cards:
        for pr in c["prints"]:
            set_names[pr["set"]].add(card_key(c))
    manual = {}
    if EXP_OVERRIDES.exists():
        manual = {int(k): v for k, v in json.loads(EXP_OVERRIDES.read_text(encoding="utf-8")).items()
                  if k.isdigit()}                  # le chiavi non numeriche sono note
    mapping, used = dict(manual), set(manual.values())
    # Jaccard: premia i set che coincidono, non quelli grandi che contengono tutto
    for exp in sorted(e for e in exp_names if e not in mapping):   # id crescente: prima le inglesi
        best, score = None, 0.0
        for code, names in set_names.items():
            if code in used:
                continue
            inter = len(exp_names[exp] & names)
            if not inter:
                continue
            sc = inter / len(exp_names[exp] | names)
            if sc > score:
                best, score = code, sc
        if best and score >= 0.3:
            mapping[exp] = best
            used.add(best)
    return mapping


def join_prices(guide, products, cards, mapping):
    """
    Abbina ogni prodotto Cardmarket a una stampa. Quando nello stesso set un
    nome compare due volte (versione base e variante Iconic) il listino non
    distingue le due: si abbina il prodotto piu' caro alla stampa piu' rara e
    si segna il prezzo come stimato.
    """
    by_id = {g["idProduct"]: g for g in guide.get("priceGuides", [])}
    unresolved_wild = []
    pins = {}
    if OVERRIDES.exists():
        pins = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    # stampe per (set, chiave nome)
    slots = defaultdict(list)
    for c in cards:
        for pr in c["prints"]:
            slots[(pr["set"], card_key(c))].append((c, pr))
    prods = defaultdict(list)
    wildcard = []
    for p in products:
        code = mapping.get(p["idExpansion"])
        if code == "*":
            wildcard.append(p)
        elif code:
            prods[(code, product_key(p["name"]))].append(p)
    # espansioni "jolly" (esclusive Kickstarter): il prodotto va alla stampa con
    # quel nome che non ha ancora un prezzo, preferendo i set promozionali
    by_name = defaultdict(list)
    for (code, key), cands in slots.items():
        by_name[key].append((code, cands))
    pref = lambda code: (0 if re.search(r"prm|promo|edgerunner|brawl|showdown|boxtopper", code, re.I) else 1, code)
    for p in wildcard:
        key = product_key(p["name"])
        options = sorted(by_name.get(key, []), key=lambda cc: pref(cc[0]))
        taken = {k[0] for k in prods}
        chosen = next((cc for cc in options if (cc[0], key) not in prods), options[0] if options else None)
        if chosen:
            p["_wild"] = True                     # abbinamento per solo nome: prezzo stimato
            prods[(chosen[0], key)].append(p)
        else:
            unresolved_wild.append({"product": p["name"], "set": "*", "why": "nessuna stampa con questo nome"})

    prices, unresolved, approx = {}, list(unresolved_wild), 0
    for key, plist in prods.items():
        cands = slots.get(key)
        if not cands:
            unresolved.append({"product": plist[0]["name"], "set": key[0], "why": "nessuna stampa con questo nome"})
            continue
        # ordina: prodotti per prezzo crescente, stampe per rarita' crescente
        plist = sorted(plist, key=lambda p: ((by_id.get(p["idProduct"]) or {}).get("trend") or 0))
        cands = sorted(cands, key=lambda cp: RARITY_RANK.get(cp[1]["rarity"], 0))
        ambiguous = len(plist) > 1 or len(cands) > 1
        for i, p in enumerate(plist):
            pid = str(p["idProduct"])
            if pid in pins:
                target = next((cp for cp in cands if cp[1]["id"] == pins[pid]), None)
            else:
                target = cands[min(i, len(cands) - 1)]
            if not target:
                unresolved.append({"product": p["name"], "set": key[0], "why": "pin verso una stampa inesistente"})
                continue
            g = by_id.get(p["idProduct"]) or {}
            row = {
                "cm": p["idProduct"],
                "trend": g.get("trend"), "low": g.get("low"), "avg": g.get("avg"),
                "avg1": g.get("avg1"), "avg7": g.get("avg7"), "avg30": g.get("avg30"),
                "trendFoil": g.get("trend-foil") or None,
            }
            if (ambiguous or p.get("_wild")) and pid not in pins:
                row["approx"] = True
                approx += 1
            prices[target[1]["id"]] = row
    return prices, unresolved, approx


# ---------------------------------------------------------------- main
def main():
    print("Night City Deck · collector")
    items = fetch_catalogue()
    if not items:
        print("Catalogo vuoto: esco senza scrivere.", file=sys.stderr)
        return 1
    cards, sets, nprints = normalize_cards(items)
    print(f"Carte: {len(cards)} · stampe: {nprints} · set: {len(sets)}")

    if SKIP_IMAGES:
        print("  immagini: saltate (NCD_SKIP_IMAGES)")
        for c in cards:
            for p in c["prints"]:
                p["img"] = (IMG_DIR / f"{p['id']}.webp").exists()
    else:
        done, failed, thumbs = ensure_images(cards)
        print(f"Immagini: {done} scaricate, {failed} fallite, {thumbs} miniature create")

    prices, unresolved, approx, mapping = {}, [], 0, {}
    try:
        guide, products = fetch_cardmarket()
        mapping = map_expansions(products["products"], cards)
        prices, unresolved, approx = join_prices(guide, products["products"], cards, mapping)
        priced = sum(1 for v in prices.values() if v.get("trend"))
        print(f"Prezzi: {len(products['products'])} prodotti Cardmarket → {len(prices)} stampe abbinate "
              f"({priced} con prezzo, {approx} stimate, {len(unresolved)} non abbinate)")
        cm_created = guide.get("createdAt")
    except Exception as e:
        print(f"Cardmarket non disponibile oggi: {e} (si pubblica senza prezzi)", file=sys.stderr)
        cm_created = None

    for c in cards:
        for p in c["prints"]:
            p.pop("_img", None)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (PUBLIC / "cards.json").write_text(json.dumps(
        {"generated": now, "source": "netdeck.gg (catalogo ufficiale WeirdCo)",
         "sets": sorted(sets.values(), key=lambda s: -s["n"]), "cards": cards},
        separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (PUBLIC / "prices.json").write_text(json.dumps(
        {"generated": now, "cardmarketCreatedAt": cm_created, "currency": "EUR",
         "source": "cardmarket.com listino pubblico", "expansions": mapping,
         "prices": prices, "unresolved": unresolved},
        separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (PUBLIC / "meta.json").write_text(json.dumps(
        {"generated": now, "cards": len(cards), "printings": nprints, "sets": len(sets),
         "priced": len(prices), "images": sum(1 for c in cards for p in c["prints"] if p["img"])},
        separators=(",", ":")), encoding="utf-8")
    kb = lambda p: (PUBLIC / p).stat().st_size // 1024
    print(f"Pubblicati: cards.json {kb('cards.json')} KB · prices.json {kb('prices.json')} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
