import Url from "url"
import Path from "path"

const WebpackConfigFile = Url.fileURLToPath(import.meta.url)
const NodeRootDirectory = Path.dirname(WebpackConfigFile)
const DistDirectory = "dist"

export default {
    entry: {
        sample: "sample/sample.ts"
    },
    mode: "development",
    watch: false,
    target: "node",
    externals: {
        typescript: "commonjs2 typescript"
    },
    devtool: "source-map",
    output: {
        filename: "[name].cjs",
        path: Path.join(NodeRootDirectory, DistDirectory),
        clean: true
    },
    resolve: {
        modules: [NodeRootDirectory, "node_modules"],
        extensions: ["*", ".js", ".ts"]
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                enforce: "pre",
                use: Path.join(NodeRootDirectory, "webpack-loader/serialize-loader.cjs")
            },
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: "babel-loader"
            }
        ]
    }
}
