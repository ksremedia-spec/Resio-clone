import { EmptyState } from '../../ui/components';
export function ComingSoonSection({ title, phase }: { title: string; phase: string }) {
  return <div className="page-inner"><EmptyState icon="layout" title={`${title} arrives in ${phase}`}>The data model, permissions and audit trail for this section already exist; the screens are built in the next vertical slice.</EmptyState></div>;
}
