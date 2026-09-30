"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowRight, CircleAlert, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api, apiErrorMessage } from "@/lib/api";
import { submissionSchema, type SubmissionFormValues } from "@/lib/schemas";
import type { Hackathon, Team } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { startRouteTransition } from "@/lib/route-navigation";
import { WalletButton } from "./wallet-button";
import { SubmissionDraftValidator } from "./submission-draft-validator";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="field-error" role="alert">
      {message}
    </p>
  ) : null;
}

function emptySubmissionForm(): SubmissionFormValues {
  return {
    hackathonId: "",
    trackId: "",
    teamId: "",
    projectName: "",
    description: "",
    githubUrl: "",
    demoUrl: "",
    videoUrl: "",
    slidesUrl: "",
    participantBlockchainEvidenceUrl: "",
  };
}

export function SubmissionForm() {
  const router = useRouter();
  const auth = useAuth();
  const { publicKey } = useWallet();
  const [hackathons, setHackathons] = useState<Hackathon[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [recipientInFlight, setRecipientInFlight] = useState<string | null>(
    null,
  );
  const sessionVersionRef = useRef(auth.sessionVersion);
  sessionVersionRef.current = auth.sessionVersion;
  const form = useForm<SubmissionFormValues>({
    resolver: zodResolver(submissionSchema),
    defaultValues: emptySubmissionForm(),
  });
  const selectedHackathon = form.watch("hackathonId");
  const selectedTracks =
    hackathons.find((item) => item.id === selectedHackathon)?.tracks || [];
  const availableTeams = useMemo(
    () =>
      teams.filter(
        (team) => !selectedHackathon || team.hackathonId === selectedHackathon,
      ),
    [teams, selectedHackathon],
  );

  useEffect(() => {
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    setHackathons([]);
    setTeams([]);
    setApiError(null);
    setDraftMessage(null);
    setDraftRevision(null);
    setSavingDraft(false);
    form.reset(emptySubmissionForm());
    if (!auth.user) {
      setLoadingOptions(false);
      return;
    }
    setLoadingOptions(true);
    Promise.all([api.hackathons.list(), api.teams.mine()])
      .then(([events, memberships]) => {
        if (cancelled || requestVersion !== sessionVersionRef.current) return;
        const query = new URLSearchParams(window.location.search);
        const preferredTeam = memberships.find(
          (team) => team.id === query.get("team"),
        );
        const preferredEvent = events.find(
          (event) => event.id === query.get("hackathon"),
        );
        const firstEvent =
          preferredEvent ||
          events.find((event) => event.id === preferredTeam?.hackathonId) ||
          events.find((event) =>
            memberships.some((team) => team.hackathonId === event.id),
          );
        const firstTeam =
          preferredTeam ||
          memberships.find((team) => team.hackathonId === firstEvent?.id);
        setHackathons(events);
        setTeams(memberships);
        // Set the related selectors in one form update. Setting the event first
        // briefly produced an empty available-team list and cleared the team on
        // a direct reload of /submit?hackathon=...&team=....
        form.reset({
          ...emptySubmissionForm(),
          hackathonId: firstEvent?.id || "",
          teamId: firstTeam?.id || "",
        });
      })
      .catch((reason) => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setApiError(apiErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!cancelled && requestVersion === sessionVersionRef.current) {
          setLoadingOptions(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user, auth.sessionVersion, form]);

  useEffect(() => {
    if (loadingOptions) return;
    const currentTeam = form.getValues("teamId");
    if (!availableTeams.some((team) => team.id === currentTeam)) {
      form.setValue("teamId", availableTeams[0]?.id || "");
    }
  }, [availableTeams, form, loadingOptions]);

  const selectedTeam = form.watch("teamId");
  useEffect(() => {
    if (!selectedTeam || !selectedHackathon || !auth.user) return;
    const requestVersion = auth.sessionVersion;
    let cancelled = false;
    api.submissions
      .draft(selectedTeam, selectedHackathon)
      .then(({ payload, updatedAt }) => {
        if (cancelled || requestVersion !== sessionVersionRef.current) return;
        (
          [
            "trackId",
            "projectName",
            "description",
            "githubUrl",
            "demoUrl",
            "videoUrl",
            "slidesUrl",
            "participantBlockchainEvidenceUrl",
          ] as const
        ).forEach((key) => {
          if (payload[key] != null) form.setValue(key, payload[key] || "");
        });
        setDraftRevision(updatedAt ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [auth.user, auth.sessionVersion, selectedHackathon, selectedTeam, form]);

  async function saveDraft() {
    const values = form.getValues();
    if (!auth.user || !values.teamId || !values.hackathonId) {
      setApiError("Choose an event and team before saving a draft.");
      return;
    }
    const requestVersion = auth.sessionVersion;
    try {
      setSavingDraft(true);
      setApiError(null);
      setDraftMessage(null);
      const saved = await api.submissions.saveDraft({
        ...values,
        trackId: values.trackId || undefined,
        projectName: values.projectName || undefined,
        description: values.description || undefined,
        githubUrl: values.githubUrl || undefined,
        demoUrl: values.demoUrl || undefined,
        videoUrl: values.videoUrl || undefined,
        slidesUrl: values.slidesUrl || undefined,
        participantBlockchainEvidenceUrl:
          values.participantBlockchainEvidenceUrl || undefined,
      });
      if (requestVersion !== sessionVersionRef.current) return;
      setDraftRevision(saved.updatedAt ?? null);
      form.reset(values);
      setDraftMessage(
        "Draft saved. You can add a recipient wallet when you finalize.",
      );
    } catch (reason) {
      if (requestVersion === sessionVersionRef.current)
        setApiError(apiErrorMessage(reason));
    } finally {
      if (requestVersion === sessionVersionRef.current) setSavingDraft(false);
    }
  }

  async function onSubmit(values: SubmissionFormValues) {
    if (!auth.user) {
      setApiError(
        "Sign in with GitHub before connecting a wallet and submitting.",
      );
      return;
    }
    if (!publicKey) {
      setApiError("Connect Phantom or Solflare before submitting.");
      return;
    }
    // Snapshot the connected address before creating the request. A later wallet
    // account switch must not silently change the recipient in this submission.
    const recipient = publicKey.toBase58();
    const requestVersion = auth.sessionVersion;
    try {
      setApiError(null);
      setRecipientInFlight(recipient);
      const submission = await api.submissions.create({
        ...values,
        trackId: values.trackId || undefined,
        videoUrl: values.videoUrl || undefined,
        walletAddress: recipient,
      });
      if (requestVersion !== sessionVersionRef.current) return;
      const successUrl = `/submit/success?id=${submission.id}`;
      startRouteTransition(successUrl);
      router.push(successUrl);
    } catch (reason) {
      if (requestVersion === sessionVersionRef.current) {
        setApiError(apiErrorMessage(reason));
      }
    } finally {
      if (requestVersion === sessionVersionRef.current)
        setRecipientInFlight(null);
    }
  }

  return (
    <div className="submission-layout">
      <aside className="submission-guide">
        <p className="eyebrow">Submission protocol</p>
        <h1>Submit a project with verifiable evidence.</h1>
        <p>
          Repository and demo details become sources for the evidence engine.
          The Solana transaction timestamps the submission record.
        </p>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Confirm the scope</strong>
              <p>Select the correct hackathon and team.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Attach real sources</strong>
              <p>The repository and demo must be accessible.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Choose the proof recipient</strong>
              <p>
                The wallet only provides the credential recipient address; the
                Azync backend mints the proof.
              </p>
            </div>
          </li>
        </ol>
        <div className="privacy-note">
          <LockKeyhole size={17} />
          <span>Your private key never leaves the wallet extension.</span>
        </div>
      </aside>

      <section className="submission-sheet">
        <header>
          <div>
            <p className="eyebrow">Project details</p>
            <h2>Submission information</h2>
          </div>
          <WalletButton />
        </header>

        {!auth.user && !auth.loading && (
          <div className="notice warning">
            <CircleAlert size={18} />
            Sign in with GitHub to load teams and submit a project.
          </div>
        )}
        {apiError && (
          <div className="notice danger" role="alert">
            {apiError}
          </div>
        )}
        {draftMessage && (
          <div className="notice success" role="status">
            {draftMessage}
          </div>
        )}
        {recipientInFlight && (
          <div className="notice warning" role="status">
            Submitting with recipient {recipientInFlight}. Switching wallets now
            will not change the address already sent.
          </div>
        )}

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="submission-fields"
        >
          <div className="field-pair">
            <label>
              <span>Hackathon</span>
              <select
                {...form.register("hackathonId")}
                disabled={!auth.user || loadingOptions}
              >
                <option value="">Select hackathon</option>
                {hackathons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <FieldError
                message={form.formState.errors.hackathonId?.message}
              />
            </label>
            <label>
              <span>Team</span>
              <select
                {...form.register("teamId")}
                disabled={!auth.user || loadingOptions}
              >
                <option value="">Select team</option>
                {availableTeams.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <FieldError message={form.formState.errors.teamId?.message} />
            </label>
          </div>
          {selectedTracks.length > 0 && (
            <label>
              <span>Track</span>
              <select {...form.register("trackId")}>
                <option value="">Select at submission</option>
                {selectedTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Project name</span>
            <input
              {...form.register("projectName")}
              placeholder="Name shown on the submission credential"
              autoComplete="off"
            />
            <FieldError message={form.formState.errors.projectName?.message} />
          </label>
          <label>
            <span>Short description</span>
            <textarea
              {...form.register("description")}
              rows={5}
              placeholder="The problem, solution, and what the team actually built"
            />
            <div className="field-meta">
              <FieldError
                message={form.formState.errors.description?.message}
              />
              <span>{form.watch("description").length}/500</span>
            </div>
          </label>
          <div className="field-pair">
            <label>
              <span>GitHub repository</span>
              <input
                {...form.register("githubUrl")}
                type="url"
                placeholder="https://github.com/org/repository"
              />
              <FieldError message={form.formState.errors.githubUrl?.message} />
            </label>
            <label>
              <span>Live demo</span>
              <input
                {...form.register("demoUrl")}
                type="url"
                placeholder="https://demo.example.com"
              />
              <FieldError message={form.formState.errors.demoUrl?.message} />
            </label>
          </div>
          <label>
            <span>
              Video walkthrough <em>optional</em>
            </span>
            <input
              {...form.register("videoUrl")}
              type="url"
              placeholder="https://youtube.com/..."
            />
            <FieldError message={form.formState.errors.videoUrl?.message} />
          </label>
          <div className="field-pair">
            <label>
              <span>Slides URL</span>
              <input
                {...form.register("slidesUrl")}
                type="url"
                placeholder="https://docs.google.com/..."
              />
              <FieldError message={form.formState.errors.slidesUrl?.message} />
            </label>
            <label>
              <span>Blockchain evidence URL</span>
              <input
                {...form.register("participantBlockchainEvidenceUrl")}
                type="url"
                placeholder="https://explorer.solana.com/..."
              />
              <FieldError
                message={
                  form.formState.errors.participantBlockchainEvidenceUrl
                    ?.message
                }
              />
            </label>
          </div>
          <footer className="form-footer">
            <p>
              Azync's backend sponsors and sends the credential mint. Your
              wallet supplies only the recipient address; you do not sign a
              submission transaction.
            </p>
            <p>
              {!auth.user
                ? "Sign in with GitHub before connecting a wallet."
                : publicKey
                  ? "This wallet address will be submitted as the recipient. The backend chooses the cluster and sends the transaction; you do not sign the submission transaction."
                  : "Connect a wallet to provide the proof recipient address. Switch wallet accounts before submitting if you want to use a different address."}
            </p>
            <button
              className="button secondary"
              type="button"
              onClick={() => void saveDraft()}
              disabled={!auth.user || savingDraft}
            >
              {savingDraft ? "Saving draft..." : "Save draft"}
            </button>
            {auth.user && selectedTeam && selectedHackathon && (
              <SubmissionDraftValidator
                teamId={selectedTeam}
                hackathonId={selectedHackathon}
                draftRevision={draftRevision}
                stale={form.formState.isDirty}
              />
            )}
            <button
              className="button primary"
              type="submit"
              disabled={!auth.user || !publicKey || form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? "Recording submission…"
                : "Submit and create proof"}{" "}
              <ArrowRight size={17} />
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
