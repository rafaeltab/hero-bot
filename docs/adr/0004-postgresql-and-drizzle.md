# Use PostgreSQL and Drizzle behind persistence adapters

Use PostgreSQL and Drizzle for persistence, subject to revisiting the choice if a concrete requirement exposes a conflict. Drizzle provides a typed query layer the developer has used before; database schemas and transaction requirements will be established by the workflows that need them, rather than invented during repository setup.

Keep database and Drizzle details inside persistence adapters, preserving the Effect-based capability contracts. Stable Drizzle's Promise-based PostgreSQL driver can be adapted to Effect with explicit error translation and managed connection-pool lifetime; adopting a native Effect integration is not required, particularly while that integration is a prerelease. Dependency installation and representative adapter tests must verify the selected version combination during implementation.
