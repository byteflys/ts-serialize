"use strict"

const fs = require("fs")
const path = require("path")
const ts = require("typescript")

let transformerFactory

function loadTransformer() {
    if (transformerFactory) return transformerFactory
    const file = path.join(__dirname, "../transformer/index.ts")
    const source = fs.readFileSync(file, "utf8")
    const {outputText} = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2017,
            esModuleInterop: true
        },
        fileName: file
    })
    const module = {exports: {}}
    const compile = new Function("require", "module", "exports", "__filename", "__dirname", outputText)
    compile(require, module, module.exports, file, path.dirname(file))
    transformerFactory = module.exports.createSerializerTransformer
    return transformerFactory
}

module.exports = function serializeLoader(source) {
    const result = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2017,
            module: ts.ModuleKind.ESNext,
            sourceMap: true,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true
        },
        fileName: this.resourcePath,
        transformers: {
            before: [loadTransformer()()]
        }
    })
    const map = result.sourceMapText ? JSON.parse(result.sourceMapText) : undefined
    this.callback(null, result.outputText, map)
}
