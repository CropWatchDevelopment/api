module.exports = {
    moduleFileExtensions: ["js", "json", "ts"],
    rootDir: ".",
    testEnvironment: "node",
    testRegex: ".e2e-spec.ts$",
    transform: {
        "^.+\\.(t|j)s$": "ts-jest"
    },
    moduleNameMapper: {
        "^src/(.*)$": "<rootDir>/src/$1" // Fallback mapping to ensure `src` alias works if used anywhere else
    },
    moduleDirectories: ["node_modules", "src"]
};