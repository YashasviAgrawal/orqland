'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminShell } from '@/components/shell/Shell';
import { OrderDetailLoader } from '@/components/orders/OrderDetail';
import { Icon } from '@/components/ui/Icon';

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  return (
    <AdminShell
      title="Order details"
      actions={
        <Link href="/admin" className="btn btn-neutral btn-sm">
          <Icon name="chevronLeft" size={15} />
          All orders
        </Link>
      }
    >
      <div style={{ maxWidth: 980, width: '100%' }}>{params?.id && <OrderDetailLoader id={params.id} />}</div>
    </AdminShell>
  );
}
