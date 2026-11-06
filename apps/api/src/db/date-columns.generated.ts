// Dihasilkan oleh scripts/gen/date-columns.mjs. Jangan diubah manual.
export const DATE_COLUMNS: Record<string, string[]> = {
  Activities: ['dateDeadline'],
  BankStatementLines: ['date'],
  Documents: ['date'],
  JournalEntries: ['date', 'invoiceDate', 'invoiceDateDue'],
  JournalEntryLines: ['date', 'dateMaturity'],
  Payments: ['date'],
  PurchaseOrderLines: ['datePlanned'],
  PurchaseOrders: ['dateOrder', 'datePlanned'],
  SalesOrders: ['dateOrder', 'dateConfirm', 'validityDate', 'commitmentDate', 'mtppProformaDate'],
  SalesPricelistItems: ['dateStart', 'dateEnd'],
  StockTransfers: ['scheduledDate'],
  SupplierPrices: ['dateStart', 'dateEnd'],
};
