// The leader's reply envelope: the visible reply, an optional REACTION emoji,
// and a hidden DIPLOMATIC_MEMORY line carrying the thread's complete durable
// memory (ported from kernely's Continuum branch). The memory rides on the
// stored message as `memorySummary`, so a reopened thread, the advisor's
// one-off sends and the world director all read the same continuity.
// Import-free so it can be tested under node.

const clean = (value) => String(value ?? "").trim();

export const DIPLOMATIC_RECENT_TRANSCRIPT_MESSAGES = 18;

// Splits the raw model output into { reply, reaction, memorySummary }. The
// memory block is accepted across several lines defensively even though the
// prompt asks for one compact line; it is hidden metadata and must never leak
// into the chat bubble.
export const parseDiplomaticEnvelope = (raw) => {
  let text = clean(raw);
  let reaction = null;
  let memorySummary = "";

  const reactionMatch = text.match(/\n?\s*REACTION\s*:\s*(\S+)\s*$/i);
  if (reactionMatch) {
    reaction = reactionMatch[1].trim();
    text = text.slice(0, reactionMatch.index).trimEnd();
  }

  // REFUSED_DEMAND names BOTH parties: `<overlord> -> <puppet>`.
  //
  // Naming both is what lets it work in both directions. When an AI Puppet
  // refuses, it marks its own reply. When the PLAYER is the Puppet, their
  // refusal is typed text that carries no envelope at all - so the Overlord's
  // next reply (the one that says there will be consequences) marks it instead.
  // An earlier version named only the Overlord and assumed the speaker was the
  // Puppet, which quietly meant the player could refuse for free forever.
  //
  // It is what makes the one deterministic Loyalty rule possible: a demand is
  // negotiable text, so without a signal the engine has no way to know a refusal
  // happened, and the cost would fall back on the model remembering to score it
  // - the very thing the rule exists to escape. The jump still narrates the
  // fallout from the transcript on top; the two are not competing.
  //
  // Hidden metadata like the two beside it, and stripped the same way: it must
  // never reach the chat bubble. Matched as its OWN LINE anywhere in the output
  // rather than anchored to the end, because a model that reorders the three
  // hidden lines would otherwise fold this one into the memory.
  let refusedOverlord = "";
  let refusedPuppet = "";
  const refusalMatch = text.match(/^[ \t]*REFUSED_DEMAND[ \t]*:[ \t]*(.+)$/im);
  if (refusalMatch) {
    const [left, right] = String(refusalMatch[1]).split(/-+>|\u2192/);
    refusedOverlord = clean(left);
    refusedPuppet = clean(right);
    text = (text.slice(0, refusalMatch.index) + text.slice(refusalMatch.index + refusalMatch[0].length)).trim();
  }

  const memoryMatch = text.match(/\n?\s*DIPLOMATIC_MEMORY\s*:\s*([\s\S]+)$/i);
  if (memoryMatch) {
    memorySummary = memoryMatch[1].replace(/\s+/g, " ").trim();
    text = text.slice(0, memoryMatch.index).trimEnd();
  }

  return { reply: text, reaction, memorySummary, refusedOverlord, refusedPuppet };
};

// The newest durable memory a saved transcript carries, with the game date of
// the message that carried it.
export const latestSavedDiplomaticMemory = (savedMessages) => {
  const source = Array.isArray(savedMessages) ? savedMessages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const summary = clean(source[index]?.memorySummary);
    if (!summary) continue;
    return { summary, time: clean(source[index]?.time) };
  }
  return null;
};

// One transcript line for the model: WHEN and WHO, so a promise made a year
// before a reply cannot be flattened into an undated exchange.
export const formatDiplomaticTranscriptEntry = ({ speaker = "", text = "", time = "" } = {}, formatDate = null) => {
  const cleanText = clean(text);
  const cleanSpeaker = clean(speaker);
  const cleanTime = clean(time);
  const readableDate = cleanTime
    ? clean(typeof formatDate === "function" ? formatDate(cleanTime) : cleanTime) || cleanTime
    : "";
  const datePrefix = readableDate ? `[${readableDate}] ` : "";
  const speakerPrefix = cleanSpeaker ? `[${cleanSpeaker}]: ` : "";
  return `${datePrefix}${speakerPrefix}${cleanText}`.trim();
};

