# Software Requirements Specification (SRS)
## PANIC.exe
**AI-Adaptive Reflex Arcade Game**

**Version:** 1.0  
**Project Type:** Hackathon MVP  
**Platform:** Desktop Web Browser  
**Primary AI Model:** Gemma 3 4B via Ollama  
**Development Deadline:** 5 Hours

---

## 1. Project Overview

### 1.1 Introduction

PANIC.exe is a fast-paced, AI-adaptive reflex game in which players react to changing instructions, flashing targets, and unexpected rule mutations.

The game begins with simple actions, such as clicking a particular color. As the player develops habits, the AI analyzes gameplay statistics and generates personalized challenges designed to test those habits.

The game combines arcade-style gameplay, procedural challenge generation, locally hosted open-weight AI, and polished WebGL visuals.

### 1.2 Problem Statement

Most reflex games use fixed difficulty curves and predictable patterns. PANIC.exe aims to make each run feel personalized by using a locally hosted language model to interpret player behavior and select appropriate challenges.

The game must remain responsive even when AI inference is slow. All live gameplay, scoring, and input validation must be handled by deterministic game logic.

### 1.3 Objectives

- Create an instantly understandable, addictive reflex game.
- Use Gemma 3 4B as a meaningful part of the gameplay experience.
- Use WebGL for animated visuals and a distinctive arcade atmosphere.
- Provide personalized challenge mutations based on player performance.
- Deliver a polished, presentation-ready MVP within five hours.
- Run AI locally through Ollama without requiring a paid AI API.

### 1.4 Target Audience

Hackathon judges, casual players, arcade-game enthusiasts, and users interested in interactive AI applications.

---

## 2. Scope

### 2.1 Included Features

1. Start screen and game instructions.
2. Timed reflex-based gameplay.
3. Multiple colors, symbols, and action rules.
4. Increasing speed and difficulty.
5. AI-generated personalized rule mutations.
6. Gameplay statistics and adaptive challenge selection.
7. Score, combo, lives, and best-score tracking.
8. Game-over screen with a personalized AI analysis.
9. Locally hosted Gemma 3 4B integration through Ollama.
10. WebGL visual effects, animations, and sound feedback.
11. Fallback challenges when AI is unavailable or too slow.

### 2.2 Excluded Features

To protect the five-hour deadline, the MVP will not include:

- Multiplayer or online leaderboards.
- User accounts or authentication.
- Cloud-hosted AI inference.
- Custom model training or fine-tuning.
- Complex physics or large 3D environments.
- Multiple game modes.
- Mobile-specific optimization beyond basic responsive layout.
- A database or external analytics service.

---

## 3. Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript | UI and application state |
| Build tool | Vite | Fast development and production builds |
| Styling | CSS / CSS Modules | Layout, typography, transitions |
| WebGL rendering | Three.js | Animated background, particles, visual effects |
| React-WebGL integration | React Three Fiber, if practical | Integrating Three.js scenes into React |
| Backend | Node.js + Express | Local AI proxy and API validation |
| AI runtime | Ollama | Local model inference |
| AI model | `gemma3:4b` | Behavioral analysis and challenge generation |
| AI communication | Ollama HTTP API | Structured model requests and responses |
| Validation | Zod or equivalent | Validating AI-generated challenge objects |
| Persistence | Browser localStorage | Best score and basic preferences |
| Version control | Git | Source control |

### 3.1 Existing AI Setup

The developer has already installed the following model using Ollama:

`gemma3:4b`

Claude Code must use this existing installation. It must not download another model, substitute a cloud API, or require an API key for a paid provider.

The backend should communicate with Ollama at:

`http://localhost:11434`

The model identifier must be configurable, with `gemma3:4b` as the default.

### 3.2 WebGL Requirement

WebGL is a mandatory visual component.

Three.js should render a lightweight animated background featuring floating geometric objects, subtle depth, particles, and visual reactions to score changes or rule mutations.

