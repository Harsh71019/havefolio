# Claude Instructions for Havefolio

Read and follow [`AGENTS.md`](./AGENTS.md) completely before making changes. It is the canonical repository policy and overrides this file if the two ever conflict.

Claude-specific startup checklist:

1. Read `anti-consumerism-app-build-prompt.md` for product intent.
2. Read or create the relevant `PER-<number>` ticket as described in `AGENTS.md`.
3. Pull the latest `main` with `--ff-only` and create a ticket-named branch.
4. State the ticket, acceptance criteria, dependencies, and planned verification before implementation.
5. Keep `.env.local` and all credentials out of Git, logs, tickets, commits, and responses.
6. Use the ticket key in every commit and in the pull-request title.
7. Run the repository-defined checks and report exact results before claiming completion.
