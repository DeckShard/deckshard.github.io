/* Interprete del testo delle carte: trasforma le frasi in operazioni per il
   motore. Copre inneschi ({Play}, {Call}, {Attack}, {Defeated}, {Spend}),
   eventi ("When this Unit steals a Gig…", "At the end of your turn…"),
   condizioni ("If you control a value-pair…"), conteggi ("for each…"),
   sconti sul costo e modificatori statici di potenza. Ciò che non capisce
   resta «manuale» e viene segnalato nel registro.                        */

const cap = w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
const N = w => ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[String(w).toLowerCase()] ?? +w);

/* ---------------- condizioni: chiave + parametri; il motore le valuta */
const CONDS = [
  [/^you control a gig with an even value and a gig with an odd value$/i, () => ({ c: "evenAndOdd" })],
  [/^you control a gig with (\d+)\+ value$/i, m => ({ c: "gigAtLeast", n: +m[1] })],
  [/^you control a gig with an (even|odd) value$/i, m => ({ c: "gigParity", p: m[1].toLowerCase() })],
  [/^you control a value-pair( of gigs)?$/i, () => ({ c: "valuePair" })],
  [/^you control (\d+) or more gigs with different values$/i, m => ({ c: "distinctGigs", n: +m[1] })],
  [/^you control (?:a|at least one) (?:friendly )?min gig$/i, () => ({ c: "minGig" })],
  [/^you control (\d+) or more (?:friendly )?min gigs$/i, m => ({ c: "minGigsCount", n: +m[1] })],
  [/^you control 2 or more gigs with 8\+ value$/i, () => ({ c: "gigsAtLeastCount", v: 8, n: 2 })],
  [/^you have (more|less) ☆ than a rival$/i, m => ({ c: "credCmp", d: m[1].toLowerCase() })],
  [/^your ☆ is an even number$/i, () => ({ c: "credEven" })],
  [/^your ☆ differs from a rival's by (\d+)\+$/i, m => ({ c: "credDiff", n: +m[1] })],
  [/^a rival controls at least (\d+) (?:more gigs than you|gigs more than you)$/i, m => ({ c: "rivalMoreGigs", n: +m[1] })],
  [/^a rival controls more gigs than you$/i, () => ({ c: "rivalMoreGigs", n: 1 })],
  [/^all friendly legends are face-up$/i, () => ({ c: "allLegendsUp" })],
  [/^this unit has power (\d+)\+$/i, m => ({ c: "selfPower", n: +m[1] })],
  [/^you played a program this turn$/i, () => ({ c: "playedProgram" })],
  [/^this unit is spent$/i, () => ({ c: "selfSpent" })],
  [/^this unit is named "([^"]+)"$/i, m => ({ c: "selfNamed", name: m[1] })],
  [/^(?:it's|this unit is|that unit is) equipped$/i, () => ({ c: "selfEquipped" })],
  [/^this unit stole a gig this turn$/i, () => ({ c: "selfStoleThisTurn" })],
  [/^its value is (even|odd)$/i, m => ({ c: "ctxGigParity", p: m[1].toLowerCase() })],
  [/^it becomes a min gig$/i, () => ({ c: "ctxGigMin" })],
  [/^it's a d20$/i, () => ({ c: "ctxGigSides", n: 20 })],
  [/^it's a program$/i, () => ({ c: "ctxCardType", t: "Program" })],
  [/^that gear's cost equals the value of a friendly gig$/i, () => ({ c: "ctxCostEqualsGig" })],
  [/^its cost equals the value of a friendly gig$/i, () => ({ c: "ctxCostEqualsGig" })],
  [/^that unit is an ai, drone, or vehicle$/i, () => ({ c: "ctxUnitCls", cls: ["AI", "DRONE", "VEHICLE"] })],
  [/^it's a rocker unit$/i, () => ({ c: "ctxUnitCls", cls: ["ROCKER"] })],
  [/^5 or more friendly units and\/or legends are spent$/i, () => ({ c: "spentCount", n: 5 })],
  [/^(\d+) or more friendly units and\/or legends are equipped$/i, m => ({ c: "equippedCount", n: +m[1] })],
  [/^you have less than (\d+) ☆$/i, m => ({ c: "credLess", n: +m[1] })],
  [/^a friendly d4 is a min gig$/i, () => ({ c: "d4Min" })],
  [/^your fixer area is empty$/i, () => ({ c: "fixerEmpty" })],
  [/^you do$/i, () => ({ c: "did" })],
  [/^the total number of discarded cards equals the value of a friendly gig$/i, () => ({ c: "discardedEqualsGig" })],
  [/^the card's cost equals the value of a friendly gig$/i, () => ({ c: "ctxCostEqualsGig" })],
  [/^that legend is arasaka or has \{go solo\}$/i, () => ({ c: "peekedTag", cls: "ARASAKA", kw: "Go Solo" })],
];
export function parseCond(s){
  s = s.replace(/\s+/g, " ").replace(/\(street cred\)/i, "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  for(const [rx, mk] of CONDS){ const m = s.match(rx); if(m) return mk(m); }
  return null;
}

/* ---------------- conteggi "for each …" */
const COUNTERS = [
  [/^friendly face-up legends?$/i, () => "faceUpLegends"],
  [/^friendly value-pairs? of gigs$/i, () => "valuePairs"],
  [/^friendly gigs? with an even value$/i, () => "evenGigs"],
  [/^friendly gigs? with an odd value$/i, () => "oddGigs"],
  [/^friendly gigs? with (\d+)\+ value$/i, m => ({ k: "gigsAtLeast", n: +m[1] })],
  [/^friendly min gigs?$/i, () => "minGigs"],
  [/^units? in your trash$/i, () => "unitsInTrash"],
  [/^of a rival[’']s units$/i, () => "rivalUnits"],
  [/^of its equipped gears?$/i, () => "selfGears"],
  [/^of its equipped gear$/i, () => "selfGears"],
];
function parseCounter(s){
  s = s.trim().replace(/\.$/, "");
  for(const [rx, mk] of COUNTERS){ const m = s.match(rx); if(m) return mk(m); }
  return null;
}

/* ---------------- effetti di una frase */
const RX = [
  [/^draw (\d+)$/i, m => ({ op: "draw", n: +m[1] })],
  [/^give a rival unit -(\d+) power this turn$/i, m => ({ op: "debuff", n: +m[1] })],
  [/^give all rival units -(\d+) power this turn$/i, m => ({ op: "debuffAll", n: +m[1] })],
  [/^a rival unit loses power equal to this unit's power this turn$/i, () => ({ op: "debuff", eq: "selfPower" })],
  [/^bottom-deck a rival unit with power (\d+)$/i, m => ({ op: "bottomDeck", who: "rival", maxPower: +m[1] })],
  [/^bottom-deck all rival units with power (\d+)$/i, m => ({ op: "bottomDeckAll", who: "rival", maxPower: +m[1] })],
  [/^that rival discards (\d+) more$/i, m => ({ op: "rivalDiscard", n: +m[1] })],
  [/^spend a rival unit for each (.+)$/i, m => ({ op: "spend", per: parseCounter(m[1]) })],
  [/^you may defeat (\d+) instead$/i, m => ({ op: "repeatPrev", n: +m[1] - 1 })],
  [/^a rival unit must attack next turn if it can$/i, () => ({ op: "mustAttack" })],
  [/^a unit can't attack until your next turn$/i, () => ({ op: "cantAttackUntil", any: true })],
  [/^a friendly legend may use \{go solo\} for -(\d+) €\$ this turn, to a minimum of (\d+) €\$$/i, m => ({ op: "goSoloDiscount", n: +m[1], min: +m[2] })],
  [/^your next program this turn plays for -(\d+) €\$ for each friendly min gig, to a minimum of (\d+) €\$$/i, m => ({ op: "nextProgramDiscount", n: +m[1], min: +m[2] })],
  [/^a rival unit steals (\d+) fewer gigs? this turn$/i, m => ({ op: "stealLess", n: +m[1] })],
  [/^the next time a friendly unit wins a fight by (\d+)\+ power this turn, it also steals a gig$/i, m => ({ op: "flag", flag: "winBySteal", n: +m[1] })],
  [/^the next time a rival unit fights this turn, it doesn't defeat the opposing friendly unit$/i, () => ({ op: "flag", flag: "noDefeatNextFight" })],
  [/^the next time a friendly unit loses a fight this turn, defeat the opposing rival unit$/i, () => ({ op: "flag", flag: "punishNextLoss" })],
  [/^if that unit steals or fights, defeat it at the end of this turn$/i, () => ({ op: "doomLast" })],
  [/^until your next turn, rival units can't steal friendly gigs with value higher than their power$/i, () => ({ op: "stealLimit", who: "units", mode: "higher" })],
  [/^until your next turn, rival legends can't steal friendly gigs with value less than their power$/i, () => ({ op: "stealLimit", who: "legends", mode: "less" })],
  [/^you may decrease a (?:friendly )?gig by up to (\d+)$/i, m => ({ op: "gig", n: +m[1], mode: "down" })],
  [/^defeat a spent rival unit with cost equal to or less than the discarded card's cost$/i, () => ({ op: "defeat", spentOnly: true, by: "cost", maxFrom: "discarded" })],
  [/^this unit gains power equal to that card's cost this turn$/i, () => ({ op: "buffSelf", eq: "revealedCost" })],
  [/^ready them$/i, () => ({ op: "readyEquipped" })],
  [/^you may ignore the result and reroll it once$/i, () => ({ op: "rerollOnce" })],
  [/^(?:then, )?you may look at a friendly face-down legend$/i, () => ({ op: "peekLegend", pick: true })],
  [/^you may call it for free$/i, () => ({ op: "freeCall", peeked: true })],
  [/^they instead choose one effect for you$/i, () => ({ op: "rivalChooses" })],
  [/^draw (\d+) for each (.+)$/i, m => ({ op: "draw", n: +m[1], per: parseCounter(m[2]) })],
  [/^trash (\d+)$/i, m => ({ op: "mill", n: +m[1] })],
  [/^trash the top card of your deck$/i, () => ({ op: "mill", n: 1 })],
  [/^sell the top card of your deck$/i, () => ({ op: "sellTop" })],
  [/^ready (\d+) eddies?$/i, m => ({ op: "readyEddies", n: +m[1] })],
  [/^ready this unit$/i, () => ({ op: "readySelf" })],
  [/^ready it$/i, () => ({ op: "readySelf" })],
  [/^ready this unit or legend$/i, () => ({ op: "readyHost" })],
  [/^ready up to (\d+) friendly units$/i, m => ({ op: "readyUnits", n: +m[1] })],
  [/^ready up to (\d+) (\w+) legends in your legends area$/i, m => ({ op: "readyLegends", n: +m[1], cls: m[2].toUpperCase() })],
  [/^ready a friendly face-up legend$/i, () => ({ op: "readyLegends", n: 1 })],
  [/^ready another friendly unit with power equal to the gig's value$/i, () => ({ op: "readyUnitPower", eq: "ctxGig" })],
  [/^give a friendly unit \+(\d+) power this turn$/i, m => ({ op: "buff", n: +m[1] })],
  [/^give a friendly unit \+(\d+) power this turn for each (.+)$/i, m => ({ op: "buff", n: +m[1], per: parseCounter(m[2]) })],
  [/^give an equipped unit \+(\d+) power this turn for each (.+)$/i, m => ({ op: "buff", n: +m[1], per: parseCounter(m[2]), equipped: true })],
  [/^(?:give this unit|this unit has) \+(\d+) power this turn$/i, m => ({ op: "buffSelf", n: +m[1] })],
  [/^(?:give this unit|this unit has) \+(\d+) power this turn for each (.+)$/i, m => ({ op: "buffSelf", n: +m[1], per: parseCounter(m[2]) })],
  [/^(?:also )?give it \+(\d+) power this turn$/i, m => ({ op: "buffLast", n: +m[1] })],
  [/^this unit gains power equal to a friendly max gig this turn$/i, () => ({ op: "buffSelf", eq: "maxGig" })],
  [/^give a friendly unit with cost (\d+) or less \{?blocker\}? this turn$/i, m => ({ op: "grantKw", kw: "Blocker", maxCost: +m[1] })],
  [/^give another friendly unit with cost (\d+) or less \{?adrenaline\}? this turn$/i, m => ({ op: "adrenaline", maxCost: +m[1] })],
  [/^increase a gig by up to (\d+)$/i, m => ({ op: "gig", n: +m[1], mode: "up" })],
  [/^increase it by up to (\d+)$/i, m => ({ op: "gig", n: +m[1], mode: "up", ctx: true })],
  [/^decrease a (?:friendly )?gig by up to (\d+)$/i, m => ({ op: "gig", n: +m[1], mode: "down" })],
  [/^adjust a gig by (?:up to )?(\d+)$/i, m => ({ op: "gig", n: +m[1], mode: "adj" })],
  [/^defeat all other units$/i, () => ({ op: "defeatAllOther" })],
  [/^defeat a rival unit with power (\d+) or less$/i, m => ({ op: "defeat", max: +m[1], by: "power" })],
  [/^defeat a rival unit with cost (\d+) or less$/i, m => ({ op: "defeat", max: +m[1], by: "cost" })],
  [/^defeat a rival unit with less power than a friendly unit$/i, () => ({ op: "defeat", lessThanFriendly: true })],
  [/^defeat a rival unit$/i, () => ({ op: "defeat" })],
  [/^defeat a unit with power equal to or less than the value of a friendly d20$/i, () => ({ op: "defeat", any: true, by: "power", maxFrom: "d20" })],
  [/^defeat a rival gear with power (\d+) or less$/i, m => ({ op: "defeatGear", max: +m[1] })],
  [/^defeat a spent unit$/i, () => ({ op: "defeat", spentOnly: true, any: true })],
  [/^defeat the opposing rival unit$/i, () => ({ op: "defeatOpponent" })],
  [/^each player defeats one of their units$/i, () => ({ op: "eachDefeats" })],
  [/^each player discards their hand and may draw 5$/i, () => ({ op: "eachRedraw", n: 5 })],
  [/^spend all rival units$/i, () => ({ op: "spendAll" })],
  [/^spend a rival unit with cost (\d+) or less$/i, m => ({ op: "spend", max: +m[1] })],
  [/^spend a rival unit$/i, () => ({ op: "spend" })],
  [/^spend this unit and a rival unit$/i, () => [{ op: "spendSelf" }, { op: "spend" }]],
  [/^it can't ready until your next turn$/i, () => ({ op: "lockLast" })],
  [/^a rival unit can't ready until your next turn$/i, () => ({ op: "spendLock", onlyLock: true })],
  [/^a rival unit can't attack until your next turn$/i, () => ({ op: "cantAttackUntil" })],
  [/^a rival discards (\d+)$/i, m => ({ op: "rivalDiscard", n: +m[1] })],
  [/^discard (\d+)$/i, m => ({ op: "discard", n: +m[1] })],
  [/^then,? discard (\d+)$/i, m => ({ op: "discard", n: +m[1] })],
  [/^bottom-deck a rival(?:'s)? (unequipped )?unit$/i, m => ({ op: "bottomDeck", who: "rival", unequipped: !!m[1] })],
  [/^bottom-deck a rival'?s lowest-power unit$/i, () => ({ op: "bottomDeck", who: "rival", lowest: true })],
  [/^bottom-deck a spent rival unit$/i, () => ({ op: "bottomDeck", who: "rival", spentOnly: true })],
  [/^bottom-deck a ready friendly unit$/i, () => ({ op: "bottomDeck", who: "friendly", readyOnly: true })],
  [/^bottom-deck this unit$/i, () => ({ op: "bottomDeckSelf" })],
  [/^return this unit to its owner's hand$/i, () => ({ op: "bounceSelf" })],
  [/^add another unit from your trash to your hand$/i, () => ({ op: "fromTrash", type: "Unit", notSelf: true })],
  [/^add a card from your trash to your hand$/i, () => ({ op: "fromTrash", type: "Card" })],
  [/^you may add a card from your trash to your hand$/i, () => ({ op: "fromTrash", type: "Card" })],
  [/^play (?:a|another) (\w+ )?(unit|gear|program) with cost (\d+) or less from your (hand or trash|trash|hand) for free$/i, m => ({ op: "playFree", cls: m[1] ? m[1].trim().toUpperCase() : null, type: cap(m[2]), maxCost: +m[3], from: m[4].toLowerCase() })],
  [/^play up to (\d+) units with cost (\d+) or less from your trash for free$/i, m => ({ op: "playFree", type: "Unit", maxCost: +m[2], from: "trash", k: +m[1] })],
  [/^play a program from your trash$/i, () => ({ op: "playFree", type: "Program", maxCost: 99, from: "trash", pay: true })],
  [/^you may call a legend for free$/i, () => ({ op: "freeCall" })],
  [/^then,? you may call a legend for free$/i, () => ({ op: "freeCall" })],
  [/^swap a friendly gig with a rival gig$/i, () => ({ op: "swapGig" })],
  [/^you may swap a friendly gig with a rival gig$/i, () => ({ op: "swapGig" })],
  [/^set a player's gig to the same value as another player's gig$/i, () => ({ op: "setGigLike" })],
  [/^you may set a gig's value to the value of another gig$/i, () => ({ op: "setGigLike" })],
  [/^steal a rival gig with a value not shared by a friendly gig$/i, () => ({ op: "stealGig", unshared: true })],
  [/^it also steals a gig$/i, () => ({ op: "stealGig" })],
  [/^reveal the top card of your deck$/i, () => ({ op: "revealTop" })],
  [/^add it to your hand$/i, () => ({ op: "takeRevealed" })],
  [/^otherwise,? add it to your hand$/i, () => ({ op: "takeRevealed", ifNotPlayed: true })],
  [/^you may play it for free$/i, () => ({ op: "playRevealed" })],
  [/^you may add it to your hand$/i, () => ({ op: "takeRevealed", may: true })],
  [/^add (\d+) to your hand$/i, m => ({ op: "takeRevealed", k: +m[1] })],
  [/^look at a friendly face-down legend$/i, () => ({ op: "peekLegend" })],
  [/^look at all friendly face-down legends$/i, () => ({ op: "peekLegend", all: true })],
  [/^this unit can attack rival units the turn it's played$/i, () => ({ op: "noLag", onlyUnits: true })],
  [/^it can attack rival units this turn$/i, () => ({ op: "noLagLast", onlyUnits: true })],
  [/^a friendly unit can attack spent rival units the turn it's played$/i, () => ({ op: "grantNoLag" })],
  [/^move a gear from this legend to an unequipped friendly unit$/i, () => ({ op: "moveGear" })],
];

/* ---------------- schemi su più frasi (si applicano dall'inizio della riga) */
const LINE_RX = [
  [/^search the top (\d+) cards? of your deck\.\s*reveal (up to (\d+)|an?|any number of) (unit|gear|program|card)s?( with cost (\d+) or less)?( with cost equal to any friendly gig values)? and add (?:them|it) to your hand\.\s*bottom-deck the rest( in a random order)?\.?/i,
    m => ({ op: "searchTop", n: +m[1], k: m[3] ? +m[3] : /any number/i.test(m[2]) ? 99 : 1, type: cap(m[4]), maxCost: m[6] ? +m[6] : null, costEqGig: !!m[7], random: !!m[8] })],
  [/^search the top (\d+) cards? of your deck\.\s*add (\d+) to your hand\.\s*you may add 1 more for each friendly min gig\.\s*bottom-deck the rest\.?/i, m => ({ op: "searchTop", n: +m[1], k: +m[2], type: "Card", maxCost: null, perMin: true })],
  [/^search the top (\d+) cards? of your deck and trash them\.?/i, m => ({ op: "mill", n: +m[1] })],
  [/^search the top card of your deck\.\s*you may trash it\.?/i, () => ({ op: "mayMillTop" })],
  [/^trash (\d+)\.\s*(?:then, )?add (?:an?|1) (?:([A-Z]{3,}) )?(unit|gear|program|card) from (among them|your trash) to your hand\.?/i,
    m => [{ op: "mill", n: +m[1] }, { op: "fromTrash", cls: m[2] ? m[2].toUpperCase() : null, type: cap(m[3]), milled: /among/i.test(m[4]) }]],
  [/^you may defeat a friendly gear\.\s*if you do, draw (\d+)\.\s*otherwise, draw (\d+)\.?/i, m => ({ op: "mayDefeatGearDraw", yes: +m[1], no: +m[2] })],
  [/^you may defeat a friendly gear\.\s*if you do, (.+?\.)/i, m => ({ op: "mayDo", kind: "defeatFriendlyGear", then: parseBody(m[1]) })],
  [/^you may defeat a gear\.\s*(if its cost equals the value of a friendly gig, draw (\d+)\.)?/i, m => ({ op: "mayDo", kind: "defeatAnyGear", then: m[1] ? [{ op: "draw", n: +m[2], cond: { c: "ctxCostEqualsGig" } }] : [] })],
  [/^you may pay (\d+) €\$\.\s*if you do, (.+?\.)/i, m => ({ op: "mayDo", kind: "pay", n: +m[1], then: parseBody(m[2]) })],
  [/^you may discard (\d+) programs?\.\s*if you do, (.+?\.)/i, m => ({ op: "mayDo", kind: "discardPrograms", n: +m[1], then: parseBody(m[2]) })],
  [/^you may discard 1 with cost equal to that gig's value\.\s*if you do, the gig isn't stolen\.?/i, () => ({ op: "manualText" })],
  [/^play a (unit|gear|program) with cost (\d+) or less from your hand for free\.?/i, m => ({ op: "playFree", type: cap(m[1]), maxCost: +m[2], from: "hand" })],
  [/^you may play a program with cost (\d+) or less from your (hand or trash|trash|hand) for free\.\s*bottom-deck it after you play it\.?/i, m => ({ op: "playFree", type: "Program", maxCost: +m[1], from: m[2].toLowerCase(), bottomAfter: true })],
  [/^play a (\w+) gear with cost (\d+) or less from your trash for free\.\s*equip it only to another friendly unit\.?/i, m => ({ op: "playFree", type: "Gear", cls: m[1].toUpperCase(), maxCost: +m[2], from: "trash", onlyOtherUnits: true })],
  [/^you may play a (unit|gear|program) with cost (\d+) or less from your (hand or trash|trash|hand) for free\.\s*(it can attack rival units this turn\.)?/i, m => ({ op: "playFree", type: cap(m[1]), maxCost: +m[2], from: m[3].toLowerCase(), noLagUnits: !!m[4] })],
  [/^reveal the top card of your deck and add it to your hand\.\s*/i, () => [{ op: "revealTop" }, { op: "takeRevealed" }]],
  [/^reveal the top (\d+) cards of your deck\.\s*a rival chooses whether you add them to your hand or trash them\.\s*if you trash them, draw (\d+)\.?/i, m => ({ op: "revealRivalChoice", n: +m[1], draw: +m[2] })],
  [/^search the top (\d+) cards of your deck and trash (\d+)\.?/i, m => ({ op: "searchTrash", n: +m[1], k: +m[2] })],
  [/^choose a card type\.\s*then, reveal the top card of your deck\.\s*if it's the chosen type, add it to your hand and ready (\d+) eddie\.\s*otherwise, trash it\.?/i, m => ({ op: "chooseTypeReveal", eddies: +m[1] })],
  [/^you may discard (\d+)\.\s*if you do, (.+?\.)/i, m => ({ op: "mayDo", kind: "discard", n: +m[1], then: parseBody(m[2]) })],
  [/^play a program from your trash\.\s*bottom-deck it after you play it\.?/i, () => ({ op: "playFree", type: "Program", maxCost: 99, from: "trash", pay: true, bottomAfter: true })],
  [/^you may call a legend for free\.?/i, () => ({ op: "freeCall" })],
  [/^swap a friendly gig with a rival gig\.?/i, () => ({ op: "swapGig" })],
  [/^set a player's gig to the same value as another player's gig\.?/i, () => ({ op: "setGigLike" })],
  [/^spend a rival unit\.\s*it can't ready until your next turn\.?/i, () => ({ op: "spend", lock: true })],
  [/^reveal the top card of your deck\.\s*you may play it for free\.\s*otherwise, add it to your hand\.?/i, () => [{ op: "revealTop" }, { op: "playRevealed", elseTake: true }]],
  [/^move a gear from this legend to an unequipped friendly unit\.\s*if you do, ready that unit\.?/i, () => ({ op: "moveGear", readyIt: true })],
  [/^bottom-deck a ready friendly unit\.\s*if you do, bottom-deck a spent rival unit\.?/i, () => ({ op: "bottomDeck", who: "friendly", readyOnly: true, then: [{ op: "bottomDeck", who: "rival", spentOnly: true }] })],
  [/^give a friendly unit these effects\.\s*/i, () => ({ op: "chooseForUnit" })],
  [/^the next time this unit attacks this turn, it may attack ready units\.?/i, () => ({ op: "grantLast", flag: "attackReady" })],
  [/^give this unit \+(\d+) power this turn\.?$/i, m => ({ op: "buffLast", n: +m[1] })],
];

export function parseBody(body){
  const ops = [];
  let rest = body.trim();
  let again = true;
  while(again && rest){
    again = false;
    for(const [rx, mk] of LINE_RX){
      const m = rest.match(rx);
      if(m){ for(const o of [].concat(mk(m))) ops.push({ ...o, text: m[0] }); rest = rest.slice(m[0].length).trim(); again = true; break; }
    }
  }
  const sentences = rest.split(/(?<=\.)\s+/).map(t => t.trim()).filter(Boolean);
  let lastCond = null;
  for(let i = 0; i < sentences.length; i++){
    let t = sentences[i];
    let cond = null, negate = false;
    // "If COND, EFFECT." / "Then, if COND, EFFECT." / "Otherwise, EFFECT."
    let m = t.match(/^(?:then, )?if (.+)$/i);
    if(m && parseOne(t)){ m = null; }   // "If that Unit steals or fights, defeat it…": frase intera già nota
    if(m){
      // la condizione può contenere virgole ("that Unit is an AI, DRONE, or VEHICLE"): prova ogni taglio
      const body = m[1], parts = body.split(", "); let found = null;
      for(let k = 1; k < parts.length && !found; k++){ const c = parseCond(parts.slice(0, k).join(", ")); if(c) found = { cond: c, rest: parts.slice(k).join(", ") }; }
      if(!found){ ops.push({ op: "manual", text: t }); lastCond = null; continue; }
      cond = found.cond; t = found.rest;
    }
    else if((m = t.match(/^otherwise, (.+)$/i)) && lastCond){ cond = lastCond; negate = true; t = m[1]; }
    else if((m = t.match(/^then, (.+)$/i))) t = m[1];
    // "…, EFFETTO instead." sostituisce l'effetto precedente quando la condizione vale
    let instead = false; if(cond && /\s+instead\.?$/i.test(t)){ instead = true; t = t.replace(/\s+instead\.?$/i, "."); }
    const parsed = parseOne(t);
    if(!parsed){ ops.push({ op: "manual", text: cond ? sentences[i] : t }); lastCond = null; continue; }
    if(instead && ops.length) ops[ops.length - 1].skipIf = cond;
    for(const o of [].concat(parsed)){ const x = { ...o, text: sentences[i] }; if(cond){ x.cond = cond; x.negate = negate; } ops.push(x); }
    lastCond = cond && !negate ? cond : null;
  }
  return ops;
}
function parseOne(t){
  t = t.replace(/\.$/, "").trim();
  for(const [rx, mk] of RX){ const m = t.match(rx); if(m){ const r = mk(m); if(Array.isArray(r) ? r.every(Boolean) : r){ if(r.per === null) return null; return r; } } }
  // "draw 1, then discard 1"
  const parts = t.split(/,\s*then\s+/i);
  if(parts.length > 1){ const ops = parts.map(x => parseOne(x)); if(ops.every(Boolean)) return ops.flat(); }
  // "EFFETTO if CONDIZIONE"
  const m = t.match(/^(.+?) if (.+)$/i);
  if(m){ const cond = parseCond(m[2]); const r = parseOne(m[1]); if(cond && r) return [].concat(r).map(o => ({ ...o, cond })); }
  return null;
}

/* ---------------- statici e sconti (da tutto il testo) */
function parseStatics(text, out){
  const clean = text.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if(/this unit can't attack\b(?! unless)/i.test(clean)) out.cantAttack = true;
  if(/can only attack rival units/i.test(clean)) out.onlyUnits = true;
  if(/^this unit can attack rival units the turn it's played\.?$/im.test(text.replace(/\([^)]*\)/g, ""))) out.noLagUnits = true;   // Sandayu Oda: statico, non legato a {Play}
  if(/\{Quick\}/.test(text)) out.quick = true;
  if(/this unit can't attack unless you played a program this turn/i.test(clean)) out.needsProgram = true;
  let m;
  if((m = clean.match(/play this (?:unit|program|gear) for -(\d+) €\$ for each (.+?), to a minimum of (\d+) €\$/i))){ const per = parseCounter(m[2]); if(per) out.costReduce = { n: +m[1], per, min: +m[3] }; }
  if((m = clean.match(/this unit has \+(\d+) power while fighting a legend/i))) out.powerVsLegend = +m[1];
  if((m = clean.match(/other friendly units have \+(\d+) power while attacking/i))) out.auraAttack = { n: +m[1], others: true };
  if((m = clean.match(/friendly (\w+) units have \+(\d+) power while attacking/i))) out.auraAttack = { n: +m[2], cls: m[1].toUpperCase() };
  if((m = clean.match(/a friendly unit has \+(\d+) power for each friendly face-up legend while fighting rival units this turn/i))) out.quickBuffPerLegend = +m[1];
  if((m = clean.match(/during your turn, this legend has \+(\d+) power for each of its equipped gear/i))) out.powerPerGear = +m[1];
  if(/this unit wins all fights against corpo units/i.test(clean)) out.winsVs = "CORPO";
  if((m = clean.match(/if you have (more|less) ☆ (?:\(street cred\) )?than a rival, this unit can't be blocked/i))) out.unblockableIf = { c: "credCmp", d: m[1].toLowerCase() };
  if((m = clean.match(/if you have more ☆ (?:\(street cred\) )?than a rival, this unit can attack ready units with \{blocker\}/i))) out.attackReadyBlockersIf = { c: "credCmp", d: "more" };
  if((m = clean.match(/if a rival controls more gigs than you, this unit can attack their gig area the turn it's played/i))) out.noLagGigsIf = { c: "rivalMoreGigs", n: 1 };
  if((m = clean.match(/if a rival controls at least (\d+) more gigs than you, this unit has \{adrenaline\}/i))) out.adrenalineIf = { c: "rivalMoreGigs", n: +m[1] };
  if(/rival units can't attack the turn they're played/i.test(clean)) out.auraRivalLag = true;
  if(/rivals must pay \+2 €\$ to use \{go solo\}/i.test(clean)) out.goSoloTax = 2;
  if((m = clean.match(/if a rival controls at least (\d+) more gigs than you, play this program for (\d+) €\$/i))) out.costIf = { cond: { c: "rivalMoreGigs", n: +m[1] }, cost: +m[2] };
  if(/if this unit would be defeated, defeat its "deadman transmitter" instead/i.test(clean)) out.deadman = true;
  if(/if a friendly unit would be defeated, you may pay (\d+) €\$ to defeat this legend instead/i.test(clean)) out.saveUnitPay = +clean.match(/pay (\d+) €\$/i)[1];
  if((m = clean.match(/this effect costs -(\d+) €\$ for each (.+?)\./i))){ const per = parseCounter(m[2]); if(per) out.spendCostReduce = { n: +m[1], per }; }
  if((m = clean.match(/play your first (\w+) gear each turn for -(\d+) €\$, to a minimum of (\d+) €\$/i))) out.firstGearDiscount = { cls: m[1].toUpperCase(), n: +m[2], min: +m[3] };
  if(/when a rival unit would steal a gig, you may discard 1 with cost equal to that gig's value/i.test(clean)) out.preventStealDiscard = true;
  if((m = clean.match(/if your fixer area is empty, play this program for (\d+) €\$/i))) out.costIf = { cond: { c: "fixerEmpty" }, cost: +m[1] };
}

/* ---------------- struttura finale */
export function parseEffects(text){
  const out = { play: [], call: [], attack: [], defeated: [], spend: [], passive: [], manual: [],
    on: { steal: [], friendlySteal: [], block: [], winFight: [], loseFight: [], spent: [], hostSpent: [], endTurn: [], startTurn: [], playProgram: [], playBlue: [], firstSpent: [], firstWin: [], firstSteal: [], rivalAdjust: [], legendSteal: [], defeatedFriendly: [], roll: [] },
    quick: false, cantAttack: false, onlyUnits: false };
  if(!text) return out;
  parseStatics(text, out);
  const lines = text.split(/\n/).filter(l => !/^\s*\[Flavou?r/i.test(l)).join("\n").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean)
    .flatMap(l => l.split(/(?<=\.)\s+(?=(?:At the (?:end|start) of your turn,|When |The first time |Until your next turn,|Choose one effect\.))/i));
  let key = "passive", chooseFor = null, chooseBothIf = null;
  for(const l of lines){
    const head = l.replace(/^(\{Quick\}\s*|\d+\s*€\$,?\s*)+/i, "");
    const trig = head.match(/^\{(Play|Call|Attack|Defeated|Spend)\}/i);
    const triggers = (head.match(/^(\{(Play|Call|Attack|Defeated|Spend)\}:?\s*)+/i) || [""])[0].match(/Play|Call|Attack|Defeated|Spend/gi) || [];
    if(trig) key = trig[1].toLowerCase(); else if(!chooseFor) key = "passive";
    let body = l.replace(/^(\{[^}]+\}:?\s*|[\d]+\s*€\$,?\s*)+/g, "").trim();
    const cm = body.match(/^choose one effect\.(?:\s*if (.+?), choose both instead\.?)?$/i);
    if(cm){ chooseFor = key; chooseBothIf = cm[1] ? parseCond(cm[1]) : null; continue; }
    // eventi: "When …, EFFECT" / "At the end of your turn, EFFECT" / "The first time … each turn, EFFECT"
    let ev = null, evCond = null, once = false, m;
    const EV = [
      [/^when this unit steals a gig, (.+)$/i, "steal"], [/^when a friendly unit steals a d(\d+), (.+)$/i, "friendlyStealDie"],
      [/^when a friendly legend steals a gig, (.+)$/i, "legendSteal"], [/^when a friendly (\w+) or (\w+) unit steals 1 or more gigs, (.+)$/i, "friendlyStealCls"],
      [/^when this unit uses \{blocker\}, (.+)$/i, "block"], [/^when a friendly unit uses \{blocker\}, (.+)$/i, "friendlyBlock"],
      [/^when you roll in a gig from your fixer area, (.+)$/i, "rollIn"], [/^when this unit wins a fight(?: against a rival unit)?, (.+)$/i, "winFight"],
      [/^when this unit loses a fight, (.+)$/i, "loseFight"], [/^when this unit or legend is spent, (.+)$/i, "hostSpent"],
      [/^when a friendly equipped unit or legend is spent, (.+)$/i, "anyEquippedSpent"], [/^when a friendly equipped unit is defeated, (.+)$/i, "defeatedFriendlyEquipped"],
      [/^when you play a (\w+) program, (.+)$/i, "playProgramCls"], [/^when a rival adjusts or swaps 1 or more friendly gigs, (.+)$/i, "rivalAdjust"],
      [/^when you roll a min or max value on a gig, (.+)$/i, "roll"],
      [/^at the end of your turn, (.+)$/i, "endTurn"], [/^at the start of your turn, (.+)$/i, "startTurn"],
      [/^the first time this unit is spent each turn, (.+)$/i, "firstSpent"], [/^the first time this unit wins a fight each turn, (.+)$/i, "firstWin"],
      [/^the first time this unit steals 1 or more gigs each turn, (.+)$/i, "firstSteal"], [/^the first time a friendly (\w+) unit attacks each turn, (.+)$/i, "firstClsAttack"],
      [/^the first time an? (\w+) unit is defeated each turn, (.+)$/i, "firstClsDefeated"], [/^the first time you play a blue unit or blue gear each turn, (.+)$/i, "playBlue"],
      [/^the first time another friendly unit steals a gig with value less than its power each turn, (.+)$/i, "firstOtherStealLess"],
      [/^during your turn, you may call a legend for free\.?$/i, "duringTurnFreeCall"],
    ];
    for(const [rx, name] of EV){ m = body.match(rx); if(m){ ev = name; break; } }
    if(ev){
      const rest = m[m.length - 1];
      const ops = parseBody(rest);
      const entry = { ops, text: body };
      if(ev === "friendlyStealDie") entry.die = +m[1];
      if(ev === "friendlyStealCls") entry.cls = [m[1].toUpperCase(), m[2].toUpperCase()];
      if(ev === "playProgramCls") entry.cls = m[1].toUpperCase();
      if(ev === "firstClsAttack") { entry.cls = m[1].toUpperCase(); entry.once = true; }
      if(ev === "firstClsDefeated") { entry.cls = m[1].toUpperCase(); entry.once = true; }
      if(/^first/.test(ev)) entry.once = true;
      const map = { friendlyStealDie: "friendlySteal", friendlyStealCls: "friendlySteal", legendSteal: "legendSteal", anyEquippedSpent: "spent", defeatedFriendlyEquipped: "defeatedFriendly", playProgramCls: "playProgram", firstSpent: "firstSpent", firstWin: "firstWin", firstSteal: "firstSteal", firstClsAttack: "friendlyAttack", firstClsDefeated: "friendlyDefeated", playBlue: "playBlue", firstOtherStealLess: "friendlySteal", duringTurnFreeCall: "none" };
      const bucket = map[ev] || ev;
      if(ev === "duringTurnFreeCall"){ out.freeCallAnytime = true; continue; }
      if(ev === "firstOtherStealLess") entry.lessThanPower = true;
      if(ev === "anyEquippedSpent") entry.equippedOnly = true;
      if(ev === "defeatedFriendlyEquipped") entry.equippedOnly = true;
      (out.on[bucket] = out.on[bucket] || []).push(entry);
      out.manual.push(...ops.filter(o => o.op === "manual").map(o => o.text));
      continue;
    }
    let ops;
    if(body.includes("//")){
      const alts = body.split(/\s*\/\/\s*/).map(a => ({ text: a.trim(), ops: parseBody(a) }));
      ops = [{ op: "choose", alts, text: body, bothIf: chooseBothIf }];
      if(chooseFor){ key = chooseFor; chooseFor = null; chooseBothIf = null; }
    } else ops = parseBody(body);
    // frasi puramente statiche già gestite altrove: non vanno segnalate come manuali
    const STATIC = /^(this unit can't attack|this unit can only attack|play this (unit|program|gear) for -|this unit has \+\d+ power while|other friendly units have|friendly \w+ units have|a friendly unit has \+\d+ power for each|during your turn, this legend has|this unit wins all fights|if you have (more|less) ☆.*can't be blocked|if you have more ☆.*can attack ready units|if a rival controls more gigs than you, this unit can attack|if a rival controls at least \d+ more gigs than you, this unit has|rival units can't attack the turn|rivals must pay|if a rival controls at least \d+ more gigs than you, play this program|if this unit would be defeated, defeat its|this effect costs -|play your first \w+ gear each turn|when a rival unit would steal a gig|if you do, the gig isn't stolen|if a friendly unit would be defeated, you may pay|if your fixer area is empty, play this program|choose one effect|\{adrenaline\}|\{blocker\}|\{go solo\}|["“].*["”]$)/i;
    ops = ops.filter(o => !(o.op === "manual" && STATIC.test(o.text)));
    const keys = triggers.length > 1 ? triggers.map(t => t.toLowerCase()) : [key];
    for(const k of keys){ if(k === "passive") out.passive.push(...ops.filter(o => o.op !== "manual")); else out[k].push(...ops); }
    out.manual.push(...ops.filter(o => o.op === "manual").map(o => o.text));
    if(key === "passive") out.passiveAll = (out.passiveAll || []).concat(ops);
  }
  return out;
}
