import {
  applyRecursively,
  getFunctionName,
  getSymbolName,
  getTail,
  isAtomic,
} from '../common/utils';
import { Expression } from '../public';
import { match, substitute, Substitution } from './patterns';
import { ComputeEngine, Numeric, Rule, RuleSet } from './public';

// Generator functions

// export function fixPoint(rule: Rule);
// export function chain(rules: RuleSet);

const SUBS = {
  x: '_x',
  y: '_y',
  z: '_z',
  a: '_a',
  b: '_b',
  c: '_c',
  m: '_m',
  n: '_n',
  i: '_i',
  j: '_j',
};

export function rules<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  rs: Iterable<Rule>
): RuleSet {
  const result = new Set<Rule>();
  for (const [lhs, rhs, condition] of rs) {
    // The `lhs` when given as an expression (and not a Latex string)
    // may not be in canonical form: this is used to rewrite some non-canonical
    // expression to canonical form.
    const xlhs =
      typeof lhs === 'string'
        ? ce.canonical(substituteSymbols(ce.parse(lhs), SUBS))
        : substituteSymbols(lhs, SUBS);
    const xrhs =
      typeof rhs === 'string'
        ? ce.canonical(substituteSymbols(ce.parse(rhs), SUBS))
        : substituteSymbols(rhs, SUBS);

    if (typeof condition === 'function' || typeof condition === 'undefined') {
      result.add([xlhs, xrhs, condition]);
    } else if (typeof condition === 'string') {
      const xcond = ce.parse(condition);
      result.add([
        xlhs,
        xrhs,
        (ce: ComputeEngine, sub: Substitution) =>
          ce.is(substitute(xcond, sub)) ?? false,
      ]);
    }
  }
  return result;
}

function substituteSymbols<T extends number = Numeric>(
  expr: Expression<T>,
  sub: Substitution<T>
): Expression<T> {
  for (const [symbol, replacement] of Object.entries(sub)) {
    console.assert(typeof replacement === 'string');
    expr = substituteSymbol<T>(expr, symbol, replacement as string);
  }
  return expr;
}

function substituteSymbol<T extends number = Numeric>(
  expr: Expression<T>,
  symbol: string,
  replacement: string
): Expression<T> {
  const sym = getSymbolName(expr);
  if (sym === symbol) return replacement;
  const name = getFunctionName(expr);
  if (name === symbol) {
    return [replacement, getTail(expr)];
  }
  if (isAtomic(expr)) return expr;
  return applyRecursively(expr, (x) =>
    substituteSymbol(x, symbol, replacement)
  );
}

export function applyRule<T extends number = Numeric>(
  ce: ComputeEngine<T>,
  [lhs, rhs, condition]: Rule<T>,
  expr: Expression<T>
): Expression<T> | null {
  const sub = match(lhs, expr);
  if (sub === null) return null;

  if (typeof condition === 'function' && !condition(ce, sub)) return null;

  console.log('Applying rule ', ce.serialize(lhs), '->', ce.serialize(rhs));
  return substitute<T>(rhs, sub);
}

/**
 * Repeatedely apply rules in the ruleset until no rules apply
 */
export function replace<T extends number = Numeric>(
  ce: ComputeEngine,
  rules: RuleSet,
  expr: Expression<T>
): Expression<T> | null {
  let done = false;
  while (!done) {
    done = true;
    for (const rule of rules) {
      const result = applyRule(ce, rule, expr);
      if (result !== null) {
        done = false;
        expr = result;
      }
    }
  }
  return expr;
}

// @todo ['Alternatives', ...]:
// @todo: ['Condition',...] : Conditional match
// @todo: ['Repeated',...] : repeating match
// @todo _x:Head or _x:RealNumber
// replace() -> replace matching patterns with another expression
// replaceAll(), replaceRepeated()