# Future AI evaluation artifacts

Store reviewed evaluation cases under `cases/<suite>/<version>/`. A version identifies
an immutable reviewed case set; change it when cases or expected behavior change.
Keep provenance, policy context and consent/redaction notes beside each case set.
Do not store private messages or credentials. No dataset, judgment format, scoring
format or runner is selected here.

Retained sanitized reports belong under `reports/<suite>/<run-id>/`. Keep metadata
beside reports identifying the case-set version, repository commit, evaluated
configuration, model/provider and model version where available, prompt/policy
versions, execution settings, time and tool versions. Record failures and unavailable
metadata explicitly. Identify changes between runs so unlike configurations are not
compared silently; identical settings do not guarantee identical model outputs.

Do not commit raw traces containing secrets or private data. Runner, datasets,
scoring, execution budget and merge policy follow the relevant AI/release decisions.
These directories intentionally contain no invented moderation evaluations.
