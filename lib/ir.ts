import { getGeneratedIR } from "./keys.ts"

export type ClassType<T = unknown> = abstract new (...args: any[]) => T

export type PrimitiveKind = "string" | "number" | "boolean" | "bigint" | "any"

export interface FieldIR {
  key: string
  jsonName?: string
  type: TypeIR
  optional?: boolean
  transient?: boolean
  convert?: string
}

export type TypeIR =
  | { kind: PrimitiveKind }
  | { kind: "date" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "generic"; index: number }
  | { kind: "array"; item: TypeIR }
  | { kind: "set"; item: TypeIR }
  | { kind: "map"; key: TypeIR; value: TypeIR }
  | { kind: "union"; variants: TypeIR[] }
  | { kind: "class"; ctor: ClassType; typeArgs: TypeIR[]; fields: FieldIR[] }

export type TypeRef =
  | TypeIR
  | ClassType
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | BigIntConstructor
  | DateConstructor
  | ArrayConstructor
  | MapConstructor
  | SetConstructor

export function isTypeIR(value: unknown): value is TypeIR {
  return Boolean(value && typeof value === "object" && "kind" in value)
}

export function generic(index: number): TypeIR {
  return { kind: "generic", index }
}

export function arrayOf(item: TypeRef): TypeIR {
  return { kind: "array", item: normalizeType(item) }
}

export function setOf(item: TypeRef): TypeIR {
  return { kind: "set", item: normalizeType(item) }
}

export function mapOf(key: TypeRef, value: TypeRef): TypeIR {
  return { kind: "map", key: normalizeType(key), value: normalizeType(value) }
}

export function unionOf(...variants: TypeRef[]): TypeIR {
  return { kind: "union", variants: variants.map(normalizeType) }
}

export function literal(value: string | number | boolean | null): TypeIR {
  return { kind: "literal", value }
}

export function normalizeType(ref: TypeRef): TypeIR {
  if (isTypeIR(ref)) {
    return completeClassFields(ref)
  }
  const builtin = builtinType(ref)
  if (builtin) {
    return builtin
  }
  const classCtor = ref as ClassType
  const generated = getGeneratedIR<TypeIR>(classCtor)
  if (generated?.kind === "class") {
    return generated
  }
  return {
    kind: "class",
    ctor: classCtor,
    typeArgs: [],
    fields: [],
  }
}

function completeClassFields(ir: TypeIR): TypeIR {
  if (ir.kind === "class" && ir.fields.length === 0) {
    const generated = getGeneratedIR<TypeIR>(ir.ctor)
    if (generated?.kind === "class") {
      return { ...generated, typeArgs: ir.typeArgs }
    }
    return ir
  }
  if (ir.kind === "array") {
    return { ...ir, item: completeClassFields(ir.item) }
  }
  if (ir.kind === "set") {
    return { ...ir, item: completeClassFields(ir.item) }
  }
  if (ir.kind === "map") {
    return { ...ir, key: completeClassFields(ir.key), value: completeClassFields(ir.value) }
  }
  if (ir.kind === "union") {
    return { ...ir, variants: ir.variants.map(completeClassFields) }
  }
  return ir
}

export function builtinType(ctor: TypeRef): TypeIR | undefined {
  if (ctor === String) {
    return { kind: "string" }
  }
  if (ctor === Number) {
    return { kind: "number" }
  }
  if (ctor === Boolean) {
    return { kind: "boolean" }
  }
  if (ctor === BigInt) {
    return { kind: "bigint" }
  }
  if (ctor === Date) {
    return { kind: "date" }
  }
  return undefined
}
