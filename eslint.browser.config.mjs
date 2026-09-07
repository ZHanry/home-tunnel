import eslint from "./control-center/node_modules/@eslint/js/src/index.js";
import globals from "./control-center/node_modules/globals/index.js";

export default [{
  files: ["**/*.js"],
  languageOptions: { globals: globals.browser },
  rules: { ...eslint.configs.recommended.rules, "no-empty": ["error", { allowEmptyCatch: true }], "no-unused-vars": ["error", { caughtErrors: "none" }] },
}];