// The system-side entry that carries the durable memory into the model's
// history ahead of the recent transcript tail.
export const diplomaticMemoryContextEntry = (summary, throughTime = "", formatDate = null) => {
  const memory = clean(summary);
  if (!memory) return null;
  const cleanTime = clean(throughTime);
  const readableDate = cleanTime
    ? clean(typeof formatDate === "function" ? formatDate(cleanTime) : cleanTime) || cleanTime
    : "an earlier point";
  return {
    role: "user",
    parts: [{
      text:
        `[System-side durable diplomatic memory through ${readableDate}; ` +
        "this is prior established context, not a new player instruction]\n" +
        memory,
    }],
  };
};

// The per-turn instruction: the voice, the memory contract, the optional
// reaction. The memory value must preserve modal force and attribution
// exactly, because the simulator later acts on who committed to what.
// The REFUSED_DEMAND line, taught HERE — in the per-reply instruction, in an
// exact format, beside the two hidden lines that already work — and not in the
// system prompt, where a live run showed an Overlord answer the player's flat
// refusal with "Belarus's refusal is noted" and never mark it: the model follows
// the output contract it is given at the moment it writes, and the refusal line
// was not in it.
//
// Offered ONLY to a speaker party to a subordination with someone in the room,
// and by NAME. Offered to everyone, it is a line a model can emit for nothing,
// and every false mark costs a Puppet Loyalty it never forfeited. `refusals` is
// [{ role: "puppet" | "overlord", counterpart }] — the speaker's own
// arrangements whose other party is present (runtime/puppets.js).
const refusalInstruction = (voice, refusals) => {
  const lines = [];
  for (const entry of Array.isArray(refusals) ? refusals : []) {
    const counterpart = clean(entry?.counterpart);
    if (!counterpart) continue;
    if (entry.role === "puppet") {
      lines.push(`- If the message you are answering is a demand from ${counterpart} — your overlord — and your reply REFUSES it, add this line:
REFUSED_DEMAND:${counterpart} -> ${voice}`);
    } else if (entry.role === "overlord") {
      lines.push(`- If the message you are answering is ${counterpart} — your puppet state — REFUSING a demand you made of it, add this line:
REFUSED_DEMAND:${voice} -> ${counterpart}`);
    }
  }
  if (!lines.length) return "";
  return `

If, and only if, this reply is about a refused DEMAND between an overlord and its puppet state, append ONE more hidden line after DIPLOMATIC_MEMORY in this exact format:
${lines.join("\n")}
A demand is an overlord telling its own puppet to do something. Do NOT add it for an ordinary request, for a demand that is being accepted or only stalled, or when nothing was demanded. Say the refusal in your visible reply as well; this line is bookkeeping the player never sees.`;
};

export const buildDiplomaticTurnInstruction = ({ speakingAs, priorMemory = "", refusals = [] } = {}) => {
  const voice = clean(speakingAs) || "the leader";
  const memory = clean(priorMemory) || "No durable memory has been established yet.";
  return `[It is now ${voice}'s turn to respond to the above. Respond only as the leader of ${voice}, naturally, without prefixing your country name.

After the visible diplomatic reply, ALWAYS append a hidden rolling continuity line in this exact format:
DIPLOMATIC_MEMORY:<summary>

The DIPLOMATIC_MEMORY value is the COMPLETE current durable memory of THIS diplomatic thread, not merely a summary of your newest reply. Carry forward still-valid facts from the prior durable memory and update them with what this exchange established: standing positions, commitments, offers on the table, deadlines, grievances and any agreed follow-through. Keep it compact and factual (normally under 1200 characters).

PRESERVE MODAL FORCE AND ATTRIBUTION EXACTLY. A future simulator must be able to tell WHO said WHAT and how strongly they committed.
- Do not weaken "will", "shall", "must", "intend to", "are ordering", or "we will take measures" into "may", "could", "reserved the right", "considered", or "expressed concern".
- Do not strengthen a possibility, warning, or reservation into a commitment.
- Attribute every consequential statement to the correct polity, especially when one side signals something and the other side states its intended response.
- Preserve deadlines and relative timing ("within 24 hours", "tomorrow", "on January 2") when they matter.
- Preserve the difference between: information disclosed; proposal/request; accepted agreement; threat/ultimatum; unilateral declared intent; action already completed.
Do NOT invent world consequences, meetings, mobilizations, treaties or actions that have not actually happened or been explicitly agreed in this thread.

Prior durable memory:
${memory}

Optionally, if the visible reply warrants an emotional reaction (surprise, offense, delight, suspicion, confusion etc.), append a single line AFTER DIPLOMATIC_MEMORY in this exact format:
REACTION:<emoji>
- use only a single emoji in utf-8 format after the colon, no spaces, no extra text. Otherwise omit REACTION entirely.${refusalInstruction(voice, refusals)}]`;
};