The actual buttons and instructions should remain normal HTML elements for reliable clicking, keyboard support, and accessibility.

The game must remain playable if WebGL initialization fails. In that case, the application should use a CSS-based animated background.

Do not build a large 3D world. Visual polish is more important than unnecessary rendering complexity.

---

## 4. Game Design and Mechanics

### 4.1 Core Gameplay Loop

1. The player starts a run.
2. An instruction appears.
3. Three or four interactive targets appear.
4. The player clicks the correct target as quickly as possible.
5. Correct actions increase score and combo.
6. Incorrect actions reduce lives or break the combo.
7. The game gradually increases speed.
8. At suitable round boundaries, an AI-selected rule mutation is introduced.
9. When the player loses all lives or time expires, the game ends.
10. The AI provides a short personalized performance summary.

A typical run should last approximately 30 to 90 seconds.

### 4.2 Initial Rules

The game begins with simple instructions, including:

- Tap the specified color.
- Avoid the specified color.
- Tap a symbol regardless of its color.
- Tap the previous target's color.
- Double-click the indicated target.
- Ignore a specific target type.

These are examples of predefined, testable mechanics. The game engine must explicitly implement every available rule.

### 4.3 Rule Mutations

A rule mutation changes the player's expected action.

Examples:

| Mutation | Effect |
|---|---|
| Reverse Colors | A normally correct color becomes incorrect |
| Symbol Override | Symbols take priority over colors |
| Double Tap | The target must be clicked twice |
| Color Blindness | The player must follow symbols rather than colors |
| Previous Color | The correct choice depends on the previous target |
| Ignore Target | One target type must be avoided |
| Speed Surge | The response window becomes shorter |
| Reverse Instruction | The action rule is inverted |

The MVP should implement approximately five reliable mutations first. Additional mutations should only be added after the core game works.

Mutations must not contradict one another unless the combination has been explicitly implemented and tested.

### 4.4 Difficulty Progression

Difficulty should increase through deterministic rules:

- Targets appear for shorter durations.
- The interval between rounds decreases.
- The number of distractors increases.
- Mutation frequency gradually increases.
- Combo rewards encourage consecutive correct actions.

Difficulty must have sensible upper and lower limits. The game should not become impossible immediately after a successful streak.

### 4.5 Scoring

Suggested initial scoring:

- Correct action: +100 points.
- Fast reaction bonus: up to +50 points.
- Consecutive correct actions: increasing combo multiplier.
- Incorrect action: lose one life and reset the combo.
- Completing a mutation round: bonus points.

The exact scoring constants may be adjusted during testing.

### 4.6 Game States

The application must support these states:

- `MENU`
- `COUNTDOWN`
- `PLAYING`
- `MUTATION_TRANSITION`
- `GAME_OVER`
- `AI_ANALYSIS`

State transitions must be controlled by the game engine. React components must not independently create conflicting timers or scoring logic.

---

## 5. AI Integration Requirements

### 5.1 Purpose of AI

Gemma 3 4B must contribute to gameplay in a measurable way.

Its primary responsibilities are:

1. Interpret a summary of the player's recent performance.
2. Identify likely weaknesses or repetitive habits.
3. Select a suitable mutation from a predefined challenge library.
4. Generate a short, clear instruction for that mutation.
5. Explain the player's performance after the run.

The model must not be responsible for frame-by-frame gameplay, click detection, timing, scoring, or direct execution of arbitrary code.

### 5.2 Behavioral Data

The frontend should collect a compact summary containing:

- Total rounds played.
- Correct and incorrect actions.
- Average reaction time.
- Recent reaction-time trend.
- Most frequently missed rule type.
- Most frequently selected incorrect target.
- Current combo and best combo.
- Mutations previously encountered.

Do not send every individual input event to the model. Send summarized statistics at round boundaries.

### 5.3 AI Request Flow

1. The frontend sends the performance summary to the Express backend.
2. The backend validates the request.
3. The backend calls the locally installed Gemma model through Ollama.
4. The model returns a structured challenge recommendation.
5. The backend validates the returned JSON against an allowlist.
6. The frontend schedules the challenge for the next round.
7. The game engine executes the corresponding predefined rule.

