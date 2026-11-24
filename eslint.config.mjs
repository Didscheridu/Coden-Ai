import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['node_modules/**', '.playwright-cli/**', 'dist/**']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
