import { AST_NODE_TYPES, ESLintUtils, TSESTree, TSESLint } from '@typescript-eslint/utils';
import {
  isLiteralTypeNode,
  isPropertySignature,
  isStringLiteral,
} from 'typescript';

const createRule = ESLintUtils.RuleCreator((name) => name);

const getterMethods = new Set(['get', 'spy']);
const spyHooks = new Set(['useRender$', 'useMapped$', 'useEffect$'] as const);
const getHooks = new Set(['useCallbackRef$'] as const);
const hooks = new Set([...spyHooks, ...getHooks] as const);
type HooksList = Parameters<(typeof hooks)['add']>[0];

function getMethod(method: HooksList) {
  // @ts-expect-error 123
  if (spyHooks.has(method)) {
    return 'spy';
  }
  return 'get';
}
function isStable(node: TSESTree.Identifier, context: TSESLint.RuleContext<string, []>) {
  // node means stable if it's .kind is 'stable' type
  try {
    const parserServices = ESLintUtils.getParserServices(context);
    const checker = parserServices.program.getTypeChecker();
    const originalNode = parserServices.esTreeNodeToTSNodeMap.get(node);
    const type = checker.getTypeAtLocation(originalNode);

    const propertySignature = type.getProperty('kind')?.valueDeclaration;
    if (!isPropertySignature(propertySignature)) {
      return false;
    }
    const literalTypeNode = propertySignature.type;
    if (!isLiteralTypeNode(literalTypeNode)) {
      return false;
    }
    const { literal } = literalTypeNode;
    if (!isStringLiteral(literal)) {
      return false;
    }

    return literal.text === 'stable';
  } catch (e) {
    return false;
  }
}

function findComponentNode(node: TSESTree.Node, context: TSESLint.RuleContext<string, []>) {
  const ancestors = context.sourceCode.getAncestors(node).reverse();
  for (const ancestor of ancestors) {
    if (ancestor.type === AST_NODE_TYPES.ArrowFunctionExpression) {
      return ancestor as TSESTree.ArrowFunctionExpression;
    }
  }
  return null;
}

function calculateComponentVariables(
  hookNode: TSESTree.Node,
  context: TSESLint.RuleContext<string, []>,
  componentNode: TSESTree.ArrowFunctionExpression,
) {
  const currentScopeVariables = context.sourceCode.getScope(hookNode).variables.map((x) => x.name);
  // Hack because ESLint cannot give us the variable list from the ArrowFunctionExpression
  const componentVarDeclaration = componentNode.parent;
  const componentScopeVariables = new Set(context.sourceCode.getScope(componentVarDeclaration).variables.map((x) => x.name));

  const delta = new Set(currentScopeVariables.filter((x) => !componentScopeVariables.has(x)));
  return delta;
}

function isGetterInvalid(node: TSESTree.CallExpression, ctxName: string | null) {
  if (!ctxName) {
    return true;
  }
  if (node.callee.type !== AST_NODE_TYPES.MemberExpression) {
    return true;
  }
  const ctxNode = node.callee.object;
  if (ctxNode.type !== AST_NODE_TYPES.Identifier) {
    return true;
  }
  if (ctxNode.name !== ctxName) {
    return true;
  }

  return false;
}

function isShortProperty(node: TSESTree.Node) {
  const { parent } = node;
  if (parent?.type === AST_NODE_TYPES.Property) {
    if (parent.shorthand) {
      return true;
    }
  }
  return false;
}

