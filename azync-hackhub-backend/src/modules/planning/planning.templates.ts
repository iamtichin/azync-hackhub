export type PlanningTemplateId = 'web3' | 'ai' | 'fullstack';

type TemplateTask = {
  key: string;
  area: string;
  title: string;
  estimatedHours: number;
  priority: 'high' | 'medium' | 'low';
  dependsOn?: string[];
};

export type PlanningTemplate = {
  areas: Array<{ key: string; name: string; color: string }>;
  tasks: TemplateTask[];
};

export const PLANNING_TEMPLATES: Record<PlanningTemplateId, PlanningTemplate> = {
  web3: {
    areas: [
      { key: 'contract', name: 'Smart Contract', color: '#8b5cf6' },
      { key: 'app', name: 'Application', color: '#0ea5e9' },
      { key: 'demo', name: 'Demo & Proof', color: '#f59e0b' },
    ],
    tasks: [
      { key: 'program', area: 'contract', title: 'Implement core program', estimatedHours: 6, priority: 'high' },
      { key: 'client', area: 'app', title: 'Integrate wallet and client', estimatedHours: 5, priority: 'high', dependsOn: ['program'] },
      { key: 'proof', area: 'demo', title: 'Prepare verifiable demo proof', estimatedHours: 3, priority: 'high', dependsOn: ['client'] },
    ],
  },
  ai: {
    areas: [
      { key: 'data', name: 'Data & Evaluation', color: '#10b981' },
      { key: 'product', name: 'AI Product', color: '#6366f1' },
      { key: 'demo', name: 'Demo', color: '#f59e0b' },
    ],
    tasks: [
      { key: 'dataset', area: 'data', title: 'Define evaluation dataset', estimatedHours: 4, priority: 'high' },
      { key: 'pipeline', area: 'product', title: 'Build bounded AI workflow', estimatedHours: 6, priority: 'high', dependsOn: ['dataset'] },
      { key: 'evaluate', area: 'data', title: 'Run evaluation and review failures', estimatedHours: 3, priority: 'high', dependsOn: ['pipeline'] },
      { key: 'demo', area: 'demo', title: 'Prepare evidence-backed demo', estimatedHours: 3, priority: 'medium', dependsOn: ['evaluate'] },
    ],
  },
  fullstack: {
    areas: [
      { key: 'backend', name: 'Backend', color: '#22c55e' },
      { key: 'frontend', name: 'Frontend', color: '#3b82f6' },
      { key: 'quality', name: 'Testing & Demo', color: '#f97316' },
    ],
    tasks: [
      { key: 'api', area: 'backend', title: 'Build core API', estimatedHours: 5, priority: 'high' },
      { key: 'ui', area: 'frontend', title: 'Build primary user flow', estimatedHours: 5, priority: 'high', dependsOn: ['api'] },
      { key: 'test', area: 'quality', title: 'Test the end-to-end flow', estimatedHours: 3, priority: 'high', dependsOn: ['ui'] },
      { key: 'demo', area: 'quality', title: 'Rehearse final demo', estimatedHours: 2, priority: 'medium', dependsOn: ['test'] },
    ],
  },
};
