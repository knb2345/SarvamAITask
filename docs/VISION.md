# Product vision

*582 words.*

## What I noticed

Most assistants with memory try to learn *you* — your tone, interests, and habits — so they
can feel more personal. ChatGPT might notice that you prefer concise answers.

Kivi does not need to infer any of that. It has something more useful. A normal assistant
knows what you told *it*. Kivi knows what you told **everyone else**: the deadline you gave
your team, the promise you made a partner, the things you said while getting work done.

That is the opportunity. Kivi starts with a record of your outgoing work, not conversations
with a bot. Building an inferred profile from it would miss the point.

## What it becomes

Kivi becomes the place you ask instead of searching six apps. Your dictations scatter across
Slack, Gmail, Linear, and threads you will never find again. Kivi has the record of what you
sent.

As Hey Kivi becomes the main interface, memory helps it know which document, thread, or
person you mean without making you explain every time. Dictation becomes one of its tools,
and stays deterministic even when invoked through Hey Kivi.

## What is kept, and what is promoted

**Source history** keeps every dictation in full and makes all of it searchable. Nothing is
summarised away.

**Semantic memory** is much smaller. Something is promoted only if you would otherwise need
to look it up again, or if it constrains future work. Dates, owners, decisions, numbers, and
preferences stated as rules qualify. The content of a single message does not; you can
still find it, but Kivi does not turn it into a lasting claim.

Preferences are not Styles. You configure a Style beforehand to shape dictation. A preference
here is something you happened to say without setting anything up. It only affects drafting
in Hey Kivi.

## What Kivi must never assume

**That the record is the world.** Kivi stores what you dictated, not what happened. It can
say "you said the sandbox was stable on the 3rd", but not "the sandbox is stable". An answer
can be grounded in your history and still be wrong about your work.

**That everything said is a statement.** "We are moving the launch to Friday" is a decision.
"Should we move it?" is not. Treating the question as a decision is worse than missing it:
that false memory could later override something true.

**That the newest claim wins.** Kivi resolves a contradiction when the history settles it
and keeps the older version as history. When nothing settles it, Kivi shows both instead of
quietly choosing one.

## What is never learned

Kivi does not learn about your health, personal finances, family, or politics. It also leaves
out a colleague's private life beyond their working role. "Rahul owns the migration" can be
remembered; "Rahul is resigning" cannot. Rahul never chose to be part of this.

You can still find your own words when you ask. Refusing that would be paternalism, not
privacy. Credentials are the exception: Kivi never learns or repeats them.

## Why anyone would trust it

Every memory shows the words it came from. Every answer shows what it was built from. If a
citation does not support a claim, Kivi drops it. If your history has no answer, Kivi says
so. You do not have to read everything it knows; you can inspect any specific memory and
delete what is wrong in one tap.

## What this rules out

No inferred profile of the user. No proactive surfacing; Kivi speaks when asked. No memory
that makes Kivi *act* rather than answer or draft. No confidence scores paraded as numbers.
And memory never reaches dictation, which must return the same sentence next month that it
returns today.
