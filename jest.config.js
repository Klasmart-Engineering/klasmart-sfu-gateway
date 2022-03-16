/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testPathIgnorePatterns: ["/node_modules/", "utils.ts"],
    setupFiles: ["<rootDir>/config/load_vars.ts"],
    collectCoverageFrom: [
        "src/**/*.{ts,tsx}",
        "!src/**/__tests__/**"
    ]
};
