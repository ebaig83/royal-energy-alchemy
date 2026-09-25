'use strict';

function receiptRows(payments = [], unlinkedLedgerPayments = []) {
  const rows = payments.filter((row) => row && row.status === 'received').map((row) => ({
    ...row,
    amount: Number(row.amount || 0),
    tip_amount: Number(row.tip_amount || 0),
    client_credit_amount: Number(row.client_credit_amount || 0),
    source: 'payment',
  }));
  const seen = new Set(rows.map((row) => row.correlation_id).filter(Boolean));
  for (const row of unlinkedLedgerPayments) {
    if (!row || row.entry_type !== 'payment' || row.related_payment_id || row.deleted_at) continue;
    if (row.correlation_id && seen.has(row.correlation_id)) continue;
    rows.push({ ...row, amount: Number(row.amount || 0), tip_amount: Number(row.tip_amount || 0),
      client_credit_amount: Number(row.client_credit_amount || 0), paid_at: row.paid_at || row.entry_date, source: 'ledger' });
    if (row.correlation_id) seen.add(row.correlation_id);
  }
  return rows;
}

function summarizeReceipts(rows = []) {
  const cents = rows.reduce((total, row) => {
    const amount = Math.max(0, Math.round(Number(row.amount || 0) * 100));
    const tip = Math.min(amount, Math.max(0, Math.round(Number(row.tip_amount || 0) * 100)));
    const credit = Math.min(amount - tip, Math.max(0, Math.round(Number(row.client_credit_amount || 0) * 100)));
    total.totalCollected += amount;
    total.serviceRevenue += Math.max(0, amount - tip - credit);
    total.tips += tip;
    total.clientCredits += credit;
    return total;
  }, { totalCollected: 0, serviceRevenue: 0, tips: 0, clientCredits: 0 });
  return Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100]));
}

module.exports = { receiptRows, summarizeReceipts };
