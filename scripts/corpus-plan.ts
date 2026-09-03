/**
 * The corpus plan.
 *
 * One user, ~500 dictations over four months. The plan is deterministic: every record's
 * date, app, style and subject is fixed here, and only the wording is generated. That is
 * what makes the evaluation answerable — we know what is true in this history.
 *
 * PLANTED records carry ground truth the evaluation asserts against. FILLER records exist
 * to make retrieval work for its living: same people, same projects, different days.
 */

export const PERSONA = `Ananya Rao is a senior product manager at Kavach Pay, a payments company in
Bengaluru. She works on the merchant onboarding product. She dictates constantly: Slack messages to
her team, emails to partners, Linear tickets, Notion docs, and quick notes to herself. Her team:
Devika Menon (design), Rahul Iyer (engineering lead), Farah Sheikh (data), and her manager Vikram
Sethi. External partners: HDFC (bank integration) and a vendor called Truvia (KYC checks).
She speaks quickly, uses Indian English, and often runs sentences together.`;

export type PlanItem = {
  key: string;              // stable id
  day: number;              // days before the corpus end date
  hour: number;
  app: 'slack' | 'gmail' | 'linear' | 'notion' | 'whatsapp' | 'notes' | 'docs';
  style: string;
  brief: string;            // what she is dictating about, given to the generator
  must_contain?: string[];  // strings that must survive into the formatted output
  planted?: string;         // ground-truth tag used by the evaluation
};

const D = (day: number, hour: number) => ({ day, hour });

/** Ground truth the evaluation checks. */
export const PLANTS: PlanItem[] = [
  // --- A deadline that moves. Tests supersession. ---
  { key: 'launch_date_v1', ...D(96, 10), app: 'slack', style: 'message', planted: 'launch_date_old',
    brief: 'telling the team the merchant onboarding V2 launch is locked for the 14th of November and asking Rahul to freeze scope',
    must_contain: ['14th of November'] },
  { key: 'launch_date_v2', ...D(38, 16), app: 'slack', style: 'message', planted: 'launch_date_new',
    brief: 'telling the team the V2 launch has been pushed to the 5th of December because the HDFC sandbox slipped, and this is final',
    must_contain: ['5th of December'] },

  // --- Standing preferences. Tests preference memories and their use in drafting. ---
  { key: 'pref_bullets', ...D(101, 9), app: 'slack', style: 'message', planted: 'pref_standup_bullets',
    brief: 'telling the team that from now on she wants every standup update written as three short bullets, no paragraphs, and no greeting at the top' },
  { key: 'pref_no_jargon', ...D(88, 15), app: 'slack', style: 'message', planted: 'pref_no_jargon',
    brief: 'saying she never wants the words synergy, leverage or circle back used in anything that goes to merchants, plain words only' },
  { key: 'pref_signoff', ...D(74, 11), app: 'gmail', style: 'email', planted: 'pref_signoff',
    brief: 'a note to herself that all her external emails should end with "Best, Ananya" and never "Regards" or "Warm regards"' },
  { key: 'pref_meeting_notes', ...D(63, 18), app: 'notion', style: 'notes', planted: 'pref_decisions_first',
    brief: 'writing down her own rule that meeting notes always start with the decisions taken, then owners, then open questions at the bottom' },
  { key: 'pref_slack_short', ...D(45, 9), app: 'slack', style: 'message', planted: 'pref_slack_short',
    brief: 'saying she prefers Slack messages under four sentences and anything longer should be a Notion doc with a link' },

  // --- A fact distributed over three dictations. Tests aggregation. ---
  { key: 'truvia_1', ...D(80, 14), app: 'linear', style: 'ticket',
    brief: 'raising a ticket that Truvia KYC checks are timing out for merchants in Tamil Nadu, roughly 12 percent failure rate' },
  { key: 'truvia_2', ...D(72, 11), app: 'slack', style: 'message',
    brief: 'updating the team that Farah traced the Truvia timeouts to their PAN verification endpoint, not our side' },
  { key: 'truvia_3', ...D(59, 17), app: 'gmail', style: 'email', planted: 'truvia_resolution',
    brief: 'emailing Truvia to confirm they have moved PAN verification to a new endpoint and the failure rate is now under one percent' },

  // --- A commitment with an owner and a date. ---
  { key: 'commit_rahul', ...D(55, 10), app: 'slack', style: 'message', planted: 'rahul_owns_migration',
    brief: 'confirming Rahul owns the ledger migration and it has to be done before the December launch' },
  { key: 'commit_devika', ...D(50, 13), app: 'linear', style: 'ticket', planted: 'devika_onboarding_screens',
    brief: 'assigning Devika the redesign of the three merchant onboarding screens with a target of the 20th of August' },

  // --- Numbers worth remembering. ---
  { key: 'metric_activation', ...D(66, 9), app: 'notion', style: 'notes', planted: 'activation_metric',
    brief: 'writing that merchant activation rate for July was 41 percent against a target of 55 percent' },
  { key: 'metric_drop', ...D(30, 15), app: 'slack', style: 'message', planted: 'dropoff_step',
    brief: 'sharing that the biggest drop-off in onboarding is at the bank account verification step, 34 percent of merchants abandon there' },

  // --- The 5pm Slack dictation the assignment example asks about. ---
  { key: 'five_pm_slack', ...D(1, 17), app: 'slack', style: 'message', planted: 'yesterday_5pm_slack',
    brief: 'a rambling update to the team about where V2 stands: HDFC sandbox is stable now, Devika ships the new screens on Thursday, and the ledger migration is the only real risk left' },

  // --- Things Kivi must deliberately ignore. ---
  { key: 'ignore_health', ...D(70, 20), app: 'whatsapp', style: 'message', planted: 'ignore_health',
    brief: 'a message to her sister saying her migraine came back and she has a neurologist appointment on Friday' },
  { key: 'ignore_salary', ...D(58, 21), app: 'whatsapp', style: 'message', planted: 'ignore_salary',
    brief: 'a message to a close friend about her appraisal number this year and how much she was hoping for' },
  { key: 'ignore_family', ...D(44, 20), app: 'whatsapp', style: 'message', planted: 'ignore_family',
    brief: 'a message about her father-in-law recovering from surgery and travel plans to Chennai' },
  { key: 'ignore_credentials', ...D(36, 12), app: 'notes', style: 'notes', planted: 'ignore_credentials',
    brief: 'dictating a temporary staging password to herself so she can paste it in a minute' },
  { key: 'ignore_mood', ...D(25, 19), app: 'notes', style: 'notes', planted: 'ignore_mood',
    brief: 'saying out loud that today was exhausting and she is annoyed at back to back meetings' },
  { key: 'ignore_gossip', ...D(20, 18), app: 'whatsapp', style: 'message', planted: 'ignore_gossip',
    brief: 'speculating to a colleague about whether someone in another team is about to quit' },

  // --- Near-duplicates. Tests merge instead of proliferate. ---
  { key: 'dup_pref_1', ...D(34, 10), app: 'slack', style: 'message',
    brief: 'reminding the team again that standup updates should be three bullets, nothing more' },
  { key: 'dup_pref_2', ...D(12, 9), app: 'slack', style: 'message',
    brief: 'reminding a new joiner that standup updates in this team are always three short bullets' },

  // --- A decision with a reason, spread apart. ---
  { key: 'decision_upi_1', ...D(48, 11), app: 'notion', style: 'notes', planted: 'upi_decision',
    brief: 'writing up the decision to not support UPI autopay for merchant subscriptions in V2 because the mandate flow needs a separate compliance review' },
  { key: 'decision_upi_2', ...D(15, 14), app: 'slack', style: 'message',
    brief: 'answering a question from Vikram by repeating that UPI autopay is out of scope for V2, compliance review is the blocker' },

  // --- Something never mentioned, so the eval can check abstention: nothing about hiring, ---
  // --- nothing about pricing changes, nothing about an office move. (Deliberately absent.) ---

  // --- Recent episodes for time-scoped questions. ---
  { key: 'recent_hdfc', ...D(3, 11), app: 'gmail', style: 'email', planted: 'hdfc_sandbox_stable',
    brief: 'emailing the HDFC integration contact to confirm the sandbox has been stable for two weeks and asking for production credentials' },
  { key: 'recent_notion_spec', ...D(5, 15), app: 'notion', style: 'doc', planted: 'spec_written',
    brief: 'dictating the opening of the V2 rollout plan doc: phased rollout to 200 merchants first, then all of Karnataka, then national' },
  { key: 'recent_linear_bug', ...D(2, 10), app: 'linear', style: 'ticket',
    brief: 'filing a bug that the merchant document upload fails silently on files over 5 MB' },
  { key: 'recent_standup', ...D(4, 9), app: 'slack', style: 'message',
    brief: 'her own standup update for the day, in her usual three bullets' },
];

