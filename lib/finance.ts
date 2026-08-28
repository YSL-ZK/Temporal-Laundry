export type Scope = "shared" | "private";
export type AccountKind = "cash" | "bank" | "card" | "savings" | "loan";
export type TransactionKind = "income" | "expense" | "transfer" | "adjustment";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  balance: number;
  currency: string;
  scope: Scope;
  color: string;
  limit?: number;
  dueDay?: number;
};

export type Transaction = {
  id: string;
  date: string;
  kind: TransactionKind;
  amount: number;
  currency: string;
  accountId: string;
  category: string;
  payee: string;
  note?: string;
  scope: Scope;
  status: "posted" | "projected";
  exchangeRate: number;
  shoppingListId?: string;
  details?: Record<string, string | number | boolean>;
};

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: number;
  estimatedPrice: number;
  actualPrice?: number;
  category: string;
  bought: boolean;
  taxRate?: number;
  fixedTax?: number;
};

export type ShoppingList = {
  id: string;
  name: string;
  scope: Scope;
  currency: string;
  defaultTaxRate: number;
  discount: number;
  shipping: number;
  tip: number;
  status: "open" | "checked-out";
  items: ShoppingItem[];
};

export type Goal = { id: string; name: string; current: number; target: number; due: string; color: string };
export type Debt = { id: string; name: string; balance: number; rate: number; minimum: number; dueDay: number };
export type Bill = { id: string; name: string; amount: number; due: string; category: string; accountId: string; cadence: string };
export type TemplateField = { id: string; label: string; type: "text" | "amount" | "date" | "checkbox" | "select" | "formula"; required?: boolean; formula?: string };
export type CategoryTemplate = { id: string; name: string; icon: string; description: string; fields: TemplateField[]; builtin?: boolean };

export const uid = () => Math.random().toString(36).slice(2, 10);
export const currency = (amount: number, code = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);

export function shoppingTotals(list: ShoppingList, boughtOnly = true) {
  const items = boughtOnly ? list.items.filter((item) => item.bought) : list.items;
  const subtotal = items.reduce((sum, item) => sum + (item.actualPrice ?? item.estimatedPrice) * item.quantity, 0);
  const tax = items.reduce((sum, item) => {
    const price = (item.actualPrice ?? item.estimatedPrice) * item.quantity;
    return sum + (item.fixedTax ?? price * ((item.taxRate ?? list.defaultTaxRate) / 100));
  }, 0);
  const discount = Math.min(Math.max(list.discount, 0), subtotal);
  const total = Math.max(0, subtotal - discount + tax + Math.max(0, list.shipping) + Math.max(0, list.tip));
  return { subtotal, tax, discount, total, count: items.length };
}

export function accountBalance(account: Account, transactions: Transaction[]) {
  return transactions.filter((transaction) => transaction.accountId === account.id && transaction.status === "posted")
    .reduce((balance, transaction) => {
      if (transaction.kind === "income" || transaction.kind === "adjustment") return balance + transaction.amount;
      return balance - transaction.amount;
    }, account.balance);
}

export function formula(expression: string, values: Record<string, number>) {
  type Token = number | string;
  const tokens: Token[] = [];
  const source = expression.trim();
  const tokenPattern = /\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|==|!=|[()+\-*/%,<>])/gy;
  let offset = 0;
  while (offset < source.length) {
    tokenPattern.lastIndex = offset;
    const match = tokenPattern.exec(source);
    if (!match) return null;
    const raw = match[1];
    tokens.push(/^\d/.test(raw) ? Number(raw) : raw);
    offset = tokenPattern.lastIndex;
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const number = (value: number) => Number.isFinite(value) ? value : null;
  const parsePrimary = (): number | null => {
    const token = take();
    if (typeof token === "number") return token;
    if (typeof token === "string" && /^[A-Za-z_]/.test(token)) {
      if (token === "round") {
        if (take() !== "(") return null;
        const value = parseConditional();
        const precision = peek() === "," ? (take(), parseConditional()) : 2;
        if (take() !== ")" || value === null || precision === null || !Number.isInteger(precision) || precision < 0 || precision > 6) return null;
        return number(Number(value.toFixed(precision)));
      }
      if (token === "if") {
        if (take() !== "(") return null;
        const condition = parseComparison();
        if (take() !== ",") return null;
        const whenTrue = parseConditional();
        if (take() !== ",") return null;
        const whenFalse = parseConditional();
        return take() === ")" && condition !== null && whenTrue !== null && whenFalse !== null ? (condition ? whenTrue : whenFalse) : null;
      }
      return number(values[token] ?? 0);
    }
    if (token === "(") {
      const value = parseConditional();
      return take() === ")" ? value : null;
    }
    if (token === "+") return parsePrimary();
    if (token === "-") { const value = parsePrimary(); return value === null ? null : -value; }
    return null;
  };
  const parseProduct = (): number | null => {
    let value = parsePrimary();
    while (value !== null && ["*", "/", "%"].includes(String(peek()))) {
      const operator = take(); const right = parsePrimary();
      if (right === null || ((operator === "/" || operator === "%") && right === 0)) return null;
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return number(value ?? NaN);
  };
  const parseSum = (): number | null => {
    let value = parseProduct();
    while (value !== null && ["+", "-"].includes(String(peek()))) {
      const operator = take(); const right = parseProduct();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return number(value ?? NaN);
  };
  const parseComparison = (): number | null => {
    const left = parseSum(); const operator = peek();
    if (left === null) return null;
    if (![">", "<", ">=", "<=", "==", "!="].includes(String(operator))) return left;
    take(); const right = parseSum();
    if (right === null) return null;
    return (operator === ">" ? left > right : operator === "<" ? left < right : operator === ">=" ? left >= right : operator === "<=" ? left <= right : operator === "==" ? left === right : left !== right) ? 1 : 0;
  };
  const parseConditional = (): number | null => parseComparison();
  const result = parseConditional();
  return result === null || index !== tokens.length ? null : number(Math.round(result * 100) / 100);
}