### 5.4 Example AI Request

```json
{
  "averageReactionMs": 420,
  "accuracy": 0.78,
  "missedRules": {
    "symbolOverride": 4,
    "reverseColors": 1
  },
  "recentTrend": "improving",
  "recentMutations": ["reverseColors"],
  "difficulty": 3
}
```

### 5.5 Example AI Response

```json
{
  "mutationId": "symbolOverride",
  "reason": "The player struggles to prioritize symbols over colors.",
  "instruction": "IGNORE THE COLOR. FOLLOW THE SYMBOL.",
  "intensity": 1,
  "taunt": "Your eyes are too loyal to color."
}
```

The response schema is illustrative. The final implementation must validate every field and reject unknown mutation IDs.

The model should be instructed to choose only from an explicitly supplied list of allowed mutations. The backend must enforce this restriction independently.

### 5.6 Adaptive Difficulty

The AI recommendation should consider:

- Player accuracy.
- Average reaction time.
- Repeated errors.
- Current difficulty.
- Recently used mutations.

If the player is struggling, the model may recommend a simpler mutation. If the player is performing well, it may recommend a more challenging one.

The game engine must enforce safe difficulty limits regardless of the model's recommendation.

### 5.7 AI Timing

AI inference must never block active gameplay.

The application should request the next mutation during an existing round or transition period, then cache the result.

If the model is not ready when the next round begins, the game must use a valid fallback challenge immediately.

### 5.8 Game-Over Analysis

After the run, Gemma should produce a brief summary containing:

- The player's strongest skill.
- The player's most frequent mistake.
- One observation based on measured statistics.
- A short humorous taunt.
- One suggested improvement.

The analysis must not invent statistics that were not included in the request.

---

## 6. Functional Requirements

### FR-01: Start Game

The application shall display a polished start screen with the game title, a concise explanation, and a clearly visible Play button.

### FR-02: Responsive Gameplay

The game shall respond to player actions immediately without waiting for an AI request.

### FR-03: Rule Enforcement

The game engine shall determine correct and incorrect actions using deterministic, predefined rules.

### FR-04: Scoring

The application shall update score, combo, lives, and reaction-time statistics during gameplay.

### FR-05: Difficulty Progression

The game shall increase difficulty according to configurable limits.

### FR-06: AI Adaptation

The application shall request AI recommendations based on summarized player behavior and apply valid recommendations to future rounds.

### FR-07: Output Validation

The backend shall reject invalid or unsupported AI-generated mutation IDs and fall back to a known valid challenge.

### FR-08: Fallback Operation

The game shall remain playable when Ollama is unavailable, the model returns invalid output, or inference times out.

### FR-09: Game-Over Summary

The application shall display the final score, best score, accuracy, reaction time, and optional AI-generated commentary.

### FR-10: Replay

The player shall be able to restart immediately without refreshing the page.

### FR-11: Local Persistence

The application shall save the best score in localStorage.

### FR-12: Visual Feedback

Correct actions, incorrect actions, combos, mutation changes, and game-over events shall produce distinct visual feedback.

### FR-13: Keyboard Support

The application should support keyboard controls as an alternative to clicking targets.

### FR-14: AI Status

The application shall clearly distinguish between AI-generated challenges and fallback challenges, without exposing technical errors during normal gameplay.

---

## 7. Non-Functional Requirements

### 7.1 Performance

- Player input handling must remain independent of model inference.
- Target interactions should feel immediate.
- The WebGL scene should target 60 FPS on a typical modern laptop, where hardware permits.
- The game must remain playable at lower frame rates.
- Animations should avoid unnecessary resource-intensive effects.

### 7.2 Reliability

- Invalid model output must never crash the game.
- Every mutation must have a deterministic implementation.
- The game must handle backend disconnection and AI timeouts.
- Timers must be cleaned up when the player restarts or leaves a game state.

