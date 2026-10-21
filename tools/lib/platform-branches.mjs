// Count the per-platform branch sites in one consumer source file (FR-009, NFR-004 of B-018).
//
// A site is a place where the file names one platform: it constructs or calls something imported
// from a platform package, calls a method only one platform's adapter has, compares against a
// platform name, tests `instanceof` a platform class, reaches a relative module (an import, a
// re-export, `import()` or `require`, type-only ones included — this tool cannot see into it, so
// it fails closed and counts it), or tests membership in / indexes a table keyed by a platform
// name. The kinds and their order are NFR-004's; a node matching two takes the first.
//
// It parses with the TypeScript compiler, because a text match missed every spelling the alignment
// refusals listed. What it does NOT see, by the brief's own statement: a property access named
// after a platform (`config.line`), a name computed at runtime, a platform-keyed object indexed
// somewhere other than where it is written, and a platform literal used as data. Nor, measured
// while it was written: an alias of an imported binding (`const C = LineAdapter; new C()`), a
// tagged template call, a method called by element access (`a["dispatchWebhookBody"](e)`), a
// computed key (`({ ["line"]: a })[p]`), a `Map` built inline from platform-keyed pairs, and a
// bound name's scope (a `const L = "line"` anywhere marks every `L` in the file). Any method call
// with a platform literal argument counts as membership, `console.log("line")` included. So a
// count is a measurement of a file, not a proof that the file has no platform branch.

import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

/**
 * The values of `PlatformName` in `packages/gateway/src/types/message-event.ts`. A tool cannot
 * import a TypeScript type, so the list is written here and a test reads the union with the type
 * checker and asserts the two are equal.
 */
export const PLATFORM_NAMES = Object.freeze([
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "matrix",
  "mattermost",
  "email",
  "sms",
  "line",
  "teams",
  "signal",
  "imessage",
  "google_chat",
]);

/** Methods only one platform's adapter has; calling one is a branch on that platform. */
const PLATFORM_METHODS = new Set(["dispatchWebhookBody", "getChannelSecret", "getBot"]);

const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * `@theokit/gateway-<suffix>` and its subpaths. A hyphenated suffix names an underscored key:
 * `gateway-google-chat` is `google_chat` (plan D1).
 */
const PLATFORM_PACKAGE = /^@theokit\/gateway-([a-z]+(?:-[a-z]+)*)(?:\/.*)?$/;

function isPlatformName(text) {
  return PLATFORM_NAMES.includes(text);
}

/** Strip the wrappers that change a node's type but not its value. */
function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isRelative(specifier) {
  return specifier.startsWith(".");
}

function isPlatformLiteral(node) {
  const n = unwrap(node);
  return (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && isPlatformName(n.text);
}

function holdsPlatformLiteral(node) {
  const n = unwrap(node);
  return (
    isPlatformLiteral(n) || (ts.isArrayLiteralExpression(n) && n.elements.some(isPlatformLiteral))
  );
}

/** Throws when the compiler reports a syntax error: a count over an unread file is fail-open. */
function assertParses(source, fileName) {
  const { diagnostics = [] } = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length === 0) return;
  const first = errors[0];
  const where =
    first.file !== undefined && first.start !== undefined
      ? `:${first.file.getLineAndCharacterOfPosition(first.start).line + 1}`
      : "";
  const message = ts.flattenDiagnosticMessageText(first.messageText, "\n");
  throw new Error(`${fileName}${where}: cannot parse: ${message}`);
}

