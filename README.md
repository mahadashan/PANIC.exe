# PANIC.exe

**An AI-adaptive reflex arcade game.** Tap the right target before time runs out, while a locally hosted **Gemma 3 4B** (via Ollama) studies your statistics between rounds and mutates the rules to break your habits.

- React + TypeScript + Vite frontend, Three.js WebGL background, HTML targets
- Node + Express backend that is the only thing that talks to Ollama
- 100% local: no cloud AI, no API keys, gameplay stats never leave your machine
- Fully playable when Ollama is off, slow, or returns garbage (deterministic fallbacks)

---

## 1. Requirements

| Tool | Version | Check |
|---|---|---|
| Node.js | 20.12 or newer (developed on 24.20) | `node --version` |
| npm | 10+ | `npm --version` |
| Ollama | any recent version, running on `http://localhost:11434` | `ollama --version` |
| Model | `gemma3:4b` (already installed) | `ollama list` |
| Chrome or Edge | only for the optional browser test | |

The project uses the existing `gemma3:4b` install. It never downloads a model.

## 2. Install

```powershell
cd C:\Users\HP\Documents\hacktoberfest
npm install
```

## 3. Verify the local AI (recommended before a demo)

```powershell
ollama list            # must show gemma3:4b
npm run check:ai       # real inference through the same prompts and validation the server uses
```

`check:ai` prints the mutation Gemma picks for three different player profiles, the response latency, and a sample post-run analysis. It ends with `All live AI checks passed.`

## 4. Launch

### Development (hot reload)

```powershell
npm run dev
```

Open **http://localhost:5173**. This starts the API server on port 8787 and Vite on port 5173 (Vite proxies `/api`). The server pre-loads the model at startup. The start screen shows `GEMMA3:4B · LOCAL · ONLINE` once the model is in memory.

### Production build (single port)

```powershell
npm run build
npm start
```

Open **http://localhost:8787**. Express serves the built client and the API.

## 5. How to play

| Action | Input |
|---|---|
| Start / retry | `Enter` (or click PLAY / RETRY) |
| Tap target 1–4 | mouse, touch, or keys `1` `2` `3` `4` (also `A` `S` `D` `F`) |
| Back to menu | `Esc` |
| Mute | `M` |

Five lives, a 100-second run. Correct taps score `100 + up to 50 speed bonus`, multiplied by the combo multiplier (+0.5× every 5 in a row, max ×4). Wrong taps and timeouts cost a life and reset the combo. Clearing a mutation without a miss adds `300 × intensity`.

**How to win: override the AI.** Clear **3 mutations without a single miss** inside them before your lives or the clock run out. Any miss or timeout during a mutation makes that one count for nothing (the HUD chip shows `FAILED`). The `OVERRIDE ▬▬▬` meter in the HUD tracks progress, and each mutation card shows what's at stake. The deciding mutation is announced as **FINAL MUTATION** and is forced to at least intensity 2 (longer and faster). Winning ends the run immediately with `SYSTEM OVERRIDDEN` and adds **+50 points per second left on the clock**. Losing all lives (`SYSTEM CRASH`) or running out of time (`TIME UP · NO OVERRIDE`) is a loss.

It is meant to be hard, and Gemma escalates to harsher mutations as you play better. A simulation of 400 runs per profile against the real engine gave these win rates:

| Player accuracy (normal / inside mutations) | Win rate |
|---|---|
| 85% / 77% | ~1–3% |
| 90% / 82% | ~4–8% |
| 95% / 87% | ~25% |
| 98% / 90% | ~45–50% |

Tuning lives in `client/src/game/scoring.ts`: `winMutationClears`, `finalMutationMinIntensity`, `winTimeBonusPerSec`.

**Base rules** unlock as you level up: tap a color, tap a symbol, avoid a color, double-tap, tap the previous target's color, and tap a color while ignoring a ★ decoy.

**Mutations** (all deterministic, one at a time):

| Mutation | Tier | Effect |
|---|---|---|
| Double Tap | 1 | Every correct target needs two taps |
| Color Blindness | 1 | Targets lose color; follow the symbol |
| Speed Surge | 2 | Response window shrinks by ~32% |
| Ignore the Star | 2 | A same-color ★ decoy always appears and must be avoided |
| Previous Color | 2 | One-back memory: tap the color shown in the previous round |
| Symbol Override | 3 | Instruction names a color *and* a symbol on different targets; the symbol wins |
| Reverse Colors | 3 | RED ⇄ CYAN, LIME ⇄ AMBER |
| Reverse Instruction | 3 | TAP means AVOID, AVOID means TAP |

## 6. How the AI is used (and kept honest)

```
Game engine ── compact stats summary ──▶ Express ──▶ Ollama (gemma3:4b)
     ▲                                     │
     └── cached, validated challenge ◀─────┘  JSON schema + allowlist + safety limits
```

