module.exports = {
    plugins: [
        ["@babel/plugin-proposal-decorators", {version: "2023-11"}]
    ],
    presets: [
        ["@babel/preset-env", {targets: {node: "18"}}],
        ["@babel/preset-typescript", {allowDeclareFields: true}]
    ]
}
