import test from "node:test";
import assert from "node:assert/strict";
import { debtPayoffMonths, formula, shoppingTotals, type ShoppingList } from "../lib/finance";
import { csvCell, csvRow } from "../lib/csv";

const list: ShoppingList = { id: "list", name: "Test", scope: "shared", currency: "USD", defaultTaxRate: 10, discount: 4, shipping: 2, tip: 0, status: "open", items: [
  { id: "one", name: "Taxable", quantity: 2, estimatedPrice: 10, category: "Shopping", bought: true },
  { id: "two", name: "Exempt", quantity: 1, estimatedPrice: 5, category: "Shopping", bought: true, taxRate: 0 },
  { id: "three", name: "Not bought", quantity: 1, estimatedPrice: 50, category: "Shopping", bought: false },
] };

test("shopping checkout calculates only purchased items and tax overrides", () => {
  assert.deepEqual(shoppingTotals(list), { subtotal: 25, tax: 2, discount: 4, total: 25, count: 2 });
});
test("shopping discount cannot make the total negative", () => {
  assert.equal(shoppingTotals({ ...list, discount: 100, shipping: 0 }).total, 2);
});
test("formula permits arithmetic over supplied values only", () => {
  assert.equal(formula("cost * 1.08 + shipping", { cost: 100, shipping: 5 }), 113);
  assert.equal(formula("alert(1)", {}), null);
});
test("formula supports declarative conditional and rounding operations", () => {
  assert.equal(formula("if(cost > 100, round(cost * 0.9, 2), cost)", { cost: 125 }), 112.5);
  assert.equal(formula("round(cost / 3, 2)", { cost: 10 }), 3.33);
  assert.equal(formula("if(cost > 0, process.exit(), 0)", { cost: 1 }), null);
});
test("debt payoff projection identifies amortizing and non-amortizing payments", () => {
  assert.equal(debtPayoffMonths(1_000, 0, 100), 10);
  assert.equal(debtPayoffMonths(1_000, 24, 20), null);
  assert.ok((debtPayoffMonths(1_000, 24, 100) ?? 0) > 10);
});
test("CSV export escapes formulas, delimiters, and quotes", () => {
  assert.equal(csvCell("=IMPORTXML(\"https://example.invalid\")"), "\"'=IMPORTXML(\"\"https://example.invalid\"\")\"");
  assert.equal(csvRow(["Groceries, weekly", "quoted \"note\"", "+1"]), "\"Groceries, weekly\",\"quoted \"\"note\"\"\",\"'+1\"");
});
