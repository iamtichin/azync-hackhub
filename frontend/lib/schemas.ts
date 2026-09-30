import { z } from "zod";

export const submissionSchema = z.object({
  trackId: z.string().optional(),
  hackathonId: z.string().min(1, "Select a hackathon."),
  teamId: z.string().min(1, "Select a team."),
  projectName: z
    .string()
    .trim()
    .min(3, "Project name must contain at least 3 characters.")
    .max(100),
  description: z
    .string()
    .trim()
    .min(10, "Description must contain at least 10 characters.")
    .max(500),
  githubUrl: z
    .string()
    .url("Enter a valid GitHub URL.")
    .refine(
      (value) => new URL(value).hostname === "github.com",
      "The repository must be hosted on github.com.",
    ),
  demoUrl: z.string().url("Enter a valid demo URL."),
  videoUrl: z.union([
    z.literal(""),
    z.string().url("Enter a valid video URL."),
  ]),
  slidesUrl: z.string().url("Enter a valid slides URL."),
  participantBlockchainEvidenceUrl: z
    .string()
    .url("Enter a valid blockchain evidence URL."),
});

export type SubmissionFormValues = z.infer<typeof submissionSchema>;
