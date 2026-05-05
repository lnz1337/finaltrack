import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface ConversionRow {
  id: string;
  occurred_at: string;
  conversion_type: string;
  amount: number;
  currency: string;
  match_method: string | null;
  click_id: string | null;
  external_order_id: string;
  offers: { name: string } | null;
}

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function shortId(id: string | null) {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function ConversionsTable({ rows }: { rows: ConversionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma conversão ainda.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Oferta</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Match</TableHead>
          <TableHead>Click ID</TableHead>
          <TableHead>Pedido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{fmtDate(r.occurred_at)}</TableCell>
            <TableCell>{r.offers?.name ?? '—'}</TableCell>
            <TableCell>{r.conversion_type}</TableCell>
            <TableCell className="text-right">{fmtMoney(Number(r.amount), r.currency)}</TableCell>
            <TableCell>{r.match_method ?? '—'}</TableCell>
            <TableCell><code className="text-xs">{shortId(r.click_id)}</code></TableCell>
            <TableCell><code className="text-xs">{r.external_order_id}</code></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
