# Matchmaking — piano di lavoro

Stato: **bozza spenta**. Le tabelle e le funzioni ci sono nel database (`supabase.sql`, sezione «matchmaking»), ma l'app non le usa e gli utenti non possono chiamarle.

## Obiettivo

Un pulsante «Cerca partita» nel Simulator → Online:

- trova un avversario con lo stesso formato (Costruito o Prerelease) e la stessa versione dell'app;
- l'avversario ha un punteggio simile;
- la partita parte da sola;
- vittorie e sconfitte di queste partite muovono un punteggio Elo, con una classifica.

## Cosa è già pronto (spento)

| Pezzo | Dove | Cosa fa |
|---|---|---|
| `mm_queue` | tabella | La coda: utente, formato, versione, mazzo, punteggio, ingresso e ultimo segnale. Nessun accesso diretto. |
| `mm_join(deck, ver, autopay)` | funzione | Cerca chi aspetta da più tempo con formato e versione uguali, senza blocchi tra i due e con punteggio entro 100 + 10 punti per ogni secondo di attesa. Se lo trova crea un tavolo già attivo (`rated = true`), altrimenti mette in coda. |
| `mm_poll()` | funzione | Il segnale di chi aspetta. Restituisce il tavolo appena qualcuno l'ha abbinato. Chi tace per 45 secondi esce dalla coda. |
| `mm_leave()` | funzione | Esce dalla coda. |
| `ratings` | tabella | Punteggio (parte da 1200) e partite giocate. Leggibile da chi ha un account. |
| `rate_result` | trigger | A fine partita valutata applica l'Elo (K = 32); la patta vale mezzo punto. |
| `game_tables.rated` | colonna | Distingue le partite da matchmaking da quelle con codice o tra amici. |

Collaudo: `mm_test.py` (12 controlli). Verifica che sia spento per gli utenti, gli abbinamenti per versione, che il tavolo nasca attivo, il segnale di attesa, l'Elo e l'uscita dalla coda.

## I passi, in ordine

### 1. Correttezza delle partite (prima di contare punti)

Oggi ogni telefono gioca la partita con il motore e il database registra solo l'ordine delle mosse. Per le partite amichevoli basta, per una classifica no.

- **Carte nascoste.** Il seme è noto a entrambi, quindi un'app modificata può calcolare la mano e il mazzo dell'avversario. Serve un mescolamento che resta sul server. La strada più semplice è un «arbitro», cioè una Edge Function che tiene il seme, applica le mosse con lo stesso motore (`engine.js` funziona anche in Deno) e manda a ogni giocatore solo ciò che può vedere. È il lavoro più grosso: il motore deve saper gestire carte avversarie «sconosciute».
- **Mosse legali.** L'arbitro rifiuta le mosse che il motore non accetta. Oggi le rifiuta già l'app dell'avversario, ma non il server.
- **Orologi.** Il tempo per turno e per partita lo calcolano i due telefoni dagli orari delle mosse. Chi finisce il tempo lo dichiara da solo, come succede per le sconfitte decise dal motore. Con l'arbitro diventa una decisione del server.
- **Risultato.** Lo dichiara l'arbitro, non più il telefono di chi perde.

Proposta: un arbitro con orologi, mosse legali e risultato (fase 1a), e il mescolamento segreto in un secondo momento (fase 1b). Finché manca la 1b, la classifica va presentata come «beta».

### 2. Interfaccia «Cerca partita»

- In Simulator → Online, una scheda «Cerca partita» con il formato e il mazzo. Durante l'attesa si vede il tempo trascorso e un pulsante «Annulla».
- `mm_join` all'ingresso e `mm_poll` ogni 5 secondi mentre si aspetta (non serve il tempo reale). `mm_leave` all'uscita, alla chiusura dell'app e al passaggio ad altro.
- Quando il tavolo arriva: `attach(row)`, la stessa strada dei tavoli con codice.
- Notifica push «Partita trovata» se l'app è in secondo piano (c'è già il webhook su `game_tables`).
- Opzioni fisse per la coda: una partita, 2 minuti per turno, 20 minuti a testa. Il formato al meglio di 3 resta ai tavoli con codice.

### 3. Classifica

- Vista «Classifica»: i primi 100 per punteggio con almeno 10 partite, più la propria posizione.
- Il punteggio va mostrato nel profilo pubblico e nella lista amici.
- Stagioni: azzeramento morbido ogni 3 mesi (punteggio = 1200 + (punteggio − 1200) / 2).

### 4. Protezioni

- **Chi abbandona la coda dopo l'abbinamento** (tavolo creato, mai giocato): 2 minuti di attesa prima di poter rientrare.
- **Abbandono e disconnessione** valgono sconfitta, come oggi.
- **Accoppiamenti ripetuti:** al massimo 3 partite valutate al giorno contro lo stesso avversario, per evitare di gonfiare il punteggio tra amici.
- **Segnalazioni** dalla fine della partita, che riusano `report_user`.

### 5. Capacità (piano gratuito di Supabase)

- **Tempo reale:** 200 connessioni contemporanee. Ogni partita ne usa 2 per giocatore (tavolo e chat), quindi circa 50 partite insieme. Oltre serve il piano Pro, oppure togliere la chat del tavolo dal canale dedicato.
- **Database:** 500 MB. Ogni partita pesa circa 20–60 KB di mosse, quindi conviene archiviare o cancellare le mosse delle partite chiuse dopo 30 giorni (lavoro notturno).
- **Edge Function:** 500 000 chiamate al mese. Un arbitro chiamato a ogni mossa (circa 200 a partita) regge circa 2 500 partite al mese. Per crescere va valutato un arbitro chiamato solo a fine turno.

### 6. Accensione

1. In `supabase.sql`, cambiare la riga `revoke all on function public.mm_join(...) ...` in `grant execute on function public.mm_join(jsonb, text, boolean), public.mm_poll(), public.mm_leave() to authenticated;` e rieseguire lo script.
2. Pubblicare la versione dell'app con la scheda «Cerca partita».
3. Prima settimana: coda aperta ma classifica nascosta, per raccogliere i dati senza pressione.

## Domande aperte

- **Coda Prerelease:** meglio accoppiare per espansione, o qualunque kit va bene?
- **Partite contro l'IA in classifica?** Proposta: no, restano allenamento.
- **Classifica:** pubblica, solo tra amici, o tutte e due?