1. **The model never runs inside the input loop.** Four rounds before a mutation is due, the engine sends a summary of the run so far: accuracy, average and recent reaction time, trend, per-rule seen/missed counts, most-missed rule, most-tapped wrong target, combos, difficulty, lives, and recent mutations. The request is fire-and-forget; the result is cached.
2. **The backend narrows the choices.** It sends Gemma only the mutations allowed for this player's state (tier limits by accuracy and lives, no recent repeats), and constrains decoding with a JSON schema whose `mutationId` is an enum of exactly that list.
3. **Everything returned is validated.** Unknown or disallowed IDs, malformed JSON, and out-of-range or empty fields are all rejected and replaced by a deterministic fallback built from the same statistics. A `reason` that cites a number not present in the stats gets a verified reason instead.
4. **The engine applies its own limits too.** It never repeats a mutation back-to-back, caps intensity for struggling players, and keeps the response window at or above 650 ms.
5. **It never waits on the model.** If Gemma is still thinking when a mutation is due, up to two more normal rounds are played. After that, a fallback challenge is used immediately.
6. **Players can see who chose.** The mutation card shows `CHOSEN BY GEMMA 3 4B · LOCAL` or `FALLBACK PROTOCOL`, with the reason and the canonical rule text. The HUD chip shows `GEMMA` or `FALLBACK`.
7. **Post-run analysis is grounded.** Gemma writes the strongest skill, most frequent mistake, an observation, a taunt, and a tip. Any field that mentions a number not in the recorded stats is replaced with a verified line, and the badge then reads `PARTLY VERIFIED`.

The server logs every decision, which is handy during a demo:

```
[ai] next-challenge AI 3220ms -> speedSurge x2 | "REACT FASTER, YOU SLOW PLAYER!" | Their average reaction time of 568ms ...
[ai] run-analysis AI 3238ms
```

## 7. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API server (watch mode) + Vite dev server |
| `npm run build` | Typecheck + production client build into `dist/` |
| `npm start` | Serve API + built client on port 8787 |
| `npm test` | 50 unit/integration tests (engine, win condition, every mutation, scoring, AI validation, fallbacks, API) |
| `npm run typecheck` | TypeScript only |
| `npm run check` | typecheck + tests + build |
| `npm run check:ai` | Live test against the real `gemma3:4b` |
| `npm run test:e2e -- <url> <outDir>` | Plays a full run in headless Chrome/Edge (keyboard + mouse), saves screenshots, prints AI usage. Needs the app running. |

## 8. Configuration

All optional. Copy `.env.example` to `.env`, or set environment variables:

| Variable | Default |
|---|---|
| `OLLAMA_URL` | `http://localhost:11434` |
| `OLLAMA_MODEL` | `gemma3:4b` |
| `PORT` | `8787` |
| `AI_CHALLENGE_TIMEOUT_MS` | `12000` |
| `AI_ANALYSIS_TIMEOUT_MS` | `25000` |

## 9. Troubleshooting

**Start screen says `AI SERVER OFFLINE · FALLBACK MODE`**
The Express server isn't running. Use `npm run dev` (not `npx vite` alone), or `npm start` after a build.

**Start screen says `OLLAMA OFFLINE · FALLBACK MODE`**
```powershell
ollama serve                                   # or start the Ollama desktop app
curl.exe http://localhost:11434/api/tags       # should list gemma3:4b
```

**Start screen says `gemma3:4b MISSING`**
Check the exact name with `ollama list`. If your model has a different tag, set `$env:OLLAMA_MODEL="<name>"` before `npm run dev`.

**First mutation says FALLBACK PROTOCOL**
The model was still loading. A cold load takes about 15 s on this machine. Wait for `ONLINE` on the start screen, or run `npm run check:ai` once before the demo. The server also pre-loads the model at startup.

**Port already in use**
```powershell
Get-NetTCPConnection -LocalPort 8787,5173 -State Listen | Select-Object LocalPort,OwningProcess
Stop-Process -Id <OwningProcess>
```
Or run on another port: `$env:PORT=8790; npm run dev`. Vite proxies to the same `PORT`.

**`tsx`/`vite` fails with an esbuild error after `npm install`**
Newer npm versions can hold back install scripts. Approve esbuild and reinstall:
```powershell
npm install-scripts approve esbuild
npm install
```

**No WebGL / blank background**
The game detects this and switches to a CSS animated background automatically. To check hardware acceleration in Chrome, visit `chrome://gpu`. To force the fallback for testing: `http://localhost:5173/?nowebgl`.

**No sound**
Browsers block audio until the first interaction. Press PLAY first. `M` toggles mute.

**Demo the offline fallback without stopping Ollama**
```powershell
$env:OLLAMA_URL="http://localhost:9"; npm start
```
Then open http://localhost:8787 (after `npm run build`). Every mutation and the analysis will show the fallback badges.

**Reset best score**
In the browser console: `localStorage.removeItem('panic.bestScore')`.

## 10. Project structure

```
shared/challenges.ts        Single source of truth: colors, symbols, mutation allowlist,
                            zod schemas, safety tiers, deterministic fallbacks, grounding checks
client/src/game/            Deterministic engine (states, timers, scoring, difficulty),
                            round builders for every rule and mutation, stats summarizer
client/src/components/      Start, HUD, targets, mutation overlay, game over (HTML)
client/src/effects/         Three.js scene + CSS fallback background
client/src/services/        AI client (validated, timed out), synthesized sound
server/src/                 Express app, Ollama client, prompts, model-output validation
tests/                      Vitest suites (engine + AI backend with a scriptable fake Ollama)
scripts/check-ai.ts         Live gemma3:4b check
scripts/e2e.ts              Headless browser playthrough
```

Game states: `MENU → COUNTDOWN → PLAYING ⇄ MUTATION_TRANSITION → GAME_OVER → AI_ANALYSIS`. A run ends as `win` (3 flawless mutation clears), `lives`, or `time`. A single `requestAnimationFrame` loop drives every timer through `engine.tick(now)`, so React never owns timers or scoring.
