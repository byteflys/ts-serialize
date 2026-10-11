import ts from "typescript"

const SERIALIZE_DECORATORS = new Set(["Serializable", "Field", "Transient", "Convert", "Alias"])
const CODEC_APIS = new Set(["fromJson", "fromPlain", "fromPlainList", "toJson", "toPlain"])

export function createSerializerTransformer(_program?: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const factory = context.factory
    return (sourceFile) => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isCallExpression(node)) {
          return rewriteCodecCall(node, factory, (child) => ts.visitEachChild(child, visit, context))
        }
        if (ts.isClassDeclaration(node) && hasDecorator(node, "Serializable")) {
          return transformSerializableClass(node, factory, (child) => ts.visitEachChild(child, visit, context))
        }
        if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) {
          const statements = flattenStatements(node.body.statements, factory, visit)
          return factory.updateModuleDeclaration(
            node,
            node.modifiers,
            node.name,
            factory.updateModuleBlock(node.body, statements),
          )
        }
        if (ts.isSourceFile(node)) {
          return factory.updateSourceFile(node, flattenStatements(node.statements, factory, visit))
        }
        return ts.visitEachChild(node, visit, context)
      }
      return visit(sourceFile) as ts.SourceFile
    }
  }
}

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return createSerializerTransformer(program)
}

function flattenStatements(
  statements: readonly ts.Statement[],
  factory: ts.NodeFactory,
  visit: (node: ts.Node) => ts.Node,
): ts.Statement[] {
  const out: ts.Statement[] = []
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && hasDecorator(statement, "Remark")) {
      out.push(...transformRemarkFunction(statement, factory))
      continue
    }
    out.push(visit(statement) as ts.Statement)
  }
  return out
}

function transformRemarkFunction(fn: ts.FunctionDeclaration, factory: ts.NodeFactory): ts.Statement[] {
  const messages = decoratorsOf(fn)
    .filter((decorator) => decoratorName(decorator) === "Remark")
    .map(decoratorStringArg)
    .filter((message): message is string => Boolean(message))
  const modifiers = fn.modifiers?.filter((modifier) => !ts.isDecorator(modifier) || decoratorName(modifier) !== "Remark")
  const updated = factory.updateFunctionDeclaration(
    fn,
    modifiers,
    fn.asteriskToken,
    fn.name,
    fn.typeParameters,
    fn.parameters,
    fn.type,
    fn.body,
  )
  if (!fn.name || messages.length === 0) {
    return [updated]
  }
  return [
    updated,
    factory.createExpressionStatement(
      factory.createAssignment(
        factory.createPropertyAccessExpression(factory.createIdentifier(fn.name.text), "__remark"),
        factory.createStringLiteral(messages.join("\n")),
      ),
    ),
  ]
}

function transformSerializableClass(
  node: ts.ClassDeclaration,
  factory: ts.NodeFactory,
  visit: (node: ts.Node) => ts.Node,
): ts.ClassDeclaration {
  const className = node.name
  if (!className) {
    return ts.visitEachChild(node, visit, undefined as never)
  }
  const typeParams = (node.typeParameters ?? []).map((param) => param.name.text)
  const fieldExprs = collectFieldExprs(node, factory, typeParams)
  const parent = getParentHeritage(node)
  const inherited = parent
    ? inheritedFieldsExpr(
        factory,
        parent.name,
        (parent.typeArguments ?? []).map((arg) => typeNodeToIR(arg, factory, typeParams)),
      )
    : undefined
  const fieldsExpr = inherited
    ? factory.createArrayLiteralExpression([factory.createSpreadElement(inherited), ...fieldExprs])
    : factory.createArrayLiteralExpression(fieldExprs)

  const irExpr = objectExpr(factory, {
    kind: factory.createStringLiteral("class"),
    ctor: factory.createIdentifier(className.text),
    typeArgs: factory.createArrayLiteralExpression([]),
    fields: fieldsExpr,
  })

  const staticBlock = factory.createClassStaticBlockDeclaration(
    factory.createBlock([
      factory.createExpressionStatement(
        factory.createAssignment(
          factory.createPropertyAccessExpression(factory.createIdentifier(className.text), "__ir"),
          irExpr,
        ),
      ),
    ]),
  )

  const members = node.members
    .map((member) => stripMemberDecorators(visit(member) as ts.ClassElement, factory))
    .concat(staticBlock)

  return factory.updateClassDeclaration(
    node,
    node.modifiers?.filter((modifier) => !ts.isDecorator(modifier) || !SERIALIZE_DECORATORS.has(decoratorName(modifier) ?? "")),
    node.name,
    node.typeParameters,
    node.heritageClauses,
    members,
  )
}

