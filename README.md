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

Regole di base applicate per intero: fasi del turno (prepara, pesca, Gig dal fixer con il d20 per ultimo), Eddies e vendita di una carta a turno, Chiamata di una Leggenda a turno per 1 €$ (si tocca la Leggenda coperta da scoprire), Leggende spese per pagare, Go Solo, Lag e Adrenaline, attacchi a Unità spese o all'area Gig con **finestra di reazione** del difensore (Blocker, Chiamata di una Leggenda, Programmi e abilità Quick, anche in sequenza), furto dei Gig in base alla potenza (1 ogni 10), Street Cred, vittoria con 7 Gig all'inizio del turno, overtime dopo il 7º turno, sconfitta per mazzo vuoto, mulligan, chi inizia con 2 Leggende spese. In due sullo stesso dispositivo le decisioni del difensore si aprono solo dopo un suo tocco, così l'attaccante non vede le sue carte.

Effetti delle carte interpretati dal testo: pesca, trash, +potenza, Gig ±N, sconfiggi/spendi Unità rivali per potenza o costo, scarti, «sconfiggi tutte le altre Unità», «spendi tutte le Unità rivali», «può attaccare solo Unità», «non può attaccare», «scegli un effetto: A // B», ricerca nelle prime N carte del mazzo, recupero dal trash (anche tra le carte appena trashate), «puoi sconfiggere un Gear: se lo fai pesca…», Chiamata gratis, gioca un Gear/Unità dalla mano gratis, scambio di Gig, «imposta un Gig al valore di un altro», prepara Unità/Leggende, Adrenaline a un'altra Unità, «spendi e non si prepara». Il resto (condizioni «se/quando», conteggi, effetti a fine turno) viene segnalato nel registro come **effetto manuale** e, per restare nelle regole, non si applica: gli strumenti manuali esistono nel codice (`MANUAL` in `sim.js`) ma sono spenti. Il bot ignora gli effetti manuali.

Pagamenti: di base il giocatore sceglie cosa spendere toccando sulla plancia gli Eddies o le Leggende (con la scorciatoia «Tutto con Eddies» e «Annulla»); nel profilo si può attivare il pagamento automatico, che chiede conferma solo quando dovrebbe spendere una Leggenda scoperta con un'abilità Spend ancora utilizzabile.

Nota sul Gear: il motore somma la potenza del Gear a quella dell'Unità equipaggiata.

## Import delle liste

«Importa testo» accetta una carta per riga, per nome (`3 Mantis Blades`, `2x Japantown Jonin`, `Legend: V: Streetkid`) o per codice stampato sulla carta (`3 WNC-025`, `MS01 025`, `SD01-004 x2`, `EBP-001`, oppure il solo numero, riferito al set principale). Codici riconosciuti: WNC/MS01 (Welcome to Night City), HEI/SD01 (starter The Heist), EBP/SD02 (starter Embracing Power), PRM01, PRR/PRR02 (prerelease), EOR/EOR01 (Edgerunner Open), NCB/NCB01 (Night City Brawl), BT (box topper). Le righe non riconosciute vengono mostrate nell'editor del mazzo.

## Scanner della collezione

Dalla Collection, «Scanner» apre la fotocamera. In modalità continua l'app legge di continuo l'inquadratura con Tesseract.js (scaricato dalla CDN la prima volta, ≈4 MB, poi resta in memoria), abbina nome e testo di regole alle 151 carte del catalogo e, quando la stessa carta viene riconosciuta in due letture consecutive con punteggio ≥ 70%, la mette nella **lista di scansione**; per contare un'altra copia della stessa carta basta allontanarla e riavvicinarla. La lista si rivede (quantità, stampa, rimozione) e si aggiunge alla collezione in blocco; resta salvata se si chiude l'app a metà. Restano «Scatta» (una lettura con i candidati) e «Da foto». Il codice set e il numero stampati sulla carta sono in verticale e in diagonale, poco adatti all'OCR: per le varianti si passa dalla scheda.

## Prossimi passi possibili

- Scanner: riconoscimento della variante (set + numero) e inquadratura continua senza premere «Scatta».
- Account e sincronizzazione (Supabase) per avere collezione e mazzi su più dispositivi.
- Mazzi meta: appena un sito esporrà le liste dei tornei in formato leggibile (oggi: link a ExBurst, Ripperdeck e Choom.gg e importazione del testo).
- Immagini dall'API ufficiale Netdeck quando l'accesso sarà aperto (lista d'attesa).
