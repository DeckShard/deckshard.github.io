# Night City Deck

App web gratuita (PWA) per il **Cyberpunk TCG**: collezione con prezzi Cardmarket, deckbuilder con le regole di costruzione, profilo, simulatore con motore di regole e bot, regole, prerelease e tutorial. Le impostazioni (tema e colori, lingua, pagamento automatico nel simulatore, origine dei prezzi, backup dei dati, versione) stanno dietro l'ingranaggio in alto a destra. Funziona su telefono e desktop, si installa dalla pagina come un'app e lavora anche offline.

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
fuzz.test.mjs              300 partite con mazzi casuali: nessun effetto deve rompere il motore
parser.js                  interprete del testo delle carte (effetti, eventi, condizioni)
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

Collaudo: `node engine.test.mjs`, `node fuzz.test.mjs` e, con il server acceso, `BASE=http://127.0.0.1:8080 node ui.test.mjs` (serve `npm i playwright`).

## Cosa fa il motore di gioco

Regole di base applicate per intero: fasi del turno (prepara, pesca, Gig dal fixer con il d20 per ultimo), Eddies e vendita di una carta a turno, Chiamata di una Leggenda a turno per 1 €$ (si tocca la Leggenda coperta da scoprire), Leggende spese per pagare, Go Solo, Lag e Adrenaline, attacchi a Unità spese o all'area Gig con **finestra di reazione** del difensore (Blocker, Chiamata di una Leggenda, Programmi e abilità Quick, anche in sequenza), furto dei Gig in base alla potenza (1 ogni 10), Street Cred, vittoria con 7 Gig all'inizio del turno, overtime dopo il 7º turno, sconfitta per mazzo vuoto, mulligan, chi inizia con 2 Leggende spese. In due sullo stesso dispositivo le decisioni del difensore si aprono solo dopo un suo tocco, così l'attaccante non vede le sue carte.

