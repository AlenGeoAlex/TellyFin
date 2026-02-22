# TellyFin Bot

TellyFin Bot is a Telegram userbot designed to automatically identify and download media (movies and TV series) from Telegram channels, organizing them for use with media servers like Jellyfin or Plex.

It uses an LLM (Large Language Model) to parse filenames and TMDB (The Movie Database) to resolve metadata and provide structured file paths.

## Features

- **Automated Media Detection**: Monitors specified Telegram channels for new media messages.
- **LLM-Powered Parsing**: Uses `node-llama-cpp` to extract titles, years, seasons, and episodes from complex filenames.
- **TMDB Integration**: Validates media information and fetches official metadata via the TMDB API.
- **Organized Downloads**: Automatically renames and sorts files into a structured directory format (e.g., `Movies/Title (Year)/Title (Year).ext` or `TV Shows/Title/Season 01/Title - S01E01.ext`).
- **Queue Management**: Handles multiple downloads with configurable concurrency.
- **Interaction via Reactions**: Provides feedback on the status of processing and downloads using Telegram reactions.

## Prerequisites

- Node.js (v20 or higher recommended)
- `pnpm`
- Telegram API credentials (`API_ID` and `API_HASH`)
- TMDB API Key
- A GGUF format LLM model (e.g., Qwen2.5-1.5B-Instruct-GGUF)

## Setup

1.  **Environment Variables**:
    Create a `.env` file in `apps/bot/` with the following variables:
    ```env
    API_ID=your_api_id
    API_HASH=your_api_hash
    SESSION_STRING=your_session_string (optional initially)
    TMDB_API_KEY=your_tmdb_api_key
    LLM_MODEL_PATH=/path/to/your/model.gguf
    FORWARD_CHANNELS=-100123456789,-100987654321
    DOWNLOAD_CONCURRENCY=1
    MOVIE_PATH=Movies/{title} ({year})/{title} ({year}).{ext}
    SERIES_PATH=TV Shows/{title}/Season {season}/{title} - S{season}E{episode}.{ext}
    ```

2.  **Login**:
    If you don't have a `SESSION_STRING`, run the login script to authenticate with Telegram:
    ```bash
    pnpm run login
    ```
    Follow the prompts to enter your phone number and the code received. The session string will be logged; copy it to your `.env` file.

3.  **Run**:
    Start the bot in development mode:
    ```bash
    pnpm run dev
    ```
    Or build and start:
    ```bash
    pnpm run build
    pnpm run start
    ```

## Project Structure

- `src/main.ts`: Entry point.
- `src/userbot.ts`: Main bot logic and event handling.
- `src/downloader.ts`: Handles file downloading and path resolution.
- `src/llm-model-manager.ts`: Manages interactions with the LLM.
- `src/tmdb-client.ts`: Wrapper for TMDB API.
- `src/handlers/`: Contains message and reply handlers.

---
[Back to main README](../../README.md)