function collectFieldExprs(
  node: ts.ClassDeclaration,
  factory: ts.NodeFactory,
  typeParams: string[],
): ts.Expression[] {
  const fields: ts.Expression[] = []
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || isStatic(member) || ts.isPrivateIdentifier(member.name)) {
      continue
    }
    if (member.exclamationToken === undefined && member.questionToken === undefined && member.initializer === undefined && !member.type) {
      continue
    }
    const name = propertyNameText(member.name)
    if (!name) {
      continue
    }
    const options = readFieldOptions(member, factory, typeParams)
    if (options.skip) {
      continue
    }
    const props: Record<string, ts.Expression> = {
      key: factory.createStringLiteral(name),
      type: options.type,
    }
    if (options.jsonName) {
      props.jsonName = factory.createStringLiteral(options.jsonName)
    }
    if (options.optional || member.questionToken) {
      props.optional = factory.createTrue()
    }
    if (options.transient) {
      props.transient = factory.createTrue()
    }
    if (options.convert) {
      props.convert = factory.createStringLiteral(options.convert)
    }
    fields.push(objectExpr(factory, props))
  }
  return fields
}

function readFieldOptions(
  member: ts.PropertyDeclaration,
  factory: ts.NodeFactory,
  typeParams: string[],
): { type: ts.Expression; jsonName?: string; optional?: boolean; transient?: boolean; convert?: string; skip?: boolean } {
  let jsonName: string | undefined
  let optional = false
  let transient = false
  let convert: string | undefined
  let type = inferTypeExpr(member, factory, typeParams)

  for (const decorator of decoratorsOf(member)) {
    const name = decoratorName(decorator)
    if (name === "Transient") {
      transient = true
    }
    if (name === "Convert") {
      convert = decoratorStringArg(decorator) ?? convert
    }
    if (name === "Alias") {
      jsonName = decoratorStringArg(decorator) ?? jsonName
    }
    if (name === "Field") {
      const literal = decoratorObjectArg(decorator)
      if (literal) {
        jsonName = readStringProp(literal, "name") ?? jsonName
        convert = readStringProp(literal, "convert") ?? convert
        optional = readBooleanProp(literal, "optional") || optional
        transient = readBooleanProp(literal, "transient") || transient
        const typeProp = readProp(literal, "type")
        if (typeProp) {
          type = typeOptionToIR(typeProp, factory, typeParams) ?? type
        }
      }
    }
  }

  return { type, jsonName, optional, transient, convert }
}

function inferTypeExpr(
  member: ts.PropertyDeclaration,
  factory: ts.NodeFactory,
  typeParams: string[],
): ts.Expression {
  if (member.type) {
    return typeNodeToIR(member.type, factory, typeParams)
  }
  if (member.initializer) {
    return inferFromInitializer(member.initializer, factory, typeParams)
  }
  return objectExpr(factory, { kind: factory.createStringLiteral("any") })
}

function inferFromInitializer(
  init: ts.Expression,
  factory: ts.NodeFactory,
  typeParams: string[],
): ts.Expression {
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return objectExpr(factory, { kind: factory.createStringLiteral("string") })
  }
  if (ts.isNumericLiteral(init)) {
    return objectExpr(factory, { kind: factory.createStringLiteral("number") })
  }
  if (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword) {
    return objectExpr(factory, { kind: factory.createStringLiteral("boolean") })
  }
  if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
    return typeReferenceToIR(init.expression.text, init.typeArguments, factory, typeParams)
  }
  if (ts.isArrayLiteralExpression(init)) {
    const item = init.elements[0]
      ? inferFromInitializer(init.elements[0], factory, typeParams)
      : objectExpr(factory, { kind: factory.createStringLiteral("any") })
    return objectExpr(factory, { kind: factory.createStringLiteral("array"), item })
  }
  return objectExpr(factory, { kind: factory.createStringLiteral("any") })
}