export const eslintPluginObservableWrapVariables = createRule({
  name: 'eslint-plugin-observable-wrap-variables',
  defaultOptions: [],
  meta: {
    type: 'suggestion',
    docs: {
      description: 'wrap closure variables in observable functions',
      recommended: 'strict',
    },
    fixable: 'code',
    schema: [],
    messages: {
      callbackRequired: 'callback is required',
      callbackArrowFunctionRequired: 'callback must be an arrow function',
      ctxNameRequired: 'first argument is required',
      ctxNameMustBeVariable: 'first argument must be a variable',
      variable: 'variable {{variable}} must be wrapped by ctx.spy or ctx.get',
      cannotUseHooksOutsideComponent: 'hooks can only be used inside a component',
    },
  },
  create(context) {
    let ctxName: string | null = null;
    let isExpression = false;
    let methodName: HooksList | null = null;
    let insideGetter = false;
    let methodNode: TSESTree.Node | null = null;
    const errors = new Map<TSESTree.Node, { variable: string }>();
    let componentVariables = new Set<string>();

    function enterObservableFn(method: HooksList) {
      return (node: TSESTree.CallExpression) => {
        const [callback] = node.arguments;
        if (!callback) {
          context.report({
            node,
            messageId: 'callbackRequired',
          });
          return;
        }
        if (callback.type !== AST_NODE_TYPES.ArrowFunctionExpression) {
          context.report({
            node: callback,
            messageId: 'callbackArrowFunctionRequired',
          });
          return;
        }
        const [firstArg] = callback.params;
        if (!firstArg) {
          context.report({
            node: callback,
            messageId: 'ctxNameRequired',
          });
          return;
        }
        if (firstArg.type !== AST_NODE_TYPES.Identifier) {
          context.report({
            node: firstArg,
            messageId: 'ctxNameMustBeVariable',
          });
          return;
        }
        const componentNode = findComponentNode(node, context);
        if (!componentNode) {
          return;
        }
        componentVariables = calculateComponentVariables(node, context, componentNode);

        methodName = method;
        ctxName = firstArg.name;
        methodNode = node;
        isExpression = componentNode.expression;
      };
    }
    function exitObservableFn() {
      if (errors.size > 0) {
        const variables = [...new Set(Array.from(errors.values()).map(({ variable: v }) => v))];
        context.report({
          node: methodNode!,
          messageId: 'variable',
          data: { variable: variables.join(', ') },
          *fix(fixer) {
            const ancestors = context.sourceCode.getAncestors(methodNode!).reverse();
            let placeArea = methodNode!;
            if (!isExpression) {
              for (const ancestor of ancestors) {
                if ('body' in ancestor && Array.isArray(ancestor.body)) {
                  break;
                }
                placeArea = ancestor;
              }
            }
            // if it is expression, we need to wrap it with return and {}
            if (isExpression) {
              yield fixer.insertTextBefore(methodNode!, '{');
            }
            yield* variables.map((varName) => fixer.insertTextBefore(placeArea, `const ${varName}$ = useWrap$(${varName});`));
            if (isExpression) {
              yield fixer.insertTextBefore(methodNode!, 'return ');
            }
            const replaces = Array.from(errors.entries()).map(([node, { variable: varName }]) => {
              const key = isShortProperty(node) ? `${varName}: ` : '';
              return fixer.replaceText(node, `${key}${ctxName}.${getMethod(methodName!)}(${varName}$)`);
            });
            yield* replaces;
            if (isExpression) {
              yield fixer.insertTextAfter(methodNode!, `}`);
            }
          },
        });
      }
      errors.clear();
      ctxName = null;
    }

    function enterGetter(node: TSESTree.CallExpression) {
      if (isGetterInvalid(node, ctxName)) {
        return;
      }
      insideGetter = true;
    }
    function exitGetter(node: TSESTree.CallExpression) {
      if (isGetterInvalid(node, ctxName)) {
        return;
      }
      insideGetter = false;
    }

    function variable(node: TSESTree.Identifier) {
      if (!ctxName) {
        return;
      }
      if (insideGetter) {
        return;
      }
      if (node.name === ctxName) {
        return;
      }
      if (errors.has(node)) {
        return;
      }
      // @ts-expect-error 123
      if (hooks.has(node.name)) {
        return;
      }
      if (!methodName) {
        return;
      }
      // Skip all generics
      if (node.parent?.type.startsWith('TSType')) {
        return;
      }
      if (!componentVariables.has(node.name)) {
        return;
      }

      if (isStable(node, context)) {
        return;
      }
      errors.set(node, { variable: node.name });
    }

    const rules: TSESLint.RuleListener = {};
    // find all hooks
    for (const hook of hooks) {
      const prefix = `CallExpression[callee.name="${hook}"]`;
      rules[prefix] = enterObservableFn(hook);
      rules[`${prefix} Identifier:not(.key):not(.property)`] = variable;
      rules[`${prefix}:exit`] = exitObservableFn;

      // find all ctx.get and ctx.spy
      for (const getter of getterMethods) {
        const getterPrefix = `${prefix} CallExpression[callee.property.name="${getter}"]`;
        rules[getterPrefix] = enterGetter;
        rules[`${getterPrefix}:exit`] = exitGetter;
      }
    }

    return rules;
  },
});

export default eslintPluginObservableWrapVariables;