### 7.3 Usability

- The game must be understandable within ten seconds.
- The player must not need to read long instructions.
- The primary interaction must be obvious.
- Feedback must clearly communicate whether an action succeeded.

### 7.4 Visual Quality

The interface must look like a finished indie arcade game rather than a generic dashboard.

The visual direction should use:

- Deep charcoal or near-black backgrounds.
- One vivid accent color, with restrained secondary colors.
- Large, bold typography.
- Generous spacing.
- Clear score and combo indicators.
- Subtle glass-like surfaces where appropriate.
- Smooth transitions and responsive hover states.
- Controlled screen shake, particles, and glow effects.
- A distinctive title treatment for `PANIC.exe`.

Avoid excessive gradients, cluttered HUD elements, generic AI-chat layouts, and unnecessary decorative cards.

### 7.5 Privacy

The game should process player statistics locally. Gameplay summaries may be sent to the local Ollama service, but must not be sent to a cloud AI provider.

### 7.6 Maintainability

Separate gameplay logic, AI communication, validation, rendering, and UI components. Challenge definitions must not be duplicated across multiple files.

---

## 8. System Architecture

The application should use the following architecture:

```text
React Frontend
    |
    +-- Game State and Scoring Engine
    |
    +-- HTML Interactive Targets
    |
    +-- Three.js WebGL Effects
    |
    +-- Performance Summary
              |
              v
       Express Backend
              |
       Request Validation
              |
              v
         Ollama API
              |
              v
          Gemma 3 4B
              |
              v
       JSON Validation
              |
              v
       Challenge Selection
              |
              v
       Next Game Round
```

### Architectural Rules

- The frontend owns live gameplay state.
- The backend owns AI request handling and validation.
- Ollama is the only AI inference service in the MVP.
- The model recommends allowed actions; it never executes arbitrary code.
- The rendering system must not control game rules.
- AI failure must not prevent the user from starting or finishing a run.

---

## 9. Backend API

### POST `/api/ai/next-challenge`

Accepts player statistics and returns a validated challenge recommendation.

Expected behavior:

- Validate the incoming summary.
- Request a structured response from Gemma.
- Validate the mutation ID and other fields.
- Return a valid challenge or a fallback result.

### POST `/api/ai/run-analysis`

Accepts the final game statistics and returns a concise performance summary.

Expected behavior:

- Validate the statistics.
- Request a short analysis from Gemma.
- Return validated text fields.
- Use a local fallback summary if inference fails.

### GET `/api/health`

Returns basic application and Ollama connectivity status.

The health endpoint should report whether the configured model is available without requiring the model to generate a response.

---

## 10. UI Requirements

### 10.1 Start Screen

Must include:

- `PANIC.exe` logo/title.
- A short tagline, such as "Your reflexes are your worst enemy."
- Play button.
- Best score.
- Brief gameplay instructions.
- A small local AI status indicator.

### 10.2 Gameplay Screen

Must include:

- Current instruction.
- Score.
- Combo multiplier.
- Remaining lives or timer.
- Interactive targets.
- Current mutation indicator.
- Subtle WebGL background.
- Immediate correct/incorrect feedback.

The gameplay area must remain uncluttered.

### 10.3 Mutation Transition

When a new mutation is introduced:

- Briefly pause the next challenge.
- Display the mutation title and instruction.
- Animate the transition.
- Resume gameplay promptly.
- Do not wait indefinitely for AI inference.

### 10.4 Game-Over Screen

Must include:

- Final score.
- Best score.
- Accuracy.
- Average reaction time.
- Highest combo.
- AI-generated performance summary, when available.
- Retry button.

The retry button should restart the game in one action.

---

## 11. Suggested Project Structure

