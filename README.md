# TellyFin

TellyFin is a monorepo containing tools to automate the process of downloading and organizing media from Telegram channels.

## Project Structure

The project is organized using `pnpm` workspaces:

- `apps/`: Main applications.
  - [`apps/bot/`](apps/bot/README.md): A Telegram userbot that identifies and downloads media.
- `scripts/`: Shared utility scripts.
  - `block-sensitive-files.js`: A pre-commit hook to prevent sensitive files (like `.env`) from being committed to Git.

## Getting Started

1.  **Install dependencies**:
    ```bash
    pnpm install
    ```

2.  **Configure applications**:
    Go to each application in `apps/` and follow their respective setup instructions.

---
For more information, visit the [apps/bot README](apps/bot/README.md).
