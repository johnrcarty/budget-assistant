import type {
  SimplefinAccount,
  SimplefinAccountsResponse,
  SimplefinTransaction,
} from "@/types/simplefin";

// Protocol shapes: balance/amount are decimal strings, dates epoch seconds.

export function epochSeconds(isoDate: string): number {
  // Noon UTC keeps `.toISOString().slice(0, 10)` on the same calendar day.
  return Math.floor(Date.parse(`${isoDate}T12:00:00Z`) / 1000);
}

export function sfTransaction(
  over: Partial<SimplefinTransaction> & { id: string },
): SimplefinTransaction {
  return {
    posted: epochSeconds("2026-07-10"),
    amount: "-4.50",
    description: "COFFEE SHOP",
    ...over,
  };
}

export function sfAccount(over: Partial<SimplefinAccount> & { id: string }): SimplefinAccount {
  return {
    name: "Test Checking ...1234",
    currency: "USD",
    balance: "1000.00",
    "balance-date": epochSeconds("2026-07-10"),
    transactions: [],
    ...over,
  };
}

export function sfResponse(
  accounts: SimplefinAccount[],
  errlist: SimplefinAccountsResponse["errlist"] = [],
): SimplefinAccountsResponse {
  return { errlist, accounts };
}
