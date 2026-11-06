# Required merge check

The existing **main** ruleset (ID `26479514`) is **active** and requires only
**`Checks`** from workflow **`CI`** (GitHub Actions integration `15368`). The PR UI
displays `CI / Checks`. The owner activated the ruleset; this state was independently
verified through the API. Mutation shards and `Mutations / Results` remain optional
by the user's explicit choice. No rule changes are needed for this test/guide update.

Successful workflow steps alone do not prove merge enforcement; verify the rule:

```sh
gh api repos/rafaeltab/hero-bot/rulesets/26479514 \
  --jq '{enforcement, required_checks: [.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]}'
```

Expected: `enforcement` is `active`, and `required_checks` is `["Checks"]`.
Maintain the existing target, bypasses and unrelated rules when administering the
[main ruleset](https://github.com/rafaeltab/hero-bot/settings/rules/26479514).
Do not add mutation checks to the required set without a new user decision.

An earlier agent update attempt was permission-denied; that historical limitation
has been resolved by the owner's activation and is not a remaining administrator task.
