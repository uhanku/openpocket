<p align="center">
  <img src="src-tauri/icons/icon.png" alt="OpenPocket icon" width="160" />
</p>

<p align="center"><strong>OPENPOCKET</strong></p>

<p align="center">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" />
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000000" />
  <img alt="HTML5" src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img alt="CSS3" src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" />
  <img alt="OpenRouter" src="https://img.shields.io/badge/OpenRouter-212121?style=for-the-badge&logo=openrouter&logoColor=white" />
</p>

OpenPocket is a lightweight Tauri desktop app for tracking **OpenRouter spending** against a configurable daily budget.

## Features

Two spending modes are available:

- **Daily** - each day uses the same fixed allowance. With a limit of `$0.67`, every day starts with `$0.67` regardless of previous spending.
- **Compound** - unused allowance carries over into the next day:

```text
available = daily_limit + previous_remaining
remaining = max(available - spent, 0)
```

Overspending does **not** create debt. If spending exceeds the available amount, the carry-over resets to zero and the next day starts with the normal daily allowance.

> The compound calculation begins from the first day in the currently loaded display window.

## Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Create the environment file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
OPENROUTER_MANAGEMENT_KEY=your_management_key_here
DAILY_LIMIT=0.67
```

The OpenRouter Management Key is used only by the **Rust backend** and is never embedded in the frontend JavaScript.

### Environment variables

| Variable                    | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter Management Key used to retrieve spending data |
| `DAILY_LIMIT`               | Base daily spending allowance                            |

## 3. Run the app

```bash
npm run dev
```

## Building the desktop app

Create a production build:

```bash
npm run build
```

Compiled files land in `src-tauri/target/release/`, with platform-specific installers and bundles in `src-tauri/target/release/bundle/`.

## Demo mode

If `OPENROUTER_MANAGEMENT_KEY` is not configured, the app automatically loads demo spending data and displays a **DEMO** indicator in the chart header, so you can preview it without connecting an OpenRouter account.

## Security

Your OpenRouter Management Key is handled by the Rust backend and is **not exposed to the frontend JavaScript**. Do not commit your `.env` file or Management Key to source control.

## Requirements

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- The platform-specific dependencies required by Tauri v2 (see https://v2.tauri.app/start/prerequisites/)