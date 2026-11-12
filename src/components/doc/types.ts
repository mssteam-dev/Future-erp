export type StockMapClient = Record<
  string,
  Record<string, { quantity: number; avg_cost: number }>
>;
