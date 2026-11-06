# Required merge check

The required check context is **`Checks`**, produced by the **`CI`** workflow
and the **GitHub Actions** app (integration ID `15368`). The PR UI displays
`CI / Checks`. Mutation shards and `Mutations / Results` remain advisory.

Successful workflow steps do not enforce merge protection by themselves.

## Current limitation and administrator action

On review, the `main` ruleset (ID `26479514`) was disabled and contained no
required-status-check rule. The current account reports `admin: false` and
`maintain: false`. An authorized attempt to update that existing ruleset returned
HTTP 404, although reading it succeeds. No protection settings were changed.

An administrator must:

1. Open [the existing main ruleset](https://github.com/rafaeltab/hero-bot/settings/rules/26479514).
2. Set **Enforcement status** to **Active**.
3. Add **Require status checks to pass**, selecting **Checks** from **GitHub Actions**.
4. Preserve the existing target/default-branch conditions, deletion and force-push
   restrictions, pull-request settings, linear-history rule, squash-only merge
   method, bypass settings and any other unrelated rules. Save the ruleset.
5. Do **not** require the advisory mutation jobs.

The disabled ruleset already expresses the repository's other desired rules;
there is no need to replace it with a new blanket branch-protection configuration.
The API rule to add, while preserving all existing rules, is:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "required_status_checks": [
      { "context": "Checks", "integration_id": 15368 }
    ],
    "strict_required_status_checks_policy": false,
    "do_not_enforce_on_create": false
  }
}
```

Verify enforcement is `active` and the rule is present:

```sh
gh api repos/rafaeltab/hero-bot/rulesets/26479514 \
  --jq '{enforcement, checks: [.rules[] | select(.type == "required_status_checks")]}'
```
