# Domain Docs

This project will use Turborepo with a separate context per subdomain. The first application is planned at `apps/discord-bot`; additional applications and contexts will follow.

## Read before exploring

- Read the root `GLOSSARY-MAP.md` to identify the contexts relevant to the task.
- Read each relevant context's `GLOSSARY.md` and ADRs under its `docs/adr/`.
- Read root `docs/adr/` for decisions spanning contexts or the workspace.
- For work spanning contexts, read each affected context's docs and preserve its vocabulary and boundaries.

If a referenced document does not exist, proceed silently. Create glossaries and ADRs as terms and decisions are resolved through `/domain-modeling`.

## Planned layout

- `GLOSSARY-MAP.md`: repository-wide index of subdomains and their documentation paths.
- `docs/adr/`: decisions spanning contexts, including workspace architecture.
- `apps/discord-bot/GLOSSARY.md`: glossary for the initial Discord bot context.
- `apps/discord-bot/docs/adr/`: decisions specific to the Discord bot context.

The application paths above describe the planned layout. Do not create `apps/discord-bot` as part of skill setup.

As subdomains are introduced, add their glossary and ADR paths to the root map. Locate docs beside the code that owns the subdomain; a subdomain may span several workspace packages. Package boundaries alone do not define domain boundaries.

## Vocabulary and decisions

Use terms as defined in the relevant context's glossary. Note unresolved terminology for `/domain-modeling`.

When a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be revisited.
