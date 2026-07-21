# Contributing to Pulse Terminal

Thanks for considering a contribution. Pulse Terminal is a small, frontend-only project, so keep changes focused.

## Workflow

This repo uses a single `main` branch.

1. Fork the repo and create a feature branch off `main`:

   ```bash
   git checkout -b fix/your-short-description
   ```

2. Make your change. Keep the diff small and scoped to one issue.
3. Test locally: open `Terminal-main.html` in a browser, or run `npx -y serve .` and visit `http://localhost:3000`.
4. Push your branch and open a Pull Request against `main`.
5. Reference any related issue in the PR description.

## Before you submit

- Do not commit private keys, API credentials, or secrets.
- Do not commit editor or OS noise (already covered by `.gitignore`).
- Keep the no-emoji style in docs and the README.

## Reporting issues

Open an issue using the Bug report or Feature request template. Include the browser, OS, trading pair, and repro steps.