function typeNodeToIR(type: ts.TypeNode, factory: ts.NodeFactory, typeParams: string[]): ts.Expression {
  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
      return objectExpr(factory, { kind: factory.createStringLiteral("string") })
    case ts.SyntaxKind.NumberKeyword:
      return objectExpr(factory, { kind: factory.createStringLiteral("number") })
    case ts.SyntaxKind.BooleanKeyword:
      return objectExpr(factory, { kind: factory.createStringLiteral("boolean") })
    case ts.SyntaxKind.BigIntKeyword:
      return objectExpr(factory, { kind: factory.createStringLiteral("bigint") })
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return objectExpr(factory, { kind: factory.createStringLiteral("any") })
    default:
      break
  }
  if (ts.isLiteralTypeNode(type) && (ts.isStringLiteral(type.literal) || ts.isNumericLiteral(type.literal))) {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("literal"),
      value: type.literal,
    })
  }
  if (ts.isArrayTypeNode(type)) {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("array"),
      item: typeNodeToIR(type.elementType, factory, typeParams),
    })
  }
  if (ts.isUnionTypeNode(type)) {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("union"),
      variants: factory.createArrayLiteralExpression(
        type.types.map((variant) => typeNodeToIR(variant, factory, typeParams)),
      ),
    })
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = entityNameText(type.typeName)
    return typeReferenceToIR(name, type.typeArguments, factory, typeParams)
  }
  return objectExpr(factory, { kind: factory.createStringLiteral("any") })
}

function typeReferenceToIR(
  name: string,
  typeArguments: readonly ts.TypeNode[] | undefined,
  factory: ts.NodeFactory,
  typeParams: string[],
): ts.Expression {
  const genericIndex = typeParams.indexOf(name)
  if (genericIndex >= 0) {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("generic"),
      index: factory.createNumericLiteral(genericIndex),
    })
  }
  if (name === "String") {
    return objectExpr(factory, { kind: factory.createStringLiteral("string") })
  }
  if (name === "Number") {
    return objectExpr(factory, { kind: factory.createStringLiteral("number") })
  }
  if (name === "Boolean") {
    return objectExpr(factory, { kind: factory.createStringLiteral("boolean") })
  }
  if (name === "BigInt") {
    return objectExpr(factory, { kind: factory.createStringLiteral("bigint") })
  }
  if (name === "Date") {
    return objectExpr(factory, { kind: factory.createStringLiteral("date") })
  }
  if (name === "Array") {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("array"),
      item: typeArguments?.[0]
        ? typeNodeToIR(typeArguments[0], factory, typeParams)
        : objectExpr(factory, { kind: factory.createStringLiteral("any") }),
    })
  }
  if (name === "Set") {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("set"),
      item: typeArguments?.[0]
        ? typeNodeToIR(typeArguments[0], factory, typeParams)
        : objectExpr(factory, { kind: factory.createStringLiteral("any") }),
    })
  }
  if (name === "Map") {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("map"),
      key: typeArguments?.[0]
        ? typeNodeToIR(typeArguments[0], factory, typeParams)
        : objectExpr(factory, { kind: factory.createStringLiteral("string") }),
      value: typeArguments?.[1]
        ? typeNodeToIR(typeArguments[1], factory, typeParams)
        : objectExpr(factory, { kind: factory.createStringLiteral("any") }),
    })
  }
  const typeArgs = (typeArguments ?? []).map((arg) => typeNodeToIR(arg, factory, typeParams))
  return objectExpr(factory, {
    kind: factory.createStringLiteral("class"),
    ctor: factory.createIdentifier(name),
    typeArgs: factory.createArrayLiteralExpression(typeArgs),
    fields: factory.createArrayLiteralExpression([]),
  })
}