/** The import and re-export declarations of a file whose module specifier is a string literal. */
function moduleDeclarationsOf(sourceFile) {
  return sourceFile.statements.filter(
    (s) =>
      (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
      s.moduleSpecifier !== undefined &&
      ts.isStringLiteral(s.moduleSpecifier),
  );
}

/** Is this specifier a platform package, `@theokit/gateway-<suffix>`, the suffix being the key with `_` as `-`? */
function isPlatformPackage(specifier) {
  const match = PLATFORM_PACKAGE.exec(specifier);
  return match !== null && isPlatformName(match[1].replaceAll("-", "_"));
}

/** Add the local names one import clause binds: descriptors (`*Channel`) apart from the rest. */
function addBindings(clause, scope) {
  if (clause.name !== undefined) scope.platformBindings.add(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings === undefined) return;
  if (ts.isNamespaceImport(bindings)) {
    scope.platformBindings.add(bindings.name.text);
    return;
  }
  for (const element of bindings.elements) {
    const imported = (element.propertyName ?? element.name).text;
    const target = imported.endsWith("Channel") ? scope.descriptors : scope.platformBindings;
    target.add(element.name.text);
  }
}

/** Pass 1: bindings imported from platform packages; a relative import is recorded as a site. */
function collectImports(sourceFile, scope, siteAt) {
  for (const statement of moduleDeclarationsOf(sourceFile)) {
    const specifier = statement.moduleSpecifier.text;
    if (isRelative(specifier)) {
      siteAt(statement, "relative_import");
    } else if (
      ts.isImportDeclaration(statement) &&
      isPlatformPackage(specifier) &&
      statement.importClause !== undefined
    ) {
      addBindings(statement.importClause, scope);
    }
  }
}

function variableDeclarationsOf(sourceFile) {
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

/** Pass 2: same-file bindings whose initializer is a platform name, a descriptor, or another one. */
function collectBoundNames(sourceFile, scope) {
  const pending = variableDeclarationsOf(sourceFile);
  let grew = true;
  while (grew) {
    const before = scope.bound.size;
    for (const declaration of pending) {
      if (isPlatformOperand(declaration.initializer, scope)) scope.bound.add(declaration.name.text);
    }
    grew = scope.bound.size > before;
  }
}

/** A platform literal, a descriptor identifier, or an identifier bound to one of those. */
function isPlatformOperand(node, scope) {
  const n = unwrap(node);
  if (isPlatformLiteral(n)) return true;
  return ts.isIdentifier(n) && (scope.descriptors.has(n.text) || scope.bound.has(n.text));
}

/** An imported platform binding, or a member reached from one (`Line.LineAdapter`, `A.fromEnv`). */
function isPlatformBinding(node, scope) {
  let root = unwrap(node);
  while (ts.isPropertyAccessExpression(root)) root = unwrap(root.expression);
  return ts.isIdentifier(root) && scope.platformBindings.has(root.text);
}

/** `import("./x")` or `require("./x")`: a module this tool cannot read. */
function isRelativeLoad(node) {
  const callee = node.expression;
  const loads =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  const [first] = node.arguments;
  return loads && first !== undefined && ts.isStringLiteral(first) && isRelative(first.text);
}

function isObjectIs(callee) {
  return (
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Object" &&
    callee.name.text === "is"
  );
}

/** Kinds (a), (b), (c) for `Object.is`, and (f) for a membership call — in NFR-004 order. */
function classifyCall(node, scope) {
  if (isRelativeLoad(node)) return "relative_import";
  const callee = node.expression;
  if (isPlatformBinding(callee, scope)) return "call";
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (PLATFORM_METHODS.has(callee.name.text)) return "platform_method";
  if (isObjectIs(callee)) {
    return node.arguments.some((arg) => isPlatformOperand(arg, scope)) ? "comparison" : undefined;
  }
  const member =
    holdsPlatformLiteral(callee.expression) || node.arguments.some(holdsPlatformLiteral);
  return member ? "membership" : undefined;
}

/** Kind (c) for `==`/`===`/`!=`/`!==`, and kind (d) for `instanceof`. */
function classifyBinary(node, scope) {
  const operator = node.operatorToken.kind;
  const either = isPlatformOperand(node.left, scope) || isPlatformOperand(node.right, scope);
  if (EQUALITY.has(operator) && either) return "comparison";
  if (
    operator === ts.SyntaxKind.InstanceOfKeyword &&
    isPlatformBinding(unwrap(node.right), scope)
  ) {
    return "instanceof";
  }
  return undefined;
}

function hasPlatformKey(property) {
  const name = property.name;
  if (name === undefined) return false;
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && isPlatformName(name.text);
}

/** Kind (f) for an element access on an object literal keyed by a platform name. */
function isDispatchTable(node) {
  const object = unwrap(node.expression);
  return ts.isObjectLiteralExpression(object) && object.properties.some(hasPlatformKey);
}

const CLASSIFIERS = [
  [
    ts.isNewExpression,
    (n, scope) => (isPlatformBinding(n.expression, scope) ? "construct" : undefined),
  ],
  [ts.isCallExpression, classifyCall],
  [ts.isBinaryExpression, classifyBinary],
  [
    ts.isCaseClause,
    (n, scope) => (isPlatformOperand(n.expression, scope) ? "comparison" : undefined),
  ],
  [ts.isElementAccessExpression, (n) => (isDispatchTable(n) ? "dispatch_table" : undefined)],
];

/** The site kind of one node, or undefined. Each node yields at most one site. */
function classify(node, scope) {
  const entry = CLASSIFIERS.find(([matches]) => matches(node));
  return entry === undefined ? undefined : entry[1](node, scope);
}

/**
 * @param {string} source a TypeScript or JavaScript module
 * @param {{ fileName?: string }} [options] the name a parse error is reported under
 * @returns {{ count: number, sites: Array<{ line: number, kind: string, text: string }> }}
 * @throws {Error} when the source does not parse, naming the file and the first diagnostic
 */
export function countPlatformBranches(source, { fileName = "source.ts" } = {}) {
  assertParses(source, fileName);
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const sites = [];
  const siteAt = (node, kind) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    sites.push({ line, kind, text: node.getText(sourceFile) });
  };

  const scope = { descriptors: new Set(), platformBindings: new Set(), bound: new Set() };
  collectImports(sourceFile, scope, siteAt);
  collectBoundNames(sourceFile, scope);

  const visit = (node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
      const kind = classify(node, scope);
      if (kind !== undefined) siteAt(node, kind);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  sites.sort((a, b) => a.line - b.line);
  return { count: sites.length, sites };
}
