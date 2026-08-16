# Phrases to cut

## Throat-clearing openers

Delete these and start at the first real claim. The sentence almost always survives intact.

- "Here's the thing:" / "Here's what happened:" / "Here's why this matters:"
- "Let's dive into" / "Let's take a look at" / "Let's break this down"
- "In this section, we'll" / "The rest of this doc will"
- "It's worth noting that" / "It's important to understand that"
- "I should mention that" / "Just to be clear,"
- "At its core," / "Fundamentally," / "Essentially," / "Ultimately,"
- "The short answer is" (then give the answer)
- "Great question." / "You're right to ask." (in chat replies — just answer)

## Emphasis crutches

These add emphasis without adding information.

- "very", "really", "quite", "extremely", "incredibly", "remarkably"
- "simply", "just", "merely", "actually", "basically", "literally"
- "crucial", "critical", "vital", "essential" — unless something genuinely breaks without it
- "robust", "seamless", "powerful", "elegant", "clean" as bare adjectives
- "significantly", "substantially", "dramatically" without a number attached

**Adverbs generally.** If the verb needs an adverb, the verb is wrong. "Ran quickly" → "sprinted".
"Failed silently" is an exception worth keeping — it is a term of art in this repo and names a
specific failure mode.

## Business and consultant register

- "leverage" → use
- "utilize" → use
- "facilitate" → let, help, cause
- "in order to" → to
- "at this point in time" → now
- "a number of" → some, or the actual number
- "surface area", "blast radius" — keep these, they are load-bearing in this repo's risk vocabulary
- "best practices", "industry standard", "battle-tested", "production-grade"
- "unlock", "empower", "streamline", "supercharge"
- "delve", "tapestry", "realm", "landscape", "journey"

## Hedges that hide a missing answer

Hedging is correct when you genuinely do not know — CLAUDE.md requires it for unverified claims.
It is slop when it substitutes for finding out.

- "may or may not", "could potentially", "might possibly"
- "some would argue", "it depends" (then say what it depends on)
- "generally speaking", "for the most part", "in most cases" — without naming the exception

If you can check, check. If you cannot, say **which** verification was not run — CLAUDE.md's
Communication section requires naming the unexercised failure surface (native SQLite, safe-area
insets, drifted prod data, real Oura tokens, Samsung WebView).

## Filler transitions

- "That said," / "With that said," / "Having said that,"
- "Moving on," / "Next up," / "Now, "
- "As mentioned above," (if they need the reminder, the doc is too long)
- "As we can see," / "Clearly," / "Obviously,"

## Repo-specific tells

Phrases that show up in agent-written docs here and mean nothing:

- "improved reliability" → say which failure stopped happening
- "better performance" → say what got faster, and by how much, and measured how
- "cleaned up the code" → say what was removed
- "made it more robust" → name the input that used to break it
- "should now work" → either it was observed working, or it was not; say which
- "comprehensive" / "thorough" describing your own work
- "This change ensures that…" → describe the mechanism, not the guarantee
