# About this Project

A TypeScript serialization framework

# Core Ability

Gson-style class serialization via compile-time codegen and standard decorators<br>
support nested classes, generics, converters, and function remarks

# Steps for Integration

#### 1. Dependency

```json
{
  "dependencies": {
    "ts-serialize": "github:byteflys/ts-serialize"
  },
  "peerDependencies": {
    "typescript": ">=5.0.0"
  }
}
```

or

```bash
npm install github:byteflys/ts-serialize
```

keep TypeScript `>=5.0` as a peer<br>
this package ships TypeScript sources, so the consuming project must compile them

#### 2. Language Service

editor-only plugin<br>
it does not generate serialize IR<br>
it only swallows official TypeScript errors that `@Remark` on functions would otherwise raise

suggest using the workspace TypeScript version in VS Code

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-serialize/language-service"
      }
    ]
  }
}
```

this project also exposes the same plugin as a nested package `ts-serialize-ls`<br>
local development uses that name:

```json
{
  "devDependencies": {
    "ts-serialize-ls": "file:./lang-service"
  }
}
```

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "ts-serialize-ls"
      }
    ]
  }
}
```

#### 3. Webpack Loader

required if you build with webpack<br>
run it as a `pre` loader so IR is injected before babel / other ts loaders

```js
module.exports = {
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        enforce: "pre",
        use: "ts-serialize/webpack"
      },
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: "babel-loader"
      }
    ]
  }
}
```

decorators must be the standard 2023-11 form

```js
module.exports = {
  plugins: [
    ["@babel/plugin-proposal-decorators", { version: "2023-11" }]
  ]
}
```

the webpack loader already runs the transformer internally<br>
you do not need to wire `ts-serialize/transformer` again in a webpack pipeline

#### 4. Transformer

required if you do not use the webpack loader<br>
this is the compile-time codegen that writes `__ir` onto serializable classes<br>
and rewrites `fromJson<T>()` / `toJson()` so the runtime schema is available

programmatic usage:

```ts
import ts from "typescript"
import { createSerializerTransformer } from "ts-serialize/transformer"

const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.ESNext,
  },
  fileName: "app.ts",
  transformers: {
    before: [createSerializerTransformer()()],
  },
})
```

or pass it through `ttypescript` / `ts-patch`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "ts-serialize/transformer"
      }
    ]
  }
}
```

without this step, `fromJson<T>()` throws `Missing type schema`

#### 5. Lib API

import runtime helpers from the package root

```ts
import {
  Alias,
  Convert,
  Field,
  Remark,
  Serializable,
  Transient,
  fromJson,
  getRemark,
  registerConverter,
  toJson,
} from "ts-serialize"
```

define a serializable class<br>
every persisted field needs `@Field()`

```ts
@Serializable()
class User {
  @Field()
  name = ""

  @Convert("isoDate")
  @Field()
  createdAt = new Date()

  @Transient()
  @Field()
  scratch = ""

  sayHi(): string {
    return `hi ${this.name}`
  }
}
```

generics, alias json keys, and nested pages work the same way

```ts
@Serializable()
class Page<T> {
  @Field()
  items: T[] = []

  @Field()
  total = 0
}

@Serializable()
class ApiResponse<T> {
  @Field()
  code = 0

  @Alias("payload")
  @Field()
  data!: T
}
```

encode / decode after the transformer has run

```ts
const json = JSON.stringify({
  code: 0,
  payload: {
    items: [{ name: "Ada", createdAt: "2024-01-02T00:00:00.000Z" }],
    total: 1,
  },
})

const response = fromJson<ApiResponse<Page<User>>>(json)
response.data.items[0].sayHi()
toJson(response)
```

`isoDate` is built in<br>
register more converters when a field needs a custom wire format

```ts
registerConverter("unixSeconds", {
  serialize(value: Date) {
    return Math.floor(value.getTime() / 1000)
  },
  deserialize(raw: unknown) {
    return new Date(Number(raw) * 1000)
  },
})
```

`@Remark` is for functions, including namespace functions<br>
the transformer strips it and writes `fn.__remark`

```ts
namespace Sync {
  @Remark("remark info")
  export function pushUser(_user: User): void {}
}

getRemark(Sync.pushUser)
```

common lib exports

- `@Serializable()` mark a class for codegen
- `@Field()` mark a persisted field
- `@Alias("name")` json key different from the field name
- `@Convert("name")` named converter
- `@Transient()` skip in encode / decode
- `@Remark("...")` attach a note on a function
- `fromJson` / `fromPlain` json or plain object to class
- `fromJson<Map<string, User>>(json)` / `fromJson<Set<User>>(json)` built-in collections
- `toJson` / `toPlain` class to json or plain object
- `getRemark` read the transformed function note
- `registerConverter` add a named converter

# End

for more detailed confusion, take a look at `sample/sample.ts`<br>
this is actually a simple and concise library, I believe you can do it<br>

*Good Job, Baby !*
