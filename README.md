# OpenRouter Spend — Tauri

A small Tauri v2 desktop app written with:

- Rust backend
- Tauri v2
- Vanilla HTML/CSS/JavaScript
- OpenRouter Analytics API

The app has two graph modes:

- **Daily** — every day uses the same fixed allowance.
- **Compound** — unused allowance carries into the next day. Overspending resets the carry to zero instead of creating debt.

## Project structure

```text
openrouter-spend-tauri/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src-tauri/
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/
│   │   ├── icon.png
│   │   └── icon.ico
│   ├── src/
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   └── openrouter.rs
│   ├── build.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 1. Requirements

Install:

- Node.js
- Rust
- the platform dependencies required by Tauri v2

Tauri's prerequisites:
https://v2.tauri.app/start/prerequisites/

## 2. Configure OpenRouter

Copy:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
OPENROUTER_MANAGEMENT_KEY=your_management_key_here
DAILY_LIMIT=0.67
DISPLAY_DAYS=14
```

The Management Key is used only by the Rust backend. It is not embedded in the frontend JavaScript.

## 3. Run

```bash
npm install
npm run dev
```

## 4. Build the desktop application

```bash
npm run build
```

The generated application/bundles will be under:

```text
src-tauri/target/release/
```

and the relevant `bundle/` directory for your operating system.

## Demo fallback

If no OpenRouter key is configured, the app still opens using demo spending data and shows a `DEMO` status in the chart header.

## Compound calculation

For each loaded day:

```text
available = daily_limit + previous_remaining
remaining = max(available - spent, 0)
```

Overspending does not create debt:

```text
available = $3.00
spent     = $3.50
remaining = $0.00

next day available = base daily limit
```

The compound calculation begins at the first day in the currently loaded window.
