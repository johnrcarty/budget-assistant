// Field names/types match the SimpleFin protocol spec exactly
// (https://www.simplefin.org/protocol.html) - balance/amount are decimal
// strings, timestamps are unix epoch seconds.
export interface SimplefinError {
  code: string;
  msg: string;
  conn_id?: string;
  account_id?: string;
}

export interface SimplefinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
}

export interface SimplefinAccount {
  id: string;
  name: string;
  conn_id?: string;
  currency: string;
  balance: string;
  "balance-date": number;
  "available-balance"?: string;
  transactions?: SimplefinTransaction[];
  extra?: Record<string, unknown>;
}

export interface SimplefinAccountsResponse {
  errlist: SimplefinError[];
  accounts: SimplefinAccount[];
  connections?: unknown[];
}
