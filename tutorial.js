/* Tutorial a lezioni. Ogni lezione è una partita guidata e ripetibile: mazzi e seme fissi, spesso una
   situazione già pronta sulla plancia («stage») e, dove serve, le mosse dell'IA scritte in anticipo
   («bot»), così la lezione va sempre allo stesso modo. Una barra sopra la plancia dice cosa fare; i passi
   si completano da soli quando lo stato della partita lo mostra (o con «Avanti» per quelli informativi),
   e nei passi «fai X» le altre mosse sono bloccate con un avviso.

   Le lezioni si sbloccano una dopo l'altra; chi alla prima apertura dice che non è la sua prima notte a
   Night City le trova già tutte aperte. Il progresso sta in S.settings.tut = { asked, vet, done: [id…] }. */

import { streetCred, power, hasKw } from "./engine.js";

/* ------------------------------------------------------------ mazzi */
const STARTER_A = "theheistretailstarterdeck", STARTER_B = "embracingpowerretailstarterdeck";
// per nome (anche solo l'inizio): le Leggende si cercano tra le Leggende, le altre carte tra le altre (Dexter DeShawn è entrambe)
const byName = (DATA, n, legend = false) => { const ok = c => (c.type === "Legend") === legend; return DATA.cards.find(c => ok(c) && c.dn === n) || DATA.cards.find(c => ok(c) && c.dn.startsWith(n)); };
/* un mazzo fatto di nomi: 3 Leggende e le carte (con quante copie); il resto lo riempie una carta qualsiasi */
function namedDeck(DATA, name, legends, cards, filler = "Kiroshi Optics"){
  const L = legends.map(n => byName(DATA, n, true)).filter(Boolean).map(c => ({ cid: c.id, pid: c.def.id }));
  const out = [];
  for(const [n, k] of cards){ const c = byName(DATA, n); if(c) out.push({ cid: c.id, pid: c.def.id, n: k }); }
  const f = byName(DATA, filler); if(f) out.push({ cid: f.id, pid: f.def.id, n: 20 });
  return { name, legends: L, cards: out };
}

/* ------------------------------------------------------------ situazione già pronta
   Le carte vengono prese per nome dal mazzo (o dalle Leggende) della partita appena creata, così sono
   istanze vere del motore. side = { hand:[nomi], field:[{n, spent, lag}], eddies:[ready, spent],
   gigs:[[lati, valore]…], fixer:[lati…], legends:[{n, faceUp, spent}], trash:[nomi], turns } */
let GIG = 9000;
function stage(G, spec){
  const take = (P, n) => { const i = P.deck.findIndex(c => c.card.dn === n || c.card.dn.startsWith(n)); return i >= 0 ? P.deck.splice(i, 1)[0] : null; };
  for(const [i, s] of [[0, spec.me], [1, spec.rival]]){
    if(!s) continue;
    const P = G.players[i];
    P.deck.push(...P.hand); P.hand = []; P.mulliganed = true;
    if(s.hand) for(const n of s.hand){ const c = take(P, n); if(c) P.hand.push(c); }
    if(s.field) for(const f of s.field){ const c = take(P, f.n); if(c) P.field.push({ ...c, spent: !!f.spent, lag: !!f.lag, mod: 0, gear: [], lagRival: false }); }
    if(s.eddies){ const [r, sp] = s.eddies; for(let k = 0; k < r + sp; k++){ const c = P.deck.pop(); if(c) P.eddies.push({ ...c, spent: k >= r }); } }
    if(s.trash) for(const n of s.trash){ const c = take(P, n); if(c) P.trash.push(c); }
    if(s.gigs) P.gigs = s.gigs.map(([sides, value]) => ({ sides, value, uid: GIG++ }));
    if(s.fixer) P.fixer = s.fixer.slice();
    if(s.legends){
      const order = [];
      for(const l of s.legends){ const j = P.legends.findIndex(x => !order.includes(x) && (x.card.dn === l.n || x.card.dn.startsWith(l.n))); if(j >= 0){ const x = P.legends[j]; x.faceUp = !!l.faceUp; x.spent = !!l.spent; order.push(x); } }
      for(const x of P.legends) if(!order.includes(x)) order.push(x);
      P.legends = order;
    }
    if(s.top) for(const n of s.top.slice().reverse()){ const c = take(P, n); if(c) P.deck.unshift(c); }   // le prossime carte da pescare
    P.turns = s.turns ?? 3; P.sold = !!s.sold; P.called = !!s.called; P.skipReadyLegends = false;
  }
  G.phase = "main"; G.pending = null; G.active = spec.active ?? 0; G.first = spec.first ?? 0; G.turn = spec.turn ?? 6;
  if(spec.overtime) G.overtime = true;
  G.log.push({ text: spec.log || "— Situazione della lezione —", kind: "turn" });
}

