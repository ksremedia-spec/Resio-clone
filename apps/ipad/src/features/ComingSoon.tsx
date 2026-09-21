import { Toolbar, EmptyState } from '../ui/components';
import { MenuToggle, ToolbarActions } from '../layouts/AppShell';

export default function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return <>
    <Toolbar title={title} leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner"><EmptyState icon="layout" title={`${title} arrives in ${phase}`}>The data model and permissions for this module are already in place; the screens are built in the next vertical slice.</EmptyState></div></div>
  </>;
}