function typeOptionToIR(
  expr: ts.Expression,
  factory: ts.NodeFactory,
  typeParams: string[],
): ts.Expression | undefined {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    const body = ts.isBlock(expr.body)
      ? undefined
      : expr.body
    if (body) {
      return typeOptionToIR(body, factory, typeParams)
    }
  }
  if (ts.isIdentifier(expr)) {
    return typeReferenceToIR(expr.text, undefined, factory, typeParams)
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "type") {
    const [ctor, ...args] = expr.arguments
    if (ctor && ts.isIdentifier(ctor)) {
      const typeArgNodes = args.flatMap((arg) =>
        ts.isIdentifier(arg) ? [factory.createTypeReferenceNode(arg.text)] : [],
      )
      if (ctor.text === "Map" || ctor.text === "Set" || ctor.text === "Array") {
        return typeReferenceToIR(ctor.text, typeArgNodes, factory, typeParams)
      }
      return objectExpr(factory, {
        kind: factory.createStringLiteral("class"),
        ctor: factory.createIdentifier(ctor.text),
        typeArgs: factory.createArrayLiteralExpression(
          args.flatMap((arg) => (ts.isIdentifier(arg) ? [typeReferenceToIR(arg.text, undefined, factory, typeParams)] : [])),
        ),
        fields: factory.createArrayLiteralExpression([]),
      })
    }
  }
  return undefined
}

function rewriteCodecCall(
  node: ts.CallExpression,
  factory: ts.NodeFactory,
  visit: (node: ts.CallExpression) => ts.CallExpression,
): ts.CallExpression {
  const visited = visit(node)
  if (!visited.typeArguments?.length || visited.arguments.length !== 1) {
    return visited
  }
  if (!isCodecIdentifier(visited.expression)) {
    return visited
  }
  const ir = typeNodeToCallIR(visited.typeArguments[0], factory)
  return factory.updateCallExpression(
    visited,
    visited.expression,
    undefined,
    [visited.arguments[0], ir],
  )
}

function isCodecIdentifier(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) {
    return CODEC_APIS.has(expr.text)
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return CODEC_APIS.has(expr.name.text)
  }
  return false
}

function typeNodeToCallIR(type: ts.TypeNode, factory: ts.NodeFactory): ts.Expression {
  if (ts.isArrayTypeNode(type)) {
    return objectExpr(factory, {
      kind: factory.createStringLiteral("array"),
      item: typeNodeToCallIR(type.elementType, factory),
    })
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = entityNameText(type.typeName)
    if (name === "Date") {
      return objectExpr(factory, { kind: factory.createStringLiteral("date") })
    }
    if (name === "Array" && type.typeArguments?.[0]) {
      return objectExpr(factory, {
        kind: factory.createStringLiteral("array"),
        item: typeNodeToCallIR(type.typeArguments[0], factory),
      })
    }
    if (name === "Set") {
      return objectExpr(factory, {
        kind: factory.createStringLiteral("set"),
        item: type.typeArguments?.[0]
          ? typeNodeToCallIR(type.typeArguments[0], factory)
          : objectExpr(factory, { kind: factory.createStringLiteral("any") }),
      })
    }
    if (name === "Map") {
      return objectExpr(factory, {
        kind: factory.createStringLiteral("map"),
        key: type.typeArguments?.[0]
          ? typeNodeToCallIR(type.typeArguments[0], factory)
          : objectExpr(factory, { kind: factory.createStringLiteral("string") }),
        value: type.typeArguments?.[1]
          ? typeNodeToCallIR(type.typeArguments[1], factory)
          : objectExpr(factory, { kind: factory.createStringLiteral("any") }),
      })
    }
    const ctor = factory.createIdentifier(name)
    if (!type.typeArguments?.length) {
      return factory.createPropertyAccessExpression(ctor, "__ir")
    }
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "assign"),
      undefined,
      [
        factory.createObjectLiteralExpression([]),
        factory.createPropertyAccessExpression(ctor, "__ir"),
        objectExpr(factory, {
          typeArgs: factory.createArrayLiteralExpression(
            type.typeArguments.map((arg) => typeNodeToCallIR(arg, factory)),
          ),
        }),
      ],
    )
  }
  return typeNodeToIR(type, factory, [])
}

function stripMemberDecorators(member: ts.ClassElement, factory: ts.NodeFactory): ts.ClassElement {
  if (!ts.isPropertyDeclaration(member)) {
    return member
  }
  const modifiers = member.modifiers?.filter(
    (modifier) => !ts.isDecorator(modifier) || !SERIALIZE_DECORATORS.has(decoratorName(modifier) ?? ""),
  )
  return factory.updatePropertyDeclaration(
    member,
    modifiers,
    member.name,
    member.questionToken ?? member.exclamationToken,
    member.type,
    member.initializer,
  )
}

