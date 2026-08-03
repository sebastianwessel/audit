package storage

import (
    "context"
    "database/sql"
)

type Invoice struct {
    ID string
    TenantID string
    Total int
}

func GetInvoice(ctx context.Context, db *sql.DB, tenantID string, invoiceID string) (*Invoice, error) {
    row := db.QueryRowContext(ctx, "SELECT id, tenant_id, total FROM invoices WHERE id = ?", invoiceID)
    invoice := &Invoice{}
    if err := row.Scan(&invoice.ID, &invoice.TenantID, &invoice.Total); err != nil {
        return nil, err
    }
    return invoice, nil
}
