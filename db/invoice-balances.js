
'use strict';

// Apply customer ledger payments to the oldest unpaid invoices first.
const cents = value => Math.round((Number(value) || 0) * 100);
const fromCents = value => value / 100;

function sortInvoices(a, b) {
  return String(a.date).localeCompare(String(b.date)) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    String(a.id).localeCompare(String(b.id));
}

function allocateLedgerPayments(invoices, payments) {
  const receipts = new Map();

  for (const p of payments) {
    const key = p.customerId;
    receipts.set(
      key,
      (receipts.get(key) || 0) + Math.max(0, cents(p.amount))
    );
  }

  const grouped = new Map();

  for (const invoice of invoices) {
    const key = invoice.customerId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(invoice);
  }

  for (const [customerId, items] of grouped) {
    let available = receipts.get(customerId) || 0;

    for (const inv of items.sort(sortInvoices)) {
      const balanceBefore = Math.max(
        0,
        cents(inv.total) - cents(inv.paidAmt)
      );

      const applied = Math.min(balanceBefore, available);
      available -= applied;

      inv.ledgerPaidAmt = fromCents(applied);
      inv.paidTotal = fromCents(cents(inv.paidAmt) + applied);
      inv.balance = fromCents(balanceBefore - applied);
    }
  }

  return invoices;
}

module.exports = { allocateLedgerPayments, sortInvoices };
