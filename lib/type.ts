import { getGeneratedIR } from "./keys.ts"
import {
  arrayOf,
  builtinType,
  isTypeIR,
  mapOf,
  normalizeType,
  setOf,
  type ClassType,
  type TypeIR,
  type TypeRef,
} from "./ir.ts"

export function type(ctor: TypeRef, ...typeArgs: TypeRef[]): TypeIR {
  if (isTypeIR(ctor)) {
    return ctor
  }
  const builtin = builtinType(ctor)
  if (builtin) {
    return builtin
  }
  if (ctor === Array) {
    return arrayOf(typeArgs[0] ?? { kind: "any" })
  }
  if (ctor === Set) {
    return setOf(typeArgs[0] ?? { kind: "any" })
  }
  if (ctor === Map) {
    return mapOf(typeArgs[0] ?? { kind: "string" }, typeArgs[1] ?? { kind: "any" })
  }

  const classCtor = ctor as ClassType
  const generated = getGeneratedIR<TypeIR>(classCtor)
  if (generated?.kind === "class") {
    return {
      ...generated,
      typeArgs: typeArgs.map(normalizeType),
    }
  }
  return {
    kind: "class",
    ctor: classCtor,
    typeArgs: typeArgs.map(normalizeType),
    fields: [],
  }
}
