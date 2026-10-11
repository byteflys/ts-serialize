import type { FieldIR } from "./ir.ts"

export interface SerializableOptions {
  typeName?: string
}

export interface FieldOptions {
  name?: string
  type?: unknown
  optional?: boolean
  transient?: boolean
  convert?: string
}

/** Compile-time marker. The transformer emits `__ir`; this is a no-op at runtime. */
export function Serializable(_options?: SerializableOptions) {
  return (_ctor: Function, _context: ClassDecoratorContext) => {}
}

/** Data-only class: properties, no behavior. Transformer emits `__ir`; JSON.parse / JSON.stringify is enough. */
export function PlainObject(_options?: SerializableOptions) {
  return (_ctor: Function, _context: ClassDecoratorContext) => {}
}

/** Compile-time marker for a serializable field. */
export function Field(_options: FieldOptions = {}) {
  return (_value: undefined, _context: ClassFieldDecoratorContext) => {}
}

export function Transient() {
  return (_value: undefined, _context: ClassFieldDecoratorContext) => {}
}

export function Convert(_name: string) {
  return (_value: undefined, _context: ClassFieldDecoratorContext) => {}
}

export function Alias(_name: string) {
  return (_value: undefined, _context: ClassFieldDecoratorContext) => {}
}

/**
 * Custom field marker. Compile-time serialize only sees Alias / Convert / Field options.
 * Use those for schema changes; this factory exists so user decorators keep new-syntax shape.
 */
export function defineFieldDecorator(_patch: (field: FieldIR) => void) {
  return (_value: undefined, _context: ClassFieldDecoratorContext) => {}
}

/**
 * Annotation for functions, including namespace functions.
 * Official TS rejects this location; the transformer strips it and writes `fn.__remark`.
 */
export function Remark(_message: string = "") {
  return (..._args: unknown[]) => {}
}

export function getRemark(fn: Function): string | undefined {
  return (fn as { __remark?: string }).__remark
}
