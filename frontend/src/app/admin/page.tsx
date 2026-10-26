'use client';
import { AdminShell } from '@/components/shell/Shell';
import { OrdersBoard } from '@/components/orders/OrdersBoard';

export default function OrdersPage() {
  return (
    <AdminShell title="Orders & bookings">
      <OrdersBoard />
    </AdminShell>
  );
}
