export const APP_GUIDE_ROUTES = [
  '/',
  '/dashboard',
  '/teams',
  '/organizer',
  '/submissions',
  '/judge',
  '/submit',
] as const;

export const APP_GUIDE_SUGGESTIONS = [
  'How do I create a hackathon?',
  'How do I create a team and add members?',
  'How do I connect a team GitHub repository?',
  'How do I submit a project and create proof?',
  'How does a judge start reviewing a submission?',
] as const;

export const APP_GUIDE_KNOWLEDGE = {
  source: 'English frontend UI source audited on 2026-09-30',
  product: 'Azync HackHub',
  audience: 'Participants, team admins, organizers, and assigned judges',
  navigation: [
    { label: 'Hackathons', route: '/', purpose: 'View open hackathons.' },
    {
      label: 'Overview',
      route: '/dashboard',
      purpose:
        'View teams, open hackathons, organizer scope, and Solana status.',
    },
    {
      label: 'Team',
      route: '/teams',
      purpose: 'Create a team and open its Team workspace.',
    },
    {
      label: 'Organizer',
      route: '/organizer',
      purpose: 'Create and manage hackathons.',
    },
    {
      label: 'Submissions',
      route: '/submissions',
      purpose: 'Open the Submission Ledger for participating teams.',
    },
    {
      label: 'Judge workspace',
      route: '/judge',
      purpose: 'Read evidence briefs and use Judge Inquiry.',
    },
    {
      label: 'Submit project',
      route: '/submit',
      purpose: 'Submit a project and create Solana devnet proof.',
    },
  ],
  principles: [
    'Describe navigation with the exact visible menu, section, tab, field, and button labels.',
    'Routes are internal navigation metadata only and must never appear in answer text or suggested questions.',
    'AI analysis is advisory. The human judge owns every score and final decision.',
    'Judge Inquiry is submission-scoped and evidence-grounded; Azync-Bot explains product workflows.',
    'Never treat repository presence, a reachable demo, or AI prose alone as proof that a feature works.',
    'A VERIFIED evidence status confirms only the recorded facts. A 404 response, a discovered test file, or a platform credential does not prove that the project runs.',
    'The Azync cNFT is a platform receipt for the final submission. It does not prove project runtime behavior or a project-owned Solana integration.',
  ],
  workflows: [
    {
      intent: 'Browse competitions',
      screen: 'Hackathons',
      route: '/',
      steps: [
        'Open Hackathons in the main navigation.',
        'Choose View hackathon on a hackathon card.',
        'The competition page shows Rules, Rubric, Leaderboard, and Submissions.',
        'Use Create team or Submit project in the hackathon header when appropriate.',
      ],
    },
    {
      intent: 'Use the personal overview',
      screen: 'Overview',
      route: '/dashboard',
      steps: [
        'Open Overview in the main navigation.',
        'The metrics show Open hackathons, My teams, organizer scope, and Solana readiness.',
        'Active workspaces link to each team; Hackathons you manage links to organizer controls.',
        'Use Create team in the page header to start a new team.',
      ],
    },
    {
      intent: 'Create a team',
      screen: 'Team workspace',
      route: '/teams',
      steps: [
        'Open Team in the main navigation.',
        'In Open a new workspace, enter Team name and choose Hackathon.',
        'Press Create team.',
        'The new team appears under My teams; select it to open its workspace.',
      ],
    },
    {
      intent: 'Manage team members and settings',
      screen: 'Team workspace — Members tab',
      route: '/teams',
      steps: [
        'Open a team from My teams, then select the Members tab.',
        'In Add member, enter a User ID and choose Member or Admin.',
        'Press Add to team. Only a team admin can use this action.',
        'A user must sign in with GitHub at least once before their User ID can be added.',
        'Team admins can change Team name or Default wallet in Identity & wallet and press Save changes.',
      ],
    },
    {
      intent: 'Register a team for its competition',
      screen: 'Team workspace header',
      route: '/teams',
      steps: [
        'Open the relevant team workspace.',
        'Confirm the competition and remaining time in the deadline banner.',
        'Press Register team for hackathon in the page header.',
      ],
    },
    {
      intent: 'Plan team execution',
      screen: 'Team workspace — Planning Canvas tab',
      route: '/teams',
      steps: [
        'Select the Planning Canvas tab.',
        'Optionally choose a template under Start from a template.',
        'Create a planning area, then add tasks with Area, Assignee, Hours, and Priority.',
        'Use the dependency form to connect a task to the task it depends on.',
        'Filter the board by status or area; change task status directly on each kanban card.',
        'Critical path and area progress update from the planning data.',
      ],
    },
    {
      intent: 'Create or monitor a GitHub repository',
      screen: 'Team workspace — GitHub & Webhook tab',
      route: '/teams',
      steps: [
        'Open a team and select GitHub & Webhook.',
        'If no repository exists, edit Topics if needed and press Start building.',
        'The repository panel then shows Webhook, Last commit, Last push, and Workflow.',
        'Team admins can use Retry webhook when webhook setup needs to be configured again.',
        'To grant access, enter a GitHub username under Add collaborator and press Send invitation.',
        'Configured push webhooks update Last commit and Last push in realtime.',
      ],
    },
    {
      intent: 'Create a competition',
      screen: 'Organizer console',
      route: '/organizer',
      steps: [
        'Open Organizer in the main navigation.',
        'Press New hackathon in the top-right of Manage hackathons.',
        'In Create your first hackathon or Create another hackathon, enter Hackathon name, Starts, and Ends.',
        'Press Create hackathon.',
        'Only competitions owned by the signed-in organizer appear in the organizer selector.',
      ],
    },
    {
      intent: 'Configure competition rules and rubric',
      screen: 'Organizer console',
      route: '/organizer',
      steps: [
        'Choose the hackathon from the selector beside New hackathon.',
        'Under Rules, enter a rule name and description, then press Add rule.',
        'Under Rubric, enter criterion name, description, and Weight 0–1, then press Add criterion.',
        'Adding or removing an item creates a new rules or rubric version.',
        'Use Edit in the control strip to change the hackathon name or dates.',
      ],
    },
    {
      intent: 'Assign judges and monitor registrations',
      screen: 'Organizer console',
      route: '/organizer',
      steps: [
        'Under Assign judges, enter the judge User ID and press Assign.',
        'Use the remove action on a roster row to unassign a judge.',
        'Registered teams lists teams and member counts.',
        'Task progress leaderboard shows rank, completed tasks, in-progress tasks, and score.',
      ],
    },
    {
      intent: 'Submit a project',
      screen: 'Submit project',
      route: '/submit',
      steps: [
        'Sign in with GitHub, then open Submit project in the main navigation.',
        'Connect Phantom or Solflare so Azync can read the public recipient address. The wallet must be ready before submission.',
        'Choose Hackathon and Team, then enter Project name and Short description.',
        'Provide an accessible GitHub repository and Live demo; Video walkthrough is optional.',
        'Press Submit and create proof. The action stays disabled until both account and wallet are ready.',
        'The participant wallet does not sign the Azync credential mint. The backend authority mints the cNFT on Solana devnet to the selected public recipient address.',
      ],
    },
    {
      intent: 'Read submission confirmation',
      screen: 'Submission recorded',
      route: '/submissions',
      steps: [
        'After submission, the confirmation page shows Submission ID, status, Transaction signature, NFT asset ID, and Solana devnet.',
        'Use the copy icon beside Transaction signature when needed.',
        'View transaction on Explorer appears after mint completes.',
        'Use View evidence brief to continue to judging evidence when authorized.',
      ],
    },
    {
      intent: 'Track team submissions',
      screen: 'Submission Ledger — Team submissions',
      route: '/submissions',
      steps: [
        'Open Submissions in the main navigation.',
        'Read the Project, Team, Submission, AI, Solana, Evidence, and Actions columns.',
        'Explorer opens the Solana proof when available.',
        'Use AI in Actions to refresh analysis. If the fingerprint is unchanged, the completed job is reused instead of creating a duplicate.',
        'A changed source revision, rule, rubric, Solana finality, or evidence freshness can create a new versioned snapshot. Unchanged GitHub evidence may be reused and the new snapshot records a delta.',
        'If NFT status is nft_failed, use Mint in Actions to retry minting.',
        'Use Submit project in the page header to create another submission.',
      ],
    },
    {
      intent: 'Open and read the judging workspace',
      screen: 'Judge workspace',
      route: '/judge',
      steps: [
        'Sign in with a GitHub account assigned as a judge.',
        'Choose a competition in the Competition selector on the left.',
        'Choose a project under Submissions to load its Evidence brief.',
        'Check Analysis, Context version, Rules, and Rubric before relying on the brief.',
        'Review Project claim, Verified summary, Strengths, Open concerns, and Links supplied.',
        'Use Repository to inspect source or Refresh evidence after source, rule, or rubric changes.',
        'Do not describe refresh as always recollecting every source: unchanged GitHub evidence can be reused, while expiring evidence such as the demo probe can be collected again.',
      ],
    },
    {
      intent: 'Use Judge Inquiry',
      screen: 'Judge workspace — Judge Inquiry',
      route: '/judge',
      steps: [
        'Select a submission first, then ask in Question for this submission.',
        'Press Tab to accept the contextual suggestion and Shift+Enter to insert a new line.',
        'Use the plus button beside Ask about the evidence to create a separate chat session.',
        'The session selector shows each session title and message count.',
        'Evidence tags on an answer show its provenance.',
      ],
    },
  ],
  analysisStatus: {
    queued: 'Analysis is waiting to start; the workspace polls automatically.',
    processing:
      'Analysis is running; keep the workspace open for automatic updates.',
    retrying: 'A temporary problem occurred and the job is trying again.',
    completed: 'The validated advisory snapshot is ready to review.',
    failed:
      'Analysis stopped; inspect the displayed error and retry when the source or provider recovers.',
  },
  evidenceStatus: {
    VERIFIED: 'The collector deterministically confirmed the recorded facts.',
    UNVERIFIED:
      'A source responded, but the required success condition was not established.',
    UNAVAILABLE:
      'The source could not be checked; absence of evidence is not evidence of failure.',
  },
  permissions: [
    'GitHub sign-in is required for authenticated workspaces and actions.',
    'Only a team admin can manage members, settings, repository webhook actions, and collaborators.',
    'Only the owning organizer can configure a competition and assign judges.',
    'Only an assigned judge can open private analysis and Judge Inquiry for that competition.',
    'A compatible wallet is needed to submit a project, not to browse or judge.',
  ],
  troubleshooting: [
    'If a competition does not appear in Judge workspace, confirm the signed-in account is assigned as its judge.',
    'If a team cannot be selected on the submission form, confirm it belongs to the selected competition.',
    'If the submit button is disabled, confirm GitHub sign-in and a connected Phantom or Solflare wallet.',
    'If analysis is queued, processing, or retrying, leave the page open because the workspace polls automatically.',
    'If repository data is stale, inspect Webhook in GitHub & Webhook and use Retry webhook as a team admin.',
    'If Explorer is absent, mint confirmation may still be pending; inspect the NFT status in Submission Ledger.',
  ],
};

export type AppGuideRoute = (typeof APP_GUIDE_ROUTES)[number];
