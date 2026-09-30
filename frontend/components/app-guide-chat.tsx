"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Send, Sparkles, X } from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, apiErrorMessage } from "@/lib/api";
import type { AzyncBotMessage } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { MarkdownContent } from "./markdown-content";

const welcomeMessage: AzyncBotMessage = {
  id: "azync-bot-welcome",
  role: "ASSISTANT",
  content:
    "I am the Azync HackHub AI assistant. Ask me about product features, hackathon workflows, teams, submissions, judging, GitHub, or Solana inside the application.",
};

const routeLabels: Record<string, string> = {
  "/": "Hackathons",
  "/dashboard": "Overview",
  "/teams": "Team workspace",
  "/organizer": "Manage hackathons",
  "/submissions": "Team submissions",
  "/judge": "Judge workspace",
  "/submit": "Submit project",
};

const pendingMessages = [
  "Hacking…",
  "Azyncing…",
  "Connecting the dots…",
  "Tracing the workflow…",
  "Checking the evidence…",
  "Shaping the answer…",
];

type BotEdge = "left" | "right" | "bottom";
type BotPlacement = { edge: BotEdge; ratio: number };

const PANEL_GAP = 10;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function botMargin() {
  return window.innerWidth <= 760 ? 14 : 22;
}

function botBounds(width: number, height: number) {
  const margin = botMargin();
  const headerBottom =
    document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect()
      .bottom || 64;
  // Judge Inquiry owns the bottom-right action. Reserve its composer zone so
  // the floating, draggable product guide cannot intercept the send control.
  // The same bound applies after a drag, rather than merely moving the bot on
  // first render and letting it overlap again on the next pointer interaction.
  const judgeComposerReserve = document.querySelector(".judge-workspace")
    ? 74
    : 0;

  return {
    margin,
    minX: margin,
    maxX: Math.max(margin, window.innerWidth - margin - width),
    minY: headerBottom + margin,
    maxY: Math.max(
      headerBottom + margin,
      window.innerHeight - margin - height - judgeComposerReserve,
    ),
  };
}

