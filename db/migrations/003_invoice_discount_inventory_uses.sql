
-- Additive database migration.
-- Existing customer, invoice, payment and inventory data is preserved.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS discount
  NUMERIC(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_uses (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL
    REFERENCES inventory(id) ON DELETE RESTRICT,
  use_date DATE NOT NULL,
  quantity NUMERIC(16,4) NOT NULL
    CHECK (quantity > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_uses_date_idx
  ON inventory_uses(use_date, inventory_id);
