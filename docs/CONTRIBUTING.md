# Contributing

## Code of conduct

Be kind. Accessibility-first means inclusive by default. See [the hackathon's CoC](https://musichackspace.org) for the baseline.

## Repo conventions

### Languages

- **TypeScript** for the web app (`apps/web/`)
- **Python 3.10+** for the audio service (`services/audio/`)
- **JSON** for pattern templates and onomatopoeia tables
- **YAML** for training data manifests

### Style

**TypeScript:**
- ESLint with `@typescript-eslint/recommended`
- Prettier for formatting
- No `any` unless absolutely necessary (and then comment why)
- Functional components, hooks, no class components
- Avoid `useEffect` for derived state — use `useMemo` or compute inline

**Python:**
- `ruff` for linting (replaces flake8, isort, etc.)
- `black` for formatting
- Type hints everywhere
- Pydantic for data models

### Naming

- Components: `PascalCase.tsx`
- Hooks: `useCamelCase.ts`
- Utilities: `camelCase.ts`
- Constants: `UPPER_SNAKE_CASE`
- Files match exports (one default export per file preferred)

### Git

**Commit format** (Conventional Commits):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting, no code change
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — performance improvement
- `test` — adding or fixing tests
- `chore` — build, CI, tooling

Examples:
```
feat(parser): add onomatopoeia matcher with confidence scoring
fix(midi): correct GM drum map for china (should be 52, was 49)
docs(architecture): clarify Reaper integration is not a plugin
chore(ci): add axe-core to GitHub Actions
```

**Branch naming:**
- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `chore/<short-description>`

Examples:
- `feat/voice-stt`
- `fix/midi-tempo-header`
- `docs/architecture-update`

### Pull requests

- One feature per PR
- PR description explains *what* and *why*
- Screenshots / screen recordings for UI changes
- Accessibility check included (NVDA test notes, axe-core results)
- All CI checks passing

### Accessibility requirements for every PR

If your PR touches the UI:

- [ ] Run axe-core locally (`npm run test:a11y`) — no AA violations
- [ ] Tab through the changed flow, verify focus order
- [ ] Test with NVDA (or document why you couldn't)
- [ ] All interactive elements have ARIA labels
- [ ] Color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large)
- [ ] No information conveyed by color alone

If your PR is docs-only or backend-only, skip these.

## Adding a new pattern template

1. Create `apps/web/data/patterns/<pattern-id>.json`
2. Follow the schema in [`03-data-model.md`](03-data-model.md#pattern-templates)
3. Test in the web app: `npm run dev`, load the pattern, generate MIDI, drag into Reaper
4. Verify the description reads naturally with a screenreader
5. Update the pattern list in [`03-data-model.md`](03-data-model.md#pattern-library--starting-list) if adding to the starting list

## Adding a new onomatopoeia

1. Edit `apps/web/data/onomatopoeia.json`
2. Add the entry with `patterns` (array of variants), `patternId`, and any defaults
3. Test the phonetic matcher: `npm run test:onomatopoeia`
4. Manually speak the variants, verify they map correctly

## Adding training data

1. Place audio in `data/training/oneshots/` or `data/training/loops/`
2. Preprocess: 44100 Hz mono, normalized to -14 LUFS
3. Add an entry to `data/training/manifest.yaml` with:
   - `id`, `path`, `category`, `tags`
   - `source`, `license`, `duration_seconds`
   - `bpm` (for loops only)
4. Run `python services/audio/training/preprocess.py` to regenerate the preprocessed versions
5. Verify the file plays correctly and the license is documented

## Accessibility testing protocol

Before opening a PR that touches UI:

1. **axe-core:** `npm run test:a11y` — must pass with no violations
2. **NVDA (Windows + Chrome/Firefox):**
   - Tab through the entire flow
   - Verify every state change is announced
   - Verify focus never disappears
   - Verify error states are announced
3. **VoiceOver (macOS + Safari):**
   - Repeat the NVDA flow
   - Especially test the grid navigation with VO + arrow keys
4. **Keyboard-only:**
   - Complete the entire demo flow without using the mouse
   - Verify every action has a keyboard equivalent
5. **High contrast:**
   - Enable Windows High Contrast Mode
   - Verify the UI is still usable
6. **200% zoom:**
   - Zoom the browser to 200%
   - Verify no content is cut off or unreachable

If any of these fail, the PR is not ready.

## Communication

- **Issues** — use GitHub Issues for bugs, feature requests, design questions
- **Discussions** — use GitHub Discussions for broader questions
- **Discord** — for real-time chat during the hackathon

## License

By contributing, you agree that your contributions will be licensed under the project's MIT license (code) or CC-BY (sample data where applicable).
