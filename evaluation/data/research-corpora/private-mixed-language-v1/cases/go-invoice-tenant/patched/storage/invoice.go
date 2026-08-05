package storage

import "context"

type Invoice struct {
	ID       string
	TenantID string
}

type Store interface {
	QueryRowContext(context.Context, string, ...string) Invoice
}

func FindInvoice(ctx context.Context, store Store, tenantID string, invoiceID string) Invoice {
	return store.QueryRowContext(ctx, "SELECT id, tenant_id FROM invoices WHERE id = ? AND tenant_id = ?", invoiceID, tenantID)
}
