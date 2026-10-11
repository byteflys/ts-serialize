import type { TypeIR } from "./ir.ts"

export function substitute(ir: TypeIR, typeArgs: TypeIR[]): TypeIR {
  switch (ir.kind) {
    case "generic":
      return typeArgs[ir.index] ?? { kind: "any" }
    case "array":
      return { kind: "array", item: substitute(ir.item, typeArgs) }
    case "set":
      return { kind: "set", item: substitute(ir.item, typeArgs) }
    case "map":
      return {
        kind: "map",
        key: substitute(ir.key, typeArgs),
        value: substitute(ir.value, typeArgs),
      }
    case "union":
      return { kind: "union", variants: ir.variants.map((variant) => substitute(variant, typeArgs)) }
    case "class":
      return {
        kind: "class",
        ctor: ir.ctor,
        typeArgs: ir.typeArgs.map((arg) => substitute(arg, typeArgs)),
        fields: ir.fields.map((field) => ({
          ...field,
          type: substitute(field.type, typeArgs),
        })),
      }
    default:
      return ir
  }
}