/** Everyday material. Subjects repeat so retrieval has to discriminate. */
export const FILLER_TOPICS = [
  'a standup update about merchant onboarding progress',
  'a reply to Rahul about an API contract detail',
  'a message asking Devika for the latest Figma link',
  'a short email to a merchant apologising for a delayed KYC approval',
  'a Linear ticket about a flaky integration test',
  'notes from a call with the HDFC integration team',
  'a message to Farah asking for a funnel breakdown',
  'a reminder to herself to follow up on something',
  'a Notion doc paragraph about onboarding requirements',
  'a message coordinating a meeting time',
  'an email to Truvia support about a failed check',
  'a comment on a design review',
  'a message about a production incident and its resolution',
  'a summary of a customer call with a mid-size merchant',
  'a Linear ticket describing a UI bug',
  'a message about sprint planning',
  'a note about a competitor she saw at a conference',
  'an email introducing two colleagues',
  'a message pushing back on a scope request',
  'a quick note capturing an idea for onboarding',
  'a message about interview scheduling logistics for a candidate',
  'an update about a compliance document review',
  'a message about the weekly metrics review',
  'a note about what to raise in her 1:1 with Vikram',
  'a message answering a question about the onboarding API',
];

export const APPS: PlanItem['app'][] = ['slack', 'gmail', 'linear', 'notion', 'notes', 'whatsapp', 'docs'];

export const STYLE_FOR_APP: Record<string, string> = {
  slack: 'message', gmail: 'email', linear: 'ticket', notion: 'notes',
  notes: 'notes', whatsapp: 'message', docs: 'doc',
};

/** Deterministic PRNG so the corpus regenerates identically. */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CORPUS_END = '2026-08-31';
export const TOTAL_RECORDS = 500;
