import next from 'eslint-config-next';

const eslintConfig = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', '.claude/**']
  }
];

export default eslintConfig;
