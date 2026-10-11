import {
  Alias,
  Convert,
  Field,
  Remark,
  Serializable,
  Transient,
  fromJson,
  getRemark,
  toJson,
} from "../lib/index.ts"

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

namespace Sync {
  @Remark("改这个接口要同步 iOS")
  export function pushUser(_user: User): void {}
}

@Serializable()
class Person {
  @Field()
  title = ""

  greet(): string {
    return `p ${this.title}`
  }
}

@Serializable()
class Pair<A, B> {
  @Field()
  first!: A

  @Field()
  second!: B
}

@Serializable()
class NamedPair<T> extends Pair<T, Person> {
  @Field()
  label = ""
}

function fail(message: string): never {
  throw new Error(message)
}

const json = JSON.stringify({
  code: 0,
  payload: {
    items: [
      { name: "Ada", createdAt: "2024-01-02T00:00:00.000Z", scratch: "ignore-me" },
    ],
    total: 1,
  },
})

const response = fromJson<ApiResponse<Page<User>>>(json)

console.log(response.data.items[0].sayHi())
console.log(toJson(response))
console.log(getRemark(Sync.pushUser))

const named = fromJson<NamedPair<User>>({
  first: { name: "Ada", createdAt: "2024-01-02T00:00:00.000Z" },
  second: { title: "Dr" },
  label: "pair",
})
if (!(named instanceof NamedPair)) fail("NamedPair")
if (!(named.first instanceof User) || named.first.sayHi() !== "hi Ada") fail("first User")
if (!(named.second instanceof Person) || named.second.greet() !== "p Dr") fail("second Person")
if (named.label !== "pair") fail("label")
console.log(named.first.sayHi(), named.second.greet(), named.label)

const users = fromJson<Map<string, User>>({
  ada: { name: "Ada", createdAt: "2024-01-02T00:00:00.000Z" },
})
const ada = users.get("ada")
if (!(users instanceof Map) || !(ada instanceof User) || ada.sayHi() !== "hi Ada") fail("Map User")
console.log(toJson(users))
