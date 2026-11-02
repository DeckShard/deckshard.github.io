# Night City Deck

App web gratuita (PWA) per il **Cyberpunk TCG**: collezione con prezzi Cardmarket, deckbuilder con le regole di costruzione, profilo e simulatore con motore di regole e bot. Funziona su telefono e desktop, si installa dalla pagina come un'app e lavora anche offline.

Progetto amatoriale, non affiliato a WeirdCo né a CD PROJEKT RED. *Cyberpunk*, *Cyberpunk 2077* e le immagini delle carte sono © CD PROJEKT S.A. / WeirdCo e vengono usate secondo le linee guida per i contenuti dei fan di WeirdCo: l'app deve restare **gratuita e senza pubblicità**. I dati delle carte arrivano dal database ufficiale (cyberpunktcg.com / Netdeck), i prezzi dal listino pubblico giornaliero di Cardmarket.

## Struttura

Tutto nella radice del repository (così si carica anche dalla pagina web di GitHub, che non conserva le cartelle):

```
collect.py                 collector: catalogo, immagini, prezzi → public/ e data/img/
cardmarket-expansions.json abbinamento espansioni Cardmarket → set del gioco
index.html, theme.css, sim.css, manifest.webmanifest, sw.js, icon*   la PWA
app.js, data.js, store.js, ui.js, collection.js, deck.js, profile.js, sim.js   le sezioni
engine.js                  motore di regole, puro (collaudabile con Node)
bot.js                     avversario euristico
scanner.js                 scanner della collezione (OCR con Tesseract.js, caricato dalla CDN quando serve)
engine.test.mjs            collaudo del motore (bot contro bot + regole puntuali)
ui.test.mjs                collaudo dell'interfaccia con Playwright
.github/workflows/collect.yml   raccolta notturna + pubblicazione su GitHub Pages
public/, data/img/         creati dal collector (il workflow li scrive nel repository)
```

## Messa in linea (GitHub Pages)

1. Crea un repository **pubblico** (GitHub Pages è gratuito solo sui repository pubblici) e carica tutti i file nella radice (*Add file → Upload files*).
2. Il workflow deve stare in `.github/workflows/collect.yml`: apri `collect.yml` nel repository, premi la matita (*Edit*), nel campo del nome scrivi `.github/workflows/collect.yml` e salva (*Commit changes*). Le barre creano le cartelle.
3. In **Settings → Pages** imposta *Source: GitHub Actions*.
4. In **Actions** lancia «Raccolta dati e pubblicazione» con *Run workflow*. La prima volta scarica le 860 immagini (qualche minuto), poi pubblica il sito. L'indirizzo è `https://<utente>.github.io/<repo>/`.
5. Da quel momento la raccolta gira ogni notte alle 04:40 UTC e ripubblica il sito; parte anche da sola ogni volta che carichi una modifica dell'app.

Sul telefono: apri l'indirizzo in Chrome → menu → *Aggiungi a schermata Home*. L'app si aggiorna da sola alla prima apertura online dopo una pubblicazione.

## Uso in locale

```
python collect.py                 # scarica tutto (NCD_SKIP_IMAGES=1 per saltare le immagini)
ln -s public/cards.json . ; ln -s public/prices.json . ; ln -s data/img img
python -m http.server 8080              # poi apri http://localhost:8080/
```

Collaudo: `node engine.test.mjs` e, con il server acceso, `BASE=http://127.0.0.1:8080 node ui.test.mjs` (serve `npm i playwright`).

## Cosa fa il motore di gioco

Regole di base applicate per intero: fasi del turno (prepara, pesca, Gig dal fixer con il d20 per ultimo), Eddies e vendita di una carta a turno, Chiamata di una Leggenda a turno per 1 €$, Leggende spendibili come 1 €$, Go Solo, Lag e Adrenaline, attacchi a Unità spese o all'area Gig, Blocker, furto dei Gig in base alla potenza (1 ogni 10), Street Cred, vittoria con 7 Gig all'inizio del turno, overtime dopo il 7º turno, sconfitta per mazzo vuoto, mulligan, chi inizia con 2 Leggende spese.

Effetti delle carte interpretati dal testo: pesca, trash, +potenza, Gig ±N, sconfiggi/spendi Unità rivali per potenza o costo, scarti, «sconfiggi tutte le altre Unità», «spendi tutte le Unità rivali», «può attaccare solo Unità», «non può attaccare». Il resto (condizioni, ricerche nel mazzo, scambi di Gig…) viene segnalato nel registro come **effetto manuale** e si applica con gli strumenti nel menù della carta (spendi/prepara, ±potenza, sconfiggi, ±1 su un Gig, pesca). Il bot ignora gli effetti manuali.

Nota sul Gear: il motore somma la potenza del Gear a quella dell'Unità equipaggiata.

## Scanner della collezione

Dalla Collection, «Scanner» apre la fotocamera (o accetta una foto). L'app legge il testo della carta con Tesseract.js, che viene scaricato dalla CDN la prima volta (≈4 MB) e poi resta in memoria, e abbina nome e testo di regole alle 151 carte del catalogo: propone fino a 5 candidati con una percentuale, un tocco aggiunge una copia della stampa predefinita, un tocco sull'immagine apre la scheda per scegliere set e variante. Il codice set e il numero stampati sulla carta sono in verticale e in diagonale, poco adatti all'OCR: per le varianti si passa dalla scheda.

## Prossimi passi possibili

- Scanner: riconoscimento della variante (set + numero) e inquadratura continua senza premere «Scatta».
- Account e sincronizzazione (Supabase) per avere collezione e mazzi su più dispositivi.
- Mazzi meta: appena un sito esporrà le liste dei tornei in formato leggibile.
- Immagini dall'API ufficiale Netdeck quando l'accesso sarà aperto (lista d'attesa).
