# Product vision

## What I noticed

Most assistants with memory try to learn *you* — your tone, interests, and habits — so
they can feel more personal. ChatGPT might notice that you prefer concise answers.

Kivi does not need to infer any of that. It has something more useful. A normal assistant
knows what you told *it*. Kivi knows what you told **everyone else**: the deadline you
gave your team, the promise you made a partner, and the things you said while getting
work done.

That is the opportunity: a record of your outgoing work, rather than your conversations
with a bot. An inferred profile would be the wrong thing to build from that.

## What it becomes

Kivi becomes the place you ask instead of searching six apps. What you dictate ends up in
Slack, Gmail, Linear, and threads you may never find again. Kivi saw all of it leave.

As Hey Kivi becomes the main interface, memory helps it know which document, thread, or
person you mean without asking every time. Dictation becomes one of its tools, but it
still behaves deterministically when you invoke it there.

**Source history** keeps every dictation in full and searchable. Nothing is summarised
away.

**Semantic memory** is much smaller. Something moves into it only if you would otherwise
need to look it up again, or if it constrains future work. Dates, owners, decisions,
numbers, and preferences stated as rules qualify. The content of a single message does
not. You can still find it, but it does not become a lasting claim.

Preferences are not Styles. You configure a Style beforehand to shape dictation. A
preference is something you happened to say without setting it up, and it only affects
drafting in Hey Kivi.

**That the record is the world.** Kivi stores what you dictated, not what happened. It says
"you said the sandbox was stable on the 3rd", not "the sandbox is stable". An answer
can be grounded in your history and still be wrong about your work.

**That everything said is a statement.** "We are moving the launch to Friday" is a decision.
"Should we move it?" is not. Treating the question as a decision is worse than missing it:
that false memory could later override something true.

**That the newest claim wins.** When the history settles a contradiction, Kivi keeps the
older version as history. When it does not, Kivi shows both claims instead of quietly
choosing one.

Kivi does not learn about your health, personal finances, family, or politics. It also
leaves out a colleague's private life beyond their working role. "Rahul owns the migration"
is remembered; "Rahul is resigning" is not, because Rahul never chose to be part of
this.

You can still find your own words when you ask. Refusing that would be paternalism, not
privacy. Credentials are the exception: never learned and never repeated back.

## Why anyone would trust it

Every memory shows the words it came from, and every answer shows what it was built from.
If a citation does not support a claim, Kivi drops it. If your history has no answer, Kivi
says so. You do not have to read through everything; you can inspect anything specific and
delete what is wrong in one tap.

No inferred profile of the user. No proactive surfacing; Kivi speaks when asked. No memory
that makes Kivi *act* instead of answering or drafting. No confidence scores paraded as
numbers. And nothing from memory reaches dictation, which must return the same sentence
next month that it returns today.
