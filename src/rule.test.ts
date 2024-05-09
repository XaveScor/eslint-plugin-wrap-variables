import * as vitest from 'vitest';
import { RuleTester } from '@typescript-eslint/rule-tester';
import path from 'path';

import { eslintPluginObservableWrapVariables } from './rule.js';

const ruleTester = new RuleTester({
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: path.join(__dirname, 'fixture'),
    project: './tsconfig.json',
    ecmaFeatures: {
      jsx: true,
    },
  },
});


RuleTester.afterAll = vitest.afterAll;

RuleTester.it = vitest.it;
RuleTester.itOnly = vitest.it.only;
RuleTester.describe = vitest.describe;

ruleTester.run('eslint-plugin-observable-wrap-variables', eslintPluginObservableWrapVariables, {
  valid: [
    {
      code: 'const A = (x) => {useRender$((ctx) => {ctx.get(x)})}',
    },
    {
      code: 'const A = (x) => {useRender$((ctx) => {ctx.spy(x)})}',
    },
    {
      code: 'const A = (x) => {useMapped$((ctx) => ctx.spy(x))}',
    },
    {
      code: 'const A = (x, y) => {useMapped$((ctx) => ctx.spy(x) + ctx.get(y))}',
    },
    {
      code: 'const A = (x) => {useMapped$((ctx) => ctx.spy(x).map())}',
    },
    {
      code: 'const A = (x) => {console.log(123);useMapped$((ctx) => ctx.spy(x$))}',
    },
    {
      code: `const A = (y) => {
        useMapped$((ctxTestName) => {
          const x = ctxTestName.spy(y);
          return x;
        })
      }`,
    },
    {
      code: 'const A = () => {useRender$((ctx) => <Foo<A> />)}',
    },
    {
      code: `const A = () => {useRender$((ctx) => <A prop={(var1) => {}} />)}`,
    },
    {
      code: 'const A = () => {useRender$((ctx) => <A prop={({var1}) => {var1}} />)}',
    },
    {
      code: `type Stable<X> = X & { b: string, kind: "stable", a: number };
type StableY = Stable<(foo: Function) => void>;

const A = (y: StableY) => {useMapped$((ctx) => y + y)}`,
    },
  ],
  invalid: [
    {
      code: 'useRender$()',
      errors: [{ messageId: 'callbackRequired' }],
    },
    {
      code: 'useRender$(asd)',
      errors: [{ messageId: 'callbackArrowFunctionRequired' }],
    },
    {
      code: 'useRender$(() => {})',
      errors: [{ messageId: 'ctxNameRequired' }],
    },
    {
      code: 'useRender$(({ctx}) => {})',
      errors: [{ messageId: 'ctxNameMustBeVariable' }],
    },
    {
      code: 'const A = () => {const x = 1;return useRender$((ctx) => {x})}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);return useRender$((ctx) => {ctx.spy(x$)})}',
    },
    {
      code: 'const A = () => {const x = 1;useRender$((ctx) => {x})}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useRender$((ctx) => {ctx.spy(x$)})}',
    },
    {
      code: 'const A = () => {const x = 1;useMapped$((ctx) => x)}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useMapped$((ctx) => ctx.spy(x$))}',
    },
    {
      code: 'const A = () => {const x = 1;useMapped$((ctx) => [x])}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useMapped$((ctx) => [ctx.spy(x$)])}',
    },
    {
      code: 'const A = () => {const x = 1;useMapped$((ctx) => ({x: x}))}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useMapped$((ctx) => ({x: ctx.spy(x$)}))}',
    },
    {
      code: 'const A = () => {const x = 1;useMapped$((ctx) => ({x}))}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useMapped$((ctx) => ({x: ctx.spy(x$)}))}',
    },
    {
      code: 'const A = () => {const y = 1;useMapped$((ctx) => ctx.spy(x) + y)}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const y = 1;const y$ = useWrap$(y);useMapped$((ctx) => ctx.spy(x) + ctx.spy(y$))}',
    },
    {
      code: 'const A = () => {const x = 1;useMapped$((ctx) => x.y)}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = () => {const x = 1;const x$ = useWrap$(x);useMapped$((ctx) => ctx.spy(x$).y)}',
    },
    {
      code: 'const A = ({x}) => {const y = useMapped$((ctx) => x)}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = ({x}) => {const x$ = useWrap$(x);const y = useMapped$((ctx) => ctx.spy(x$))}',
    },
    {
      code: `const A = (y) => useMapped$((ctx) => y)`,
      errors: [{ messageId: 'variable' }],
      output: `const A = (y) => {const y$ = useWrap$(y);return useMapped$((ctx) => ctx.spy(y$))}`,
    },
    {
      code: 'const A = (x) => {useMapped$((ctx) => x + x)}',
      errors: [{ messageId: 'variable' }],
      output: 'const A = (x) => {const x$ = useWrap$(x);useMapped$((ctx) => ctx.spy(x$) + ctx.spy(x$))}'
    },
    {
      code: `type Stable<X> = X & { b: string, kind: "stable", a: number };
type StableY = Stable<(foo: Function) => void>;

const A = (y: StableY, z: number) => useMapped$((ctx) => y + z)`,
      errors: [{ messageId: 'variable' }],
      output: `type Stable<X> = X & { b: string, kind: "stable", a: number };
type StableY = Stable<(foo: Function) => void>;

const A = (y: StableY, z: number) => {const z$ = useWrap$(z);return useMapped$((ctx) => y + ctx.spy(z$))}`,
    },
  ],
});
