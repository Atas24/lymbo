// Structured messages between agents, managed by Lymbo (not by the agents).
import type { JobContext } from "./types";

export type AgentMessage =
  | {
      type: "job.recommended";
      from: "KASPR";
      to: "SONNY";
      job: JobContext;
      resumeId: number;
      /** Local keyword check (no AI). */
      match: import("./keywords").KeywordMatch;
    }
  | {
      type: "alignment.result";
      from: "SONNY";
      to: "USER";
      job: JobContext;
      verdict: "good" | "workshop";
      summary: string;
      missing: string[];
    };

type Handler = (m: AgentMessage) => void;
const handlers = new Set<Handler>();
const log: { at: Date; msg: AgentMessage }[] = [];

export const bus = {
  publish(msg: AgentMessage) {
    log.push({ at: new Date(), msg });
    handlers.forEach((h) => h(msg));
  },
  subscribe(h: Handler) {
    handlers.add(h);
    return () => void handlers.delete(h);
  },
  history: () => [...log],
};
