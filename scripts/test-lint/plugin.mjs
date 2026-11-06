// Resolve named imports through ESLint's scope so aliases work and shadowed names
// do not become false test registrations or assertions.
function importedBinding(context, node) {
  if (node.type !== "Identifier") return undefined;
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      const definition = variable.defs[0];
      if (definition?.type !== "ImportBinding") return undefined;
      const declaration = definition.parent;
      return {
        source: declaration.source.value,
        name: definition.node.imported?.name ?? "*",
      };
    }
    scope = scope.upper;
  }
}

function importedName(context, node) {
  const binding = importedBinding(context, node);
  if (["vitest", "@effect/vitest"].includes(binding?.source))
    return binding.name;
}

function isEffectSync(context, callee) {
  const call = chain(callee);
  if (!call) return false;
  const binding = importedBinding(context, call.root);
  return (
    (binding?.source === "effect" &&
      binding.name === "Effect" &&
      call.members.join(".") === "sync") ||
    (binding?.source === "effect/Effect" &&
      ((binding.name === "*" && call.members.join(".") === "sync") ||
        (binding.name === "sync" && call.members.length === 0)))
  );
}

function chain(node) {
  if (node.type === "Identifier") return { root: node, members: [] };
  if (node.type === "CallExpression") return chain(node.callee);
  if (node.type === "MemberExpression") {
    const base = chain(node.object);
    const name = node.computed ? node.property.value : node.property.name;
    if (base && typeof name === "string")
      return { ...base, members: [...base.members, name] };
  }
}

function registration(context, node) {
  // Only the outer registration, not each(table) or skipIf(condition).
  if (
    node.parent.type === "CallExpression" ||
    node.parent.type === "MemberExpression"
  )
    return undefined;
  const call = chain(node.callee);
  if (!call) return undefined;
  const name = importedName(context, call.root);
  if (!["it", "test", "describe", "suite"].includes(name)) return undefined;
  return { ...call, suite: ["describe", "suite"].includes(name) };
}

function enabledOption(node, names) {
  return node.arguments.some(
    (argument) =>
      argument.type === "ObjectExpression" &&
      argument.properties.some((property) => {
        const name = property.computed
          ? property.key?.value
          : (property.key?.name ?? property.key?.value);
        return (
          names.includes(name) &&
          !(
            property.value?.type === "Literal" && property.value.value === false
          )
        );
      }),
  );
}

const rule = (message, create) => ({
  meta: { type: "problem", schema: [], messages: { invalid: message } },
  create,
});

export default {
  rules: {
    "no-async-assertion-in-sync": rule(
      "Effect.sync does not await promises; use Effect.promise for asynchronous assertions.",
      (context) => ({
        CallExpression(node) {
          // Inspect only the outer matcher call, not expect(...) and modifiers.
          if (node.parent.type === "MemberExpression") return;
          const call = chain(node);
          if (
            !call ||
            importedName(context, call.root) !== "expect" ||
            !call.members.some((name) =>
              ["resolves", "rejects", "poll"].includes(name),
            )
          )
            return;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (
              [
                "ArrowFunctionExpression",
                "FunctionExpression",
                "FunctionDeclaration",
              ].includes(parent.type)
            ) {
              const invocation = parent.parent;
              if (
                invocation.type === "CallExpression" &&
                invocation.arguments[0] === parent &&
                isEffectSync(context, invocation.callee)
              )
                context.report({ node, messageId: "invalid" });
              return;
            }
          }
        },
      }),
    ),
    // The upstream poll rule accepts any return, but generator returns are values,
    // not awaited promises. Effect.gen therefore needs this additional guard.
    "no-generator-poll-return": rule(
      "Await polling assertions inside Effect.promise instead of returning them from a generator.",
      (context) => ({
        ReturnStatement(node) {
          if (!node.argument) return;
          const call = chain(node.argument);
          if (
            !call ||
            importedName(context, call.root) !== "expect" ||
            call.members[0] !== "poll"
          )
            return;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (
              [
                "FunctionExpression",
                "FunctionDeclaration",
                "ArrowFunctionExpression",
              ].includes(parent.type)
            ) {
              if (parent.generator)
                context.report({ node, messageId: "invalid" });
              return;
            }
          }
        },
      }),
    ),
    "no-conditional-assertions": rule(
      "Assertions must not be conditional, caught or inside loops.",
      (context) => ({
        CallExpression(node) {
          const call = chain(node.callee);
          if (
            !call ||
            importedName(context, call.root) !== "expect" ||
            !(
              call.members.length === 0 ||
              (call.members.length === 1 && call.members[0] === "poll")
            )
          )
            return;
          let child = node;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (
              [
                "IfStatement",
                "SwitchCase",
                "CatchClause",
                "ForStatement",
                "ForOfStatement",
                "ForInStatement",
                "WhileStatement",
                "DoWhileStatement",
              ].includes(parent.type) ||
              (parent.type === "CallExpression" &&
                parent.callee.type === "MemberExpression" &&
                (parent.callee.computed
                  ? parent.callee.property.value
                  : parent.callee.property.name) === "catch" &&
                parent.arguments.includes(child)) ||
              (parent.type === "LogicalExpression" && parent.right === child) ||
              (parent.type === "ConditionalExpression" && parent.test !== child)
            ) {
              context.report({ node, messageId: "invalid" });
              return;
            }
            child = parent;
          }
        },
      }),
    ),
    "no-duplicate-titles": rule(
      "Duplicate test or suite title in the same suite.",
      (context) => {
        const scopes = [{ test: new Set(), suite: new Set() }];
        const suites = new WeakSet();
        return {
          CallExpression(node) {
            const call = registration(context, node);
            if (!call) return;
            const argument = node.arguments[0];
            const title =
              argument?.type === "Literal"
                ? argument.value
                : argument?.type === "TemplateLiteral" &&
                    argument.expressions.length === 0
                  ? argument.quasis[0].value.cooked
                  : undefined;
            const titles = scopes.at(-1)[call.suite ? "suite" : "test"];
            if (typeof title === "string") {
              if (titles.has(title))
                context.report({ node: argument, messageId: "invalid" });
              titles.add(title);
            }
            if (call.suite) {
              scopes.push({ test: new Set(), suite: new Set() });
              suites.add(node);
            }
          },
          "CallExpression:exit"(node) {
            if (suites.has(node)) scopes.pop();
          },
        };
      },
    ),
    "no-skipped-tests": rule(
      "Skipped, todo, conditional or bodyless tests are forbidden.",
      (context) => ({
        CallExpression(node) {
          const call = registration(context, node);
          if (
            call &&
            (call.members.some((member) =>
              ["skip", "todo", "skipIf", "runIf"].includes(member),
            ) ||
              enabledOption(node, ["skip", "todo"]) ||
              node.arguments.length < 2)
          )
            context.report({ node, messageId: "invalid" });
        },
      }),
    ),
    "no-focused-tests": rule(
      "Focused tests or suites are forbidden.",
      (context) => ({
        CallExpression(node) {
          if (
            registration(context, node) &&
            (registration(context, node).members.includes("only") ||
              enabledOption(node, ["only"]))
          )
            context.report({ node, messageId: "invalid" });
        },
      }),
    ),
  },
};