Effetti delle carte: l'interprete (`parser.js`) legge il testo e lo trasforma in operazioni. Copre gli inneschi {Play}/{Call}/{Attack}/{Defeated}/{Spend} (anche sui Gear equipaggiati: Overwatch, Kiroshi Optics, Dying Night), gli eventi («When this Unit steals a Gig…», «When this/a friendly Unit uses Blocker…», «When this Unit wins/loses a fight…», «When this Unit or Legend is spent…», «When you roll in a Gig…», «At the end/start of your turn…», «The first time … each turn»), le condizioni («If you control a value-pair / a Gig with 8+ value / an even and an odd Gig…», «If you have more ☆ than a Rival», «If a Rival controls more Gigs than you», «If all friendly Legends are face-up», «If your fixer area is empty», «If 5 or more friendly Units and/or Legends are equipped»…, anche con «instead» e «Otherwise»), i conteggi («for each friendly face-up Legend / Gig with an odd value / Unit in your trash…»), gli sconti sul costo («Play this Unit for -1 €$ for each…», il primo Gear CYBERWARE del turno di Viktor, il Go Solo scontato di Nocturne, il prossimo Programma di Alt, l'abilità di Johnny), le aure di potenza (Saul Bright, Saburo, Meredith) e le restrizioni temporanee («can't attack until your next turn», «can't ready», «must attack next turn if it can», i limiti al furto di Chrome Fang e Westbrook Netrunner). Operazioni: pesca, trash, vendi dal mazzo, prepara Eddies/Unità/Leggende, ±potenza (anche a tutte le Unità rivali), Gig ±N, scambio e copia di Gig, ruba un Gig, sconfiggi/spendi/bottom-deck Unità con vari filtri, scarti propri e del rivale, ricerca nel mazzo, recupero dal trash, gioca gratis dalla mano o dal trash, Chiamata gratis (anche della Leggenda appena guardata, Arasaka Emergency Radioport), Blocker/Adrenaline temporanei, «scegli un effetto» (con «choose both instead» e con la scelta lasciata al rivale), «puoi pagare/scartare/sconfiggere un Gear: se lo fai…», gli effetti «la prossima volta che… in questo turno» (Appetite for Destruction, Safety Override, Reboot Optics), la condanna di Cyberpsychosis, il ritiro del dado di Kerry, la rivelazione decisa dal rivale (Fool on the Hill), il tipo da indovinare di Misty, la difesa di Alt Cunningham («scarta una carta con costo pari al Gig e non viene rubato») e il sacrificio di Jackie Welles («paga 1 €$: esce dal gioco al posto dell'Unità»). **Tutte le 151 carte hanno gli effetti eseguiti dal motore**; il registro mostra ogni innesco con la carta che lo produce. Gli strumenti manuali esistono nel codice (`MANUAL` in `sim.js`) ma sono spenti. `fuzz.test.mjs` fa giocare al bot 300 partite con mazzi casuali per scovare errori negli effetti.

Pagamenti: di base il giocatore sceglie cosa spendere toccando sulla plancia gli Eddies o le Leggende (con la scorciatoia «Tutto con Eddies» e «Annulla»); nel profilo si può attivare il pagamento automatico, che chiede conferma solo quando dovrebbe spendere una Leggenda scoperta con un'abilità Spend ancora utilizzabile.

Nota sul Gear: il motore somma la potenza del Gear a quella dell'Unità equipaggiata.

## Import delle liste

«Importa testo» accetta una carta per riga, per nome (`3 Mantis Blades`, `2x Japantown Jonin`, `Legend: V: Streetkid`) o per codice stampato sulla carta (`3 WNC-025`, `MS01 025`, `SD01-004 x2`, `EBP-001`, oppure il solo numero, riferito al set principale). Codici riconosciuti: WNC/MS01 (Welcome to Night City), HEI/SD01 (starter The Heist), EBP/SD02 (starter Embracing Power), PRM01, PRR/PRR02 (prerelease), EOR/EOR01 (Edgerunner Open), NCB/NCB01 (Night City Brawl), BT (box topper). Le righe non riconosciute vengono mostrate nell'editor del mazzo.

Collezione: «Importa collezione» accetta lo stesso formato (testo incollato o file .txt/.csv/.json) in modalità **Aggiorna** (somma alle copie possedute) o **Sostituisci** (azzera e ricarica); «Esporta testo» produce la lista con i codici, pronta da reimportare o da portare altrove. Il JSON esportato da **Deckrunners** (`entries` con `printingId` tipo `MS01-025` e `copies`) viene letto direttamente, sia per la collezione sia incollato in «Importa testo» del deckbuilder; in generale vanno bene array o oggetti con `entries`/`cards`/`collection`/`items`, quantità in `copies`/`qty`/`quantity`/`count` e carta identificata da codice, set + numero o nome.

Nel Simulator si scelgono solo i mazzi in regola (3 Leggende, 40–50 carte entro i limiti RAM, oppure le regole del sealed): le bozze restano nel deckbuilder, dove il pulsante «Gioca» si attiva quando il mazzo è completo.

## Regole, Prerelease e tutorial

La scheda **Regole** ha due viste: «In breve» (quello che serve per la prima partita) ed «Estensive» (tutto il regolamento in 14 sezioni, riscritto, con in coda le letture che il simulatore applica dove la guida non entra nel dettaglio), più i collegamenti alla guida ufficiale. Nel Simulator, **Prerelease** apre un kit come quello reale (6 buste da 12 carte con 7 comuni, 3 non comuni e 2 rare-o-meglio, un pacchetto di 3 Leggende, il promo Gorilla Arms) e crea un mazzo *sealed* nel deckbuilder: almeno 30 carte di massimo 3 colori, senza limiti di RAM né di copie, Leggende libere; «Gioca» lo fa affrontare un bot che ha aperto un kit a sua volta. Il **tutorial** è una partita guidata contro il bot, con seme fisso e mano iniziale garantita (una carta vendibile e un'Unità da ≤2 €$, anche dopo il mulligan): la barra indica il passo da fare e nei passi «fai X» le altre azioni sono disabilitate, così non ci si può bloccare; non si chiude finché non si arriva all'ultimo passo. Scegliendo un mazzo Prerelease nel simulatore l'avversario è sempre il bot con il kit abbinato a quel mazzo.

## Scanner della collezione

Dalla Collection, «Scanner» apre la fotocamera. In modalità continua l'app legge di continuo l'inquadratura con Tesseract.js (scaricato dalla CDN la prima volta, ≈4 MB, poi resta in memoria), abbina nome e testo di regole alle 151 carte del catalogo e, quando la stessa carta viene riconosciuta in due letture consecutive con punteggio ≥ 70%, la mette nella **lista di scansione**; per contare un'altra copia della stessa carta basta allontanarla e riavvicinarla. La lista si rivede (quantità, stampa, rimozione) e si aggiunge alla collezione in blocco; resta salvata se si chiude l'app a metà. Restano «Scatta» (una lettura con i candidati) e «Da foto». Le varianti (Secret, Iconic, Nova Rare) vengono riconosciute confrontando l'illustrazione inquadrata con quelle di tutte le stampe della carta; a parità di arte (beta e retail) si propone la stampa predefinita, modificabile toccando la miniatura.

## Prossimi passi possibili

- Scanner: riconoscimento della variante (set + numero) e inquadratura continua senza premere «Scatta».
- Account e sincronizzazione (Supabase) per avere collezione e mazzi su più dispositivi.
- Mazzi meta: appena un sito esporrà le liste dei tornei in formato leggibile (oggi: link a ExBurst, Ripperdeck e Choom.gg e importazione del testo).
- Immagini dall'API ufficiale Netdeck quando l'accesso sarà aperto (lista d'attesa).
