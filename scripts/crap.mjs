import assert from "node:assert/strict";
import ts from "typescript";

const functions = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

/** Score runtime functions using source AST identity and their own statements. */
export function scoreFile(file, source, report) {
  assert(
    !/(?:v8|istanbul|c8)\s+ignore|coverage\s+ignore/i.test(source),
    "Coverage ignore directives are forbidden",
  );
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  assert.equal(ast.parseDiagnostics.length, 0, `Invalid TypeScript: ${file}`);
  const nodes = [];
  function collect(node) {
    if (functions.has(node.kind) && node.body) nodes.push(node);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  const offset = ({ line, column }, allowNull = false) => {
    assert(
      Number.isInteger(line) && line > 0 && line <= ast.getLineStarts().length,
      "Invalid coverage line",
    );
    const start = ast.getLineStarts()[line - 1];
    const end = source.indexOf("\n", start);
    const length = (end < 0 ? source.length : end) - start;
    assert(
      (allowNull && column === null) ||
        (Number.isInteger(column) && column >= 0 && column <= length),
      "Invalid coverage column",
    );
    return start + (column ?? length);
  };
  const ranges = nodes.map((node) => ({
    node,
    start: node.body.getStart(ast),
    end: node.body.end,
  }));
  const owner = (position) =>
    ranges
      .filter(({ start, end }) => start <= position && position < end)
      .sort((a, b) => b.start - a.start)[0];
  assert(report && report.path === file, `Missing coverage: ${file}`);
  const functionIds = Object.keys(report.fnMap);
  const statements = Object.entries(report.statementMap).map(([id, loc]) => {
    const start = offset(loc.start);
    assert(offset(loc.end, true) >= start, "Invalid statement range");
    assert(
      Number.isInteger(report.s[id]) && report.s[id] >= 0,
      "Invalid statement count",
    );
    return { owner: owner(start), hits: report.s[id] };
  });
  assert.deepEqual(
    Object.keys(report.s),
    Object.keys(report.statementMap),
    "Statement inventory mismatch",
  );
  assert.deepEqual(
    Object.keys(report.f),
    functionIds,
    "Function inventory mismatch",
  );
  const matched = new Set();
  const scores = ranges.map((range) => {
    const { node, start, end } = range;
    const ids = functionIds.filter((id) => {
      const loc = report.fnMap[id].loc;
      return (
        offset(loc.start) === start &&
        offset(loc.end, true) >= end &&
        loc.end.line === ast.getLineAndCharacterOfPosition(end).line + 1
      );
    });
    assert.equal(
      ids.length,
      1,
      `Unusable function attribution: ${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`,
    );
    const id = ids[0];
    assert(!matched.has(id), "Ambiguous function attribution");
    matched.add(id);
    const hits = report.f[id];
    assert(Number.isInteger(hits) && hits >= 0, "Invalid function count");
    let complexity = 1;
    function visit(child) {
      if (child !== node && functions.has(child.kind)) return;
      if (ts.isTypeNode(child)) return;
      if (
        [
          ts.SyntaxKind.IfStatement,
          ts.SyntaxKind.ConditionalExpression,
          ts.SyntaxKind.ForStatement,
          ts.SyntaxKind.ForInStatement,
          ts.SyntaxKind.ForOfStatement,
          ts.SyntaxKind.WhileStatement,
          ts.SyntaxKind.DoStatement,
          ts.SyntaxKind.CaseClause,
          ts.SyntaxKind.CatchClause,
        ].includes(child.kind)
      )
        complexity++;
      if (
        ts.isBinaryExpression(child) &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.AmpersandAmpersandEqualsToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
        ].includes(child.operatorToken.kind)
      )
        complexity++;
      if (child.questionDotToken) complexity++;
      if (ts.isParameter(child) && child.initializer) complexity++;
      ts.forEachChild(child, visit);
    }
    visit(node);
    const own = statements.filter((statement) => statement.owner === range);
    assert(
      own.length > 0 ||
        (ts.isBlock(node.body) && node.body.statements.length === 0),
      `Missing statement evidence: ${file}:${node.getStart(ast)}`,
    );
    const coverage =
      hits === 0
        ? 0
        : own.length
          ? own.filter(({ hits }) => hits > 0).length / own.length
          : 1;
    return {
      file,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      column: ast.getLineAndCharacterOfPosition(node.getStart(ast)).character,
      name: node.name?.getText(ast) ?? "<anonymous>",
      complexity,
      coverage,
      score: complexity ** 2 * (1 - coverage) ** 3 + complexity,
    };
  });
  assert.equal(
    matched.size,
    functionIds.length,
    `Unmatched coverage functions: ${file}`,
  );
  return scores;
}

export function enforceScores(scores) {
  const failures = scores.filter(({ score }) => score > 30);
  assert.equal(
    failures.length,
    0,
    failures
      .map(
        ({ file, line, name, score }) =>
          `${file}:${line} ${name}: CRAP ${score} exceeds 30`,
      )
      .join("\n"),
  );
}
