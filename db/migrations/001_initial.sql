CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  cust_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  addr TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('roll','ink','accessory')),
  company TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  roll_size NUMERIC(16,4) NOT NULL DEFAULT 1,
  qty NUMERIC(16,4) NOT NULL DEFAULT 0,
  prate NUMERIC(14,4) NOT NULL DEFAULT 0,
  srate NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amt NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices(customer_id, date);
CREATE TABLE IF NOT EXISTS invoice_items (
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_position INTEGER NOT NULL,
  item_id TEXT REFERENCES inventory(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity NUMERIC(16,4) NOT NULL,
  unit TEXT NOT NULL,
  rate NUMERIC(14,4) NOT NULL,
  purchase_rate NUMERIC(14,4) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  PRIMARY KEY(invoice_id, line_position)
);
CREATE INDEX IF NOT EXISTS invoice_items_item_idx ON invoice_items(item_id);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments(customer_id, date);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Printing','Ready','Delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_ledger (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('loan','advance','repayment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_ledger_staff_idx ON staff_ledger(staff_id, date);
