import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // The seed runs during container startup, so it must never delete user data.
  const hackathonData = {
    id: 'hack-demo-456',
    name: 'UniHackFest 2026',
    startDate: new Date('2026-09-01'),
    endDate: new Date('2026-09-30'),
    rulesVersion: 'rules-v1',
    rubricVersion: 'rubric-v1',
    rules: [
      {
        id: 'public-repository',
        name: 'Public source repository',
        description:
          'The submitted repository must be publicly accessible to judges at review time.',
      },
      {
        id: 'working-demo',
        name: 'Working demo',
        description:
          'The submission must provide a demo URL that judges can reach without private credentials.',
      },
      {
        id: 'solana-proof',
        name: 'Solana proof',
        description:
          'The submission must provide a finalized Solana transaction or other verifiable on-chain evidence.',
      },
    ],
    rubric: [
      {
        id: 'innovation',
        name: 'Innovation',
        description:
          'How novel and clearly differentiated the proposed solution is.',
        weight: 0.3,
        minScore: 0,
        maxScore: 10,
      },
      {
        id: 'technical-execution',
        name: 'Technical execution',
        description:
          'The quality, completeness, and verifiable depth of the implementation.',
        weight: 0.4,
        minScore: 0,
        maxScore: 10,
      },
      {
        id: 'impact-usability',
        name: 'Impact and usability',
        description:
          'The usefulness of the project for its target users and the quality of its user experience.',
        weight: 0.3,
        minScore: 0,
        maxScore: 10,
      },
    ],
  };
  const hackathon = await prisma.hackathon.upsert({
    where: { id: hackathonData.id },
    create: hackathonData,
    update: hackathonData,
  });

  const teamData = {
    id: 'team-demo-123',
    name: 'Team Azync',
    hackathonId: hackathon.id,
    walletAddress: null,
  };
  const team = await prisma.team.upsert({
    where: { id: teamData.id },
    create: teamData,
    update: teamData,
  });

  console.log('✅ Seed data created:');
  console.log('Team:', team);
  console.log('Hackathon:', hackathon);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
