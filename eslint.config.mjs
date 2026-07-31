import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import typescriptEslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      // カバレッジのHTMLレポートに含まれる生成JS。gitignore済みだが、
      // 同じ作業ツリーで coverage を回すと lint が拾って落ちる。
      "**/coverage/",
      "**/target/",
      "**/.turbo/",
      "**/*.d.ts",
      "app/desktop/src/__mock__/",
      "app/desktop/e2e/",
      "**/*.config.ts",
      "**/*.config.mjs",
      "app/chrome-extension/build.mjs",
      "app/figma-plugin/build.mjs",
    ],
  },

  // Base configs
  js.configs.recommended,
  ...typescriptEslint.configs.recommended,
  ...typescriptEslint.configs.strict,
  ...typescriptEslint.configs.stylistic,

  // TypeScript files
  {
    files: ["**/*.ts", "**/*.tsx"],

    plugins: {
      "@typescript-eslint": typescriptEslint.plugin,
      import: importPlugin,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: typescriptEslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: "./tsconfig.eslint.json",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    rules: {
      // Console control
      "no-console": [
        "error",
        {
          allow: ["info", "error", "warn"],
        },
      ],

      // TypeScript strict rules (from example-org/sample-project-backend)
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-non-null-assertion": "off",

      // Type assertions — strict but allow as const and satisfies
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],
      "@typescript-eslint/prefer-as-const": "error",

      // Unused variables — strict
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Import ordering
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "parent", "sibling", "index", "object", "type"],
          pathGroups: [
            {
              pattern: "react",
              group: "external",
              position: "before",
            },
            {
              pattern: "@figdiff/**",
              group: "parent",
              position: "before",
            },
            {
              pattern: "@/**",
              group: "parent",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["builtin"],
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          "newlines-between": "always",
        },
      ],

      // Import/export control
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "import/no-unresolved": "off",

      // General best practices (from example-org/sample-project-backend)
      "prefer-const": "error",
      "no-var": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-caller": "error",
      "no-extend-native": "error",
      "no-extra-bind": "error",
      "no-lone-blocks": "error",
      "no-loop-func": "error",
      "no-multi-spaces": "error",
      "no-multi-str": "error",
      "no-global-assign": "error",
      "no-return-assign": "error",
      "no-self-compare": "error",
      "no-sequences": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unused-expressions": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-void": "error",
      "prefer-promise-reject-errors": "error",
      radix: "error",
      yoda: "error",
      eqeqeq: "error",
      "no-debugger": "error",
      "no-alert": "error",
    },
  },

  // Every eslint-disable / eslint-enable directive must carry a justification
  // (prohibition #8). Applies to TS, TSX, and plain JS/MJS scripts alike so the
  // repo scripts under script/** and verification/script/** are also covered.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.cjs", "**/*.js"],
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
      "@eslint-community/eslint-comments/no-unused-disable": "error",
    },
  },

  // React hooks rules + props type naming
  {
    files: ["app/desktop/src/**/*.tsx", "app/desktop/src/**/*.ts"],
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Props types are named after the component (`XxxProps`), never bare `Props`.
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSTypeAliasDeclaration[id.name='Props']",
          message: "Name props type after the component: use `XxxProps`, not bare `Props`.",
        },
        {
          selector: "TSInterfaceDeclaration[id.name='Props']",
          message: "Name props interface after the component: use `XxxProps`, not bare `Props`.",
        },
      ],
    },
  },

  // Figma Plugin — relaxed rules
  // figma global (showUI, ui, on, etc.) is declared via @figma/plugin-typings ambient declarations,
  // which the ESLint TypeScript parser cannot resolve through tsconfig.eslint.json.
  // Unsafe rules are suppressed here because the warnings are structural artifacts of Figma's
  // ambient type approach, not actual type-safety issues in our code.
  {
    files: ["app/figma-plugin/src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "no-alert": "off",
    },
  },

  // Chrome Extension — relaxed unsafe rules
  // chrome global (chrome.runtime, chrome.tabs, chrome.storage, etc.) is provided by @types/chrome
  // as ambient declarations. The ESLint TypeScript parser resolves types through tsconfig.eslint.json
  // which does not include Chrome extension lib types, causing false-positive unsafe warnings.
  {
    files: ["app/chrome-extension/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // Test files — relaxed rules
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-console": "off",
    },
  },

  // Verification + repo-root Node.js utility scripts
  {
    files: ["verification/**/*.mjs", "script/**/*.mjs", "app/desktop/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // App-level smoke/contract scripts (Node.js + browser globals for page.evaluate contexts)
  {
    files: [
      "app/chrome-extension/script/**/*.mjs",
      "app/desktop/script/**/*.mjs",
      "app/mcp-server/script/**/*.mjs",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
];