/* ------------------------------------------------------------ mosse dell'IA scritte in anticipo
   bot: [[mosse del 1º turno dell'IA], [mosse del 2º]…]; una mossa è { t:"attack", u:"nome", to:"gigs"|"nome" },
   { t:"play", c:"nome" } o { t:"sell", c:"nome" }. Finite le mosse del turno, l'IA passa. */
function scripted(G, pi, part){
  const P = G.players[pi], R = G.players[1 - pi];
  part._bt = part._bt || { turn: null, k: -1, i: 0 };
  const st = part._bt; if(st.turn !== G.turn){ st.turn = G.turn; st.k++; st.i = 0; }
  const list = (part.bot || [])[st.k] || [];
  const m = list[st.i++]; if(!m) return { t: "end" };
  const find = (arr, n) => arr.find(x => x.card.dn === n || x.card.dn.startsWith(n));
  if(m.t === "attack"){ const u = find(P.field, m.u); if(!u) return { t: "end" }; if(m.to === "gigs") return { t: "attack", uid: u.uid, target: { kind: "gigs" } }; const t = find(R.field, m.to); return t ? { t: "attack", uid: u.uid, target: { kind: "unit", uid: t.uid } } : { t: "end" }; }
  if(m.t === "play"){ const c = find(P.hand, m.c); return c ? { t: "play", uid: c.uid } : scripted(G, pi, part); }
  if(m.t === "sell"){ const c = find(P.hand, m.c); return c ? { t: "sell", uid: c.uid } : scripted(G, pi, part); }
  return { t: "end" };
}

/* ------------------------------------------------------------ evidenziazioni ricorrenti */
const HL = {
  strip: ".bstrip", stacks: ".bz.mine .brow:not(.field):not(.hand) .stack, .rs.mine .stack", eddies: "[data-eddies='0']",
  legends: ".bz.mine [data-legend], .rs.mine [data-legend]", dice: ".bz.mine .dice, .rs.mine .dice", rdice: ".bz.rival .dice, .rs.rival .dice",
  field: ".bz.mine .brow.field", hand: ".bz.mine .brow.hand", rfield: ".bz.rival .brow.field", log: "#bLog",
};
const me0 = G => G.players[0], ai = G => G.players[1];
const fieldHas = (P, n) => P.field.some(u => u.card.dn.startsWith(n));

