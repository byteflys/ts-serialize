import { SerializeError } from "./errors.ts"

export interface Converter<T = unknown> {
  serialize(value: T): unknown
  deserialize(raw: unknown): T
}

const registry = new Map<string, Converter>()

export function registerConverter(name: string, converter: Converter): void {
  registry.set(name, converter)
}

export function getConverter(name: string): Converter {
  const converter = registry.get(name)
  if (!converter) {
    throw new SerializeError(`Unknown converter "${name}"`)
  }
  return converter
}

registerConverter("isoDate", {
  serialize(value) {
    if (!(value instanceof Date)) {
      throw new SerializeError("isoDate can only serialize Date")
    }
    return value.toISOString()
  },
  deserialize(raw) {
    const date = new Date(String(raw))
    if (Number.isNaN(date.getTime())) {
      throw new SerializeError(`Invalid ISO date: ${String(raw)}`)
    }
    return date
  },
})
