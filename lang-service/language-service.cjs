"use strict"

function init(modules) {
  const ts = modules.typescript
  return {
    create(info) {
      const service = info.languageService
      const proxy = Object.create(null)
      for (const key of Object.keys(service)) {
        const value = service[key]
        proxy[key] = typeof value === "function" ? value.bind(service) : value
      }
      proxy.getSemanticDiagnostics = (fileName) =>
        filterDiagnostics(service.getSemanticDiagnostics(fileName), fileName, service, ts)
      proxy.getSyntacticDiagnostics = (fileName) =>
        filterDiagnostics(service.getSyntacticDiagnostics(fileName), fileName, service, ts)
      proxy.getSuggestionDiagnostics = (fileName) =>
        filterDiagnostics(service.getSuggestionDiagnostics(fileName), fileName, service, ts)
      return proxy
    },
  }
}

function filterDiagnostics(diagnostics, fileName, service, ts) {
  const sourceFile = service.getProgram()?.getSourceFile(fileName)
  if (!sourceFile) {
    return diagnostics
  }
  return diagnostics.filter(
    (diagnostic) =>
      !isRemarkOnFunction(diagnostic, sourceFile, ts) &&
      !isUnusedFunctionDecorator(diagnostic, sourceFile, ts),
  )
}

function isRemarkOnFunction(diagnostic, sourceFile, ts) {
  if (diagnostic.code !== 1206 || diagnostic.start == null) {
    return false
  }
  let node = findNode(sourceFile, diagnostic.start, ts)
  while (node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      return false
    }
    if (ts.isFunctionDeclaration(node) && hasDecoratorNamed(node, ts, "Remark")) {
      return true
    }
    node = node.parent
  }
  return false
}

function isUnusedFunctionDecorator(diagnostic, sourceFile, ts) {
  if (diagnostic.start == null || (diagnostic.code !== 6133 && diagnostic.code !== 6192)) {
    return false
  }
  const node = findNode(sourceFile, diagnostic.start, ts)
  const names =
    diagnostic.code === 6192
      ? namesFromImport(findAncestor(node, ts.isImportDeclaration), ts)
      : [quotedDiagnosticName(diagnostic, ts) ?? unusedBindingName(node, ts)].filter(Boolean)
  return names.length > 0 && names.every((name) => hasFunctionDecoratorNamed(sourceFile, ts, name))
}

function quotedDiagnosticName(diagnostic, ts) {
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  return text.match(/^'([^']+)'/)?.[1]
}

function namesFromImport(declaration, ts) {
  if (!declaration?.importClause) {
    return []
  }
  const names = []
  const clause = declaration.importClause
  if (clause.name) {
    names.push(clause.name.text)
  }
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const specifier of clause.namedBindings.elements) {
      names.push(specifier.name.text)
    }
  }
  return names
}

function unusedBindingName(node, ts) {
  let current = node
  while (current) {
    if (ts.isIdentifier(current)) {
      return current.text
    }
    if (ts.isImportSpecifier(current)) {
      return current.name.text
    }
    if (ts.isImportClause(current) && current.name) {
      return current.name.text
    }
    if (ts.isNamespaceImport(current)) {
      return current.name.text
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

function hasFunctionDecoratorNamed(sourceFile, ts, name) {
  let found = false
  const visit = (node) => {
    if (found) {
      return
    }
    if (ts.isFunctionDeclaration(node) && hasDecoratorNamed(node, ts, name)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function hasDecoratorNamed(node, ts, name) {
  const decorators = ts.canHaveDecorators?.(node)
    ? ts.getDecorators(node) ?? []
    : [...(node.modifiers ?? [])].filter((modifier) => ts.isDecorator(modifier))
  return decorators.some((decorator) => decoratorName(decorator, ts) === name)
}

function decoratorName(decorator, ts) {
  const expr = decorator.expression
  const callee = ts.isCallExpression(expr) ? expr.expression : expr
  if (ts.isIdentifier(callee)) {
    return callee.text
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text
  }
  return undefined
}

function findAncestor(node, predicate) {
  let current = node
  while (current) {
    if (predicate(current)) {
      return current
    }
    current = current.parent
  }
  return undefined
}

function findNode(sourceFile, position, ts) {
  let found = sourceFile
  const visit = (node) => {
    if (position >= node.getStart(sourceFile) && position < node.end) {
      found = node
      ts.forEachChild(node, visit)
    }
  }
  ts.forEachChild(sourceFile, visit)
  return found
}

module.exports = init