function inheritedFieldsExpr(factory: ts.NodeFactory, parent: string, typeArgExprs: ts.Expression[]): ts.Expression {
  const parentIR = factory.createPropertyAccessExpression(factory.createIdentifier(parent), "__ir")
  if (typeArgExprs.length === 0) {
    return parentFieldsFallback(factory, parentIR)
  }
  return factory.createCallExpression(inheritFieldsLambda(factory), undefined, [
    parentIR,
    factory.createArrayLiteralExpression(typeArgExprs),
  ])
}

function parentFieldsFallback(factory: ts.NodeFactory, parentIR: ts.Expression): ts.Expression {
  return factory.createBinaryExpression(
    factory.createPropertyAccessChain(parentIR, factory.createToken(ts.SyntaxKind.QuestionDotToken), "fields"),
    factory.createToken(ts.SyntaxKind.QuestionQuestionToken),
    factory.createArrayLiteralExpression([]),
  )
}

function inheritFieldsLambda(factory: ts.NodeFactory): ts.Expression {
  const parentIR = factory.createIdentifier("parentIR")
  const typeArgs = factory.createIdentifier("typeArgs")
  const subst = factory.createIdentifier("subst")
  const ir = factory.createIdentifier("ir")
  const field = factory.createIdentifier("field")
  const remap = () =>
    factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("Object"), "assign"), undefined, [
      factory.createObjectLiteralExpression([]),
      field,
      objectExpr(factory, {
        type: factory.createCallExpression(subst, undefined, [factory.createPropertyAccessExpression(field, "type")]),
      }),
    ])
  const substFn = factory.createFunctionExpression(
    undefined,
    undefined,
    subst,
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, ir)],
    undefined,
    factory.createBlock([
      factory.createIfStatement(
        factory.createBinaryExpression(
          factory.createBinaryExpression(ir, ts.SyntaxKind.EqualsEqualsToken, factory.createNull()),
          ts.SyntaxKind.BarBarToken,
          factory.createBinaryExpression(
            factory.createTypeOfExpression(ir),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            factory.createStringLiteral("object"),
          ),
        ),
        factory.createReturnStatement(ir),
      ),
      factory.createSwitchStatement(
        factory.createPropertyAccessExpression(ir, "kind"),
        factory.createCaseBlock([
          factory.createCaseClause(factory.createStringLiteral("generic"), [
            factory.createReturnStatement(
              factory.createBinaryExpression(
                factory.createElementAccessExpression(typeArgs, factory.createPropertyAccessExpression(ir, "index")),
                ts.SyntaxKind.QuestionQuestionToken,
                objectExpr(factory, { kind: factory.createStringLiteral("any") }),
              ),
            ),
          ]),
          factory.createCaseClause(factory.createStringLiteral("array"), [
            factory.createReturnStatement(
              objectExpr(factory, {
                kind: factory.createStringLiteral("array"),
                item: factory.createCallExpression(subst, undefined, [factory.createPropertyAccessExpression(ir, "item")]),
              }),
            ),
          ]),
          factory.createCaseClause(factory.createStringLiteral("set"), [
            factory.createReturnStatement(
              objectExpr(factory, {
                kind: factory.createStringLiteral("set"),
                item: factory.createCallExpression(subst, undefined, [factory.createPropertyAccessExpression(ir, "item")]),
              }),
            ),
          ]),
          factory.createCaseClause(factory.createStringLiteral("map"), [
            factory.createReturnStatement(
              objectExpr(factory, {
                kind: factory.createStringLiteral("map"),
                key: factory.createCallExpression(subst, undefined, [factory.createPropertyAccessExpression(ir, "key")]),
                value: factory.createCallExpression(subst, undefined, [factory.createPropertyAccessExpression(ir, "value")]),
              }),
            ),
          ]),
          factory.createCaseClause(factory.createStringLiteral("union"), [
            factory.createReturnStatement(
              objectExpr(factory, {
                kind: factory.createStringLiteral("union"),
                variants: factory.createCallExpression(
                  factory.createPropertyAccessExpression(factory.createPropertyAccessExpression(ir, "variants"), "map"),
                  undefined,
                  [subst],
                ),
              }),
            ),
          ]),
          factory.createCaseClause(factory.createStringLiteral("class"), [
            factory.createReturnStatement(
              objectExpr(factory, {
                kind: factory.createStringLiteral("class"),
                ctor: factory.createPropertyAccessExpression(ir, "ctor"),
                typeArgs: factory.createCallExpression(
                  factory.createPropertyAccessExpression(
                    factory.createBinaryExpression(
                      factory.createPropertyAccessExpression(ir, "typeArgs"),
                      ts.SyntaxKind.QuestionQuestionToken,
                      factory.createArrayLiteralExpression([]),
                    ),
                    "map",
                  ),
                  undefined,
                  [subst],
                ),
                fields: factory.createCallExpression(
                  factory.createPropertyAccessExpression(
                    factory.createBinaryExpression(
                      factory.createPropertyAccessExpression(ir, "fields"),
                      ts.SyntaxKind.QuestionQuestionToken,
                      factory.createArrayLiteralExpression([]),
                    ),
                    "map",
                  ),
                  undefined,
                  [
                    factory.createArrowFunction(
                      undefined,
                      undefined,
                      [factory.createParameterDeclaration(undefined, undefined, field)],
                      undefined,
                      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      remap(),
                    ),
                  ],
                ),
              }),
            ),
          ]),
          factory.createDefaultClause([factory.createReturnStatement(ir)]),
        ]),
      ),
    ]),
  )
  return factory.createFunctionExpression(
    undefined,
    undefined,
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(undefined, undefined, parentIR),
      factory.createParameterDeclaration(undefined, undefined, typeArgs),
    ],
    undefined,
    factory.createBlock([
      factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(subst, undefined, undefined, substFn)],
          ts.NodeFlags.Const,
        ),
      ),
      factory.createReturnStatement(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(parentFieldsFallback(factory, parentIR), "map"),
          undefined,
          [
            factory.createArrowFunction(
              undefined,
              undefined,
              [factory.createParameterDeclaration(undefined, undefined, field)],
              undefined,
              factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              remap(),
            ),
          ],
        ),
      ),
    ]),
  )
}

