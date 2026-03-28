/**
 * pi-extension-smart-edit
 *
 * Overrides the built-in `edit` tool with a smarter version that tolerates
 * whitespace/indentation differences. Ideal for local LLMs that can't
 * reproduce exact whitespace.
 *
 * Matching strategy:
 * 1. Exact match (same as built-in)
 * 2. Whitespace-normalized match (strips leading/trailing whitespace per line)
 * 3. Prettier-normalized match (format file, then match)
 *
 * After a fuzzy replacement, prettier is run on the result to ensure
 * consistent formatting.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { smartEdit } from "./smart-match.ts";

// Replicate the edit-diff utilities we need (they're not all exported)
function detectLineEnding(content: string): string {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(text: string, ending: string): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF")
    ? { bom: "\uFEFF", text: content.slice(1) }
    : { bom: "", text: content };
}

/** Simple unified diff for the tool result */
function simpleDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const output: string[] = [];

  // Find first different line
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  // Find last different line
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  // Context before
  const contextStart = Math.max(0, start - 3);
  for (let i = contextStart; i < start; i++) {
    output.push(` ${i + 1} ${oldLines[i]}`);
  }

  // Removed lines
  for (let i = start; i <= oldEnd; i++) {
    output.push(`-${i + 1} ${oldLines[i]}`);
  }

  // Added lines
  for (let i = start; i <= newEnd; i++) {
    output.push(`+${i + 1} ${newLines[i]}`);
  }

  // Context after
  const contextEnd = Math.min(oldLines.length - 1, oldEnd + 3);
  for (let i = oldEnd + 1; i <= contextEnd; i++) {
    output.push(` ${i + 1} ${oldLines[i]}`);
  }

  return output.join("\n");
}

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "edit",
    label: "Smart Edit",
    description:
      "Edit a file by replacing text (smart-edit: tolerates minor whitespace/indentation differences). Provide oldText as close to the original as possible; the tool will match even if indentation is slightly off.",
    parameters: editSchema,

    async execute(_toolCallId, { path, oldText, newText }, signal, _onUpdate, ctx) {
      // Strip leading @ (some models add it)
      const cleanPath = path.startsWith("@") ? path.slice(1) : path;
      const absolutePath = resolve(ctx.cwd, cleanPath);

      return withFileMutationQueue(absolutePath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted");

        // Check file exists
        try {
          await access(absolutePath, constants.R_OK | constants.W_OK);
        } catch {
          throw new Error(`File not found: ${path}`);
        }

        if (signal?.aborted) throw new Error("Operation aborted");

        // Read file
        const buffer = await readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");

        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);
        const normalizedOldText = normalizeToLF(oldText);
        const normalizedNewText = normalizeToLF(newText);

        if (signal?.aborted) throw new Error("Operation aborted");

        // Smart edit: tries exact → quote/whitespace-normalized (line-based)
        const result = smartEdit(
          normalizedContent,
          normalizedOldText,
          normalizedNewText
        );

        if (signal?.aborted) throw new Error("Operation aborted");

        // Write result
        const finalContent = bom + restoreLineEndings(result.newContent, originalEnding);
        await writeFile(absolutePath, finalContent, "utf-8");

        // Generate diff for display
        const diff = simpleDiff(normalizedContent, result.newContent);
        const firstChangedLine = diff
          .split("\n")
          .find((l) => l.startsWith("+"))
          ?.match(/^\+(\d+)/)?.[1];

        const matchInfo =
          result.matchType === "exact"
            ? ""
            : ` (matched via ${result.matchType})`;

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully replaced text in ${path}.${matchInfo}`,
            },
          ],
          details: {
            diff,
            firstChangedLine: firstChangedLine ? parseInt(firstChangedLine) : undefined,
          },
        };
      });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("smart-edit extension loaded", "info");
  });
}
