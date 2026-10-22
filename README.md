# Basilisk

A first-person / idle proof of concept set in twin clan valleys. You spawn as a gatherer, walk a job circuit, and a fat-tail of XP promotes a few souls to war. The highest XP wears the crown and skims the clan.

This is a fork of the Roadkeep stack. Roadkeep remotes are not used here.

## Play

1. Pick **Blue** or **Red** and a job (Farmer, Hunter, Blacksmith, Lumberjack).
2. Walk the circuit in first person. Food, gold, and wood tick while you move.
3. XP unlocks camera pull-back. A few bodies promote to Runner, Archer, Ward, or Ram.
4. If you are top XP you are King: gather, hold the fords, or hunt (keys `1` `2` `3`).
5. Esc leaves the body gathering. Click it to take first person again. Death waits, then you rejoin as a gatherer.

Clanmates are simulated. Live 60-person shards and a phone store client are out of this slice.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

Third-party asset credits are included in `public/models/kenney/CREDITS.txt`.
