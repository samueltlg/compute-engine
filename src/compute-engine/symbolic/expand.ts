import { asMachineInteger } from '../boxed-expression/numerics';
import { isRelationalOperator } from '../boxed-expression/utils';
import { simplifyAdd } from '../library/arithmetic-add';
import { BoxedExpression, IComputeEngine } from '../public';
import { canonicalNegate } from './negate';

function distribute2(
  lhs: Readonly<BoxedExpression>,
  rhs: Readonly<BoxedExpression>
): BoxedExpression {
  // @fixme: if both lhs and rhs are not functions, just return their product. Do we need to call mul(), which will evaluate them?

  //
  // Negate
  //

  if (lhs.head === 'Negate' && rhs.head === 'Negate')
    return distribute2(lhs.op1, rhs.op1);

  if (lhs.head === 'Negate') return canonicalNegate(distribute2(lhs.op1, rhs));
  if (rhs.head === 'Negate') return canonicalNegate(distribute2(lhs, rhs.op1));

  const ce = lhs.engine;

  //
  // Divide
  //
  if (lhs.head === 'Divide' && rhs.head === 'Divide') {
    // Apply distribute to the numerators only.
    const denom = ce.mul(lhs.op2, rhs.op2);
    return ce.div(distribute2(lhs.op1, rhs.op1), denom);
  }

  if (lhs.head === 'Divide') return ce.div(distribute2(lhs.op1, rhs), lhs.op2);
  if (rhs.head === 'Divide') return ce.div(distribute2(lhs, rhs.op1), rhs.op2);

  //
  // Add
  //
  if (lhs.head === 'Add')
    return ce.add(...lhs.ops!.map((x) => distribute2(x, rhs)));
  if (rhs.head === 'Add')
    return ce.add(...rhs.ops!.map((x) => distribute2(lhs, x)));
  return ce.mul(lhs, rhs);
}

/* Distribute
 * Assuming `expr` is a product of expressions, distribute each term of the product.
 */
export function distribute(
  ce: IComputeEngine,
  head: string,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  if (head === 'Power') {
    const exp = asMachineInteger(ops[1]);
    if (exp === null) return null;
    return expandPower(ops[0], exp);
  }

  if (head === 'Negate')
    return distribute(ce, 'Multiply', [ce.NegativeOne, ops[0]]);

  if (head === 'Divide') {
    if (!ops[0]?.ops || typeof ops[0].head !== 'string') return null;
    const num = distribute(ce, ops[0].head!, ops[0].ops);
    if (!num) return null;
    return ce.div(num, ops[1]);
  }

  if (head === 'Multiply') {
    if (ops.length === 1) return ops[0];
    if (ops.length === 2) return distribute2(ops[0], ops[1]);

    const rhs = distribute(ce, head, ops.slice(1));
    if (!rhs) return null;
    return distribute2(ops[0], rhs);
  }
  return null;
}

const binomials = [
  [1],
  [1, 1],
  [1, 2, 1],
  [1, 3, 3, 1],
  [1, 4, 6, 4, 1],
  [1, 5, 10, 10, 5, 1],
  [1, 6, 15, 20, 15, 6, 1],
  [1, 7, 21, 35, 35, 21, 7, 1],
  [1, 8, 28, 56, 70, 56, 28, 8, 1],
];

function choose(n: number, k: number): number {
  while (n >= binomials.length) {
    const s = binomials.length;
    const nextRow = [1];
    const prev = binomials[s - 1];
    for (let i = 1; i < s; i++) nextRow[i] = prev[i - 1] + prev[i];

    nextRow[s] = 1;
    binomials.push(nextRow);
  }
  return binomials[n][k];
}

function multinomialCoefficient(k: number[]): number {
  let n = k.reduce((acc, v) => acc + v, 0);
  let prod = 1;
  for (let i = 0; i < k.length; i += 1) {
    prod *= choose(n, k[i]);
    n -= k[i];
  }
  return prod;
}

// Return all the combinations of n non-negative integers that sum to exp.
function* powers(n: number, exp: number): Generator<number[]> {
  if (n === 1) {
    yield [exp];
    return;
  }

  for (let i = 0; i <= exp; i += 1)
    for (const p of powers(n - 1, exp - i)) yield [i, ...p];
}