```text
panic-exe/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── StartScreen.tsx
│   │   │   ├── GameHUD.tsx
│   │   │   ├── TargetGrid.tsx
│   │   │   ├── MutationOverlay.tsx
│   │   │   └── GameOverScreen.tsx
│   │   ├── game/
│   │   │   ├── gameEngine.ts
│   │   │   ├── mutations.ts
│   │   │   ├── scoring.ts
│   │   │   └── gameTypes.ts
│   │   ├── effects/
│   │   │   └── WebGLBackground.tsx
│   │   ├── services/
│   │   │   └── aiClient.ts
│   │   ├── styles/
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   └── aiRoutes.ts
│   │   ├── services/
│   │   │   └── ollamaService.ts
│   │   ├── schemas/
│   │   │   └── challengeSchema.ts
│   │   └── index.ts
│   └── package.json
├── .env.example
├── README.md
└── package.json
```

Claude Code may simplify this structure if doing so makes the five-hour deadline more achievable. Do not create empty files or unnecessary abstractions merely to match the diagram.

---

## 12. Testing Requirements

### 12.1 Gameplay Tests

- Correct actions increase the score.
- Incorrect actions reduce lives as expected.
- Combo multipliers work correctly.
- Difficulty increases within configured limits.
- Restarting clears the previous run's transient state.
- Each mutation produces its documented behavior.
- Keyboard and mouse inputs follow the same game rules.

### 12.2 AI Tests

- Ollama responds using the installed `gemma3:4b` model.
- Valid model responses produce valid challenges.
- Invalid JSON triggers a fallback.
- Unsupported mutation IDs are rejected.
- Slow model responses do not freeze gameplay.
- The game works if Ollama is stopped.
- AI analysis uses actual recorded statistics.

### 12.3 Visual Tests

- WebGL effects render without covering interactive targets.
- The interface remains usable if WebGL is unavailable.
- Animations do not interfere with clicks.
- The start, gameplay, transition, and game-over screens are visually consistent.

### 12.4 Demo Acceptance Criteria

The MVP is complete when:

1. The player can start and finish a full run.
2. The core mechanic is understandable in ten seconds.
3. Score, combo, and difficulty progression work correctly.
4. At least three distinct rule mutations are playable, with five as the target.
5. Gemma 3 4B successfully analyzes gameplay and influences a subsequent challenge.
6. The game continues working if AI inference fails.
7. WebGL visual effects are visible and polished.
8. The final screen displays statistics and a replay option.
9. The project can be launched using documented commands.

---

## 13. Five-Hour Development Plan

### Hour 1: Core Gameplay

- Create the Vite React TypeScript project.
- Implement game states and scoring.
- Build interactive targets.
- Complete one working game loop.

**Deliverable:** A playable game without AI.

### Hour 2: Rules and Progression

- Implement at least three rule mutations.
- Add reaction-time tracking, lives, combos, and increasing difficulty.
- Test restart behavior.

**Deliverable:** A complete basic arcade loop.

### Hour 3: AI Integration

- Connect Express to the local Ollama API.
- Use the existing `gemma3:4b` model.
- Implement the performance summary and structured challenge response.
- Add output validation and deterministic fallback challenges.

**Deliverable:** AI demonstrably influences gameplay.

### Hour 4: Visual Polish

- Add the Three.js WebGL background.
- Improve typography, spacing, colors, animations, and feedback.
- Complete the start and game-over screens.
- Add sound effects if time permits.

**Deliverable:** A polished presentation-ready game.

### Hour 5: Testing and Demo Preparation

- Fix critical bugs.
- Verify local AI connectivity.
- Test fallback behavior.
- Tune difficulty and timing.
- Prepare a short demonstration.
- Write the README and launch instructions.

**Deliverable:** A stable hackathon MVP.

If time becomes limited, prioritize a complete working game, genuine AI integration, and visual consistency over additional features.

---

## 14. Final Design Principle

PANIC.exe should feel like a simple arcade game that becomes disturbingly good at exploiting the player's habits.

The player acts quickly. The AI thinks between rounds. The game engine handles the rules.

The final experience must be fun even when the AI is unavailable, but noticeably more personalized when Gemma 3 4B is active.
