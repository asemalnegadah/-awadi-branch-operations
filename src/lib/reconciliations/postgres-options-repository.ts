import type { Sql } from "postgres";

export interface ReconciliationAccountOption {
  readonly customerId: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly customerNumber: string | null;
  readonly currencyCode: "SR" | "RG";
  readonly accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

interface AccountOptionRow {
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  currency_code: "SR" | "RG";
  account_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

export async function listReconciliationAccountOptionsPostgres(
  sql: Sql,
  query?: string,
): Promise<readonly ReconciliationAccountOption[]> {
  const rows = await sql.unsafe<AccountOptionRow[]>(
    `
      SELECT
        customer.id AS customer_id,
        account.id AS customer_account_id,
        customer.trade_name_ar AS customer_name,
        customer.customer_number,
        account.currency_code,
        account.status AS account_status
      FROM customer_accounts AS account
      JOIN customers AS customer ON customer.id = account.customer_id
      WHERE customer.deleted_at IS NULL
        AND customer.merged_into_customer_id IS NULL
        AND account.status <> 'CLOSED'
        AND (
          $1::text IS NULL
          OR customer.trade_name_ar ILIKE '%' || $1 || '%'
          OR customer.customer_number ILIKE '%' || $1 || '%'
        )
      ORDER BY customer.trade_name_ar ASC, account.currency_code ASC, account.id ASC
      LIMIT 200
    `,
    [query?.trim() || null],
  );
  return Object.freeze(rows.map((row) => Object.freeze({
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    accountStatus: row.account_status,
  })));
}