function getParentHeritage(node: ts.ClassDeclaration): { name: string; typeArguments?: readonly ts.TypeNode[] } | undefined {
  const heritage = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
  const type = heritage?.types[0]
  const expr = type?.expression
  if (!expr || !ts.isIdentifier(expr)) {
    return undefined
  }
  return { name: expr.text, typeArguments: type.typeArguments }
}

function objectExpr(factory: ts.NodeFactory, props: Record<string, ts.Expression>): ts.ObjectLiteralExpression {
  return factory.createObjectLiteralExpression(
    Object.entries(props).map(([key, value]) => factory.createPropertyAssignment(key, value)),
  )
}

function decoratorsOf(node: ts.Node): ts.Decorator[] {
  if (ts.canHaveDecorators(node)) {
    return [...(ts.getDecorators(node) ?? [])]
  }
  const modifiers = (node as ts.HasModifiers).modifiers
  return [...(modifiers ?? [])].filter((modifier): modifier is ts.Decorator => ts.isDecorator(modifier))
}

function hasDecorator(node: ts.Node, name: string): boolean {
  return decoratorsOf(node).some((decorator) => decoratorName(decorator) === name)
}

function decoratorName(decorator: ts.Decorator): string | undefined {
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

function decoratorStringArg(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression
  if (!ts.isCallExpression(expr) || !expr.arguments[0]) {
    return undefined
  }
  const arg = expr.arguments[0]
  return ts.isStringLiteral(arg) ? arg.text : undefined
}

function decoratorObjectArg(decorator: ts.Decorator): ts.ObjectLiteralExpression | undefined {
  const expr = decorator.expression
  if (!ts.isCallExpression(expr) || !expr.arguments[0]) {
    return undefined
  }
  return ts.isObjectLiteralExpression(expr.arguments[0]) ? expr.arguments[0] : undefined
}

function readProp(literal: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of literal.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      return prop.initializer
    }
  }
  return undefined
}

function readStringProp(literal: ts.ObjectLiteralExpression, name: string): string | undefined {
  const value = readProp(literal, name)
  return value && ts.isStringLiteral(value) ? value.text : undefined
}

function readBooleanProp(literal: ts.ObjectLiteralExpression, name: string): boolean {
  const value = readProp(literal, name)
  return value?.kind === ts.SyntaxKind.TrueKeyword
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function entityNameText(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text
}

function isStatic(member: ts.ClassElement): boolean {
  return Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static)
}
