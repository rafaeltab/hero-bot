# Local source repair

Source: https://github.com/mattpocock/skills/tree/main/skills/in-progress/software-factory

The upstream SKILL.md description contains an unquoted colon followed by a space, which skills.sh rejects as invalid YAML. This copy quotes that description; the skill content is otherwise unchanged.

The project lockfile points here so installation can be reproduced without a temporary directory. Reinstall with:

```sh
npx skills@latest add ./.agents/skill-sources/software-factory --skill software-factory --agent codex --yes
```