/* ------------------------------------------------------------ lezioni */
export const LESSONS = [
  { id: "basi", title: "Le basi", sub: "Una plancia già apparecchiata: cosa sono le zone, le carte e i dadi. Niente da giocare, solo da guardare.",
    parts: [{
      decks: DATA => [namedDeck(DATA, "Tu", ["V: Corporate Exile", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Dexter DeShawn", 2], ["Secondhand Bombus", 2], ["Floor It", 2], ["Psycho Squad", 2], ["Delamain Cab", 1], ["Zetatech Faceplate", 2]]),
                      namedDeck(DATA, "IA", ["Goro Takemura: Hands Unclean", "Saburo Arasaka", "Yorinobu Arasaka: Embracing"], [["Ruthless Lowlife", 2], ["Corpo Security", 2], ["Mantis Blades", 2]], "Industrial Assembly")],
      stage: { active: 0, turn: 5, me: { field: [{ n: "Dexter DeShawn" }, { n: "Secondhand Bombus", spent: true }], hand: ["Floor It", "Kiroshi Optics", "Psycho Squad", "Delamain Cab", "Zetatech Faceplate"], eddies: [2, 1], gigs: [[4, 3], [6, 5]], fixer: [8, 10, 12, 20], legends: [{ n: "V: Corporate Exile", faceUp: true }, { n: "Viktor" }, { n: "Jackie" }], trash: ["Dexter DeShawn"], sold: true, turns: 3 },
               rival: { field: [{ n: "Ruthless Lowlife" }, { n: "Corpo Security", spent: true }], eddies: [1, 1], gigs: [[4, 2], [8, 6]], fixer: [6, 10, 12, 20], hand: ["Mantis Blades", "Industrial Assembly", "Industrial Assembly", "Corpo Security"], turns: 2 } },
      lock: true,
      steps: [
        { t: "Benvenuto a Night City, choom. Questa è la plancia: in alto il rivale (l'IA), in basso tu. Per ora non si gioca: guardiamo cosa c'è.", info: true },
        { t: "La barra del turno: di chi è il turno, l'ultima mossa, «Fine turno», il registro ≡ (tutto quello che è successo) e il menù ⋯.", info: true, hl: HL.strip },
        { t: "Le tue pile. Mazzo: da qui peschi 1 carta a ogni turno. Trash: le carte usate o sconfitte (toccalo per vederle). Se devi pescare e il mazzo è vuoto, perdi.", info: true, hl: HL.stacks },
        { t: "€$ sono gli Eddies, la moneta: pronti/totali. Li ottieni vendendo una carta col simbolo €$ (una a turno) e li spendi per giocare le carte. A ogni tuo turno tornano tutti pronti.", info: true, hl: HL.eddies },
        { t: "Le tue 3 Leggende. Coperte valgono 1 €$ ciascuna per pagare. Con la Chiamata (1 €$) ne scopri una a caso e ne usi l'effetto; V qui è già scoperta. Alcune possono scendere in campo con Go Solo.", info: true, hl: HL.legends },
        { t: "I dadi. Quelli tratteggiati sono il fixer: a ogni inizio turno ne tiri uno e diventa un Gig (dado pieno). Il numero dopo ☆ è lo Street Cred, la somma dei tuoi Gig.", info: true, hl: HL.dice },
        { t: "Anche il rivale ha i suoi Gig. Gli attacchi servono a rubarli: vince chi inizia il proprio turno con 7 Gig.", info: true, hl: HL.rdice },
        { t: "Il campo: qui stanno le tue Unità. Dexter è pronta (dritta) e può attaccare; Secondhand Bombus è spesa (girata) e si preparerà al tuo prossimo turno.", info: true, hl: HL.field },
        { t: "Il campo del rivale. Puoi attaccare il suo Corpo Security perché è speso; il Ruthless Lowlife è pronto, quindi lo si può attaccare solo… quando si sarà speso anche lui.", info: true, hl: HL.rfield },
        { t: "La mano. In alto a sinistra di ogni carta il costo in €$, in basso la potenza ⚡ (per le Unità), il simbolo €$ dice che si può vendere. Unità vanno in campo, Gear si equipaggiano, Programmi fanno un effetto e finiscono nel Trash.", info: true, hl: HL.hand },
        { t: "Tieni premuta una carta per vederla grande, oppure toccala per le azioni e la «Scheda carta». Provalo pure, poi «Avanti».", info: true, hl: HL.hand },
        { t: "Ecco le basi. Nella prossima lezione giochi un turno vero, passo per passo.", info: true, last: true },
      ] }] },

  { id: "turno", title: "Un turno, passo per passo", sub: "Partita vera, con le animazioni rallentate: tiro del fixer, vendita, Eddies, giocare, chiamare, attaccare e reagire.",
    parts: [{
      decks: () => "starters", seed: 20771, first: 1, ensure: true, slow: true,
      steps: [
        { t: "Prima di iniziare decidi se tenere la mano: con 6 carte di costo basso di solito si tiene. Il mulligan rimescola la mano nel mazzo e ne pesca 6 nuove.", done: G => G.players.every(p => p.mulliganed) },
        { bar: "bottom", t: "Inizia l'IA: guarda il suo turno. Ogni turno ha tre momenti: si prepara tutto, si pesca 1 carta e si tira un dado dal fixer, che diventa un Gig.", done: (G, me) => G.active === me && G.phase === "main" && !G.pending },
        { t: "Il tuo turno! Hai già pescato e tirato il dado. Ora vendi una carta: trascinala sulla pila €$ (o toccala → «Vendi»). Diventa 1 Eddie, qualunque fosse il suo costo; una sola a turno.", only: "sell", done: (G, me) => G.players[me].eddies.length >= 1, hl: HL.eddies },
        { t: "Gli Eddies pagano i costi; contano anche le Leggende pronte (1 €$ ciascuna). Gioca un'Unità con potenza (per esempio Dexter DeShawn): trascinala sul campo o toccala → «Gioca», poi paga toccando Eddies o Leggende.", only: "playUnit", done: (G, me) => G.players[me].field.length >= 1, hl: HL.hand },
        { t: "Un'Unità appena giocata ha il Lag: attaccherà dal prossimo turno. Ora chiama una Leggenda: tocca una Leggenda coperta → «Chiama» (1 €$). La scopri e ne attivi l'effetto {Call}. Una Chiamata per turno, anche nel turno del rivale.", only: "call", done: (G, me) => G.players[me].legends.some(l => l.faceUp), hl: HL.legends },
        { bar: "bottom", t: "Quando hai finito premi «Fine turno». L'IA gioca il suo turno: guarda cosa fa nella barra e nel registro (≡).", only: "end", done: (G, me) => G.active !== me && G.players[me].turns >= 1, hl: HL.strip },
        { t: "Secondo turno: le tue carte spese si preparano, peschi e tiri un altro dado. Vendi di nuovo e gioca Secondhand Bombus, l'Unità con {Blocker}: ti servirà per difenderti.", only: "playBlocker", done: (G, me) => G.active === me && G.players[me].field.some(u => hasKw(u, "Blocker")) },
        { t: "Attacca: tocca l'Unità giocata al primo turno → «Attacca l'area Gig». Con potenza 1–9 rubi un Gig, 10–19 due, 20+ tre: scegli tu quale. Se il rivale ha Unità spese puoi invece attaccarle: lo scontro lo vince la potenza più alta.", only: "attack", done: (G, me) => G.players[me].field.some(u => u.spent && !hasKw(u, "Blocker")) || G.players[me].gigs.length >= 3 },
        { bar: "bottom", t: "Premi «Fine turno» e tieni gli occhi aperti: ora l'IA ha Unità pronte e attaccherà. Il Lag di Bombus finisce con il tuo turno, quindi potrà bloccare.", only: "end", done: (G, me) => G.active !== me },
        { reactBar: true, t: "L'IA attacca: reagisci! Blocca con Secondhand Bombus (l'attacco va su di lei), oppure chiama una Leggenda coperta (1 €$) o usa una carta {Quick} dalla mano. Puoi reagire anche più volte.", done: (G, me) => G.active === me && G.players[me].turns >= 3 },
        { t: "Ecco un turno completo. Continua a giocare se vuoi; quando sei pronto chiudi la lezione: la prossima parla di come si vince.", info: true, last: true },
      ] }] },

  { id: "vittoria", title: "Come si vince", sub: "I 7 Gig, il turno del rivale in mezzo e l'overtime: due situazioni già pronte.",
    parts: [{
      decks: DATA => [namedDeck(DATA, "Tu", ["V: Corporate Exile", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Psycho Squad", 2], ["Dexter DeShawn", 2]]),
                      namedDeck(DATA, "IA", ["Goro Takemura: Hands Unclean", "Saburo Arasaka", "Yorinobu Arasaka: Embracing"], [["Swordwise Huscle", 3], ["Ruthless Lowlife", 2]], "Industrial Assembly")],
      stage: { active: 0, turn: 9, me: { field: [{ n: "Psycho Squad" }], hand: ["Dexter DeShawn"], eddies: [4, 0], gigs: [[4, 3], [6, 5], [8, 6], [10, 2], [12, 9], [6, 4]], fixer: [20], legends: [{ n: "V: Corporate Exile", faceUp: true }, { n: "Viktor" }, { n: "Jackie" }], sold: true, turns: 5 },
               rival: { field: [], hand: ["Swordwise Huscle", "Ruthless Lowlife"], eddies: [3, 0], gigs: [[4, 1], [6, 3], [8, 2], [10, 7], [12, 4]], fixer: [20], turns: 5 } },
      bot: [[{ t: "play", c: "Swordwise Huscle" }]],
      steps: [
        { t: "Situazione: hai 6 Gig, l'IA 5. Si vince iniziando il proprio turno con 7 Gig: ti manca un furto.", info: true, hl: HL.dice },
        { t: "Attacca l'area Gig con Psycho Squad (potenza 6 = un Gig) e scegli quale rubare.", only: "attack", to: "gigs", done: G => me0(G).gigs.length >= 7 },
        { t: "Hai 7 Gig, ma non hai ancora vinto: devi arrivarci all'inizio del tuo prossimo turno. Nel suo turno l'IA proverà a riprenderne uno.", info: true, hl: HL.dice },
        { bar: "bottom", t: "Premi «Fine turno». L'IA non ha Unità pronte per attaccare: guarda cosa fa.", only: "end", done: G => G.winner != null },
        { t: "Vittoria! Hai iniziato il turno con 7 Gig. Ora l'overtime: «Avanti».", info: true, next: true },
      ] }, {
      decks: DATA => [namedDeck(DATA, "Tu", ["V: Corporate Exile", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Psycho Squad", 2], ["Dexter DeShawn", 2]]),
                      namedDeck(DATA, "IA", ["Goro Takemura: Hands Unclean", "Saburo Arasaka", "Yorinobu Arasaka: Embracing"], [["Swordwise Huscle", 3]], "Industrial Assembly")],
      stage: { active: 0, turn: 15, overtime: true, log: "— Overtime —", me: { field: [{ n: "Psycho Squad" }], eddies: [5, 0], gigs: [[4, 3], [6, 5], [8, 6], [10, 2], [12, 9], [20, 11]], fixer: [], legends: [{ n: "V: Corporate Exile", faceUp: true }, { n: "Viktor" }, { n: "Jackie" }], sold: true, turns: 8 },
               rival: { field: [{ n: "Swordwise Huscle", spent: true }], eddies: [4, 0], gigs: [[4, 1], [6, 3], [8, 2], [10, 7], [12, 4], [20, 15]], fixer: [], turns: 8 } },
      steps: [
        { t: "Overtime: dopo il 7º turno di entrambi la partita va a morte improvvisa. Chi arriva a 7 Gig vince subito, senza aspettare il proprio turno.", info: true, hl: HL.strip },
        { t: "Siete 6 a 6 e i fixer sono vuoti: i Gig si fanno solo rubando. Attacca l'area Gig con Psycho Squad.", hl: HL.rdice, only: "attack", to: "gigs", done: G => G.winner != null },
        { t: "Vittoria immediata. Ricorda anche il deck-out: chi deve pescare da un mazzo vuoto perde. Lezione finita!", info: true, last: true },
      ] }] },

  { id: "speciali", title: "Casi particolari", sub: "Potenza 10+ e potenza 0, Blocker e Quick, Go Solo, una Leggenda chiamata in risposta per vincere uno scontro.",
    parts: [{
      decks: DATA => [namedDeck(DATA, "Tu", ["V: Corporate Exile", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Animals Wrecker", 1], ["Psycho Squad", 1], ["Evelyn Parker: Scheming Siren", 1]]),
                      namedDeck(DATA, "IA", ["Goro Takemura: Hands Unclean", "Saburo Arasaka", "Yorinobu Arasaka: Embracing"], [["Ruthless Lowlife", 2]], "Industrial Assembly")],
      stage: { active: 0, turn: 8, me: { field: [{ n: "Animals Wrecker" }, { n: "Psycho Squad" }, { n: "Evelyn Parker" }], eddies: [3, 0], gigs: [[4, 3], [6, 2]], fixer: [8, 10, 12, 20], legends: [{ n: "V: Corporate Exile", faceUp: true }, { n: "Viktor" }, { n: "Jackie" }], sold: true, turns: 4 },
               rival: { field: [{ n: "Ruthless Lowlife", spent: true }], eddies: [3, 0], gigs: [[4, 2], [6, 6], [8, 5]], fixer: [10, 12, 20], turns: 4 } },
      steps: [
        { t: "Più potenza, più Gig: un attacco all'area Gig ne ruba 1 con potenza 1–9, 2 con 10–19, 3 con 20 o più. Animals Wrecker ha 10.", info: true, hl: HL.field },
        { t: "Attacca l'area Gig con Animals Wrecker e ruba due Gig.", only: "attack", to: "gigs", onlyUnit: "Animals Wrecker", done: G => me0(G).gigs.length >= 4 },
        { t: "Ora uno scontro: il Ruthless Lowlife del rivale è speso, quindi attaccabile. Attaccalo con Psycho Squad (6 contro 4): vince la potenza più alta e chi perde viene sconfitto.", hl: HL.rfield, only: "attack", to: "unit", onlyUnit: "Psycho Squad", done: G => !fieldHas(ai(G), "Ruthless Lowlife") },
        { t: "Evelyn Parker ha potenza 0: può attaccare, ma un'Unità a 0 non ruba Gig e in uno scontro perde contro chiunque abbia almeno 1. Le Unità a 0 servono per i loro effetti.", info: true, next: true },
      ] }, {
      decks: DATA => [namedDeck(DATA, "Tu", ["V: Corporate Exile", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Corpo Security", 1], ["Reboot Optics", 1], ["Dexter DeShawn", 1]]),
                      namedDeck(DATA, "IA", ["Goro Takemura: Hands Unclean", "Saburo Arasaka", "Yorinobu Arasaka: Embracing"], [["Psycho Squad", 1]], "Industrial Assembly")],
      stage: { active: 1, turn: 9, log: "— Turno dell'IA —", me: { field: [{ n: "Corpo Security" }, { n: "Dexter DeShawn", spent: true }], hand: ["Reboot Optics"], eddies: [3, 0], gigs: [[4, 3], [6, 2], [8, 7]], fixer: [10, 12, 20], legends: [{ n: "V: Corporate Exile", faceUp: true, spent: true }, { n: "Viktor", spent: true }, { n: "Jackie", spent: true }], turns: 4 },
               rival: { field: [{ n: "Psycho Squad" }], eddies: [2, 0], gigs: [[4, 2], [6, 6]], fixer: [8, 10, 12, 20], turns: 5, sold: true } },
      bot: [[{ t: "attack", u: "Psycho Squad", to: "gigs" }]],
      steps: [
        { t: "È il turno dell'IA e il suo Psycho Squad (6) sta per attaccare i tuoi Gig. Tu hai Corpo Security, un'Unità con {Blocker}, e in mano Reboot Optics, una carta {Quick}.", info: true, hl: HL.rfield + ", " + HL.field, bar: "bottom" },
        { t: "Prima la carta Quick: nella finestra di reazione scegli «Quick: Reboot Optics» (2 €$). La prossima volta che un'Unità rivale combatte non sconfigge la tua.", react: "quick", done: G => !me0(G).hand.some(c => c.card.dn.startsWith("Reboot")) },
        { t: "Ora blocca con Corpo Security: l'attacco finisce su di lei invece che sui tuoi Gig. Perde lo scontro (2 contro 6), ma Reboot Optics la salva.", react: "block", done: G => G.log.some(e => /blocca/.test(e.text || "")) },
        { t: "Nessun Gig rubato e Corpo Security è ancora viva. I Blocker si usano solo se sono pronti, e una carta Quick si può giocare anche nel turno del rivale, quando si apre la finestra di reazione.", info: true, next: true },
      ] }, {
      decks: DATA => [namedDeck(DATA, "Tu", ["Goro Takemura: Hands Unclean", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Dexter DeShawn", 1]]),
                      namedDeck(DATA, "IA", ["Saburo Arasaka", "Yorinobu Arasaka", "Wakako Okada"], [["Ruthless Lowlife", 1]], "Industrial Assembly")],
      stage: { active: 0, turn: 10, me: { field: [], eddies: [6, 0], gigs: [[4, 3], [6, 2], [8, 7]], fixer: [10, 12, 20], legends: [{ n: "Viktor", faceUp: true }, { n: "Jackie", faceUp: true }, { n: "Goro Takemura" }], sold: true, turns: 5 },
               rival: { field: [], eddies: [2, 0], gigs: [[4, 2], [6, 6], [10, 4]], fixer: [8, 12, 20], turns: 5 } },
      steps: [
        { t: "Go Solo: alcune Leggende possono entrare in campo come Unità. Prima va scoperta: chiama la tua Leggenda coperta (1 €$). È Goro Takemura.", only: "call", done: G => me0(G).legends.some(l => l.faceUp && l.card.dn.startsWith("Goro")) },
        { t: "Ora trascina Goro sul campo (o toccalo → «Go Solo»): paghi il suo costo e entra pronto, senza Lag. Se lascia il campo viene rimosso dal gioco.", only: "gosolo", done: G => me0(G).field.some(u => u.isLegend) },
        { t: "Goro può attaccare subito: attacca l'area Gig.", only: "attack", to: "gigs", done: G => me0(G).gigs.length >= 4 },
        { t: "Ecco il Go Solo: una Leggenda forte in campo dal turno stesso. Avanti per l'ultimo caso.", info: true, next: true },
      ] }, {
      decks: DATA => [namedDeck(DATA, "Tu", ["Wakako Okada", "Viktor Vektor", "Jackie Welles: Pour One Out"], [["Dexter DeShawn", 1]]),
                      namedDeck(DATA, "IA", ["Saburo Arasaka", "Yorinobu Arasaka", "Goro Takemura: Hands Unclean"], [["Offduty Malfini", 1]], "Industrial Assembly")],
      stage: { active: 1, turn: 11, log: "— Turno dell'IA —", me: { field: [{ n: "Dexter DeShawn", spent: true }], eddies: [2, 0], gigs: [[4, 3], [6, 2], [8, 7]], fixer: [10, 12, 20], legends: [{ n: "Viktor", faceUp: true, spent: true }, { n: "Jackie", faceUp: true, spent: true }, { n: "Wakako" }], turns: 5 },
               rival: { field: [{ n: "Offduty Malfini" }], eddies: [2, 0], gigs: [[4, 2], [6, 6]], fixer: [8, 10, 12, 20], turns: 6, sold: true } },
      bot: [[{ t: "attack", u: "Offduty Malfini", to: "Dexter DeShawn" }]],
      steps: [
        { t: "L'IA attacca il tuo Dexter DeShawn, speso, con Offduty Malfini: 5 contro 4, perderesti. Ma hai una Leggenda coperta e 1 €$.", info: true, hl: HL.rfield + ", " + HL.legends, bar: "bottom" },
        { t: "Reagisci chiamando la Leggenda: è Wakako Okada. Scegli l'effetto «-2 potenza a un'Unità rivale» e dallo a Offduty Malfini.", react: "call", choice: /-2/, done: G => me0(G).legends.some(l => l.faceUp && l.card.dn.startsWith("Wakako")) && !(G.pending && G.pending.player === 0 && G.pending.kind !== "block") },
        { t: "Ora non reagire più: lo scontro è 3 contro 4 e vince Dexter.", react: "none", done: G => !fieldHas(ai(G), "Offduty Malfini") },
        { t: "Ribaltato! Le Chiamate in risposta a un attacco cambiano gli scontri: ricordati che le Leggende coperte possono sempre sorprendere. Lezione finita.", info: true, last: true },
      ] }] },

  { id: "libera", title: "Partita libera", sub: "Una partita intera con i due mazzi starter, contro l'IA. Nessuna guida: si gioca e basta.",
    parts: [{ decks: () => "starters", free: true,
      steps: [{ t: "Partita libera con i mazzi starter. Buona fortuna, choom: chiudi questa barra quando vuoi.", info: true, last: true, done: G => G.winner != null }] }] },
];

/* ------------------------------------------------------------ stato */
let active = false, L = null, part = 0, idx = 0;
export const tutorialActive = () => active;
export const lesson = () => L;
export const lessonPart = () => (L ? L.parts[part] : null);
export function startLesson(id, p = 0){ L = LESSONS.find(x => x.id === id) || LESSONS[0]; part = p; idx = 0; active = true; const P = L.parts[part]; P._bt = null; return P; }
export function stopTutorial(){ active = false; }
export const startTutorial = () => startLesson("turno");   // compatibilità
export const TUTORIAL_SEED = 20771;
export const tutorialSlow = () => active && !!(lessonPart() || {}).slow;
export const tutorialTour = () => active && !!(lessonPart() || {}).lock && !!curStep().info;
const curStep = () => (L && L.parts[part].steps[idx]) || {};
export const tutorialHighlight = () => active ? curStep().hl || "" : "";

/* progresso: lezioni completate, sbloccate */
export function tutProgress(S){ const t = S.settings.tut || {}; return { asked: !!t.asked, vet: !!t.vet, done: Array.isArray(t.done) ? t.done : [] }; }
export function unlocked(S, i){ const t = tutProgress(S); return t.vet || i === 0 || t.done.includes(LESSONS[i - 1].id); }
export function markDone(S, id){ const t = tutProgress(S); if(!t.done.includes(id)) t.done.push(id); S.settings.tut = t; S.save("settings"); }

/* la plancia della lezione: mazzi, seme, situazione */
export function lessonSetup(DATA){ const P = lessonPart(); return { decks: P.decks(DATA), seed: P.seed ?? 4000 + LESSONS.indexOf(L) * 10 + part, first: P.first ?? 0, ensure: !!P.ensure, staged: !!P.stage, free: !!P.free }; }
export function lessonStage(G){ const P = lessonPart(); if(P && P.stage) stage(G, P.stage); }
export const lessonScripted = () => active && !!(lessonPart() || {}).bot;
export const lessonBotAction = (G, pi) => scripted(G, pi, lessonPart());

/* la mano della lezione «turno» deve sempre permettere i passi: una carta vendibile, un'Unità
   con potenza da 3 €$ o meno e Secondhand Bombus (l'Unità con Blocker) */
export function ensureHand(G, me){
  const P = G.players[me];
  const need = [c => c.card.eddiable && c.card.type !== "Unit", c => c.card.type === "Unit" && (c.card.power ?? 0) >= 1 && (c.card.cost ?? 0) <= 3, c => c.card.type === "Unit" && hasKw(c, "Blocker") && (c.card.cost ?? 0) <= 2];
  for(const test of need){
    if(P.hand.some(test)) continue;
    const i = P.deck.findIndex(test); if(i < 0) continue;
    const card = P.deck.splice(i, 1)[0];
    const j = P.hand.findIndex(c => !need.some(t2 => t2(c))); const out = j >= 0 ? P.hand.splice(j, 1)[0] : P.hand.pop();
    P.hand.push(card); if(out) P.deck.push(out);
  }
}
/* azioni permesse nel passo corrente: nei passi «fai X» si può fare solo X (e pagare); nelle lezioni
   «da guardare» niente; altrimenti tutto. obj: la carta (o l'Unità che attacca); to: il bersaglio dell'attacco */
export function tutorialAllows(kind, obj, to){
  if(!active) return true;
  const s = curStep(), P = lessonPart();
  if(kind === "pay") return true;
  if(kind === "react") return !s.react || true;
  if(P.lock) return false;
  const only = s.only; if(!only) return !s.react;   // durante una reazione guidata non si fa altro
  if(only === "playUnit") return kind === "play" && obj && obj.card.type === "Unit" && (obj.card.power ?? 0) >= 1;
  if(only === "playBlocker") return kind === "sell" || (kind === "play" && obj && obj.card.type === "Unit" && hasKw(obj, "Blocker"));
  if(only === "attack" && kind === "attack") return (!s.onlyUnit || !obj || obj.card.dn.startsWith(s.onlyUnit)) && (!s.to || !to || to === s.to);   // to: "gigs" o "unit", se il passo chiede un bersaglio preciso
  return kind === only;
}
/* nelle reazioni guidate si accetta solo l'opzione del passo (call, quick, block, none) */
export function tutorialAllowsOption(pending, opt){
  if(!active) return true;
  const s = curStep(); if(!pending) return true;
  if(s.choice && pending.kind !== "block") return !opt || !opt.label || s.choice.test(opt.label) || !pending.options.some(o => o.label && s.choice.test(o.label));
  if(!s.react || pending.kind !== "block") return true;
  return opt && opt.kind === s.react;
}
/* avanza se il passo corrente risulta completato; ritorna "next" (parte successiva), "end" (lezione finita), true o false */
export function tutorialStep(G, me, force = false){
  if(!active || !G) return false;
  const s = curStep();
  if(force || (s.done && s.done(G, me))){
    if(s.last){ return force ? "end" : false; }
    if(s.next){ return force ? "next" : false; }
    idx++; return true;
  }
  return false;
}
export function nextPart(){ if(!L || part + 1 >= L.parts.length) return null; part++; idx = 0; const P = L.parts[part]; P._bt = null; return P; }
export function tutorialBarHTML(G, me, fx = false){
  const s = curStep(), P = lessonPart(), n = P.steps.length;
  const btn = s.last ? (P.free ? "Chiudi la guida" : "Lezione completata") : s.next ? "Avanti" : s.info ? "Avanti" : "";
  const id = s.last ? "tutDone" : s.next ? "tutPart" : "tutNext";
  // nelle reazioni: con le grafiche avanzate si reagisce toccando le carte (anche in mano) → barra in alto;
  // senza, le opzioni sono in una finestra al centro → barra in basso
  const pos = (s.react || s.reactBar) ? (fx ? "top" : "bottom") : s.bar || (/rival/.test(s.hl || "") ? "bottom" : "top");
  return `<div class="tutbar ${pos}"><span class="n"><b>${esc(L.title)}</b><small>${L.parts.length > 1 ? `${part + 1}/${L.parts.length} · ` : ""}${idx + 1}/${n}</small></span><span class="tx">${s.t}</span>
    ${btn ? `<button class="btn sm yel" id="${id}">${btn}</button>` : ""}</div>`;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const tutorialHTML = () => "";
export { streetCred, power };
