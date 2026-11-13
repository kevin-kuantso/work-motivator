# Calendar Selection and Repository Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active calendar date visually clear and add general-edition repository/version entry points outside the widget.

**Architecture:** Calendar view owns transient selection state keyed to its open day menu. The web header uses a normal safe external link, while Electron owns the native About dialog and opens the same fixed repository URL through the OS shell.

**Tech Stack:** Vanilla ES modules/CSS, Node test runner, Playwright browser tests, Electron main process.

**Spec:** `docs/superpowers/specs/2026-11-13-calendar-selected-date-design.md`, `docs/superpowers/specs/2026-11-13-repository-info-design.md`

## Global Constraints

- General edition only; do not include Sheer branding, paths, assets, or text.
- The calendar selection is transient and never stored in settings or backups.
- Do not add repository actions to the floating widget.
- Both Traditional and Simplified Chinese must provide matching copy.

## Review Focus

- Opening then closing a date menu removes the selected treatment without changing a mark; covered by Task 1 browser test.
- Keyboard and pointer opening select the same date; covered by Task 1 browser test.
- Hovering another date does not hide the menu anchor selection; covered by Task 1 browser test.
- The header link is keyboard named and opens only the fixed general-edition repository; covered by Task 2 browser test.
- Native About opens external repository only from the main process; covered by Task 2 unit test/helper seam where practical.

---

### Task 1: Transient calendar selection

**Files:**
- Modify: `src/ui/calendar-view.js`
- Modify: `src/style.css`
- Test: `e2e/calendar-menu.spec.mjs`

**Interfaces:**
- Produces: `.day.is-selected` only while the matching day menu is open.

- [ ] Add failing browser assertions for pointer/keyboard menu opening, menu close, different-date selection, and concurrent hover.
- [ ] Run `node --test --test-concurrency=1 e2e/calendar-menu.spec.mjs` and confirm the assertions fail.
- [ ] Track the menu key in `calendar-view.js`, emit `is-selected` during render, and clear it on every menu-close path.
- [ ] Add a brand-ring/soft-fill CSS treatment that retains status backgrounds and remains distinct from `:focus-visible`.
- [ ] Re-run the calendar browser test and confirm it passes.

### Task 2: Repository and About entry points

**Files:**
- Modify: `src/ui/app.js`, `src/ui/icons.js`, `src/style.css`
- Modify: `src/strings.zh-TW.js`, `src/strings.zh-CN.js`
- Modify: `electron/desktop/main.cjs`
- Test: relevant UI/Electron tests

**Interfaces:**
- Produces: a labelled header repository link and localized desktop About menu item.

- [ ] Add failing assertions for the labelled header link and both locale string contracts.
- [ ] Add an inline GitHub icon and a safe `target=_blank` header link to the fixed repository URL.
- [ ] Add localized About labels/body and a tray/application-menu item that shows the app version and opens the repository through Electron `shell.openExternal`.
- [ ] Verify web tests and desktop unit tests pass.

### Task 3: Release refresh

**Files:**
- Modify: `.gitignore` as needed for generated output only
- Build: `dist/work-motivator.html`, Electron macOS arm64 and Windows x64 artifacts

- [ ] Re-run `npm test`, web build, desktop build, calendar browser test, and diff check.
- [ ] Rebuild macOS arm64 DMG/ZIP, Windows x64 installer, and self-contained web ZIP; regenerate `SHA256SUMS.txt`.
- [ ] Verify archive integrity and publish the updated `v1.3.0` release assets after the corresponding source commit is pushed.
