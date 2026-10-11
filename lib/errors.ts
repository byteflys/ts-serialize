export class SerializeError extends Error {
  readonly path: string

  constructor(message: string, path = "$") {
    super(path === "$" ? message : `${message} at ${path}`)
    this.name = "SerializeError"
    this.path = path
  }
}
