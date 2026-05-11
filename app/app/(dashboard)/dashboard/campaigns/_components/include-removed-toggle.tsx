import Link from 'next/link';

export function IncludeRemovedToggle({ active }: { active: boolean }) {
  return (
    <Link
      href={active ? '/dashboard/campaigns' : '/dashboard/campaigns?include_removed=1'}
      className="text-xs text-muted-foreground hover:underline"
    >
      {active ? '☑ Incluindo REMOVED' : '☐ Incluir REMOVED'}
    </Link>
  );
}
