import type { contracts } from '@buildline/core';
import { DocumentBrowser } from './DocumentBrowser';
export default function ProjectDocuments({ project }: { project: contracts.ProjectDetail }) { return <DocumentBrowser projectId={project.id} />; }
