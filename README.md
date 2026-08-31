# OpenPocket

A lightweight desktop app for tracking **OpenRouter spending** against a configurable daily budget.

Built with:

- Rust
- Tauri v2
- Vanilla HTML, CSS, and JavaScript
- OpenRouter Analytics API

## Platform Support

| Platform       | Status        |
| -------------- | ------------- |
| 🪟 **Windows** | ✅ Working    |
| 🐧 **Linux**   | ⚠️ Not tested |
| 🍎 **macOS**   | ⚠️ Not tested |

## Features

OpenPocket provides two spending modes:

### Daily

Each day uses the same fixed allowance.

For example, with a daily limit of `$0.67`, every day starts with `$0.67` available regardless of previous spending.

### Compound

Unused allowance carries over into the next day.

```text
available = daily_limit + previous_remaining
remaining = max(available - spent, 0)
```

Overspending does **not** create debt.

For example:

```text
Daily limit:          $0.67
Previous remaining:   $2.33

Available:            $3.00
Spent:                $3.50
Remaining:            $0.00

Next day available:   $0.67
```

If spending exceeds the available amount, the carry-over resets to zero and the next day starts with the normal daily allowance.

> The compound calculation begins from the first day in the currently loaded display window.

## Requirements

Before running the project, install:

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- The platform-specific dependencies required by Tauri v2

See the official Tauri prerequisites guide:

https://v2.tauri.app/start/prerequisites/

## Configuration

Create a local environment file from the provided example.

### Linux / macOS

```bash
cp .env.example .env
```

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```env
OPENROUTER_MANAGEMENT_KEY=your_management_key_here
DAILY_LIMIT=0.67
```

### Environment Variables

| Variable                    | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter Management Key used to retrieve spending data |
| `DAILY_LIMIT`               | Base daily spending allowance                            |

The graph always shows the full current calendar month, from day 1 through the last day of the month.

The OpenRouter Management Key is used only by the **Rust backend** and is not embedded in the frontend JavaScript.

## Running in Development

Install dependencies:

```bash
npm install
```

Start the Tauri development app:

```bash
npm run dev
```

## Building the Desktop App

Create a production build with:

```bash
npm run build
```

Compiled files will be generated under:

```text
src-tauri/target/release/
```

Platform-specific installers and bundles can be found in the corresponding:

```text
src-tauri/target/release/bundle/
```

directory.

## Demo Mode

OpenPocket can run without an OpenRouter Management Key.

If `OPENROUTER_MANAGEMENT_KEY` is not configured, the application automatically loads demo spending data and displays a **DEMO** indicator in the chart header.

This makes it possible to preview the application without connecting an OpenRouter account.

## Security

Your OpenRouter Management Key is handled by the Rust backend.

It is **not exposed to the frontend JavaScript**, helping prevent accidental exposure through the webview.

Do not commit your `.env` file or Management Key to source control.

## License

Add your project's license here if you plan to distribute or open-source the application.
