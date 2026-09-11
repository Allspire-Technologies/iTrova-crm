# iTrova CRM (Admin OS)

The internal staff console: customer success, renewals, referrals, and the content consoles for
both marketing sites. Shares one Supabase project with the app.

## Read the codebase map first

Before starting any work in this repository, read **[docs/CODEBASE-MAP.md](docs/CODEBASE-MAP.md)**.
It gives the directory layout and the key flows (auth, data access, gating, migrations, deploys),
so you are not rediscovering structure that is already written down.

If the map disagrees with the code, the code wins: correct the map in the same change. When a
change alters the structure or a flow the map describes, update the map with it.

## Before you touch the database

There is no Supabase CLI on this machine and no DB credentials. Write the migration file into
`supabase/migrations/`, then hand the SQL to the user to paste into the Supabase dashboard. Edge
Functions are pasted whole the same way, so production can drift from the repo: if a function
misbehaves in a way the code does not explain, suspect drift and re-paste it.

This is an older Supabase project without default privileges, so every table a function or RPC
touches needs an explicit `grant ... to service_role` in the migration.

Shells may start in `iTrova`, not here. Use `git -C` or `cd` for CRM work.

## Working agreements

- Branch, commit, open a PR. Never push to `main`.
- One PR per change. Ask before folding unrelated work into an open PR.
- Comment sparingly: brief essential whys, not blocks. Rationale belongs in the PR description.
- Add a `CHANGELOG.md` entry when you ship a feature or fix.
- Verify UI work in a real browser before opening the PR.
