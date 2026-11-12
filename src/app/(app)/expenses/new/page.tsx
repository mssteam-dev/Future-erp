import { requirePermission } from "@/lib/auth";
import { getBranches, getExpenseTypes, getTreasuryAccounts } from "@/lib/data";
import ExpenseForm from "@/components/doc/ExpenseForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("expenses.create");
  const { error } = await searchParams;

  const [branches, types, treasury] = await Promise.all([
    getBranches(),
    getExpenseTypes(),
    getTreasuryAccounts(),
  ]);

  return (
    <>
      <PageHeader title="تسجيل مصروف" />
      <ExpenseForm branches={branches} types={types} treasury={treasury} error={error} />
    </>
  );
}
