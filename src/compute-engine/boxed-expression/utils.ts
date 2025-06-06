import type {
  BoxedExpression,
  FunctionDefinition,
  SemiBoxedExpression,
  SymbolDefinition,
  NumericFlags,
  ComputeEngine,
} from '../global-types';

import { joinLatex } from '../latex-syntax/tokenizer';
import { DEFINITIONS_INEQUALITIES } from '../latex-syntax/dictionary/definitions-relational-operators';

import { MACHINE_PRECISION } from '../numerics/numeric';
import { Type } from '../../common/type/types';
import { NumericValue } from '../types';

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return typeof x === 'object' && x !== null && 'engine' in x;
}

/**
 * For any numeric result, if `bignumPreferred()` is true, calculate using
 * bignums. If `bignumPreferred()` is false, calculate using machine numbers
 */
export function bignumPreferred(ce: ComputeEngine): boolean {
  return ce.precision > MACHINE_PRECISION;
}

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function asLatexString(s: unknown): string | null {
  if (typeof s === 'number') return s.toString();
  if (typeof s === 'string') {
    const str = s.trim();

    if (str.startsWith('$$') && str.endsWith('$$')) return str.slice(2, -2);
    if (str.startsWith('$') && str.endsWith('$')) return str.slice(1, -1);
  }
  if (Array.isArray(s)) {
    // Check after 'string', since a string is also an array...
    return asLatexString(joinLatex(s));
  }
  return null;
}

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
}

export function normalizedUnknownsForSolve(
  syms:
    | string
    | Iterable<string>
    | BoxedExpression
    | Iterable<BoxedExpression>
    | null
    | undefined
): string[] {
  if (syms === null || syms === undefined) return [];
  if (typeof syms === 'string') return [syms];
  if (isBoxedExpression(syms)) return normalizedUnknownsForSolve(syms.symbol);
  if (typeof syms[Symbol.iterator] === 'function')
    return Array.from(syms as Iterable<any>).map((s) =>
      typeof s === 'string' ? s : s.symbol
    );
  return [];
}

/** Return the local variables in the expression.
 *
 * A local variable is an identifier that is declared with a `Declare`
 * expression in a `Block` expression.
 *
 * Note that the canonical form of a `Block` expression will hoist all
 * `Declare` expressions to the top of the block. `Assign` expressions
 * of undeclared variables will also have a matching `Declare` expressions
 * hoisted.
 *
 */
// export function getLocalVariables(
//   expr: BoxedExpression,
//   result: Set<string>
// ): void {
//   const h = expr.op;
//   if (h !== 'Block') return;
//   for (const statement of expr.ops!)
//     if (statement.op === 'Declare') {
//       const id = statement.op1.symbol;
//       if (id) result.add(id);
//     }
// }

export function isRelationalOperator(name: BoxedExpression | string): boolean {
  if (typeof name !== 'string') return false;
  return DEFINITIONS_INEQUALITIES.some((x) => x.name === name);
}

export function isInequalityOperator(operator: string): boolean {
  return ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(operator);
}

export function isEquationOperator(operator: string): boolean {
  return ['Equal', 'NotEqual'].includes(operator);
}

export function isInequality(expr: BoxedExpression): boolean {
  const h = expr.operator;
  if (typeof h !== 'string') return false;
  return isInequalityOperator(h);
}

export function isEquation(expr: BoxedExpression): boolean {
  const h = expr.operator;
  if (typeof h !== 'string') return false;
  return isEquationOperator(h);
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'  -> 1
 * - ['Negate', 'ImaginaryUnit']  -> -1
 * - ['Negate', ['Multiply', 3, 'ImaginaryUnit']] -> -3
 * - ['Multiply', 5, 'ImaginaryUnit'] -> 5
 * - ['Multiply', 'ImaginaryUnit', 5] -> 5
 * - ['Divide', 'ImaginaryUnit', 2] -> 0.5
 *
 */
export function getImaginaryFactor(
  expr: number | BoxedExpression
): BoxedExpression | undefined {
  if (typeof expr === 'number') return undefined;
  const ce = expr.engine;
  if (expr.symbol === 'ImaginaryUnit') return ce.One;

  if (expr.re === 0) return ce.number(expr.im!);

  if (expr.operator === 'Negate') return getImaginaryFactor(expr.op1)?.neg();

  if (expr.operator === 'Complex') {
    if (expr.op1.is(0) && !isNaN(expr.op2.re)) return ce.number(expr.op2.re);
    return undefined;
  }

  if (expr.operator === 'Multiply' && expr.nops === 2) {
    const [op1, op2] = expr.ops!;
    if (op1.symbol === 'ImaginaryUnit') return op2;
    if (op2.symbol === 'ImaginaryUnit') return op1;

    // c * (bi)
    if (op2.isNumberLiteral && op2.re === 0 && op2.im !== 0)
      return op1.mul(op2.im!);

    // (bi) * c
    if (op1.isNumberLiteral && op1.re === 0 && op1.im !== 0)
      return op2.mul(op1.im!);
  }

  if (expr.operator === 'Divide') {
    const denom = expr.op2;
    if (denom.is(0)) return undefined;
    return getImaginaryFactor(expr.op1)?.div(denom);
  }

  return undefined;
}

export function normalizeFlags(
  flags: Partial<NumericFlags> | undefined
): NumericFlags | undefined {
  if (!flags) return undefined;
  const result = { ...flags };

  if (result.odd) result.even = false;
  if (result.even) result.odd = false;

  return result as NumericFlags;
}

export function isSymbolDefinition(def: any): def is SymbolDefinition {
  if (def === undefined || def === null || typeof def !== 'object')
    return false;

  if (isBoxedExpression(def)) return false;

  if (
    'value' in def ||
    'constant' in def ||
    'inferred' in def ||
    'type' in def
  ) {
    if ('type' in def && typeof def.type !== 'string') {
      throw new Error(
        'The `type` field of a symbol definition should be of type `string`'
      );
    }

    if ('signature' in def) {
      throw new Error(
        'Symbol definition cannot have a `signature` field. Use a `type` field instead.'
      );
    }

    if ('sgn' in def) {
      throw new Error(
        'Symbol definition cannot have a `sgn` field. Use a `flags.sgn` field instead.'
      );
    }

    return true;
  }
  return false;
}

export function isFunctionDefinition(def: any): def is FunctionDefinition {
  if (def === undefined || def === null || typeof def !== 'object')
    return false;
  if (isBoxedExpression(def)) return false;
  if ('signature' in def || 'complexity' in def) {
    if ('constant' in def) {
      throw new Error(
        'Function definition cannot have a `constant` field and symbol definition cannot have a `signature` field.'
      );
    }
  }
  if (
    !('evaluate' in def) &&
    !('signature' in def) &&
    !('sgn' in def) &&
    !('complexity' in def) &&
    !('canonical' in def)
  )
    return false;

  if ('type' in def && typeof def.type !== 'function') {
    throw new Error(
      'The `type` field of a function definition should be a function'
    );
  }
  if ('sgn' in def && typeof def.sgn !== 'function') {
    throw new Error(
      'The `sgn` field of a function definition should be a function'
    );
  }
  return true;
}

export function semiCanonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<SemiBoxedExpression>
): ReadonlyArray<BoxedExpression> {
  if (!xs.every((x) => isBoxedExpression(x))) return xs.map((x) => ce.box(x));

  // Avoid memory allocation if possible
  return (xs as ReadonlyArray<BoxedExpression>).every((x) => x.isCanonical)
    ? (xs as ReadonlyArray<BoxedExpression>)
    : ((xs as ReadonlyArray<BoxedExpression>).map(
        (x) => x.canonical
      ) as ReadonlyArray<BoxedExpression>);
}

