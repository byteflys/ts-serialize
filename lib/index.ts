export type { ClassType, FieldIR, PrimitiveKind, TypeIR, TypeRef } from "./ir.ts"
export { arrayOf, generic, isTypeIR, literal, mapOf, normalizeType, setOf, unionOf } from "./ir.ts"
export { type } from "./type.ts"
export { substitute } from "./substitute.ts"
export {
  Alias,
  Convert,
  Field,
  PlainObject,
  Remark,
  Serializable,
  Transient,
  defineFieldDecorator,
  getRemark,
  type FieldOptions,
  type SerializableOptions,
} from "./decorators.ts"
export { fromJson, fromPlain, toJson, toPlain, type CodecOptions } from "./codec.ts"
export { bindIR, getGeneratedIR, resolveClassIR } from "./bind.ts"
export { IR_KEY, REMARK_KEY } from "./keys.ts"
export { getConverter, registerConverter, type Converter } from "./converters.ts"
export { SerializeError } from "./errors.ts"
