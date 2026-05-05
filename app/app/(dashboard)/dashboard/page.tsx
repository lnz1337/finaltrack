import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Resumo</h1>
      <p className="text-sm text-muted-foreground">
        Métricas agregadas (spend, revenue, ROAS) chegam na Fase 2 com a integração Google Ads.
      </p>
      <Card>
        <CardHeader><CardTitle>Conversões</CardTitle></CardHeader>
        <CardContent>
          <Link href="/dashboard/conversions" className="text-primary underline">
            Ver lista de conversões →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
