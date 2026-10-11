import { bindIR, getGeneratedIR, resolveClassIR } from "./bind.ts"
import { getConverter } from "./converters.ts"
import { SerializeError } from "./errors.ts"
import { substitute } from "./substitute.ts"
import type { ClassType, FieldIR, TypeIR } from "./ir.ts"

export interface CodecOptions {
  bindMethods?: boolean
}

export function fromJson<T>(json: string | object, ir?: TypeIR, options: CodecOptions = {}): T {
  const data = typeof json === "string" ? JSON.parse(json) : json
  return fromPlain<T>(data, requireIR(ir, "fromJson"), options)
}

fromJson.ir = bindIR

export function fromPlain<T>(data: unknown, ir?: TypeIR, options: CodecOptions = {}): T {
  return revive(data, requireIR(ir, "fromPlain"), "$", options) as T
}

fromPlain.ir = bindIR

function requireIR(ir: TypeIR | undefined, api: string): TypeIR {
  if (!ir) {
    throw new SerializeError(`Missing type schema for ${api}<T>(). Enable the ts-serialize transformer, or pass bindIR(...)`)
  }
  return ir
}

export function toJson(value: unknown, ir?: TypeIR): string {
  return JSON.stringify(toPlain(value, ir))
}

export function toPlain(value: unknown, ir?: TypeIR): unknown {
  return dump(value, ir, "$")
}

function revive(data: unknown, ir: TypeIR, path: string, options: CodecOptions): unknown {
  if (data === null || data === undefined) {
    return data
  }

  switch (ir.kind) {
    case "any":
      return data
    case "string":
    case "number":
    case "boolean":
    case "literal":
      return data
    case "bigint":
      return typeof data === "bigint" ? data : BigInt(String(data))
    case "date": {
      const date = new Date(data as string | number)
      if (Number.isNaN(date.getTime())) {
        throw new SerializeError(`Invalid date: ${String(data)}`, path)
      }
      return date
    }
    case "generic":
      return data
    case "array": {
      if (!Array.isArray(data)) {
        throw new SerializeError("Expected array", path)
      }
      return data.map((item, index) => revive(item, ir.item, `${path}[${index}]`, options))
    }
    case "set": {
      const items = Array.isArray(data) ? data : [...(data as Iterable<unknown>)]
      return new Set(items.map((item, index) => revive(item, ir.item, `${path}[${index}]`, options)))
    }
    case "map":
      return reviveMap(data, ir, path, options)
    case "union": {
      const errors: string[] = []
      for (const variant of ir.variants) {
        try {
          return revive(data, variant, path, options)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new SerializeError(`No union variant matched: ${errors.join("; ")}`, path)
    }
    case "class":
      return reviveClass(data, resolveClassIR(ir), path, options)
    default:
      return data
  }
}

function reviveMap(data: unknown, ir: Extract<TypeIR, { kind: "map" }>, path: string, options: CodecOptions): Map<unknown, unknown> {
  const map = new Map<unknown, unknown>()
  if (Array.isArray(data)) {
    data.forEach((entry, index) => {
      const [key, value] = entry as [unknown, unknown]
      map.set(
        revive(key, ir.key, `${path}[${index}].key`, options),
        revive(value, ir.value, `${path}[${index}].value`, options),
      )
    })
    return map
  }
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      map.set(
        revive(key, ir.key, `${path}.${key}`, options),
        revive(value, ir.value, `${path}.${key}`, options),
      )
    }
    return map
  }
  throw new SerializeError("Expected object or entries array for Map", path)
}

function reviveClass(data: unknown, ir: Extract<TypeIR, { kind: "class" }>, path: string, options: CodecOptions): object {
  if (isArrayLikeCtor(ir.ctor) && Array.isArray(data)) {
    return reviveArrayLike(data, ir, path, options)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new SerializeError("Expected object", path)
  }
  const inst = createInstance(ir.ctor) as Record<string, unknown>
  for (const field of resolveFields(ir)) {
    if (field.transient) {
      continue
    }
    const jsonKey = field.jsonName ?? field.key
    if (!Object.prototype.hasOwnProperty.call(data, jsonKey)) {
      continue
    }
    const raw = (data as Record<string, unknown>)[jsonKey]
    inst[field.key] = field.convert
      ? getConverter(field.convert).deserialize(raw)
      : revive(raw, field.type, `${path}.${field.key}`, options)
  }
  if (options.bindMethods) {
    bindPrototypeMethods(inst, ir.ctor)
  }
  const hook = (inst as { onDeserialized?: () => void }).onDeserialized
  if (typeof hook === "function") {
    hook.call(inst)
  }
  return inst
}

function resolveFields(ir: Extract<TypeIR, { kind: "class" }>): FieldIR[] {
  return ir.fields.map((field) => ({
    ...field,
    type: substitute(field.type, ir.typeArgs),
  }))
}

