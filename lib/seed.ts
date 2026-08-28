import type { Account, Bill, CategoryTemplate, Debt, Goal, ShoppingList, Transaction } from "./finance";

export const initialAccounts: Account[] = [
  { id: "a1", name: "Everyday checking", kind: "bank", balance: 4820, currency: "USD", scope: "shared", color: "#5f7cff" },
  { id: "a2", name: "Travel card", kind: "card", balance: -860, currency: "USD", scope: "private", color: "#e98757", limit: 5000, dueDay: 8 },
  { id: "a3", name: "Emergency fund", kind: "savings", balance: 12400, currency: "USD", scope: "shared", color: "#26a880" },
  { id: "a4", name: "Colombia cash", kind: "cash", balance: 340000, currency: "COP", scope: "private", color: "#af70d7" },
];

export const initialTransactions: Transaction[] = [
  { id: "t1", date: "2026-08-26", kind: "income", amount: 4200, currency: "USD", accountId: "a1", category: "Salary", payee: "Northstar Studio", scope: "shared", status: "posted", exchangeRate: 1 },
  { id: "t2", date: "2026-08-25", kind: "expense", amount: 84.5, currency: "USD", accountId: "a1", category: "Dining", payee: "Marlow Kitchen", scope: "shared", status: "posted", exchangeRate: 1 },
  { id: "t3", date: "2026-08-24", kind: "expense", amount: 126, currency: "USD", accountId: "a2", category: "Shopping", payee: "Market basket", scope: "private", status: "posted", exchangeRate: 1 },
  { id: "t4", date: "2026-08-28", kind: "expense", amount: 19.99, currency: "USD", accountId: "a2", category: "Subscriptions", payee: "Streamflow", scope: "private", status: "projected", exchangeRate: 1 },
];

export const initialShoppingLists: ShoppingList[] = [{
  id: "s1", name: "Weekend groceries", scope: "shared", currency: "USD", defaultTaxRate: 8.25, discount: 4, shipping: 0, tip: 0, status: "open",
  items: [
    { id: "i1", name: "Coffee beans", quantity: 1, estimatedPrice: 16, actualPrice: 15.5, category: "Groceries", bought: true },
    { id: "i2", name: "Oat milk", quantity: 2, estimatedPrice: 5.5, category: "Groceries", bought: true },
    { id: "i3", name: "Pasta", quantity: 2, estimatedPrice: 3.25, category: "Groceries", bought: false, taxRate: 0 },
  ],
}];

export const initialGoals: Goal[] = [{ id: "g1", name: "Lisbon in spring", current: 2150, target: 3800, due: "2027-04-01", color: "#ffb653" }, { id: "g2", name: "Emergency cushion", current: 12400, target: 18000, due: "2027-01-01", color: "#5f7cff" }];
export const initialDebts: Debt[] = [{ id: "d1", name: "Travel card", balance: 860, rate: 20.5, minimum: 85, dueDay: 8 }];
export const initialBills: Bill[] = [{ id: "b1", name: "Streamflow", amount: 19.99, due: "Aug 28", category: "Subscriptions", accountId: "a2", cadence: "Monthly" }, { id: "b2", name: "Internet", amount: 65, due: "Sep 2", category: "Bills", accountId: "a1", cadence: "Monthly" }];
export const initialTemplates: CategoryTemplate[] = [
  { id: "shopping", name: "Shopping", icon: "shopping", description: "Itemized lists, tax and checkout", builtin: true, fields: [] },
  { id: "bills", name: "Bills", icon: "bills", description: "Provider, billing period and deadline", builtin: true, fields: [] },
  { id: "transport", name: "Transport", icon: "transport", description: "Vehicle, fuel and routes", builtin: true, fields: [] },
  { id: "dining", name: "Dining", icon: "dining", description: "Guests, tips and splits", builtin: true, fields: [] },
  { id: "health", name: "Health", icon: "health", description: "Care, claims and reimbursements", builtin: true, fields: [] },
  { id: "travel", name: "Travel", icon: "travel", description: "Trips, bookings and local currency", builtin: true, fields: [] },
];