function pickPendingMessage(previous: string) {
  const choices = pendingMessages.filter((message) => message !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function AzyncBot() {
  const auth = useAuth();
  const pathname = usePathname();
  const privacyKey = `${auth.sessionVersion}:${auth.user?.id ?? "anonymous"}`;
  const privacyKeyRef = useRef(privacyKey);
  privacyKeyRef.current = privacyKey;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AzyncBotMessage[]>([welcomeMessage]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [routes, setRoutes] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(pendingMessages[0]);
  const [streamedPending, setStreamedPending] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const placementRef = useRef<BotPlacement>({ edge: "right", ratio: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [edge, setEdge] = useState<BotEdge>("right");

  useEffect(() => {
    setHydrated(true);
  }, []);

  const placeTrigger = useCallback((placement: BotPlacement) => {
    const bot = botRef.current;
    const trigger = triggerRef.current;
    if (!bot || !trigger) return;

    const bounds = botBounds(trigger.offsetWidth, trigger.offsetHeight);
    const ratio = clamp(placement.ratio, 0, 1);
    const x =
      placement.edge === "left"
        ? bounds.minX
        : placement.edge === "right"
          ? bounds.maxX
          : bounds.minX + (bounds.maxX - bounds.minX) * ratio;
    const y =
      placement.edge === "bottom"
        ? bounds.maxY
        : bounds.minY + (bounds.maxY - bounds.minY) * ratio;

    bot.style.left = `${x}px`;
    bot.style.top = `${y}px`;
    bot.style.right = "auto";
    bot.style.bottom = "auto";
  }, []);

  const placePanel = useCallback(() => {
    const bot = botRef.current;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!bot || !panel || !trigger) return;

    const margin = botMargin();
    const triggerRect = trigger.getBoundingClientRect();
    const headerBottom =
      document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect()
        .bottom || 64;
    const minTop = headerBottom + margin;
    const viewportBottom = window.innerHeight - margin;
    panel.style.maxWidth = `${Math.max(240, window.innerWidth - margin * 2)}px`;
    const preferredPanelHeight = window.innerWidth <= 760 ? 620 : 650;
    const panelHeight = Math.max(
      0,
      Math.min(
        preferredPanelHeight,
        viewportBottom - minTop - triggerRect.height - PANEL_GAP,
      ),
    );

    panel.style.height = `${panelHeight}px`;
    const panelRect = panel.getBoundingClientRect();
    let left = triggerRect.left + (triggerRect.width - panelRect.width) / 2;
    if (placementRef.current.edge === "left") left = margin;
    if (placementRef.current.edge === "right") {
      left = window.innerWidth - margin - panelRect.width;
    }
    left = clamp(left, margin, window.innerWidth - margin - panelRect.width);

    const usableCenter = minTop + (viewportBottom - minTop) / 2;
    const buttonAbove =
      triggerRect.top + triggerRect.height / 2 <= usableCenter;
    const maximumGroupTop = Math.max(
      minTop,
      viewportBottom - triggerRect.height - PANEL_GAP - panelHeight,
    );
    const groupTop = buttonAbove
      ? clamp(triggerRect.top, minTop, maximumGroupTop)
      : clamp(
          triggerRect.top - PANEL_GAP - panelHeight,
          minTop,
          maximumGroupTop,
        );
    const temporaryButtonTop = buttonAbove
      ? groupTop
      : groupTop + panelHeight + PANEL_GAP;
    const panelTop = buttonAbove
      ? groupTop + triggerRect.height + PANEL_GAP
      : groupTop;

    panel.dataset.side = buttonAbove ? "below-button" : "above-button";
    panel.style.left = `${left}px`;
    panel.style.top = `${panelTop}px`;
    bot.style.top = `${temporaryButtonTop}px`;
  }, []);

  const snapTrigger = useCallback(
    (x: number, y: number) => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const bounds = botBounds(trigger.offsetWidth, trigger.offsetHeight);
      const distances: Record<BotEdge, number> = {
        left: Math.abs(x - bounds.minX),
        right: Math.abs(bounds.maxX - x),
        bottom: Math.abs(bounds.maxY - y),
      };
      const candidates: BotEdge[] = [
        placementRef.current.edge,
        "left",
        "right",
        "bottom",
      ];
      const nextEdge = candidates.reduce<BotEdge>(
        (closest, candidate) =>
          distances[candidate] < distances[closest] ? candidate : closest,
        placementRef.current.edge,
      );
      const ratio =
        nextEdge === "bottom"
          ? (x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)
          : (y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY);
      const placement = { edge: nextEdge, ratio: clamp(ratio, 0, 1) };

      placementRef.current = placement;
      setEdge(nextEdge);
      placeTrigger(placement);
    },
    [placeTrigger],
  );

  useLayoutEffect(() => {
    placeTrigger(placementRef.current);
  }, [placeTrigger]);

  useLayoutEffect(() => {
    if (open) {
      placePanel();
    } else if (!dragRef.current?.moved) {
      placeTrigger(placementRef.current);
    }
  }, [edge, open, placePanel, placeTrigger]);

  useEffect(() => {
    function reposition() {
      placeTrigger(placementRef.current);
      if (open) requestAnimationFrame(placePanel);
    }

    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open, placePanel, placeTrigger]);

  useLayoutEffect(() => {
    // AppFrame outlives route content. On a streamed route, the bot can mount
    // before JudgeWorkspace exists, so its initial bounds do not yet include
    // the composer safe zone. Reposition once the route content is committed.
    const reposition = () => {
      placeTrigger(placementRef.current);
      if (open) requestAnimationFrame(placePanel);
    };
    reposition();
    const frame = requestAnimationFrame(reposition);
    if (pathname !== "/judge" || document.querySelector(".judge-workspace")) {
      return () => cancelAnimationFrame(frame);
    }
    const observer = new MutationObserver(() => {
      if (!document.querySelector(".judge-workspace")) return;
      observer.disconnect();
      reposition();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, pathname, placePanel, placeTrigger]);

  function handleDragStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const bot = botRef.current;
    if (!bot) return;

    const rect = bot.getBoundingClientRect();
    bot.style.left = `${rect.left}px`;
    bot.style.top = `${rect.top}px`;
    bot.style.right = "auto";
    bot.style.bottom = "auto";
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: rect.left,
      startY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDragMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const bot = botRef.current;
    const trigger = triggerRef.current;
    if (!drag || !bot || !trigger || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      bot.dataset.dragging = "true";
      if (open) setOpen(false);
    }

    const bounds = botBounds(trigger.offsetWidth, trigger.offsetHeight);
    bot.style.left = `${clamp(drag.startX + deltaX, bounds.minX, bounds.maxX)}px`;
    bot.style.top = `${clamp(drag.startY + deltaY, bounds.minY, bounds.maxY)}px`;
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (botRef.current) delete botRef.current.dataset.dragging;
    if (!drag.moved) return;

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const rect = botRef.current?.getBoundingClientRect();
    if (rect) snapTrigger(rect.left, rect.top);
  }

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !botRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !auth.user || suggestions.length > 0) return;
    const requestKey = privacyKey;
    let cancelled = false;
    api.bot
      .suggestions()
      .then((response) => {
        if (!cancelled && requestKey === privacyKeyRef.current) {
          setSuggestions(response.suggestions);
        }
      })
      .catch((reason) => {
        if (!cancelled && requestKey === privacyKeyRef.current) {
          setError(apiErrorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, privacyKey, suggestions.length, auth.user]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const log = logRef.current;
      if (log) log.scrollTop = log.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, messages, sending, streamedPending]);

  useEffect(() => {
    if (!sending) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStreamedPending(pendingMessage);
      return;
    }

    let character = 0;
    const timer = window.setInterval(() => {
      character += 1;
      setStreamedPending(pendingMessage.slice(0, character));
      if (character >= pendingMessage.length) window.clearInterval(timer);
    }, 45);
    return () => window.clearInterval(timer);
  }, [pendingMessage, sending]);

  async function sendQuestion(event: FormEvent) {
    event.preventDefault();
    const content = question.trim();
    if (!content || sending || !auth.user) return;
    const requestKey = privacyKeyRef.current;

    const userMessage: AzyncBotMessage = {
      id: crypto.randomUUID(),
      role: "USER",
      content,
    };
    const recentMessages = messages
      .filter((message) => message.id !== welcomeMessage.id)
      .slice(-10)
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));

    setQuestion("");
    setError(null);
    setMessages((current) => [...current, userMessage]);
    setPendingMessage((current) => pickPendingMessage(current));
    setStreamedPending("");
    setSending(true);
    try {
      const response = await api.bot.ask(content, recentMessages);
      if (requestKey !== privacyKeyRef.current) return;
      const answer = response.answer;
      if (answer) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "ASSISTANT",
            content: answer,
          },
        ]);
      }
      setRoutes(response.relatedRoutes);
      if (response.suggestedQuestions.length > 0) {
        setSuggestions(response.suggestedQuestions);
      }
      if (response.error) setError(response.error.message);
    } catch (reason) {
      if (requestKey !== privacyKeyRef.current) return;
      setQuestion(content);
      setError(apiErrorMessage(reason));
    } finally {
      if (requestKey === privacyKeyRef.current) setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div
      className={`app-guide ${open ? "open" : ""}`}
      data-edge={edge}
      ref={botRef}
    >
      {open && (
        <section
          className="app-guide-panel"
          aria-label="Azync-Bot, AI assistant"
          ref={panelRef}
        >
          <header>
            <div>
              <p className="eyebrow">Azync-Bot</p>
              <h2>AI assistant</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close Azync-Bot"
            >
              <X size={18} />
            </button>
          </header>

          <div className="app-guide-scope">
            <Sparkles size={14} />
            <span>
              Product assistant · for Azync HackHub and hackathon workflows.
            </span>
          </div>

          <div
            className="app-guide-log"
            ref={logRef}
            aria-live="polite"
            aria-busy={sending}
          >
            {messages.map((message) => (
              <article
                className={`app-guide-message ${message.role.toLowerCase()}`}
                key={message.id}
              >
                <strong>{message.role === "USER" ? "You" : "Azync-Bot"}</strong>
                <MarkdownContent
                  content={message.content}
                  className="chat-markdown"
                />
              </article>
            ))}
            {sending && (
              <div
                className="analysis-progress"
                role="status"
                aria-label="Azync-Bot is processing the question"
              >
                <span aria-hidden="true" />
                <p aria-hidden="true">
                  {streamedPending}
                  <i className="pending-cursor">▍</i>
                </p>
              </div>
            )}
          </div>

          {routes.length > 0 && (
            <nav className="app-guide-routes" aria-label="Related pages">
              {routes.map((route) => (
                <Link key={route} href={route}>
                  {routeLabels[route] || "Open related page"}
                </Link>
              ))}
            </nav>
          )}

          {suggestions.length > 0 && (
            <div className="app-guide-suggestions">
              {suggestions.slice(0, 4).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="app-guide-error" role="alert">
              {error}
            </p>
          )}

          <form className="app-guide-composer" onSubmit={sendQuestion}>
            <label htmlFor="azync-bot-question" className="sr-only">
              Question for Azync-Bot
            </label>
            <textarea
              id="azync-bot-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                auth.user
                  ? "What would you like to ask about Azync HackHub?"
                  : "Sign in to chat with Azync-Bot"
              }
              rows={3}
              disabled={!auth.user || sending}
            />
            <button
              type="submit"
              className="send-button"
              disabled={!auth.user || !question.trim() || sending}
              aria-label="Send question to Azync-Bot"
            >
              <Send size={17} />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className="app-guide-trigger"
        ref={triggerRef}
        disabled={!hydrated}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-label={open ? "Close Azync-Bot" : "Open Azync-Bot"}
        aria-describedby="azync-bot-drag-hint"
      >
        <Bot size={18} />
        <span>Azync-Bot</span>
      </button>
      <span className="sr-only" id="azync-bot-drag-hint">
        Drag this button to the left, right, or bottom edge of the screen.
      </span>
    </div>
  );
}