export function canonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<SemiBoxedExpression>
): ReadonlyArray<BoxedExpression> {
  // Avoid memory allocation if possible
  return xs.every((x) => isBoxedExpression(x) && x.isCanonical)
    ? (xs as ReadonlyArray<BoxedExpression>)
    : xs.map((x) => ce.box(x));
}

export function domainToType(expr: BoxedExpression): Type {
  // if (expr.symbol === 'Booleans') return 'boolean';
  // if (expr.symbol === 'Strings') return 'string';
  if (expr.symbol === 'Numbers') return 'number';
  if (expr.symbol === 'ComplexNumbers') return 'complex';
  if (expr.symbol === 'ImaginaryNumbers') return 'imaginary';
  if (expr.symbol === 'RealNumbers') return 'real';
  if (expr.symbol === 'RationalNumbers') return 'rational';
  if (expr.symbol === 'Integers') return 'integer';
  return 'unknown';
}

function angleToRadians(
  x: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  if (angularUnit === 'deg') x = x.mul(ce.Pi).div(180);
  if (angularUnit === 'grad') x = x.mul(ce.Pi).div(200);
  if (angularUnit === 'turn') x = x.mul(ce.Pi).mul(2);
  return x;
}

/**
 * Return the angle in the range [0, 2π) that is equivalent to the given angle.
 *
 * @param x
 * @returns
 */
export function canonicalAngle(
  x: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!x) return x;
  const theta = angleToRadians(x);
  if (!theta) return undefined;

  if (theta.N().im !== 0) return theta;

  const ce = theta.engine;

  // Get k, t such that theta = k * π + t
  const [k, t] = getPiTerm(theta);

  if (k.isZero) return ce.number(t);

  const k2 = ce._numericValue(k.bignumRe ? k.bignumRe.mod(2) : k.re % 2);
  return ce.number(t.add(ce.Pi.mul(k2).N().numericValue!));
}

/*
 * Return k and t such that expr = k * pi + t.
 * If no pi factor is found, or k or t are not numeric values, return [0, 0].
 */
export function getPiTerm(
  expr: BoxedExpression
): [k: NumericValue, t: NumericValue] {
  const ce = expr.engine;
  if (expr.symbol === 'Pi') return [ce._numericValue(1), ce._numericValue(0)];

  if (expr.operator === 'Negate') {
    const [k, t] = getPiTerm(expr.ops![0]);
    return [k.neg(), t.neg()];
  }

  if (expr.operator === 'Add' && expr.nops === 2) {
    const [k1, t1] = getPiTerm(expr.op1);
    const [k2, t2] = getPiTerm(expr.op2);
    return [k1.add(k2), t1.add(t2)];
  }

  if (expr.operator === 'Multiply' && expr.nops === 2) {
    if (expr.op1.isNumberLiteral) {
      const [k, t] = getPiTerm(expr.op2);
      const n = expr.op1.numericValue!;
      return [k.mul(n), t.mul(n)];
    }
    if (expr.op2.isNumberLiteral) {
      const [k, t] = getPiTerm(expr.op1);
      const n = expr.op2.numericValue!;
      return [k.mul(n), t.mul(n)];
    }
  }

  if (expr.operator === 'Divide') {
    if (expr.op2.isNumberLiteral) {
      const [k1, t1] = getPiTerm(expr.op1);
      const d = expr.op2.numericValue!;
      return [k1.div(d), t1.div(d)];
    }
  }

  return [ce._numericValue(0), ce._numericValue(expr.N().numericValue ?? 0)];
}