function expandPower(
  base: BoxedExpression,
  exp: number
): BoxedExpression | null {
  const ce = base.engine;
  if (exp < 0) {
    const expr = expandPower(base, -exp);
    return expr ? ce.inv(expr) : null;
  }
  if (exp === 0) return ce.One;
  if (exp === 1) return expand(base);
  if (base.head === 'Negate') {
    if (Number.isInteger(exp)) {
      const sign = exp % 2 === 0 ? 1 : -1;
      const result = expandPower(base.op1, exp);
      if (result === null) return null;
      return sign > 0 ? result : ce.neg(result);
    }
  }

  // Subtract is non-canonical, so we don't expect to see it here.
  console.assert(base.head !== 'Subtract');

  // We can expand only if the expression is a power of a sum.
  if (base.head !== 'Add') return null;

  // Apply the multinomial theorem
  // https://en.wikipedia.org/wiki/Multinomial_theorem
  // (a + b + c)^n = sum_{k1 + k2 + ... + km = n} (n choose k1, k2, ..., km) a^k1 b^k2 ... c^km
  // where the sum is over all non-negative integers k1, k2, ..., km such that k1 + k2 + ... + km = n
  // and (n choose k1, k2, ..., km) = n! / (k1! k2! ... km!)
  // For example, (a + b)^3 = (a + b)^2 (a + b) = (a^2 + 2ab + b^2) (a + b) = a^3 + 3a^2b + 3ab^2 + b^3
  // The multinomial theorem is a generalization of the binomial theorem.
  // For example, (a + b)^2 = a^2 + 2ab + b^2
  // (a + b + c)^2 = (a + b + c) (a + b + c) = a^2 + b^2 + c^2 + 2ab + 2ac + 2bc
  // (a + b + c)^3 = (a + b + c) (a + b + c) (a + b + c) = a^3 + b^3 + c^3 + 3a^2b + 3a^2c + 3b^2a + 3b^2c + 3c^2a + 3c^2b + 6abc

  const terms = base.ops!;
  const it = powers(terms.length, exp);

  const result: BoxedExpression[] = [];
  for (const val of it) {
    const product = [ce.number(multinomialCoefficient(val))];
    for (let i = 0; i < val.length; i += 1) {
      if (val[i] !== 0) {
        if (val[i] === 1) product.push(terms[i]);
        else product.push(ce.pow(terms[i], val[i]));
      }
    }
    result.push(ce.mul(...product));
  }
  return ce.add(...result);
}

/** Use the multinomial theorem (https://en.wikipedia.org/wiki/Multinomial_theorem) to expand the expression.
 * The expression must be a power of a sum of terms.
 * The power must be a positive integer.
 * - expr = '(a + b)^2'
 *     ->  'a^2 + 2ab + b^2'
 * - expr = '(a + b)^3'
 *    -> 'a^3 + 3a^2b + 3ab^2 + b^3'
 */
export function expandMultinomial(
  expr: BoxedExpression
): BoxedExpression | null {
  if (expr.head !== 'Power') return null;
  const exp = asMachineInteger(expr.op2);
  if (exp === null) return null;

  return expandPower(expr.op1, exp);
}

/** Expand all
 * Recursive expand of all terms in the expression
 */
export function expandAll(expr: BoxedExpression): BoxedExpression | null {
  if (expr.head && expr.ops) {
    const ops = expr.ops.map((x) => expandAll(x) ?? x);
    const result = expr.engine.box([expr.head, ...ops]);
    return expand(result) ?? result;
  }

  return null;
}

/** ExpandNumerator
 * Expand the numerator of a fraction, or a simple product
 */

function expandNumerator(expr: BoxedExpression): BoxedExpression | null {
  if (expr.head !== 'Divide') return null;
  const expandedNumerator = expand(expr.op1);
  if (expandedNumerator === null) return null;
  const ce = expr.engine;
  if (expandedNumerator.head === 'Add') {
    return ce.add(...expandedNumerator.ops!.map((x) => ce.div(x, expr.op2)));
  }
  return expr.engine.div(expandedNumerator, expr.op2);
}

/** ExpandDenominator
 * Expand the denominator of a fraction (but not a simple product)
 */

function expandDenominator(expr: BoxedExpression): BoxedExpression | null {
  if (expr.head !== 'Divide') return null;
  const expandedDenominator = expand(expr.op2);
  if (expandedDenominator === null) return null;
  const ce = expr.engine;
  if (expandedDenominator.head === 'Add') {
    return ce.add(...expandedDenominator.ops!.map((x) => ce.div(expr.op1, x)));
  }
  return ce.div(expr.op1, expandedDenominator);
}

/** Apply the distributive law if the expression is a product of sums.
 * For example, a(b + c) = ab + ac
 * Expand the expression if it is a power of a sum.
 * Expand the terms of the expression if it is a sum or negate.
 * If the expression is a fraction, expand the numerator.
 * If the exression is a relational operator, expand the operands.
 * Return null if the expression cannot be expanded.
 */
export function expand(
  expr: BoxedExpression | undefined
): BoxedExpression | null {
  if (!expr) return null;

  // Expand relational operators
  const h = expr.head;
  if (isRelationalOperator(h)) {
    return expr.engine._fn(
      h,
      expr.ops!.map((x) => expand(x) ?? x)
    );
  }

  const result = expandNumerator(expr);
  if (result !== null) return result;

  if (h === 'Multiply') return distribute(expr.engine, 'Multiply', expr.ops!);

  // Note arg simplifyAdd will simplify each argument (which in turn will
  // expand them), so no need to expand the arguments here.
  if (h === 'Add') return simplifyAdd(expr.engine, expr.ops!);

  if (h === 'Negate') {
    const op = expand(expr.op1);
    if (op === null) return null;
    return expr.engine.neg(op);
  }

  if (h === 'Power') return expandMultinomial(expr);

  return null;
}
