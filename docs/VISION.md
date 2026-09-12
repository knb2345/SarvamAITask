# Product vision

*532 words.*

## What I noticed

Most assistants that add memory try to learn *you*: tone, interests, habits, so they feel
more personal. ChatGPT might notice you prefer concise answers.

Kivi need infer none of that, because it has something more useful. A normal assistant
knows what you told *it*. Kivi knows what you told **everyone else**: the deadline you
gave your team, the promise you made a partner, the things you said while getting work
done.

That is the opportunity. Kivi is built around a record of your outgoing work, not around
conversations with a bot, which is why an inferred profile would be the wrong thing to
build.

## What it becomes

The place you ask instead of searching six apps. Everything you dictate scatters into
Slack, Gmail, Linear, threads you will never find again. Kivi saw all of it leave.

As Hey Kivi grows into the main interface, memory is what makes tool use useful: knowing
which document, thread or person you mean without being told every time. Dictation becomes
one tool inside it, still deterministic when invoked through it.

## What is kept, and what is promoted

**Source history** is every dictation in full, all of it searchable. Nothing is summarised
away.

**Semantic memory** is the much smaller set promoted from it, by one test: *would you
otherwise need to look this up again, or does it constrain future work?* Dates, owners,
decisions, numbers and preferences stated as rules qualify. The content of a single message
does not; it stays findable without becoming a lasting claim.

Preferences are not Styles. A Style is configured beforehand and shapes dictation. These
are things you happened to say and never set up, and they only affect drafting in Hey Kivi.

## What Kivi must never assume

**That the record is the world.** Kivi stores what you dictated, not what happened. It says
"you said the sandbox was stable on the 3rd", not "the sandbox is stable". An answer can be
grounded in your history and still wrong about your work.

**That everything said is a statement.** "We are moving the launch to Friday" is a decision.
"Should we move it?" is not, and treating it as one is worse than missing it, because that
false memory could later override something true.

**That the newest claim wins.** Contradictions are resolved where the history settles them,
keeping the older version as history. Where nothing settles it, Kivi shows both rather than
quietly deciding.

## What is never learned

Your health, personal finances, family, politics. A colleague's private life beyond their
working role: "Rahul owns the migration" is remembered, "Rahul is resigning" is not, because
Rahul never chose to be part of this.

You can still find your own words when you ask; refusing would be paternalism, not privacy.
Credentials are the exception, never learned and never repeated back.

## Why anyone would trust it

Every memory shows the words it came from. Every answer shows what it was built from, and a
citation that does not support the claim is dropped rather than shown. If your history has
no answer, Kivi says so. You need never read all of it: only inspect anything specific, and
delete what is wrong in one tap.

## What this rules out

No inferred profile of the user. No proactive surfacing; Kivi speaks when asked. No memory
that makes Kivi *act* rather than answer or draft. No confidence scores paraded as numbers.
And nothing from memory reaches dictation, which must return the same sentence next month
that it returns today.