function dump(value: unknown, ir: TypeIR | undefined, path: string): unknown {
  if (value === null || value === undefined || typeof value === "function") {
    return value === undefined || typeof value === "function" ? undefined : value
  }
  const resolved = ir ?? inferIR(value)
  if (!resolved) {
    return dumpUntyped(value, path)
  }

  switch (resolved.kind) {
    case "any":
    case "string":
    case "number":
    case "boolean":
    case "literal":
    case "generic":
      return value
    case "bigint":
      return typeof value === "bigint" ? value.toString() : value
    case "date":
      if (!(value instanceof Date)) {
        throw new SerializeError("Expected Date", path)
      }
      return value.toISOString()
    case "array":
      if (!Array.isArray(value)) {
        throw new SerializeError("Expected array", path)
      }
      return value.map((item, index) => dump(item, resolved.item, `${path}[${index}]`))
    case "set":
      return [...(value as Set<unknown>)].map((item, index) => dump(item, resolved.item, `${path}[${index}]`))
    case "map":
      return dumpMap(value as Map<unknown, unknown>, resolved, path)
    case "union":
      return dump(value, resolved.variants[0], path)
    case "class":
      return dumpClass(value, resolveClassIR(resolved), path)
    default:
      return value
  }
}

function dumpMap(value: Map<unknown, unknown>, ir: Extract<TypeIR, { kind: "map" }>, path: string): unknown {
  if (ir.key.kind === "string") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of value) {
      out[String(key)] = dump(item, ir.value, `${path}.${String(key)}`)
    }
    return out
  }
  return [...value.entries()].map(([key, item], index) => [
    dump(key, ir.key, `${path}[${index}].key`),
    dump(item, ir.value, `${path}[${index}].value`),
  ])
}

function dumpClass(value: unknown, ir: Extract<TypeIR, { kind: "class" }>, path: string): unknown {
  if (isArrayLikeCtor(ir.ctor) && Array.isArray(value)) {
    const itemIR = ir.typeArgs[0]
    return [...value].map((item, index) => dump(item, itemIR, `${path}[${index}]`))
  }
  const out: Record<string, unknown> = {}
  for (const field of resolveFields(ir)) {
    if (field.transient) {
      continue
    }
    const raw = (value as Record<string, unknown>)[field.key]
    if (raw === undefined || typeof raw === "function") {
      continue
    }
    const dumped = field.convert
      ? getConverter(field.convert).serialize(raw)
      : dump(raw, field.type, `${path}.${field.key}`)
    if (dumped !== undefined) {
      out[field.jsonName ?? field.key] = dumped
    }
  }
  return out
}

function dumpUntyped(value: unknown, path: string): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Map) {
    return [...value.entries()]
  }
  if (value instanceof Set) {
    return [...value]
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => dump(item, undefined, `${path}[${index}]`))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function") {
        continue
      }
      const dumped = dump(item, inferIR(item), `${path}.${key}`)
      if (dumped !== undefined) {
        out[key] = dumped
      }
    }
    return out
  }
  return value
}

function inferIR(value: unknown): TypeIR | undefined {
  if (value instanceof Date) {
    return { kind: "date" }
  }
  if (value instanceof Map) {
    let stringKeys = true
    for (const key of value.keys()) {
      if (typeof key !== "string") {
        stringKeys = false
        break
      }
    }
    return {
      kind: "map",
      key: { kind: stringKeys ? "string" : "any" },
      value: { kind: "any" },
    }
  }
  if (value instanceof Set) {
    return { kind: "set", item: { kind: "any" } }
  }
  if (value && typeof value === "object") {
    const ctor = value.constructor as ClassType
    if (ctor && ctor !== Object) {
      return getGeneratedIR(ctor)
    }
  }
  return undefined
}

function isArrayLikeCtor(ctor: ClassType | undefined): boolean {
  if (!ctor) {
    return false
  }
  if (ctor === Array) {
    return true
  }
  try {
    return ctor.prototype instanceof Array
  } catch {
    return false
  }
}

function reviveArrayLike(
  data: unknown[],
  ir: Extract<TypeIR, { kind: "class" }>,
  path: string,
  options: CodecOptions,
): unknown {
  const itemIR = ir.typeArgs[0] ?? { kind: "any" as const }
  const items = data.map((item, index) => revive(item, itemIR, `${path}[${index}]`, options))
  if (ir.ctor === Array) {
    return items
  }
  const list = createInstance(ir.ctor)
  if (Array.isArray(list)) {
    list.push(...items)
    return list
  }
  return items
}

function createInstance(ctor: ClassType): object {
  try {
    return new (ctor as new () => object)()
  } catch {
    return Object.create(ctor.prototype)
  }
}

function bindPrototypeMethods(inst: object, ctor: ClassType): void {
  let proto: object | null = ctor.prototype
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") {
        continue
      }
      const desc = Object.getOwnPropertyDescriptor(proto, name)
      if (desc && typeof desc.value === "function") {
        (inst as Record<string, unknown>)[name] = desc.value.bind(inst)
      }
    }
    proto = Object.getPrototypeOf(proto)
  }
}
