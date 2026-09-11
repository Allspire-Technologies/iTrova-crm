# iTrova CRM (Admin OS)

The internal staff console: customer success, renewals, referrals, and the content consoles for
both marketing sites. Shares one Supabase project with the app.

## The codebase map

**[docs/CODEBASE-MAP.md](docs/CODEBASE-MAP.md)** is shared working memory for everyone on this
repo: the directory layout and the key flows. Read it twice, write it back once.

**Read it before you start.** Before searching the tree, before planning, before your first edit,
so you are not rediscovering structure that is already written down. If it disagrees with the
code, the code wins: correct the map in the same change that proves it wrong.

**Read it again before you commit.** Other agents work in parallel, in worktrees and other
sessions, so the map may have moved since you read it. This is also the moment to check whether
your own work has made part of it wrong. If two agents have edited it, resolve the conflict by
keeping both descriptions rather than taking one side.

**Update it in the same commit as the change**, never as a follow-up, so a reviewer sees both
together. Update it when you move or rename something the map names, change a flow it describes,
add an integration point (an allowlist entry, Edge Function, RPC, table, scheduled job), or find
a trap worth warning the next agent about. Do not touch it for a bug fix inside an existing flow,
copy changes, dependency bumps or a new test. The map earns its value by staying short and true.

## Before you touch the database

There is no Supabase CLI on this machine and no DB credentials. Write the migration file into
`supabase/migrations/`, then hand the SQL to the user to paste into the Supabase dashboard. Edge
Functions are pasted whole the same way, so production can drift from the repo: if a function
misbehaves in a way the code does not explain, suspect drift and re-paste it.

This is an older Supabase project without default privileges, so a table an Edge Function reads or
writes **directly** as service_role needs an explicit `grant ... to service_role` in the migration.
A table reached only inside a `SECURITY DEFINER` function does not: that runs with its owner's
privileges. Grant what the runtime role actually touches and no more.

Shells may start in `iTrova`, not here. Use `git -C` or `cd` for CRM work.

## Working agreements

- Branch, commit, open a PR. Never push to `main`.
- One PR per change. Ask before folding unrelated work into an open PR.
- Comment sparingly: brief essential whys, not blocks. Rationale belongs in the PR description.
- Add a `CHANGELOG.md` entry when you ship a feature or fix.
- Verify UI work in a real browser before opening the PR.
