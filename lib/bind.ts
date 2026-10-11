import { getGeneratedIR } from "./keys.ts"
import { isTypeIR, type ClassType, type TypeIR } from "./ir.ts"
import { SerializeError } from "./errors.ts"

export { getGeneratedIR, IR_KEY, REMARK_KEY } from "./keys.ts"

export function resolveClassIR(ir: Extract<TypeIR, { kind: "class" }>): Extract<TypeIR, { kind: "class" }> {
  if (ir.fields.length > 0) {
    return ir
  }
  const generated = getGeneratedIR<TypeIR>(ir.ctor)
  if (generated?.kind === "class") {
    return { ...generated, typeArgs: ir.typeArgs }
  }
  return ir
}

export function bindIR(ctor: ClassType, ...typeArgs: Array<TypeIR | ClassType>): TypeIR {
  const base = getGeneratedIR<TypeIR>(ctor)
  if (!base || base.kind !== "class") {
    throw new SerializeError(
      `${ctor.name || "Type"} has no compile-time schema. Enable the ts-serialize transformer.`,
    )
  }
  return {
    ...base,
    typeArgs: typeArgs.map((arg) => {
      if (isTypeIR(arg)) {
        return arg.kind === "class" ? resolveClassIR(arg) : arg
      }
      const generated = getGeneratedIR<TypeIR>(arg)
      if (!generated) {
        throw new SerializeError(
          `${arg.name || "Type"} has no compile-time schema. Enable the ts-serialize transformer.`,
        )
      }
      return generated
    }),
  }
}
