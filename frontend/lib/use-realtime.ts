"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL } from "./api";
import type { TeamActivity } from "./types";

function token() {
  return typeof window === "undefined"
    ? undefined
    : window.sessionStorage.getItem("azync.access_token") || undefined;
}

const teamEvents = [
  "team:member-joined",
  "team:member-left",
  "area:created",
  "area:updated",
  "area:deleted",
  "task:created",
  "task:updated",
  "task:deleted",
  "dependency:created",
  "dependency:deleted",
  "planning:template-applied",
  "submission:confirmed",
  "submission:nft-failed",
  "repository:updated",
  "repository:collaborators-sync",
] as const;

const hackathonEvents = [
  "leaderboard:updated",
  "leaderboard:invalidated",
  "submission:new",
] as const;

export function useTeamRealtime(teamId: string, onUpdate: () => void) {
  useEffect(() => {
    const socket = io(API_URL, {
      transports: ["websocket", "polling"],
      auth: { token: token() },
    });
    const joinTeam = () => socket.emit("join:team", teamId);
    socket.on("connect", joinTeam);
    teamEvents.forEach((event) => socket.on(event, onUpdate));
    return () => {
      socket.off("connect", joinTeam);
      socket.emit("leave:team", teamId);
      socket.disconnect();
    };
  }, [onUpdate, teamId]);
}

/** Dedicated activity channel so callers can merge a cursor-based delta rather
 * than replacing newer local state with a delayed planning snapshot. */
export function useTeamActivityRealtime(
  teamId: string,
  onActivity: (activity: TeamActivity) => void,
  onReconnect: () => void,
) {
  useEffect(() => {
    const socket = io(API_URL, {
      transports: ["websocket", "polling"],
      auth: { token: token() },
    });
    const joinTeam = () => socket.emit("join:team", teamId);
    socket.on("connect", joinTeam);
    socket.on("planning:activity", onActivity);
    // `connect` also fires for the initial connection. Activity was already
    // loaded then, so only the Manager's actual reconnect should start a
    // cursor-delta drain.
    socket.io.on("reconnect", onReconnect);
    // Browser reconnect/online recovery uses the same cursor-drain path as a
    // Socket.IO reconnect, which also keeps this behavior testable offline.
    window.addEventListener("online", onReconnect);
    return () => {
      window.removeEventListener("online", onReconnect);
      socket.off("connect", joinTeam);
      socket.off("planning:activity", onActivity);
      socket.io.off("reconnect", onReconnect);
      socket.emit("leave:team", teamId);
      socket.disconnect();
    };
  }, [onActivity, onReconnect, teamId]);
}

export function useHackathonRealtime(
  hackathonId: string | null,
  onUpdate: () => void,
) {
  useEffect(() => {
    if (!hackathonId) return;
    const socket = io(API_URL, {
      transports: ["websocket", "polling"],
      auth: { token: token() },
    });
    const joinLeaderboard = () => socket.emit("join:leaderboard", hackathonId);
    socket.on("connect", joinLeaderboard);
    hackathonEvents.forEach((event) => socket.on(event, onUpdate));
    return () => {
      socket.off("connect", joinLeaderboard);
      socket.emit("leave:hackathon", hackathonId);
      socket.disconnect();
    };
  }, [hackathonId, onUpdate]);
}
