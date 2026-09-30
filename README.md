# Azync HackHub

Azync HackHub is a hackathon operating workspace for teams, organizers, and judges. It connects team planning, GitHub repository provisioning and CI, immutable final submissions, Solana credentials, evidence-grounded AI review, and human-controlled winner certification.

> **Status:** MVP implementation, five-account desktop E2E, the Vietnamese submission source set, and ten Vietnamese review PDFs are complete. Final judge notes, live winner selection, demo video, screenshots, and the designed deck remain.
> **Updated:** 30 September 2026

## Product flow

```text
Organizer creates and publishes an event
  → participants create teams and register
  → Start Building provisions a private GitHub repository
  → teams plan work and receive signed CI updates
  → a revisioned draft is validated
  → final submission creates an immutable receipt
  → Azync issues an AHSUB cNFT on Solana devnet
  → evidence is collected before AI analysis
  → assigned judges inspect the brief and ask private follow-ups
  → organizer records one human winner and may issue an AHWIN cNFT
```

## Core capabilities

### Participants

- GitHub OAuth identity, profiles, teams, roles, and one-time invites.
- Private repository provisioning with collaborators, Actions workflow, and signed webhook.
- Hackathon-specific planning with areas, tasks, dependencies, critical path, templates, forecast, alerts, and activity.
- Revisioned draft persistence and deterministic pre-submit validation.
- Immutable final receipt and verifiable Solana submission credential.

### Judges

- Assigned-submission access with versioned, evidence-linked project briefs.
- Clear separation of participant claims, source evidence, CI execution, demo reachability, and platform credentials.
- Encrypted private inquiry scoped to a judge, event, and submission.
- Safe Markdown responses with provenance and uncertainty.
- AI remains advisory and cannot write official scores or choose winners.

### Organizers

- Event, track, rule, rubric, registration, and judge-assignment operations.
- Submission search, filters, detail, and safe CSV export.
- Deadline enforcement and post-event read access.
- One immutable post-deadline winner decision with a separate `AHWIN` cNFT.

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16.3, React 19.2, TypeScript 5.9, React Hook Form, Zod, Socket.IO, Solana wallet adapters |
| Backend | NestJS 11 modular monolith, Prisma 5.22, PostgreSQL, Redis, BullMQ, Socket.IO |
| GitHub | OAuth, Octokit, private repositories, Actions, signed raw-body webhooks |
| Solana | web3.js, Metaplex Bubblegum, Umi, devnet compressed NFTs |
| AI | commit-pinned evidence, versioned context, strict structured output, business validation, encrypted judge chat |
| Tests | Jest, Supertest, Playwright, isolated Docker E2E harness |

## Trust boundaries

- Backend authorization applies to every protected object and realtime room.
- Participant content is untrusted input.
- Deterministic collectors establish evidence before AI interpretation.
- Submission and winner cNFTs certify Azync records, not participant runtime behavior.
- Final receipts and winner decisions are immutable.
- Submission success survives AI or blockchain provider delay.

## Repository layout

```text
azync-hackhub-backend/   NestJS API, workers, Prisma schema, and E2E harness
frontend/                Next.js application and Playwright smoke tests
docs/                    Current product, technical, business, and submission documents
```

## Local development

### Requirements

- Node.js 20 or newer
- npm
- Docker Desktop for PostgreSQL and Redis workflows
- GitHub OAuth/App credentials for live integration paths
- Solana devnet RPC, Bubblegum tree, and backend authority for live minting
- AI gateway credentials for live analysis

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The default development URL is `http://localhost:3000`.

### Backend

```bash
cd azync-hackhub-backend
npm install
npm run docker:up
npm run start:dev
```

The default API URL is `http://localhost:3001`. Environment values are deployment-specific and must not be committed.

## Verification

### Frontend

```bash
cd frontend
npm run typecheck
npm run build
npm run test:smoke
```

### Backend

```bash
cd azync-hackhub-backend
npm run build
npm run test:unit
npm run test:e2e:ci
```

The E2E harness creates and owns isolated PostgreSQL, Redis, network, migration, fixture, and cleanup resources. Destructive tests must not run against the live development database.

## Current evidence and limits

- A five-account desktop flow exercised organizer, judge, two-member team, and solo participant roles.
- One live final submission completed GitHub, Solana devnet, and AI analysis paths.
- Additional unavailable, malicious, stale, retry, and second-judge cases used clearly labeled isolated fixtures.
- Phantom ran live. Solflare extension-level behavior remains blocked.
- The sample project is source plus a static walkthrough and was not deployed.
- Mobile testing was outside the agreed scope.

See the [product verification summary](docs/VERIFICATION.md) for tested paths, results, evidence boundaries, and remaining limitations.

## Documentation

- [Documentation index](docs/README.md)
- [Product One-Pager](docs/01-product/PRODUCT_ONE_PAGER.md)
- [Technical Appendix](docs/02-technical/TECHNICAL_APPENDIX.md)
- [Risk and Compliance Note](docs/02-technical/RISK_COMPLIANCE_NOTE.md)
- [Product Verification](docs/VERIFICATION.md)
- [Pitch Deck Source](docs/03-business/PITCH_DECK.md)
- [Corelia Submission Content](docs/04-submission/CORELIA_PROJECT_SUBMISSION_VI.md)
- [Câu chuyện dự án](docs/04-submission/CAU_CHUYEN_DU_AN_VI.md)

## Remaining submission actions

1. Complete the human judge review.
2. Select and verify the live winner certificate.
3. Capture the final screenshot set.
4. Design and export the final deck; review the generated document PDFs.
5. Record and upload the demo video.

## License

No public open-source license has been granted. The repository remains all rights reserved unless the owner adds a license file.
