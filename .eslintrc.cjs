module.exports = {
    root: true, // Prevent ESLint from looking further up the directory tree
    parser: '@typescript-eslint/parser', // Specifies the ESLint parser for TypeScript
    parserOptions: {
      ecmaVersion: 2021, // Allows for the parsing of modern ECMAScript features
      sourceType: 'module', // Allows for the use of imports
      project: './tsconfig.json', // Important for type-aware linting rules
      tsconfigRootDir: __dirname, // Tells parser plugin where to find tsconfig
    },
    env: {
      node: true, // Enables Node.js global variables and Node.js scoping.
      es2021: true, // Adds all ECMAScript 2021 globals and automatically sets ecmaVersion parser option to 12.
    },
    plugins: [
      '@typescript-eslint', // TypeScript specific linting rules
      'prettier', // Runs Prettier as an ESLint rule
      'import', // Linting of ES6+ import/export syntax
      'node', // Additional Node.js rules
      'security', // Security rules
    ],
    extends: [
      'eslint:recommended', // Base ESLint recommended rules
      'plugin:node/recommended', // Node.js recommended rules
      'plugin:@typescript-eslint/recommended', // Base recommended TS rules
      'plugin:@typescript-eslint/recommended-requiring-type-checking', // Recommended rules requiring type info (powerful but requires tsconfig.json)
      'plugin:import/recommended', // Recommended import rules
      'plugin:import/typescript', // Settings for import plugin with TS
      'plugin:security/recommended', // Recommended security rules
      // IMPORTANT: Must be LAST in extends to override other formatting rules
      'plugin:prettier/recommended', // Integrates Prettier: includes eslint-config-prettier and runs prettier as a rule
    ],
    rules: {
      // --- Prettier ---
      'prettier/prettier': 'warn', // Show Prettier formatting issues as warnings
  
      // --- General ESLint/Best Practices ---
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off', // Warn about console.log in production
      'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off', // Warn about debugger in production
      'eqeqeq': ['error', 'always', { null: 'ignore' }], // Enforce ===, allow == null check
      'no-unused-vars': 'off', // Disable base rule, use TS version below
  
      // --- TypeScript ---
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_', // Allow unused function arguments starting with _
          varsIgnorePattern: '^_', // Allow unused variables starting with _
          caughtErrorsIgnorePattern: '^_', // Allow unused caught errors starting with _
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn', // Warn against using 'any' type
      '@typescript-eslint/explicit-module-boundary-types': 'off', // Functions can often infer return types
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }], // Require handling of Promises (allow void for fire-and-forget)
      '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: false } // Allow async functions passed to void contexts (like Express middleware)
      ],
      '@typescript-eslint/consistent-type-imports': 'warn', // Prefer `import type` for types
  
      // --- Import Plugin ---
      'import/order': [
        'warn',
        {
          groups: [
            'builtin', // Node.js built-in modules
            'external', // npm dependencies
            'internal', // Internal aliases/paths (if configured)
            'parent', // ../
            'sibling', // ./
            'index', // ./index
            'object', // type imports
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-unresolved': 'error', // Ensure imports can be resolved
      'import/prefer-default-export': 'off', // Allow named exports without default
      'import/no-cycle': ['warn', { maxDepth: 5 }], // Detect dependency cycles
  
      // --- Node Plugin ---
      'node/no-missing-import': 'off', // Handled by typescript/import plugin
      'node/no-unpublished-import': 'off', // Can be noisy in monorepos or with certain setups
      'node/no-unsupported-features/es-syntax': ['error', { ignores: ['modules'] }], // Allow ES Modules syntax
  
      // --- Security Plugin ---
      // (Defaults from plugin:security/recommended are generally good, customize if needed)
      // e.g., 'security/detect-object-injection': 'warn',
  
      // --- Custom Project Rules (Add as needed) ---
      // 'no-restricted-syntax': ['error', 'ForbiddenFeature'],
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json', // Tell eslint-plugin-import where to find tsconfig
        },
        node: true,
      },
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
    },
    ignorePatterns: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '.*.js', // Ignore top-level dotfiles like *.config.js, use .cjs instead
      '*.config.js', // Ignore common config files if they are JS
      '*.config.cjs', // Ignore common config files if they are CJS
      '**/prisma/generated/', // Ignore Prisma generated client
      // Add any other specific directories or files to ignore
    ],
  };