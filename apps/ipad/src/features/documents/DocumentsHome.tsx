import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Toolbar } from '../../ui/components';
import { DocumentBrowser } from './DocumentBrowser';
export default function DocumentsHome() {
  return <>
    <Toolbar title="Company documents" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><DocumentBrowser projectId={null} /></div>
  </>;
}
