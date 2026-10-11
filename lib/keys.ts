export const IR_KEY = "__ir"
export const REMARK_KEY = "__remark"

export function getGeneratedIR<T>(ctor: Function): T | undefined {
  return (ctor as { [IR_KEY]?: T })[IR_KEY]
}
